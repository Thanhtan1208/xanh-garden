import { db, visibleProducts } from '../core/store.js';
import { FREE_SHIPPING_FROM, MAX_LINE_QUANTITY, PAYMENT_TTL_MS, SHIPPING_FEES } from '../core/rules.js';
import { getShop } from '../services/settings.js';
import { normalize } from './kb.js';
import { CHAT_MODEL, aiConfigured } from './openai.js';

// Câu trả lời cố định, chạy trước AI nên luôn đúng và không tốn lượt gọi API:
// 1. Chặn yêu cầu THAO TÁC (đặt hàng, hủy đơn, thanh toán, sửa tài khoản, tra số dư...): trợ lý chỉ tư vấn.
//    Câu hỏi CÁCH LÀM ("hủy đơn thế nào?") không bị chặn mà để cơ sở tri thức trả lời.
// 2. Khách hỏi về chính trợ lý (là ai, dùng AI/model gì).

const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;
// Chữ đệm có thể chen giữa động từ và đối tượng: "lập cho tôi đơn", "hủy giúp mình đơn"
const GAP = '(?:\\s+(?:cho|giup|ho|dum|gium|toi|minh|em|tui|mot|1|ngay|luon|cai|lai))*';
const re = (source) => new RegExp(source);

// Nhờ làm thay
const HELP = /\b(giup|dum|gium|ho (toi|minh|em|tui)|cho (toi|minh|em|tui|tao))\b/;
// Hỏi cách làm / ở đâu
const HOW =
    /\b(lam sao|lam the nao|nhu the nao|the nao|bang cach nao|cach nao|cach de|huong dan|o dau|cho nao|khi nao|bao lau|quy dinh|chinh sach)\b/;
// Câu kết thúc kiểu hỏi
const QUESTION_END = /\b(khong|chua|nao|sao|gi|duoc ko|ko|k)$/;
// Ra lệnh ở cuối câu
const COMMAND_END = /\b(di|nhe|nha|luon|ngay|lien|gap)$/;
// Chữ chỉ ý định đứng trước động từ: "tôi muốn hủy đơn", "shop ơi đặt giúp"
const LEAD =
    /^(?:(?:toi|minh|em|tui|anh|chi|shop|ad|admin|oi|ban|bot|tro ly|hay|vui long|lam on|xin|muon|can|dinh|se|giup|cho|ho|dum|gium|nho|a)\s*)*$/;

const ACTIONS = [
    {
        kind: 'order',
        patterns: [
            re(`\\b(?:dat|lap|tao|len|chot|order)${GAP}\\s+(?:don|hang)\\b`),
            re(`\\b(?:dat mua|mua ngay|mua luon|mua ho|mua giup|mua dum|mua gium|dat ho|dat giup|dat dum|dat gium)\\b`),
            re(`\\b(?:dat|mua|lay|order)${GAP}\\s+\\d+\\s*(?:cay|chau|cai|san pham|bao|goi|bich)\\b`),
            /\b(?:them|bo|cho|dua|add)\b(?:\s+\S+){0,5}?\s+vao gio\b/
        ]
    },
    { kind: 'cancel', patterns: [re(`\\bhuy${GAP}\\s+(?:don|dat hang|hang)\\b`)] },
    { kind: 'change', patterns: [re(`\\b(?:doi|sua|thay doi|cap nhat)${GAP}\\s+(?:dia chi|so luong|don)\\b`)] },
    { kind: 'pay', patterns: [re(`\\b(?:thanh toan|chuyen khoan|tra tien|quet ma)${GAP}\\s*(?:don|giup|dum|gium|ho|cho|$)`)] },
    { kind: 'refund', patterns: [re(`\\bhoan${GAP}\\s+tien\\b`)] },
    {
        kind: 'account',
        patterns: [
            re(
                `\\b(?:doi|dat lai|reset|xoa|sua|cap nhat|lay lai|mo khoa)${GAP}\\s+(?:mat khau|pass|password|tai khoan|email|so dien thoai|sdt|ten dang nhap|ngay sinh|anh dai dien|avatar)\\b`
            )
        ]
    },
    { kind: 'voucher', patterns: [re(`\\b(?:ap|nhap|tang|cap|them|gui)${GAP}\\s+(?:ma|voucher|coupon)\\b`)] },
    { kind: 'ship', patterns: [re(`\\bgiao${GAP}\\s+(?:nhanh|ngay|som|gap|hom nay|lien)\\b`)] },
    // Không cần chữ nhờ vả: hỏi số dư hay xin bớt giá đều là việc trợ lý không làm được
    { kind: 'balance', always: true, patterns: [/\b(so du|vi tien|vi dien tu|diem thuong|tich diem|nap tien|rut tien)\b/] },
    {
        kind: 'price',
        always: true,
        patterns: [re(`\\b(?:bot|giam)${GAP}\\s+(?:gia|tien|chut|it)\\b`), /\b(tra gia|mac ca|giam gia rieng)\b/]
    }
];

// Sản phẩm khách nhắc tới (tên dài khớp trước) và số lượng muốn mua
function mentionedProduct(q) {
    return [...visibleProducts()].sort((a, b) => b.name.length - a.name.length).find((product) => q.includes(normalize(product.name)));
}

function orderReply(q) {
    const lines = ['Mình không thể tự đặt hàng hay thêm vào giỏ thay bạn. Bạn tự đặt trên website nhé:'];
    const product = mentionedProduct(q);
    const quantity = Number(/\b(\d+)\s*(?:cay|chau|cai|san pham|bao|goi|bich)\b/.exec(q)?.[1] || 0);
    if (product) {
        const link = `[${product.name}](./product-detail.html?id=${product.id})`;
        if (product.stock <= 0) lines.push(`- ${link} đang tạm hết hàng.`);
        else {
            lines.push(`- ${link} giá ${money(product.price)}, còn ${product.stock} sản phẩm.`);
            const limit = Math.min(product.stock, MAX_LINE_QUANTITY);
            if (quantity > limit)
                lines.push(
                    `- Bạn muốn ${quantity} cái nhưng mỗi đơn mua được tối đa ${limit} cái${product.stock < MAX_LINE_QUANTITY ? ' (theo số còn trong kho)' : ''}.`
                );
        }
    }
    lines.push(
        '- Mở trang sản phẩm, chọn số lượng, bấm "Mua ngay".',
        '- Ở trang Thanh toán chọn địa chỉ, cách giao, cách thanh toán rồi bấm "Xác nhận đặt hàng".'
    );
    return lines.join('\n');
}

const REPLIES = {
    order: orderReply,
    cancel: () =>
        [
            'Mình không thể hủy đơn thay bạn. Bạn vào [Đơn hàng của tôi](./my-orders.html):',
            '- Đơn Chờ thanh toán / Chờ xác nhận: bấm "Hủy đơn" và chọn lý do.',
            '- Đơn Đã xác nhận: bấm "Yêu cầu hủy đơn", cửa hàng sẽ duyệt.',
            '- Đơn đang giao thì không hủy được nữa.'
        ].join('\n'),
    change: () =>
        [
            'Mình không sửa được đơn hay địa chỉ thay bạn.',
            '- Địa chỉ đã lưu: sửa ở [Tài khoản → Sổ địa chỉ](./account.html?tab=addresses).',
            `- Đơn đã đặt không sửa được: đơn chưa xác nhận thì hủy rồi đặt lại; đơn đã xác nhận thì gửi "Yêu cầu hủy đơn" hoặc gọi hotline ${getShop().hotline}.`
        ].join('\n'),
    pay: () =>
        `Mình không thanh toán thay bạn được và không bao giờ hỏi thông tin thẻ hay mã OTP. Đơn chuyển khoản chưa trả: vào [Đơn hàng của tôi](./my-orders.html), bấm "Thanh toán ngay" rồi quét mã QR trong ${PAYMENT_TTL_MS / 60000} phút.`,
    refund: () =>
        `Mình không tự hoàn tiền được. Đơn đã trả tiền mà bị hủy thì cửa hàng sẽ hoàn tiền cho bạn; cần hỏi thêm thì gửi [Góp ý](./feedback.html) kèm mã đơn hoặc gọi hotline ${getShop().hotline}.`,
    account: () =>
        'Mình không sửa tài khoản thay bạn được và không bao giờ hỏi mật khẩu hay mã xác nhận. Bạn vào [Tài khoản của tôi](./account.html) để sửa thông tin, ảnh đại diện, địa chỉ; đổi mật khẩu ở tab "Đổi mật khẩu". Quên mật khẩu thì bấm "Quên mật khẩu" ở trang [Đăng nhập](./login.html).',
    voucher: () =>
        'Mình không áp hay tặng voucher thay bạn được. Bạn nhận mã ở trang [Voucher](./vouchers.html) rồi chọn voucher ở bước Thanh toán (mỗi đơn 1 voucher giảm giá + 1 voucher giảm phí ship).',
    ship: () =>
        `Mình không điều phối giao hàng được. Khi đặt hàng bạn chọn "Giao nhanh" (${money(SHIPPING_FEES.express)}) để được ưu tiên; đơn đã đặt thì theo dõi ở [Đơn hàng của tôi](./my-orders.html) hoặc gọi hotline ${getShop().hotline}.`,
    balance: () =>
        'Xanh Garden không có ví tiền, điểm thưởng hay số dư, và mình không xem được tài khoản ngân hàng của bạn. Tiền trả theo từng đơn (COD hoặc chuyển khoản QR): trạng thái thanh toán xem ở [Đơn hàng của tôi](./my-orders.html), ưu đãi xem ở trang [Voucher](./vouchers.html).',
    price: () =>
        `Giá trên website là giá niêm yết, mình không giảm giá riêng được. Bạn xem mã giảm giá ở trang [Voucher](./vouchers.html) nhé; đơn từ ${money(FREE_SHIPPING_FROM)} được miễn phí giao tiêu chuẩn.`
};

// Trả câu từ chối có sẵn nếu khách nhờ trợ lý thao tác thay, ngược lại null
export function actionReply(message) {
    // "cho tôi hỏi..." là câu hỏi lịch sự, không phải nhờ làm
    const q = normalize(message)
        .replace(/\bcho (toi|minh|em|tui) (hoi|xem|biet)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!q) return null;
    const help = HELP.test(q);
    const how = HOW.test(q);
    const question = how || /\?\s*$/.test(message) || QUESTION_END.test(q);

    for (const action of ACTIONS) {
        const match = action.patterns.map((pattern) => pattern.exec(q)).find(Boolean);
        if (!match) continue;
        if (action.always) {
            if (how && !help) return null; // "làm sao để được giảm giá" là hỏi về voucher
            return REPLIES[action.kind](q);
        }
        if (help || COMMAND_END.test(q)) return REPLIES[action.kind](q);
        if (question) return null;
        // Câu mệnh lệnh: động từ đứng đầu câu (chỉ có chữ chỉ ý định phía trước) hoặc có số lượng cụ thể
        const startsWithAction = LEAD.test(q.slice(0, match.index).trim());
        const hasQuantity = /\b\d+\s*(?:cay|chau|cai|san pham)\b/.test(q);
        if (startsWithAction || hasQuantity) return REPLIES[action.kind](q);
    }
    return null;
}

// Hỏi về trợ lý. "mô hình" phải đi kèm AI vì "mô hình tiểu cảnh" là sản phẩm
const ABOUT_BOT = [
    /\b(model|chatgpt|chat gpt|gpt|openai|gemini|claude|llm)\b/,
    /\bmo hinh (ai|ngon ngu|tri tue)\b/,
    /\b(dung|chay|xai|la)\s+(ai|tri tue nhan tao)\s*(nao|gi)\b/,
    /\b(ban|em|bot|tro ly|chatbot)\s+(la ai|ten (la )?gi|la nguoi|la robot|la may|co phai (la )?nguoi)/,
    /\b(nguoi that|ai dang tra loi|dang chat voi ai)\b/
];

export function aboutBotReply(message) {
    const q = normalize(message);
    if (!ABOUT_BOT.some((pattern) => pattern.test(q))) return null;
    const engine = aiConfigured()
        ? `dùng mô hình ${CHAT_MODEL()} của OpenAI, kết hợp tra cứu tài liệu và dữ liệu sản phẩm của cửa hàng`
        : 'đang chạy chế độ tra cứu tài liệu và dữ liệu sản phẩm của cửa hàng (không dùng mô hình AI)';
    return `Mình là trợ lý tự động của Xanh Garden (không phải nhân viên), ${engine}. Mình tư vấn chọn cây, cách chăm sóc và giải đáp chính sách; không đặt hàng hay xem tài khoản thay bạn. Cần gặp người thật thì gọi hotline ${getShop().hotline} hoặc gửi [Góp ý](./feedback.html).`;
}
