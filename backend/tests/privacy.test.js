// Dữ liệu gửi sang OpenAI: che thông tin cá nhân, không gửi tên đăng nhập, lý do/từ khóa chữ tự do không lọt vào bản phân tích.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { addAddress, call, login, newCustomer, placeOrder, startServer } from './helpers.js';
import { redact, safeKeyword } from '../server/ai/privacy.js';

describe('Che thông tin cá nhân', () => {
    test('che email, số điện thoại, khóa API và dãy số dài; giữ nguyên giá tiền và số thường', () => {
        assert.equal(redact('liên hệ an@gmail.com nhé'), 'liên hệ [email] nhé');
        assert.equal(
            redact('gọi 0912345678 hoặc 0912 345 678 hoặc +84 912 345 678'),
            'gọi [số điện thoại] hoặc [số điện thoại] hoặc [số điện thoại]'
        );
        assert.equal(redact('khóa sk-proj-abcdefghij123456'), 'khóa [khóa]');
        assert.equal(redact('stk 1234567890123'), 'stk [số]');
        assert.equal(redact('cây dưới 12.000.000 ₫, mua 3 cái, mã 123456'), 'cây dưới 12.000.000 ₫, mua 3 cái, mã 123456');
        assert.equal(redact(null), '');
    });

    test('từ khóa tìm kiếm chứa số điện thoại, email hoặc quá dài bị bỏ; từ khóa thường giữ', () => {
        assert.equal(safeKeyword('bonsai mini'), true);
        assert.equal(safeKeyword('cây kim tiền 2 chậu'), true);
        assert.equal(safeKeyword('0912345678'), false);
        assert.equal(safeKeyword('an@gmail.com'), false);
        assert.equal(safeKeyword('x'.repeat(41)), false);
    });
});

describe('Nội dung thật gửi sang OpenAI', () => {
    let ctx;
    let admin;
    let fake;
    let sent;
    before(async () => {
        ctx = await startServer();
        admin = await login(ctx, 'admin');
        sent = [];
        fake = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                sent.push(body);
                res.setHeader('Content-Type', 'application/json');
                if (req.url.endsWith('/embeddings')) {
                    res.statusCode = 500;
                    return res.end('{}');
                }
                res.end(JSON.stringify({ choices: [{ message: { content: 'Xin chào, mình hỗ trợ được gì ạ?' } }] }));
            });
        });
        await new Promise((resolve) => fake.listen(0, resolve));
        process.env.OPENAI_BASE_URL = `http://localhost:${fake.address().port}`;
        process.env.OPENAI_API_KEY = 'khoa-gia';
    });
    after(() => {
        fake.close();
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_BASE_URL;
        ctx.stop();
    });

    test('chatbot: không gửi tên đăng nhập; email và số điện thoại khách gõ bị che ở cả tin nhắn lẫn lịch sử', async () => {
        const customer = await newCustomer(ctx);
        const ask = (message) => call(ctx, 'POST', '/chat', { token: customer.token, body: { message } });
        // tin 1 chứa số điện thoại; sang tin 2 nó nằm trong lịch sử hội thoại gửi kèm
        assert.equal((await ask('số mình là 0987654321 nhé')).status, 200);
        const first = sent.join(' ');
        sent.length = 0;
        const reply = await ask('tư vấn cây để bàn giúp mình, email mình là bi.mat@gmail.com');
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        const all = first + ' ' + sent.join(' ');
        assert.ok(sent.length > 0, 'có gọi OpenAI');
        assert.ok(!all.includes(customer.name), 'không gửi tên đăng nhập');
        assert.ok(!all.includes('bi.mat@gmail.com'), 'email bị che');
        assert.ok(!all.includes('0987654321'), 'số điện thoại bị che (cả khi nằm trong lịch sử)');
        assert.match(sent.join(' '), /[email]/);
        assert.match(sent.join(' '), /[số điện thoại]/, 'lịch sử gửi kèm đã được che');
        assert.match(all, /cây để bàn/, 'phần còn lại của câu hỏi vẫn được gửi');
    });

    test('phân tích AI: lý do hủy gõ tay và từ khóa chứa số điện thoại không lọt vào dữ liệu gửi đi', async () => {
        const buyer = await newCustomer(ctx);
        const order = (await placeOrder(ctx, buyer.token, await addAddress(ctx, buyer.token), [['1', 1]])).body;
        const cancelled = await call(ctx, 'PATCH', `/orders/${order.id}/status`, {
            token: admin,
            body: { status: 'cancelled', reason: 'Khách Nguyễn Văn Bí 0911222333 không nghe máy' }
        });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        const track = (q) =>
            call(ctx, 'POST', '/track', { body: { events: [{ type: 'search', v: 'abcdefgh12', s: 'abcdefgh34', q, n: 0 }] } });
        await track('cây tiểu cảnh 0911222333');
        await track('xương rồng bonsai');
        await new Promise((resolve) => setTimeout(resolve, 1300)); // nhật ký hành vi ghi gộp mỗi giây

        sent.length = 0;
        const result = await call(ctx, 'POST', '/admin/insights/ai', { token: admin, body: { days: 30 } });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const all = sent.join('\n');
        assert.ok(all.length > 500, 'có gửi dữ liệu');
        assert.ok(!all.includes('0911222333'), 'không có số điện thoại');
        assert.ok(!all.includes('Nguyễn Văn Bí'), 'không có tên khách');
        assert.match(all, /lý do ghi tay/, 'lý do gõ tay được gộp thành nhóm chung');
        assert.match(all, /xương rồng bonsai/, 'từ khóa bình thường vẫn được giữ');
    });
});
