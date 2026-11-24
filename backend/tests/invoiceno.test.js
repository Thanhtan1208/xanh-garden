// Số hóa đơn: dãy số 8 chữ số tăng dần cho từng đơn (đơn cũ được đánh số khi khởi động) và mã số thuế người bán.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, call, fixture, login, newCustomer, placeOrder, startServer } from './helpers.js';

const oldOrder = (id, createdAt) => ({
    id,
    code: `XG250101-${id.toUpperCase()}`,
    userId: 'admin1',
    customer: { fullName: 'Khách cũ', phone: '0901234567', email: 'cu@xanhgarden.test', address: '12 Lê Lợi' },
    items: [{ id: '1', name: 'Lưỡi hổ', price: 120000, qty: 1, image: 'p1.png' }],
    subtotal: 120000,
    discount: 0,
    shippingFee: 30000,
    shippingDiscount: 0,
    total: 150000,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    shippingMethod: 'standard',
    status: 'delivered',
    history: [],
    createdAt,
    updatedAt: createdAt
});

let ctx;
let admin;
before(async () => {
    const data = fixture();
    // hai đơn cũ chưa có số hóa đơn, cố ý để ngược thứ tự thời gian
    data.orders = [oldOrder('muoi', '2026-03-01T00:00:00.000Z'), oldOrder('truoc', '2026-01-01T00:00:00.000Z')];
    ctx = await startServer({ data });
    admin = await login(ctx, 'admin');
});
after(() => ctx.stop());

describe('Số hóa đơn', () => {
    test('đơn cũ được đánh số theo thứ tự thời gian đặt; đơn mới nhận số tiếp theo, không trùng', async () => {
        const byId = (id) => ctx.db.orders.find((order) => order.id === id);
        assert.equal(byId('truoc').invoiceNo, '00000001', 'đơn đặt sớm hơn có số nhỏ hơn');
        assert.equal(byId('muoi').invoiceNo, '00000002');

        const buyer = await newCustomer(ctx);
        const address = await addAddress(ctx, buyer.token);
        const first = (await placeOrder(ctx, buyer.token, address, [['1', 1]])).body;
        const second = (await placeOrder(ctx, buyer.token, address, [['2', 1]])).body;
        assert.equal(first.invoiceNo, '00000003');
        assert.equal(second.invoiceNo, '00000004');
        assert.match(first.invoiceNo, /^\d{8}$/);
    });

    test('số hóa đơn không bị dùng lại sau khi đơn bị hủy', async () => {
        const buyer = await newCustomer(ctx);
        const address = await addAddress(ctx, buyer.token);
        const gone = (await placeOrder(ctx, buyer.token, address, [['3', 1]])).body;
        await call(ctx, 'PATCH', `/orders/${gone.id}/status`, { token: admin, body: { status: 'cancelled' } });
        const next = (await placeOrder(ctx, buyer.token, address, [['4', 1]])).body;
        assert.ok(Number(next.invoiceNo) > Number(gone.invoiceNo), `${next.invoiceNo} sau ${gone.invoiceNo}`);
    });

    test('email hóa đơn ghi số hóa đơn', async () => {
        const buyer = await newCustomer(ctx);
        const order = (await placeOrder(ctx, buyer.token, await addAddress(ctx, buyer.token), [['5', 1]])).body;
        assert.equal((await call(ctx, 'POST', `/orders/${order.id}/invoice-email`, { token: admin })).status, 200);
        const mail = [...ctx.mails].reverse().find((item) => item.subject.includes(order.code));
        assert.match(mail.text, new RegExp(`Số phiếu bán hàng: ${order.invoiceNo}`));
    });
});

describe('Mã số thuế người bán', () => {
    const save = async (taxCode) => {
        const current = (await call(ctx, 'GET', '/admin/shop', { token: admin })).body;
        return call(ctx, 'PUT', '/admin/shop', { token: admin, body: { ...current, taxCode } });
    };

    test('10 chữ số hoặc 13 chữ số có gạch nối, hoặc để trống; sai định dạng thì từ chối', async () => {
        assert.equal((await save('0312345678')).status, 200);
        assert.equal((await call(ctx, 'GET', '/shop')).body.shop.taxCode, '0312345678', 'giao diện nhận được để in lên hóa đơn');
        assert.equal((await save('0312345678-001')).status, 200);
        assert.equal((await save('')).status, 200);
        for (const bad of ['123', 'abcdefghij', '03123456789', '0312345678-1']) assert.equal((await save(bad)).status, 400, bad);
    });
});
