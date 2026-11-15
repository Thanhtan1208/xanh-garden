import { db } from '../core/store.js';
import { AUTO_RECEIVE_DAYS, FREE_SHIPPING_FROM, HIGH_VALUE_FROM, SHIPPING_FEES } from '../core/rules.js';
import { newestProducts } from '../services/inventory.js';
import { getShop } from '../services/settings.js';
import { describeVoucher, isLive } from '../services/vouchers.js';
import { currentEvent } from '../services/site.js';
import { docChunks, normalize } from './kb.js';

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
    const office = has(
        q,
        'van phong',
        'ban lam viec',
        'may tinh',
        'man hinh',
        'cong so',
        'ban hoc',
        'phong lam viec',
        'laptop',
        'de ban',
        'tren ban',
        'goc lam viec'
    );
    const lowLight =
        office ||
        has(
            q,
            'it anh sang',
            'thieu sang',
            'it nang',
            'thieu nang',
            'khong co nang',
            'phong toi',
            'khong co cua so',
            'bong ram',
            'trong nha',
            'phong ngu',
            'may lanh',
            'dieu hoa'
        );
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
    // Khách chưa nói nhu cầu: gợi ý cây dễ chăm và hỏi thêm chỗ đặt
    const vague = !(lowLight || sunny || easy || fengshui || air || gift);
    const cheap = has(q, 'gia re', 're nhat', 'binh dan', 'sinh vien', 're re');

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
            // Cây chịu bóng: "chịu bóng", "ánh sáng yếu", "tán xạ", "sáng gián tiếp", "ánh sáng đèn".
            // Cây cần nắng (kể cả "nắng nhẹ") thì trừ điểm khi khách cần chỗ ít sáng.
            const shade = has(light, 'bong', 'yeu', 'tan xa', 'gian tiep', 'anh sang den');
            let score = 0;
            if (lowLight) score += shade ? 3 : has(light, 'nang') ? -4 : 0;
            if (office) score += has(category, 'de ban', 'loc khong khi') ? 1 : 0;
            if (sunny) score += has(light, 'nang') ? 3 : -1;
            if (easy || vague)
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
        .sort((a, b) =>
            cheap ? a.product.price - b.product.price || b.score - a.score : b.score - a.score || a.product.price - b.product.price
        )
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
    if (vague) notes.push('Bạn cho mình biết chỗ đặt cây (có nắng không) và ngân sách để mình gợi ý sát hơn nhé.');
    const title = anyNeed || pets || budget ? 'Gợi ý cho bạn:' : cheap ? 'Một vài cây giá mềm:' : 'Một vài cây dễ chăm, hợp người mới:';
    return [title, ...lines, ...notes].join('\n');
}

// Câu gợi ý chọn cây
const RECOMMEND_CUES = [
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
    'nen chon',
    'gia re',
    're nhat',
    'binh dan'
];
const wantsRecommend = (text) => has(text, ...RECOMMEND_CUES) || has(text, ...NEED_WORDS);

// "có (bán) X không" mà X không phải tên đầy đủ của sản phẩm: tìm theo tên và danh mục.
// Không thấy thì chỉ nói "chưa có" khi X là hàng hóa ("có hủy được không", "có bán sỉ không" không phải hỏi hàng)
const GOODS = /^(cay|chau|hoa|hat|dat|phan|mo hinh|tieu canh|sen|xuong rong|binh|khay|bonsai|day)\b/;
function sellAnswer(own) {
    const match = /\b(co ban|ban co|co)\s+(.+?)\s+(khong|ko|k|hong|chua)$/.exec(own);
    if (!match) return null;
    const wanted = sectionWords(match[2]).filter((word) => !['cay', 'loai', 'nao'].includes(word));
    if (!wanted.length) return null;
    const found = db.products
        .filter((product) => {
            const words = new Set(normalize(`${product.name} ${categoryOf(product)?.name || ''}`).split(' '));
            return product.stock > 0 && wanted.every((word) => words.has(word));
        })
        .slice(0, 3);
    if (found.length) return ['Có ạ:', ...found.map((product) => `- ${productLink(product)} – ${money(product.price)}`)].join('\n');
    if (!GOODS.test(match[2])) return null;
    return `Hiện cửa hàng chưa có sản phẩm này. Cửa hàng đang bán: ${db.categories.map((category) => category.name.toLowerCase()).join(', ')}. Xem tất cả ở trang [Sản phẩm](./products.html).`;
}

// Câu hỏi về một sản phẩm cụ thể
function findProduct(q) {
    return [...db.products].sort((a, b) => b.name.length - a.name.length).find((product) => q.includes(normalize(product.name)));
}

// Cây đang nói tới khi khách hỏi tiếp ngắn: tên cây trong câu trước của khách, hoặc câu trả lời gần nhất có link sản phẩm.
// Câu trả lời đó có nhiều link (vừa gợi ý nhiều cây) thì không đoán, để hỏi lại khách. Dùng cho cả chế độ có AI.
export function topicProduct(context, replies) {
    const named = context ? findProduct(normalize(context)) : null;
    if (named) return named;
    for (const reply of replies) {
        const ids = [...new Set([...String(reply).matchAll(/product-detail\.html\?id=([^)\s]+)/g)].map((match) => match[1]))];
        if (ids.length > 1) return null;
        if (ids.length === 1) return db.products.find((item) => String(item.id) === ids[0]) || null;
    }
    return null;
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

// Trả nguyên một mục của cơ sở tri thức (chọn theo tiêu đề), cho câu hỏi cách dùng website/chính sách
const SECTION_FILLER = new Set(
    'the nao nay sao khong duoc cua cho nhu lam minh toi ban em tui co la va thi mot nhieu nhung cac voi can bi do dau ve giup cach huong dan o khi de da roi muon xem hay oi shop ad nhe nha ha san pham'.split(
        ' '
    )
);
const sectionWords = (text) => [...new Set(normalize(text).split(' '))].filter((word) => word.length > 1 && !SECTION_FILLER.has(word));

function condense(body, max = 450) {
    // Bỏ chữ đậm trước rồi mới bỏ gạch đầu dòng, tránh sót dấu "*"
    const text = body
        .split('\n')
        .map((line) =>
            line
                .replace(/\*\*/g, '')
                .replace(/^\s*(?:[-*]|\d+\.)\s*/, '')
                .trim()
        )
        .filter(Boolean)
        .join(' ');
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function sectionAnswer(own, { how }) {
    const words = sectionWords(own);
    if (!words.length) return null;
    const aboutBot = has(own, 'chatbot', 'tro ly', 'bot');
    let best = null;
    docChunks().forEach((chunk) => {
        const title = chunk.title.split(' — ').pop();
        if (!aboutBot && /chatbot|trợ lý chat|hỏi lại khách/i.test(title)) return;
        const titleWords = sectionWords(title);
        // So khớp nguyên từ ("thu" không khớp "thường")
        const bodyWords = new Set(normalize(chunk.embedText).split(' '));
        const titleHits = words.filter((word) => titleWords.includes(word)).length;
        const covered = words.filter((word) => bodyWords.has(word)).length;
        // Câu thường cần trùng 2 từ của tiêu đề ("giá bao nhiêu" không được khớp mục "Đánh giá"),
        // trừ khi câu chỉ có 1 từ khóa ("có bán sỉ không", "có hủy được không")
        if (!titleHits || (!how && titleHits < Math.min(2, titleWords.length, words.length))) return;
        // Hỏi cách làm thì ưu tiên mục "Cách ..."; câu thường thì cần khớp nhiều từ hơn
        const enough = how
            ? covered >= Math.ceil(words.length / 2)
            : covered >= Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.6)));
        if (!enough) return;
        const score = titleHits * 3 + covered + (how && /^(Cách|Hướng dẫn)/.test(title) ? 2 : 0) + titleHits / titleWords.length;
        if (!best || score > best.score) best = { score, body: chunk.embedText.split('\n').slice(1).join('\n') };
    });
    return best ? condense(best.body) : null;
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
        'dau',
        've',
        'giup'
    ]);
    const words = [...new Set(q.split(' ').filter((word) => word.length > 1 && !FILLER.has(word)))];
    let best = { score: 0, lines: [] };
    hits.slice(0, 3).forEach((hit) => {
        const lines = hit.text
            .split('\n')
            .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
            .filter((line) => line.length > 20 && !line.startsWith('Sản phẩm:') && !line.includes(' — '));
        lines.forEach((line, index) => {
            // Khớp nguyên từ: "ai" không được khớp "tài khoản"
            const tokens = new Set(normalize(line).split(' '));
            const score = words.filter((word) => tokens.has(word)).length;
            if (score > best.score) best = { score, lines: [line, lines[index + 1]].filter(Boolean) };
        });
    });
    // Phải khớp ít nhất nửa số từ của câu hỏi (tối thiểu 2), tránh trả lời lạc đề chỉ vì trùng vài từ ngắn
    if (!words.length || best.score < Math.max(Math.min(2, words.length), Math.ceil(words.length / 2))) return null;
    return condense(best.lines.join('\n'), 280);
}

// Câu trả lời ngắn (vài dòng) cho chế độ không có AI
export function quickAnswer(message, { hits = [], user = null, context = '', replies = [] } = {}) {
    const q = normalize(`${context} ${message}`);
    const own = normalize(message);

    if (/^(xin chao|chao|hello|hi|alo|hey)\b/.test(own) && own.split(' ').length <= 4) {
        return 'Chào bạn! Mình có thể giúp chọn cây, hướng dẫn chăm sóc, hoặc giải đáp về giao hàng, thanh toán, voucher.';
    }
    if (has(own, 'cam on', 'thank')) return 'Không có gì ạ! Bạn cần gì cứ hỏi mình nhé.';
    // Hỏi cách làm / ở đâu: ưu tiên trả nguyên mục hướng dẫn tương ứng
    const how = /\b(lam sao|lam the nao|nhu the nao|the nao|bang cach nao|cach|huong dan|o dau|cho nao)\b/.test(own);

    // Liên hệ: lấy từ thông tin cửa hàng admin đã lưu
    if (
        has(own, 'hotline', 'lien he', 'gio mo cua', 'gio lam viec', 'mo cua', 'zalo', 'facebook', 'fanpage') ||
        /\b(so dien thoai|sdt|email|dia chi|dien thoai)\b.*\b(cua hang|shop|ben ban)\b|\b(cua hang|shop) o dau\b|\bgoi (cho )?(shop|cua hang)\b/.test(
            own
        )
    ) {
        const shop = getShop();
        return [
            `Hotline ${shop.hotline} · Email ${shop.email} · Zalo ${shop.zalo}`,
            `Địa chỉ: ${shop.address}. Giờ làm việc: ${shop.hours}.`,
            'Cần cửa hàng trả lời bằng văn bản (khiếu nại, hỏi về đơn) thì gửi ở trang [Góp ý](./feedback.html).'
        ].join('\n');
    }
    // Xác nhận đã nhận hàng / tự xác nhận
    if (
        has(own, 'tu xac nhan', 'da nhan duoc hang', 'xac nhan da nhan', 'xac nhan nhan hang', 'tu dong xac nhan', 'tu chuyen sang da giao')
    ) {
        return `Đơn đang giao: nhận hàng xong bạn bấm "Đã nhận được hàng" trong [Đơn hàng của tôi](./my-orders.html). Nếu không bấm, hệ thống tự xác nhận đã giao sau ${AUTO_RECEIVE_DAYS} ngày kể từ lúc bắt đầu giao (ngày cụ thể hiện trên thẻ đơn).`;
    }

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
    // Hỏi giá ("đánh giá", "giảm giá" không phải hỏi giá)
    const askPrice =
        (hasWord(own, 'gia') && !has(own, 'danh gia', 'giam gia', 'gia han', 'gia tri')) || has(own, 'bao nhieu tien', 'het bao nhieu');
    const askStock = has(own, 'con hang', 'het hang', 'con khong', 'con bao nhieu');
    // Câu hỏi tiếp về cây đang nói tới (giá, còn hàng, cách chăm...). Câu khác chủ đề thì không mượn cây của câu trước.
    const asksProduct =
        askPrice ||
        askStock ||
        hasWord(own, 'nay', 'no') ||
        has(
            own,
            'con hang',
            'con khong',
            'het hang',
            'con bao nhieu',
            'tuoi',
            'cham soc',
            'nang',
            'anh sang',
            'bon phan',
            'kich thuoc',
            'thu cung',
            'song duoc'
        );
    const product = findProduct(own) || (!storeTopic && asksProduct && own.split(' ').length <= 6 ? topicProduct(context, replies) : null);
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
    // Xem đơn của chính mình (câu hỏi cách hủy/đánh giá đơn để mục hướng dẫn trả lời)
    if (
        !how &&
        has(
            own,
            'don cua toi',
            'don hang cua toi',
            'don cua minh',
            'don hang cua minh',
            'don toi',
            'don minh',
            'trang thai don',
            'kiem tra don',
            'xem don',
            'ma don',
            'don hang toi',
            'don hang minh',
            'don hang dau',
            'don dau'
        )
    ) {
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
    if (!how && (has(own, 'voucher', 'ma giam', 'giam gia', 'khuyen mai', 'uu dai', 'coupon') || hasWord(own, 'sale'))) {
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
            'Nhận ở trang [Voucher](./vouchers.html); mỗi đơn dùng 1 voucher giảm giá + 1 voucher ship.'
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
    if (how) {
        const guide = sectionAnswer(own, { how });
        if (guide) return guide;
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
    // Hỏi giá / còn hàng mà chưa rõ cây nào (kể cả ngay sau khi vừa gợi ý nhiều cây)
    if ((askPrice || askStock) && !wantsRecommend(own)) {
        return 'Bạn muốn hỏi cây nào? Gõ tên cây (ví dụ "kim tiền giá bao nhiêu") hoặc xem giá và số lượng còn ở trang [Sản phẩm](./products.html).';
    }
    // Hỏi một món hàng cụ thể thì trả lời món đó, không mượn nhu cầu của câu trước
    const sell = !wantsRecommend(own) && sellAnswer(own);
    if (sell) return sell;
    if (has(q, ...RECOMMEND_CUES) || has(own, ...NEED_WORDS)) return recommend(q);
    return (
        sectionAnswer(own, { how: false }) ||
        shortExtract(own, hits) ||
        'Mình chỉ hỗ trợ về cây cảnh và cửa hàng Xanh Garden. Bạn thử hỏi về chọn cây, cách chăm sóc, phí ship, thanh toán hoặc voucher nhé.'
    );
}
