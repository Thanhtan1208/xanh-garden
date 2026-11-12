import { db } from '../core/store.js';
import { FREE_SHIPPING_FROM, HIGH_VALUE_FROM, SHIPPING_FEES } from '../core/rules.js';
import { newestProducts } from '../services/inventory.js';
import { describeVoucher, isLive } from '../services/vouchers.js';
import { currentEvent } from '../services/site.js';
import { normalize } from './kb.js';

// Trả lời NGẮN GỌN khi không dùng được mô hình AI: nhận diện ý định câu hỏi rồi trả lời bằng dữ liệu thật
// của cửa hàng (tối đa vài dòng). Câu không thuộc ý định nào thì trích 1–2 dòng liên quan nhất của cơ sở tri thức.

const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;
const has = (text, ...words) => words.some((word) => text.includes(word));
// Khớp nguyên từ, cho các từ ngắn dễ trùng sau khi bỏ dấu ("cho" = chó/cho, "qua" = quà/quá, "gia" nằm trong "giao").
const hasWord = (text, ...words) => words.some((word) => ` ${text} `.includes(` ${word} `));
const productLink = (product) => `[${product.name}](./product-detail.html?id=${product.id})`;
const categoryOf = (product) => db.categories.find((category) => Number(category.id) === Number(product.categoryId));
const ACCESSORY_CATEGORY = '5'; // chậu & phụ kiện: không gợi ý khi khách hỏi chọn cây
// Cây có thể gây kích ứng/độc nếu thú cưng hoặc trẻ nhỏ nhai (theo cơ sở tri thức), không gợi ý cho nhà có thú cưng.
const PET_RISK = ['luoi ho', 'trau ba', 'lan y', 'kim tien', 'phat tai', 'co may man', 'xuong rong'];

// "Ánh sáng: Chịu bóng, ánh sáng yếu" -> "chịu bóng, ánh sáng yếu"
function careValue(product, label) {
    const line = (product.care || []).find((item) => normalize(item).startsWith(normalize(label)));
    return line ? line.split(':').slice(1).join(':').trim().toLowerCase() : '';
}

function careShort(product) {
    const light = careValue(product, 'Ánh sáng');
    const water = careValue(product, 'Tưới nước');
    return [light, water && `tưới ${water}`].filter(Boolean).join(', ');
}

// Gợi ý chọn cây theo nhu cầu
const NEED_WORDS = [
    'van phong',
    'ban lam viec',
    'may tinh',
    'phong thuy',
    'tai loc',
    'khai truong',
    'tan gia',
    'ban cong',
    'qua tang',
    'de cham',
    'hay quen',
    'nguoi moi',
    'loc khong khi',
    'thu cung',
    'it anh sang',
    'thieu sang'
];

function recommend(q) {
    const office = has(q, 'van phong', 'ban lam viec', 'may tinh', 'man hinh', 'cong so', 'ban hoc', 'phong lam viec', 'laptop');
    const lowLight =
        office ||
        has(q, 'it anh sang', 'thieu sang', 'phong toi', 'khong co cua so', 'bong ram', 'trong nha', 'phong ngu', 'may lanh', 'dieu hoa');
    const sunny = has(q, 'ban cong', 'nhieu nang', 'san thuong', 'ngoai troi', 'cua so co nang', 'nang truc tiep');
    const easy = has(
        q,
        'de cham',
        'luoi',
        'ban ron',
        'hay quen',
        'nguoi moi',
        'it tuoi',
        'cong tac',
        'khong co thoi gian',
        'it thoi gian',
        'de song'
    );
    const fengshui = has(q, 'phong thuy', 'tai loc', 'khai truong', 'tan gia', 'sep', 'doi tac', 'may man');
    const gift = has(q, 'qua tang', 'mon qua', 'lam qua', 'tang ban', 'tang nguoi', 'tang sep', 'tang me', 'de tang');
    const air = has(q, 'loc khong khi', 'khong khi', 'bui', 'khi doc', 'thanh loc');
    const pets = hasWord(q, 'meo', 'cun') || has(q, 'thu cung', 'tre nho', 'em be', 'con nho', 'con cho', 'nuoi cho', 'cho meo');
    const budgetMatch = /(duoi|toi da|khoang|tam|<)\s*(\d+)\s*(k|nghin|ngan|tr|trieu)?/.exec(q);
    const budget = budgetMatch
        ? Number(budgetMatch[2]) *
          (/^tr/.test(budgetMatch[3] || '') ? 1000000 : budgetMatch[3] ? 1000 : Number(budgetMatch[2]) < 10000 ? 1000 : 1)
        : null;

    const scored = db.products
        .filter((product) => product.stock > 0 && String(product.categoryId) !== ACCESSORY_CATEGORY && (!budget || product.price <= budget))
        .filter(
            (product) =>
                !pets || (!has(normalize(product.specs?.pet || ''), 'doc', 'khong nen') && !has(normalize(product.name), ...PET_RISK))
        )
        .map((product) => {
            const light = normalize(careValue(product, 'Ánh sáng'));
            const water = normalize(careValue(product, 'Tưới nước'));
            const difficulty = normalize(product.specs?.difficulty || '');
            const category = normalize(categoryOf(product)?.name || '');
            const petNote = normalize(product.specs?.pet || '');
            let score = 0;
            if (lowLight) score += has(light, 'bong', 'yeu', 'nhe', 'tan xa') ? 3 : has(light, 'nang nhieu', 'nang day du') ? -4 : 0;
            if (office) score += has(category, 'de ban', 'loc khong khi') ? 1 : 0;
            if (sunny) score += has(light, 'nang') ? 3 : -1;
            if (easy)
                score +=
                    (has(difficulty, 'rat de') ? 2 : has(difficulty, 'de') ? 1 : 0) +
                    (has(water, '1 lan/tuan', 'tuan/lan', '2 tuan') ? 1 : 0);
            if (fengshui) score += has(category, 'phong thuy') ? 4 : 0;
            if (air) score += has(category, 'loc khong khi') ? 3 : 0;
            if (gift) score += product.price <= 100000 ? 1 : 0;
            if (pets) score += has(normalize(product.name), 'sen da') ? 2 : 0;
            return { product, score };
        });
    const anyNeed = lowLight || sunny || easy || fengshui || air || gift; // sở thích cần khớp; thú cưng/ngân sách chỉ là bộ lọc
    const picks = scored
        .filter((row) => !anyNeed || row.score > 0)
        .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
        .slice(0, 3);
    if (!picks.length) {
        return budget
            ? `Hiện chưa có cây nào dưới ${money(budget)} phù hợp yêu cầu này. Bạn xem thêm ở trang [Sản phẩm](./products.html) nhé.`
            : 'Bạn cho mình biết thêm: đặt cây ở đâu, có nắng không, và ngân sách khoảng bao nhiêu nhé?';
    }
    const lines = picks.map(({ product }) => `- ${productLink(product)} – ${money(product.price)}: ${careShort(product)}`);
    const notes = [];
    if (has(q, 'may tinh', 'man hinh', 'buc xa'))
        notes.push('Cây không chặn được bức xạ màn hình, nhưng giúp dịu mắt và góc làm việc dễ chịu hơn.');
    if (pets) notes.push('Nên đặt cây ngoài tầm với của thú cưng/trẻ nhỏ.');
    return [anyNeed || pets || budget ? 'Gợi ý cho bạn:' : 'Một vài cây dễ chăm, đang bán chạy:', ...lines, ...notes].join('\n');
}

// Câu hỏi về một sản phẩm cụ thể
function findProduct(q) {
    return [...db.products].sort((a, b) => b.name.length - a.name.length).find((product) => q.includes(normalize(product.name)));
}

function aboutProduct(product, q) {
    const stock = product.stock > 0 ? `còn ${product.stock} sản phẩm` : 'tạm hết hàng';
    if (has(q, 'tuoi', 'cham', 'nang', 'anh sang', 'bon phan', 'vang la', 'heo', 'thay chau', 'dat trong', 'song duoc')) {
        const care = careShort(product);
        return `${productLink(product)}: ${care || 'xem hướng dẫn chăm sóc ở trang sản phẩm'}.${product.specs?.difficulty ? ` Độ khó: ${product.specs.difficulty.toLowerCase()}.` : ''}`;
    }
    if (hasWord(q, 'gia', 'mua') || has(q, 'bao nhieu tien', 'con hang', 'con khong', 'het hang')) {
        return `${productLink(product)} giá ${money(product.price)}, ${stock}.`;
    }
    return `${productLink(product)} – ${money(product.price)}, ${stock}. ${product.description}`;
}

// Trích ngắn từ cơ sở tri thức
function shortExtract(q, hits) {
    const FILLER = new Set([
        'the',
        'nao',
        'nay',
        'sao',
        'khong',
        'duoc',
        'cua',
        'cho',
        'nhu',
        'lam',
        'bao',
        'gio',
        'hom',
        'minh',
        'toi',
        'ban',
        'gia',
        'co',
        'la',
        'va',
        'thi',
        'mot',
        'nhieu',
        'nhung',
        'cac',
        'voi',
        'can',
        'bi',
        'do',
        'dau'
    ]);
    const words = [...new Set(q.split(' ').filter((word) => word.length > 1 && !FILLER.has(word)))];
    let best = { score: 0, lines: [] };
    hits.slice(0, 3).forEach((hit) => {
        const lines = hit.text
            .split('\n')
            .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
            .filter((line) => line.length > 20 && !line.startsWith('Sản phẩm:') && !line.includes(' — '));
        lines.forEach((line, index) => {
            const text = normalize(line);
            const score = words.filter((word) => text.includes(word)).length;
            if (score > best.score) best = { score, lines: [line, lines[index + 1]].filter(Boolean) };
        });
    });
    if (best.score < Math.min(2, words.length) || !words.length) return null;
    return best.lines.join(' ').replace(/\*\*/g, '').slice(0, 280);
}

/** Câu trả lời ngắn (vài dòng) cho chế độ không có AI. */
export function quickAnswer(message, { hits = [], user = null, context = '' } = {}) {
    const q = normalize(`${context} ${message}`);
    const own = normalize(message);

    if (/^(xin chao|chao|hello|hi|alo|hey)\b/.test(own) && own.split(' ').length <= 4) {
        return 'Chào bạn! Mình có thể giúp chọn cây, hướng dẫn chăm sóc, hoặc giải đáp về giao hàng, thanh toán, voucher.';
    }
    if (has(own, 'cam on', 'thank')) return 'Không có gì ạ! Bạn cần gì cứ hỏi mình nhé.';

    // Câu ngắn kiểu "còn hàng không?" mới cần mượn sản phẩm của câu trước; câu đã có chủ đề riêng
    // (thanh toán, giao hàng, voucher, đơn hàng...) thì trả lời đúng chủ đề đó.
    const storeTopic =
        has(
            own,
            'thanh toan',
            'chuyen khoan',
            'tra tien',
            'van chuyen',
            'giao hang',
            'phi giao',
            'voucher',
            'ma giam',
            'khuyen mai',
            'bao hanh',
            'doi tra',
            'hoan tien',
            'don hang',
            'mat khau',
            'dang ky',
            'dang nhap',
            'tai khoan'
        ) || hasWord(own, 'cod', 'qr', 'ship', 'freeship');
    const product = findProduct(own) || (!storeTopic && own.split(' ').length <= 6 ? findProduct(q) : null);
    if (product) return aboutProduct(product, own);

    if (has(own, 'san pham moi', 'hang moi', 'cay moi', 'moi nhat', 'moi ve')) {
        const rows = newestProducts(4).map((item) => `- ${productLink(item)} – ${money(item.price)}${item.stock > 0 ? '' : ' (hết hàng)'}`);
        return ['Sản phẩm mới nhất của cửa hàng:', ...rows].join('\n');
    }
    if (
        has(
            own,
            'bao nhieu san pham',
            'bao nhieu loai',
            'co nhung gi',
            'ban gi',
            'ban nhung',
            'co gi',
            'danh muc',
            'tat ca san pham',
            'nhung loai cay'
        )
    ) {
        const rows = db.categories.map(
            (category) => `- ${category.name}: ${db.products.filter((item) => Number(item.categoryId) === Number(category.id)).length}`
        );
        return [
            `Cửa hàng có ${db.products.length} sản phẩm (${db.products.filter((item) => item.stock > 0).length} còn hàng), gồm:`,
            ...rows,
            'Xem tất cả ở trang [Sản phẩm](./products.html).'
        ].join('\n');
    }
    if (has(own, 'don hang', 'don cua toi', 'trang thai don', 'kiem tra don', 'ma don', 'don toi')) {
        if (!user) return 'Bạn đăng nhập rồi vào mục [Đơn hàng của tôi](./my-orders.html) để xem trạng thái đơn nhé.';
        const LABEL = {
            unconfirmed: 'chờ thanh toán',
            pending: 'chờ xác nhận',
            confirmed: 'đã xác nhận',
            shipping: 'đang giao',
            delivered: 'đã giao',
            cancelled: 'đã hủy'
        };
        const orders = db.orders
            .filter((order) => String(order.userId) === String(user.id))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 3);
        if (!orders.length) return 'Bạn chưa có đơn hàng nào.';
        return [
            'Đơn gần đây của bạn:',
            ...orders.map((order) => `- ${order.code}: ${LABEL[order.status] || order.status}, ${money(order.total)}`),
            'Chi tiết ở [Đơn hàng của tôi](./my-orders.html).'
        ].join('\n');
    }
    if (has(own, 'voucher', 'ma giam', 'giam gia', 'khuyen mai', 'uu dai', 'coupon') || hasWord(own, 'sale')) {
        const vouchers = db.vouchers
            .filter(
                (voucher) =>
                    voucher.claimable && isLive(voucher) && (!voucher.totalQuantity || (voucher.claimedCount || 0) < voucher.totalQuantity)
            )
            .slice(0, 3);
        const event = currentEvent();
        const lines = vouchers.map((voucher) => `- ${voucher.code}: ${describeVoucher(voucher)}`);
        return [
            event ? `Đang có sự kiện ${event.name}.` : null,
            vouchers.length ? 'Voucher đang có:' : 'Hiện chưa có voucher mới để nhận.',
            ...lines,
            'Nhận ở [Kho voucher](./vouchers.html); mỗi đơn dùng 1 voucher giảm giá + 1 voucher ship.'
        ]
            .filter(Boolean)
            .join('\n');
    }
    if (has(own, 'bao lau', 'may ngay', 'khi nao nhan', 'bao gio nhan', 'khi nao toi')) {
        return 'Thời gian giao tùy khu vực và đơn vị vận chuyển; chọn giao nhanh (50.000 ₫) sẽ được ưu tiên chuyển sớm hơn. Bạn theo dõi trạng thái ở [Đơn hàng của tôi](./my-orders.html).';
    }
    if (has(own, 'van chuyen', 'giao hang', 'phi giao', 'mien phi', 'giao nhanh') || hasWord(own, 'ship', 'freeship')) {
        return `Giao tiêu chuẩn ${money(SHIPPING_FEES.standard)}, miễn phí cho đơn từ ${money(FREE_SHIPPING_FROM)}; giao nhanh ${money(SHIPPING_FEES.express)}. Cửa hàng giao toàn quốc.`;
    }
    if (has(own, 'thanh toan', 'chuyen khoan', 'tra tien', 'tra gop') || hasWord(own, 'cod', 'qr')) {
        return `Có 2 cách: thanh toán khi nhận hàng (COD, cho đơn có tiền hàng đến ${money(HIGH_VALUE_FROM)}) hoặc chuyển khoản QR (trả trong 30 phút, tiền về là đơn tự xác nhận). Đơn có tiền hàng trên ${money(HIGH_VALUE_FROM)} bắt buộc chuyển khoản. Đơn chưa thanh toán có thể đổi qua lại 2 cách này.`;
    }
    if (
        has(
            own,
            'bao hanh',
            'doi tra',
            'hoan tien',
            'doi cay',
            'khi nhan',
            'luc nhan',
            'nhan hang',
            'giao toi',
            'giao den',
            'van chuyen bi'
        ) &&
        (has(own, 'chet', 'bao hanh', 'hoan tien', 'doi tra') || hasWord(own, 'hu', 'gay', 'dap', 'vo', 'heo'))
    ) {
        return 'Cây được bảo hành 7 ngày nếu hư do vận chuyển. Bạn chụp ảnh lúc mở hàng rồi gửi khiếu nại kèm mã đơn ở trang [Góp ý](./feedback.html).';
    }
    if (has(own, 'vang la', 'la vang', 'la bi vang', 'la cay bi vang', 'ua vang')) {
        return 'Lá vàng thường do tưới quá nhiều (đất ẩm lâu, gốc mềm), thiếu sáng, hoặc lá già tự rụng. Hãy để đất khô lớp mặt rồi mới tưới, chuyển cây ra chỗ sáng hơn và tỉa bỏ lá vàng.';
    }
    if (has(own, 'thoi re', 'thoi goc', 'nhun', 'ung nuoc')) {
        return 'Cây bị úng/thối rễ: ngưng tưới, nhấc cây ra cắt bỏ rễ đen mềm, thay đất khô thoát nước tốt và chậu có lỗ đáy; tuần đầu chỉ tưới thật ít.';
    }
    if (has(own, 'chay la', 'mep la', 'la kho', 'kho mep')) {
        return 'Lá khô/cháy mép thường do nắng gắt hoặc thiếu nước, không khí khô. Chuyển cây ra chỗ có ánh sáng tán xạ, tưới đều hơn và có thể phun sương nhẹ cho lá.';
    }
    if (hasWord(own, 'heo') || has(own, 'ru la', 'sap chet', 'cay yeu')) {
        return 'Cây héo: sờ đất trước — đất khô thì tưới đẫm; đất còn ướt mà vẫn héo thì có thể úng rễ, cần ngưng tưới và kiểm tra rễ. Tránh để cây ở chỗ nắng gắt hoặc gió máy lạnh thổi thẳng.';
    }
    if (has(own, 'mat khau', 'dang ky', 'dang nhap', 'tai khoan', 'xac minh')) {
        return 'Quên mật khẩu thì vào [Đăng nhập](./login.html) → "Quên mật khẩu" để nhận mã qua email. Tài khoản mới cần nhập mã xác minh gửi tới email.';
    }
    if (
        has(
            q,
            'nen mua',
            'cay nao',
            'goi y',
            'tu van',
            'phu hop',
            'hop voi',
            'chon cay',
            'mua cay',
            'loai nao',
            'loai cay',
            'can mua',
            'nen trong',
            'nen chon'
        ) ||
        has(own, ...NEED_WORDS)
    ) {
        return recommend(q);
    }
    return (
        shortExtract(own, hits) ||
        'Mình chỉ hỗ trợ về cây cảnh và cửa hàng Xanh Garden. Bạn thử hỏi về chọn cây, cách chăm sóc, phí ship, thanh toán hoặc voucher nhé.'
    );
}
