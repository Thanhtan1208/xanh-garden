import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

// Một kết nối SMTP dùng lại cho mọi email (pool 1 kết nối) thay vì bắt tay lại mỗi lần gửi;
// chỉ gửi văn bản thuần và có giới hạn thời gian chờ để không treo request.
const transport = SMTP_HOST
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 465,
        secure: (Number(SMTP_PORT) || 465) === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    })
    : null;

if (!transport) {
    console.warn('[mail] Chưa đặt SMTP_HOST: email sẽ được in ra console thay vì gửi thật.');
} else {
    // Kiểm tra đăng nhập SMTP một lần lúc khởi động (không chặn server) để biết cấu hình đúng hay sai.
    transport.verify()
        .then(() => console.log(`[mail] Sẵn sàng gửi email qua ${SMTP_HOST} bằng ${SMTP_USER}.`))
        .catch((error) => console.error(`[mail] Đăng nhập SMTP thất bại: ${error.message}`));
}

const FROM = MAIL_FROM || SMTP_USER || 'Xanh Garden <no-reply@xanhgarden.vn>';

// Không có SMTP (chạy thử trên máy): in nội dung email ra console của server.
// Thử lại 1 lần khi lỗi mạng tạm thời; lỗi sai mật khẩu/từ chối thì báo ngay.
export async function sendMail({ to, subject, text, html }) {
    if (!transport) {
        console.log(`\n[MAIL -> ${to}] ${subject}\n${text}\n`);
        return;
    }
    let info;
    try {
        info = await transport.sendMail({ from: FROM, to, subject, text, html });
    } catch (error) {
        if (error.responseCode >= 500 || error.code === 'EAUTH') throw error;
        info = await transport.sendMail({ from: FROM, to, subject, text, html });
    }
    // Ghi lại phản hồi thật của SMTP để truy vết khi khách báo không nhận được mail.
    console.log(`[mail] "${subject}" -> ${to}: ${info.accepted.length ? 'đã được SMTP nhận' : 'BỊ TỪ CHỐI'}${info.rejected.length ? ` (từ chối: ${info.rejected.join(', ')})` : ''} | ${String(info.response).split('\n')[0]}`);
    if (info.rejected.length && !info.accepted.length) throw new Error(`SMTP từ chối địa chỉ ${to}`);
}
