// Gửi email qua Brevo (HTTPS) khi máy chủ chặn cổng SMTP: thử với một server Brevo giả trên máy
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

let fake;
const received = [];
let status = 201;
let sendMail;

before(async () => {
    fake = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            received.push({ key: req.headers['api-key'], body: JSON.parse(body) });
            res.writeHead(status, { 'content-type': 'application/json' }).end(status < 300 ? '{"messageId":"x"}' : '{"message":"bad"}');
        });
    }).listen(0, '127.0.0.1');
    await once(fake, 'listening');
    Object.assign(process.env, {
        BREVO_API_KEY: 'test-brevo-key',
        BREVO_API_URL: `http://127.0.0.1:${fake.address().port}/v3/smtp/email`,
        MAIL_FROM: 'Xanh Garden <shop@example.com>'
    });
    console.log = () => {};
    ({ sendMail } = await import('../server/core/mailer.js'));
});
after(() => fake.close());

describe('Email qua Brevo', () => {
    test('gửi đúng khóa, người gửi, người nhận, tiêu đề và nội dung', async () => {
        await sendMail({ to: 'khach@test.vn', subject: 'Mã xác minh', text: 'Mã của bạn là: 123456', html: '<b>123456</b>' });
        assert.deepEqual(received.at(-1), {
            key: 'test-brevo-key',
            body: {
                sender: { name: 'Xanh Garden', email: 'shop@example.com' },
                to: [{ email: 'khach@test.vn' }],
                subject: 'Mã xác minh',
                textContent: 'Mã của bạn là: 123456',
                htmlContent: '<b>123456</b>'
            }
        });
    });

    test('Brevo từ chối (sai khóa) thì báo lỗi ngay, không thử lại', async () => {
        status = 401;
        const before = received.length;
        await assert.rejects(sendMail({ to: 'khach@test.vn', subject: 'x', text: 'y' }), /Brevo 401/);
        assert.equal(received.length, before + 1);
        status = 201;
    });
});
