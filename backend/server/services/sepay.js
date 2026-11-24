// Cấu hình tài khoản nhận tiền SePay. Đặt biến môi trường khi triển khai thật;
// giá trị mặc định chỉ để chạy thử trên máy (production bắt buộc đặt SEPAY_API_KEY, xem core/config.js).
export const DEV_SEPAY_KEY = 'dev-sepay-key';

export const normalizeText = (value) =>
    String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');

export const SEPAY = {
    bank: process.env.SEPAY_BANK || 'MBBank',
    account: process.env.SEPAY_ACCOUNT || '0000000000',
    accountName: process.env.SEPAY_ACCOUNT_NAME || 'XANH GARDEN',
    apiKey: process.env.SEPAY_API_KEY || DEV_SEPAY_KEY,
    // Tiền tố một số ngân hàng bắt buộc có ở đầu nội dung chuyển khoản thì SePay mới nhận được (VD VietinBank: SEVQR)
    contentPrefix: normalizeText(process.env.SEPAY_CONTENT_PREFIX)
};

// Nút "Đã chuyển khoản (demo)" để thử luồng thanh toán khi chưa nối SePay thật.
// Mặc định bật khi chạy máy cá nhân, tắt khi NODE_ENV=production; đặt PAYMENT_DEMO=on/off để chọn thủ công.
export const PAYMENT_DEMO = process.env.PAYMENT_DEMO ? process.env.PAYMENT_DEMO === 'on' : process.env.NODE_ENV !== 'production';

if (!process.env.SEPAY_API_KEY) console.warn(`[sepay] Chưa đặt SEPAY_API_KEY: đang dùng khóa thử "${DEV_SEPAY_KEY}".`);

// Mã đơn bỏ dấu gạch (ngân hàng thường bỏ ký tự đặc biệt): dùng để tìm đơn trong nội dung giao dịch.
export const transferContent = (order) => normalizeText(order.code);

export function paymentInfo(order) {
    // Nội dung khách chuyển = [tiền tố] + mã đơn; webhook chỉ cần thấy mã đơn trong nội dung
    const content = [SEPAY.contentPrefix, transferContent(order)].filter(Boolean).join(' ');
    const qrUrl =
        `https://qr.sepay.vn/img?acc=${encodeURIComponent(SEPAY.account)}&bank=${encodeURIComponent(SEPAY.bank)}` +
        `&amount=${order.total}&des=${encodeURIComponent(content)}`;
    return { bank: SEPAY.bank, account: SEPAY.account, accountName: SEPAY.accountName, amount: order.total, content, qrUrl };
}
