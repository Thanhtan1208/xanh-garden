// Giao hàng nhanh: thời gian giao dự kiến, mã vận đơn khi bắt đầu giao, thông tin vận chuyển trong email hóa đơn.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, call, login, newCustomer, placeOrder, startServer } from './helpers.js';

let ctx;
let admin;
let customer;
let address;
let deliveryWindow;
before(async () => {
    ctx = await startServer();
    // nạp sau khi server thử chạy để dùng dữ liệu tạm của bộ test
    ({ deliveryWindow } = await import('../server/core/rules.js'));
    admin = await login(ctx, 'admin');
    customer = await newCustomer(ctx);
    address = await addAddress(ctx, customer.token);
});
after(() => ctx.stop());

const DAY = 24 * 60 * 60 * 1000;
const order = async (shippingMethod, items = [['1', 1]]) => {
    const made = await placeOrder(ctx, customer.token, address, items, { shippingMethod });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return made.body;
};
const setStatus = (id, status, extra = {}) => call(ctx, 'PATCH', `/orders/${id}/status`, { token: admin, body: { status, ...extra } });

describe('Thời gian giao dự kiến', () => {
    test('giao nhanh 1–2 ngày, giao tiêu chuẩn 3–5 ngày, tính từ lúc đặt', () => {
        const start = Date.parse('2026-11-16T03:00:00.000Z');
        const days = (method) => {
            const window = deliveryWindow(method, start);
            return [(Date.parse(window.from) - start) / DAY, (Date.parse(window.to) - start) / DAY];
        };
        assert.deepEqual(days('express'), [1, 2]);
        assert.deepEqual(days('standard'), [3, 5]);
    });

    test('đơn lưu thời gian dự kiến theo cách giao khách chọn; giao nhanh vẫn tính phí 50.000 ₫ dù đơn trên 500.000 ₫', async () => {
        const fast = await order('express', [['5', 2]]);
        const slow = await order('standard');
        assert.equal(fast.shippingMethod, 'express');
        assert.equal(fast.shippingFee, 50000, 'giao nhanh không được miễn phí');
        const gap = (entry) => Math.round((Date.parse(entry.delivery.to) - Date.parse(entry.createdAt)) / DAY);
        assert.equal(gap(fast), 2);
        assert.equal(gap(slow), 5);
    });

    test('giao diện nhận được số ngày dự kiến qua cấu hình cửa hàng', async () => {
        const shop = await call(ctx, 'GET', '/shop');
        assert.deepEqual(shop.body.rules.deliveryDays, { standard: [3, 5], express: [1, 2] });
    });
});

describe('Mã vận đơn và email hóa đơn', () => {
    test('mã vận đơn do nhân viên nhập khi bắt đầu giao (hãng thật), không tự bịa mã', async () => {
        const fast = await order('express', [['3', 1]]);
        const slow = await order('standard', [['4', 1]]);
        assert.equal(fast.trackingCode, undefined, 'chưa giao thì chưa có mã vận đơn');
        for (const entry of [fast, slow]) assert.equal((await setStatus(entry.id, 'confirmed')).status, 200);

        const bad = await setStatus(fast.id, 'shipping', { carrier: 'ghn', trackingCode: '12' });
        assert.equal(bad.status, 400, 'hãng thật thì bắt buộc mã hợp lệ');
        assert.equal(
            (await call(ctx, 'GET', `/orders/${fast.id}`, { token: admin })).body.status,
            'confirmed',
            'mã sai thì đơn chưa chuyển trạng thái'
        );

        assert.equal((await setStatus(fast.id, 'shipping', { carrier: 'ghn', trackingCode: ' lk7xq9ab ' })).status, 200);
        assert.equal((await setStatus(slow.id, 'shipping', { carrier: 'shop' })).status, 200);
        const mine = (await call(ctx, 'GET', '/orders', { token: customer.token })).body;
        const a = mine.find((entry) => entry.id === fast.id);
        const b = mine.find((entry) => entry.id === slow.id);
        assert.equal(a.trackingCode, 'LK7XQ9AB');
        assert.equal(a.carrier, 'Giao Hàng Nhanh');
        assert.equal(b.trackingCode, undefined, 'cửa hàng tự giao thì không có mã');
        assert.equal(b.carrier, 'Cửa hàng tự giao');
        await setStatus(fast.id, 'delivered');
        const after = (await call(ctx, 'GET', `/orders/${fast.id}`, { token: customer.token })).body;
        assert.equal(after.trackingCode, 'LK7XQ9AB', 'mã không đổi sau khi giao xong');
    });

    test('email hóa đơn ghi cách giao, ngày dự kiến nhận hàng và mã vận đơn (nếu đã có)', async () => {
        const made = await order('express', [['6', 1]]);
        await setStatus(made.id, 'confirmed');
        await setStatus(made.id, 'shipping', { carrier: 'ghtk', trackingCode: 'S22A123456' });
        const sent = await call(ctx, 'POST', `/orders/${made.id}/invoice-email`, { token: admin });
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        const mail = [...ctx.mails].reverse().find((item) => item.subject.includes(made.code));
        assert.ok(mail, 'có email hóa đơn');
        assert.match(mail.text, /Vận chuyển: Giao nhanh · dự kiến nhận hàng \d{2}\/\d{2} – \d{2}\/\d{2}/);
        const tracking = (await call(ctx, 'GET', `/orders/${made.id}`, { token: admin })).body.trackingCode;
        assert.match(mail.text, new RegExp(`Mã vận đơn: Giao Hàng Tiết Kiệm · ${tracking}`));
    });
});
