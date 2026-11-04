// Cấu hình tài khoản nhận tiền SePay. Đặt biến môi trường khi triển khai thật;
// giá trị mặc định chỉ để chạy thử trên máy.
export const SEPAY = {
    bank: process.env.SEPAY_BANK || 'MBBank',
    account: process.env.SEPAY_ACCOUNT || '0000000000',
    accountName: process.env.SEPAY_ACCOUNT_NAME || 'XANH GARDEN',
    apiKey: process.env.SEPAY_API_KEY || 'dev-sepay-key'
};

if (!process.env.SEPAY_API_KEY) console.warn('[sepay] Chưa đặt SEPAY_API_KEY: đang dùng khóa thử "dev-sepay-key".');

export const normalizeText = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Nội dung chuyển khoản = mã đơn bỏ dấu gạch (ngân hàng thường bỏ ký tự đặc biệt).
export const transferContent = (order) => normalizeText(order.code);

export function paymentInfo(order) {
    const content = transferContent(order);
    const qrUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(SEPAY.account)}&bank=${encodeURIComponent(SEPAY.bank)}` +
        `&amount=${order.total}&des=${encodeURIComponent(content)}`;
    return { bank: SEPAY.bank, account: SEPAY.account, accountName: SEPAY.accountName, amount: order.total, content, qrUrl };
}
