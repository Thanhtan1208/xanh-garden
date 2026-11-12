// Email gửi mã xác nhận 6 số (xác minh tài khoản, đặt lại mật khẩu, đổi mật khẩu): bản HTML dễ nhìn, mã to và dễ chọn.
const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// purpose: câu mô tả mã dùng để làm gì, ví dụ "xác minh tài khoản"; warning: dòng cảnh báo cuối thư
export function codeMail({ name, purpose, code, minutes, warning }) {
    // Giữ đúng cụm "là: <mã>" ở bản văn bản thuần (client không hiện HTML và test đọc mã từ đây)
    const text = `Xin chào ${name},\n\nMã ${purpose} của bạn là: ${code}\nMã có hiệu lực ${minutes} phút. ${warning}\n\nXanh Garden`;

    const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#222222;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e1e5df;border-radius:8px;">
<tr><td style="padding:18px 24px;border-bottom:3px solid #2e7d32;font-size:18px;font-weight:bold;color:#2e7d32;">Xanh Garden</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:15px;line-height:1.6;">Xin chào <b>${esc(name)}</b>,<br>Đây là mã ${esc(purpose)} của bạn:</td></tr>
<tr><td align="center" style="padding:8px 24px 16px;">
<div style="display:inline-block;padding:14px 28px;background:#f1f8f1;border:2px dashed #2e7d32;border-radius:8px;font-family:'Courier New',monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#1b5e20;user-select:all;-webkit-user-select:all;">${esc(code)}</div>
<div style="margin-top:8px;font-size:12px;color:#777777;">Chạm hoặc nhấp đúp vào mã để chọn, rồi sao chép</div>
</td></tr>
<tr><td style="padding:0 24px 8px;font-size:14px;line-height:1.6;color:#444444;">Mã có hiệu lực trong <b>${esc(minutes)} phút</b>.</td></tr>
<tr><td style="padding:8px 24px 24px;"><div style="padding:10px 12px;background:#fff8e1;border-left:4px solid #f9a825;font-size:13px;line-height:1.5;color:#5d4037;">${esc(warning)}</div></td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e1e5df;font-size:12px;color:#888888;">Email tự động từ Xanh Garden, vui lòng không trả lời.</td></tr>
</table></body></html>`;

    return { text, html };
}
