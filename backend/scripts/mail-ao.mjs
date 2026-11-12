// Hộp thư ảo để thử gửi email qua SMTP mà không cần Gmail thật.
// Chạy:  npm run mail   (giữ terminal này mở)
//   - Nhận thư ở SMTP cổng 1025 (không cần tài khoản, không mã hóa).
//   - Xem thư (mã OTP, hóa đơn, tệp đính kèm) tại http://localhost:1080
// Cách nối với website: trong .env đặt SMTP_HOST=localhost, SMTP_PORT=1025 và để trống SMTP_USER, SMTP_PASS
// (dòng SMTP_* thật của Gmail để thành chú thích bằng dấu #), rồi chạy lại: npm run server
import http from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const SMTP_PORT = Number(process.env.MAIL_SINK_SMTP_PORT) || 1025;
const WEB_PORT = Number(process.env.MAIL_SINK_WEB_PORT) || 1080;
const MAX_MAILS = 200;

const mails = []; // mới nhất đứng đầu; chỉ giữ trong bộ nhớ, tắt hộp thư ảo là mất

const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
        simpleParser(stream)
            .then((parsed) => {
                mails.unshift({
                    id: String(Date.now()) + Math.random().toString(16).slice(2, 6),
                    at: new Date().toISOString(),
                    from: parsed.from?.text || '',
                    to: parsed.to?.text || '',
                    subject: parsed.subject || '(không tiêu đề)',
                    text: parsed.text || '',
                    html: parsed.html || '',
                    attachments: (parsed.attachments || []).map((file) => ({
                        name: file.filename || 'tep-dinh-kem',
                        type: file.contentType,
                        content: file.content
                    }))
                });
                mails.length = Math.min(mails.length, MAX_MAILS);
                console.log(`[mail ảo] ${mails[0].subject} -> ${mails[0].to}`);
                callback();
            })
            .catch(callback);
    }
});
smtp.on('error', (error) => console.error('[mail ảo] Lỗi SMTP:', error.message));
smtp.listen(SMTP_PORT, () => console.log(`[mail ảo] Nhận thư ở SMTP cổng ${SMTP_PORT}`));

const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const page = (
    body
) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hộp thư ảo</title>
<style>body{font-family:Arial,sans-serif;margin:0;background:#f3f5f2;color:#222}header{background:#2e7d32;color:#fff;padding:14px 20px}header a{color:#fff;text-decoration:none;font-weight:bold}main{max-width:900px;margin:0 auto;padding:16px}
.row{display:block;background:#fff;border:1px solid #e1e5df;border-radius:8px;padding:12px 14px;margin-bottom:8px;color:inherit;text-decoration:none}.row small{color:#777;display:block;margin-top:2px}
.meta{background:#fff;border:1px solid #e1e5df;border-radius:8px;padding:12px 14px;margin-bottom:12px}iframe{width:100%;height:560px;border:1px solid #e1e5df;border-radius:8px;background:#fff}
pre{white-space:pre-wrap;background:#fff;border:1px solid #e1e5df;border-radius:8px;padding:12px}.muted{color:#777}</style></head>
<body><header><a href="/">Hộp thư ảo</a> &nbsp;·&nbsp; SMTP cổng ${SMTP_PORT}</header><main>${body}</main></body></html>`;

http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const mail = mails.find((item) => url.pathname === `/mail/${item.id}`);
    const send = (status, type, body) => {
        response.writeHead(status, { 'Content-Type': type });
        response.end(body);
    };

    const file = url.pathname.match(/^\/mail\/([^/]+)\/file\/(\d+)$/);
    if (file) {
        const found = mails.find((item) => item.id === file[1])?.attachments[Number(file[2])];
        if (!found) return send(404, 'text/plain; charset=utf-8', 'Không tìm thấy tệp');
        response.writeHead(200, {
            'Content-Type': found.type,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(found.name)}"`
        });
        return response.end(found.content);
    }
    if (url.pathname === '/api/mails') {
        return send(
            200,
            'application/json; charset=utf-8',
            JSON.stringify(mails.map(({ id, at, from, to, subject, text }) => ({ id, at, from, to, subject, text })))
        );
    }
    if (mail) {
        const body = mail.html ? `<iframe sandbox srcdoc="${esc(mail.html)}"></iframe>` : `<pre>${esc(mail.text)}</pre>`;
        return send(
            200,
            'text/html; charset=utf-8',
            page(`
            <p><a href="/">&larr; Quay lại hộp thư</a></p>
            <div class="meta"><b>${esc(mail.subject)}</b><br>Từ: ${esc(mail.from)}<br>Tới: ${esc(mail.to)}<br>Lúc: ${new Date(mail.at).toLocaleString('vi-VN')}
            ${mail.attachments.length ? `<br>Đính kèm: ${mail.attachments.map((item, index) => `<a href="/mail/${mail.id}/file/${index}">${esc(item.name)}</a>`).join(', ')}` : ''}</div>
            ${body}
            ${mail.html ? `<h4>Bản văn bản thuần</h4><pre>${esc(mail.text)}</pre>` : ''}`)
        );
    }
    if (url.pathname !== '/') return send(404, 'text/plain; charset=utf-8', 'Không tìm thấy');
    send(
        200,
        'text/html; charset=utf-8',
        page(`
        <h2>Thư đã nhận (${mails.length})</h2>
        ${mails.length ? mails.map((item) => `<a class="row" href="/mail/${item.id}"><b>${esc(item.subject)}</b><small>Tới ${esc(item.to)} · ${new Date(item.at).toLocaleString('vi-VN')}${item.attachments.length ? ' · có đính kèm' : ''}</small></a>`).join('') : '<p class="muted">Chưa có thư nào. Thử đổi mật khẩu hoặc gửi hóa đơn trên website, thư sẽ hiện ở đây.</p>'}
        <script>setTimeout(() => location.reload(), 5000)</script>`)
    );
}).listen(WEB_PORT, () => console.log(`[mail ảo] Xem thư tại http://localhost:${WEB_PORT}`));
