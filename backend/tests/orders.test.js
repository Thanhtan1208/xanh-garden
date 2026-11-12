// Nghiệp vụ đơn hàng: tính giá, đặt hàng, giới hạn, trừ/hoàn kho, luồng trạng thái, đổi phương thức thanh toán,
// webhook SePay (đủ/thiếu/thừa/trùng/đơn đã hủy), tự hủy đơn quá hạn thanh toán, hoàn tiền.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, call, login, newCustomer, placeOrder, startServer, stockOf, webhook } from './helpers.js';

let ctx;
let admin;
before(async () => {
    ctx = await startServer();
    admin = await login(ctx, 'admin');
});
after(() => ctx.stop());

const content = (order) => order.code.replace(/[^A-Z0-9]/g, '');
let tx = 1000;

describe('Xem trước giá (/orders/quote)', () => {
    test('phí ship: tiêu chuẩn 30k, miễn phí từ 500k tiền hàng; giao nhanh luôn 50k', async () => {
        const { token } = await newCustomer(ctx);
        const quote = (items, shippingMethod = 'standard') =>
            call(ctx, 'POST', '/orders/quote', { token, body: { items, shippingMethod } });
        const small = await quote([{ id: '1', qty: 2 }]);
        assert.equal(small.status, 200);
        assert.deepEqual([small.body.goods, small.body.shippingFee, small.body.total], [240000, 30000, 270000]);
        const free = await quote([{ id: '3', qty: 2 }]);
        assert.deepEqual([free.body.goods, free.body.shippingFee, free.body.total], [500000, 0, 500000]);
        const express = await quote([{ id: '3', qty: 2 }], 'express');
        assert.equal(express.body.shippingFee, 50000);
        const merged = await quote([
            { id: '1', qty: 1 },
            { id: '1', qty: 1 }
        ]);
        assert.equal(merged.body.goods, 240000, 'dòng trùng sản phẩm được gộp');
    });

    test('giá do server tính, bỏ qua giá client gửi lên', async () => {
        const { token } = await newCustomer(ctx);
        const result = await call(ctx, 'POST', '/orders/quote', {
            token,
            body: { items: [{ id: '1', qty: 1, price: 1 }], shippingMethod: 'standard', total: 1 }
        });
        assert.equal(result.body.goods, 120000);
    });
});

describe('Đặt hàng', () => {
    test('đơn COD: trừ kho, ghi nhật ký kho, xóa sản phẩm đã đặt khỏi giỏ, chụp giá lúc đặt', async () => {
        const { token, user } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        await call(ctx, 'PUT', '/cart', {
            token,
            body: {
                items: [
                    { id: '1', qty: 2 },
                    { id: '7', qty: 1 }
                ]
            }
        });
        const before = stockOf(ctx, 1);

        const result = await placeOrder(ctx, token, addressId, [['1', 2]]);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        const order = result.body;
        assert.match(order.code, /^XG\d{6}-[A-Z0-9]{5}$/);
        assert.equal(
            order.code.slice(2, 8),
            new Date(Date.now() + 7 * 3600000).toISOString().slice(2, 10).replace(/-/g, ''),
            'ngày trong mã đơn theo giờ Việt Nam'
        );
        assert.equal(order.status, 'pending');
        assert.equal(order.paymentStatus, 'unpaid');
        assert.equal(order.userId, user.id);
        assert.equal(order.items[0].price, 120000);
        assert.equal(order.total, 240000 + 30000);
        assert.equal(stockOf(ctx, 1), before - 2);
        const log = ctx.db.stockLogs.find((entry) => entry.note === `Đơn ${order.code}`);
        assert.deepEqual([log.type, log.qty, log.balanceAfter], ['sale', -2, before - 2]);
        const cart = await call(ctx, 'GET', '/cart', { token });
        assert.deepEqual(cart.body.items, [{ id: '7', qty: 1 }], 'chỉ bỏ sản phẩm đã đặt khỏi giỏ');

        ctx.db.products.find((product) => product.id === '1').price = 999000; // đổi giá sau khi đặt
        const again = await call(ctx, 'GET', `/orders/${order.id}`, { token });
        assert.equal(again.body.items[0].price, 120000, 'đơn giữ giá lúc đặt');
        ctx.db.products.find((product) => product.id === '1').price = 120000;
    });

    test('chặn bấm đặt 2 lần (đơn giống hệt trong 10 giây)', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        assert.equal((await placeOrder(ctx, token, addressId, [['9', 1]])).status, 201);
        const duplicate = await placeOrder(ctx, token, addressId, [['9', 1]]);
        assert.equal(duplicate.status, 429);
    });

    test('kiểm tra dữ liệu: địa chỉ, số lượng, tồn kho, sản phẩm không tồn tại', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        assert.equal((await placeOrder(ctx, token, 'khong-co', [['1', 1]])).status, 400, 'địa chỉ không thuộc tài khoản');
        assert.equal((await placeOrder(ctx, token, addressId, [])).status, 400, 'giỏ trống');
        assert.equal((await placeOrder(ctx, token, addressId, [['1', 0]])).status, 400, 'số lượng 0');
        assert.equal((await placeOrder(ctx, token, addressId, [['1', 1.5]])).status, 400, 'số lượng lẻ');
        assert.equal((await placeOrder(ctx, token, addressId, [['1', 21]])).status, 400, 'quá 20 cái/sản phẩm');
        assert.equal((await placeOrder(ctx, token, addressId, [['8', 4]])).status, 409, 'vượt tồn kho');
        assert.equal((await placeOrder(ctx, token, addressId, [['13', 1]])).status, 409, 'hết hàng');
        assert.equal((await placeOrder(ctx, token, addressId, [['999', 1]])).status, 400, 'sản phẩm không tồn tại');
        assert.equal((await placeOrder(ctx, token, addressId, [['1', 1]], { shippingMethod: 'bay' })).status, 400);
        assert.equal((await placeOrder(ctx, token, addressId, [['1', 1]], { paymentMethod: 'momo' })).status, 400);
    });

    test('tiền hàng trên 1 triệu: bắt buộc chuyển khoản, đơn ở trạng thái chờ thanh toán có hạn 30 phút', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const cod = await placeOrder(ctx, token, addressId, [['5', 3]]);
        assert.equal(cod.status, 400);
        const qr = await placeOrder(ctx, token, addressId, [['5', 3]], { paymentMethod: 'sepay' });
        assert.equal(qr.status, 201);
        assert.equal(qr.body.status, 'unconfirmed');
        assert.ok(qr.body.payExpiresAt - Date.now() > 29 * 60 * 1000);
        const info = await call(ctx, 'GET', `/orders/${qr.body.id}/payment-info`, { token });
        assert.equal(info.body.amount, qr.body.total);
        assert.equal(info.body.content, content(qr.body));
        assert.match(info.body.qrUrl, /qr\.sepay\.vn/);
    });

    test('giá trị đơn tối đa 50 triệu', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const product = ctx.db.products.find((item) => item.id === '4');
        product.price = 30000000;
        const result = await placeOrder(ctx, token, addressId, [['4', 2]], { paymentMethod: 'sepay' });
        product.price = 320000;
        assert.equal(result.status, 400);
    });

    test('tối đa 3 đơn chưa thanh toán/chưa xác nhận cùng lúc', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        for (const id of ['10', '11', '12'])
            assert.equal((await placeOrder(ctx, token, addressId, [[id, 1]], { paymentMethod: 'sepay' })).status, 201);
        const fourth = await placeOrder(ctx, token, addressId, [['9', 1]], { paymentMethod: 'sepay' });
        assert.equal(fourth.status, 409);
    });

    test('khách chỉ xem được đơn của mình; admin xem được tất cả', async () => {
        const a = await newCustomer(ctx);
        const b = await newCustomer(ctx);
        const order = (await placeOrder(ctx, a.token, await addAddress(ctx, a.token), [['7', 2]])).body;
        assert.equal((await call(ctx, 'GET', `/orders/${order.id}`, { token: b.token })).status, 403);
        assert.equal((await call(ctx, 'GET', `/orders/${order.code}`, { token: a.token })).status, 200, 'tra được bằng mã đơn');
        const mine = await call(ctx, 'GET', '/orders', { token: b.token });
        assert.ok(mine.body.every((item) => item.userId === b.user.id));
        const all = await call(ctx, 'GET', '/orders', { token: admin });
        assert.ok(all.body.some((item) => item.id === order.id));
    });
});

describe('Luồng trạng thái đơn', () => {
    test('chờ xác nhận -> đã xác nhận -> đang giao -> đã giao; COD giao xong thì ghi nhận đã thanh toán', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['2', 1]])).body;
        const set = (status, who = admin) => call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: who, body: { status } });
        assert.equal((await set('confirmed', token)).status, 403, 'khách không tự xác nhận');
        assert.equal((await set('delivered')).status, 409, 'không nhảy cóc trạng thái');
        assert.equal((await set('confirmed')).status, 200);
        assert.equal((await set('cancelled', token)).status, 403, 'đã xác nhận thì khách không tự hủy');
        assert.equal((await set('shipping')).status, 200);
        assert.equal((await set('cancelled', token)).status, 403, 'đang giao thì khách không tự hủy');
        const done = await set('delivered');
        assert.equal(done.body.status, 'delivered');
        assert.equal(done.body.paymentStatus, 'paid');
        assert.deepEqual(
            done.body.history.map((entry) => entry.status),
            ['pending', 'confirmed', 'shipping', 'delivered']
        );
        assert.equal((await set('cancelled')).status, 409);
    });

    test('khách hủy đơn: hoàn kho đúng một lần, ghi nhật ký hoàn kho', async () => {
        const { token } = await newCustomer(ctx);
        const before = stockOf(ctx, 6);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['6', 2]])).body;
        assert.equal(stockOf(ctx, 6), before - 2);
        const cancel = await call(ctx, 'PATCH', `/orders/${order.id}/status`, {
            token,
            body: { status: 'cancelled', reasonId: 'change_mind' }
        });
        assert.equal(cancel.status, 200);
        assert.equal(stockOf(ctx, 6), before);
        const again = await call(ctx, 'PATCH', `/orders/${order.id}/status`, {
            token,
            body: { status: 'cancelled', reasonId: 'change_mind' }
        });
        assert.equal(again.status, 409);
        assert.equal(stockOf(ctx, 6), before, 'hủy lần hai không cộng kho thêm');
        assert.ok(ctx.db.stockLogs.some((entry) => entry.type === 'cancel_return' && entry.note === `Hủy đơn ${order.code}`));
    });

    test('đơn SePay chưa nhận tiền thì admin chưa xác nhận được', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['7', 3]], { paymentMethod: 'sepay' })).body;
        assert.equal(order.status, 'pending');
        const confirm = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        assert.equal(confirm.status, 409);
    });

    test('giao không thành công (khách không nhận): admin hủy đơn đang giao, hoàn kho, COD không tính đã thu tiền', async () => {
        const { token } = await newCustomer(ctx);
        const before = stockOf(ctx, 9);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['9', 2]])).body;
        for (const status of ['confirmed', 'shipping'])
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        const failed = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'cancelled' } });
        assert.equal(failed.status, 200);
        assert.equal(failed.body.status, 'cancelled');
        assert.equal(failed.body.paymentStatus, 'unpaid', 'COD chưa thu tiền thì không cần hoàn');
        assert.match(failed.body.cancelReason, /Giao hàng không thành công/);
        assert.equal(stockOf(ctx, 9), before, 'hàng hoàn về kho');
    });

    test('đơn đã chuyển khoản mà giao không thành công: hủy và đánh dấu cần hoàn tiền', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['11', 1]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: order.total, content: content(order) });
        for (const status of ['confirmed', 'shipping'])
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        const failed = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'cancelled' } });
        assert.equal(failed.status, 200);
        assert.equal(failed.body.paymentStatus, 'refund_pending');
    });
});

describe('Đổi phương thức thanh toán', () => {
    test('COD <-> QR khi chưa thanh toán và chưa xác nhận', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['1', 1]])).body;
        const toQr = await call(ctx, 'PATCH', `/orders/${order.id}/payment-method`, { token, body: { paymentMethod: 'sepay' } });
        assert.equal(toQr.status, 200);
        assert.equal(toQr.body.paymentMethod, 'sepay');
        assert.ok(toQr.body.payExpiresAt > Date.now());
        const same = await call(ctx, 'PATCH', `/orders/${order.id}/payment-method`, { token, body: { paymentMethod: 'sepay' } });
        assert.equal(same.status, 409);
        const toCod = await call(ctx, 'PATCH', `/orders/${order.id}/payment-method`, { token, body: { paymentMethod: 'cod' } });
        assert.equal(toCod.body.payExpiresAt, undefined);
    });

    test('đơn trên 1 triệu không đổi sang COD; đã có giao dịch chuyển khoản thì không đổi được', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const big = (await placeOrder(ctx, token, addressId, [['4', 4]], { paymentMethod: 'sepay' })).body;
        assert.equal((await call(ctx, 'PATCH', `/orders/${big.id}/payment-method`, { token, body: { paymentMethod: 'cod' } })).status, 400);

        const small = (await placeOrder(ctx, token, addressId, [['10', 1]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: 1000, content: content(small) });
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${small.id}/payment-method`, { token, body: { paymentMethod: 'cod' } })).status,
            409
        );
    });

    test('đổi sang chuyển khoản vẫn tính vào giới hạn 3 đơn chưa thanh toán', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const cod = (await placeOrder(ctx, token, addressId, [['1', 1]])).body;
        for (const id of ['7', '9', '10'])
            assert.equal((await placeOrder(ctx, token, addressId, [[id, 1]], { paymentMethod: 'sepay' })).status, 201);
        const toQr = await call(ctx, 'PATCH', `/orders/${cod.id}/payment-method`, { token, body: { paymentMethod: 'sepay' } });
        assert.equal(toQr.status, 409);
    });
});

describe('Webhook SePay', () => {
    test('sai khóa API bị từ chối; giao dịch tiền ra bị bỏ qua; thiếu mã giao dịch báo lỗi', async () => {
        assert.equal((await webhook(ctx, { id: 1, transferAmount: 1, content: 'X' }, 'sai')).status, 401);
        const out = await webhook(ctx, { id: 2, transferType: 'out', transferAmount: 1 });
        assert.equal(out.status, 200);
        assert.ok(!ctx.db.payments.some((payment) => payment.txId === '2'));
        assert.equal((await webhook(ctx, { transferAmount: 1 })).status, 400);
    });

    test('không khớp đơn nào: lưu lại để admin xử lý', async () => {
        const result = await webhook(ctx, { id: (tx += 1), transferAmount: 50000, content: 'chuyen tien linh tinh' });
        assert.equal(result.status, 200);
        assert.equal(ctx.db.payments.at(-1).result, 'no_order');
    });

    test('đủ tiền: đơn trên 1 triệu được xác nhận tự động và gửi email; giao dịch lặp lại không ghi 2 lần', async () => {
        const { token, email } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['5', 3]], { paymentMethod: 'sepay' })).body;
        const id = (tx += 1);
        // Ngân hàng thường bỏ dấu gạch và thêm chữ vào nội dung.
        const result = await webhook(ctx, { id, transferAmount: order.total, content: `MBVCB.123 ${content(order)} thanh toan` });
        assert.equal(result.status, 200);
        const fresh = (await call(ctx, 'GET', `/orders/${order.id}`, { token })).body;
        assert.equal(fresh.paymentStatus, 'paid');
        assert.equal(fresh.status, 'pending', 'chuyển từ chờ thanh toán sang chờ cửa hàng xác nhận');
        assert.equal(fresh.payExpiresAt, undefined);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const invoice = ctx.mails.find((mail) => mail.to === email && mail.subject.includes(`Hóa đơn ${order.code}`));
        assert.ok(invoice, 'nhận đủ tiền thì tự gửi hóa đơn');
        assert.ok(invoice.text.includes('xác nhận tự động'));

        const repeat = await webhook(ctx, { id, transferAmount: order.total, content: content(order) });
        assert.equal(repeat.body.duplicate, true);
        assert.equal(ctx.db.payments.filter((payment) => payment.txId === String(id)).length, 1);

        const twice = await webhook(ctx, { id: (tx += 1), transferAmount: order.total, content: content(order) });
        assert.equal(twice.status, 200);
        assert.equal(ctx.db.payments.at(-1).result, 'duplicate_payment', 'khách chuyển 2 lần: đánh dấu để hoàn');
        // Đơn đã thanh toán, cửa hàng chưa xác nhận: khách hủy được (phải chọn lý do), đơn chuyển sang "cần hoàn tiền"
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token, body: { status: 'cancelled' } })).status,
            400,
            'thiếu lý do hủy'
        );
        const refund = await call(ctx, 'PATCH', `/orders/${order.id}/status`, {
            token,
            body: { status: 'cancelled', reasonId: 'change_mind' }
        });
        assert.equal(refund.status, 200, JSON.stringify(refund.body));
        assert.equal(refund.body.paymentStatus, 'refund_pending');
        assert.equal(refund.body.cancelledBy, 'customer');
    });

    test('chuyển thiếu rồi chuyển bù: cộng dồn đủ tiền thì ghi nhận đã thanh toán', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 5]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: 1000000, content: content(order) });
        assert.equal(ctx.db.payments.at(-1).result, 'underpaid');
        assert.equal((await call(ctx, 'GET', `/orders/${order.id}`, { token })).body.paymentStatus, 'unpaid');
        await webhook(ctx, { id: (tx += 1), transferAmount: order.total - 1000000, content: content(order) });
        const fresh = (await call(ctx, 'GET', `/orders/${order.id}`, { token })).body;
        assert.equal(fresh.paymentStatus, 'paid');
        assert.equal(fresh.status, 'pending');
    });

    test('chuyển thừa: vẫn ghi nhận đã thanh toán và đánh dấu thừa tiền', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['7', 4]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: order.total + 5000, content: content(order) });
        assert.equal(ctx.db.payments.at(-1).result, 'overpaid');
        assert.equal(ctx.db.orders.find((item) => item.id === order.id).paymentStatus, 'paid');
    });

    test('tiền về sau khi đơn đã hủy: đánh dấu cần hoàn tiền', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['9', 2]], { paymentMethod: 'sepay' })).body;
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token, body: { status: 'cancelled', reasonId: 'change_mind' } });
        await webhook(ctx, { id: (tx += 1), transferAmount: order.total, content: content(order) });
        assert.equal(ctx.db.payments.at(-1).result, 'order_cancelled');
        assert.equal(ctx.db.orders.find((item) => item.id === order.id).paymentStatus, 'refund_pending');
    });
});

describe('Hết hạn thanh toán và hoàn tiền', () => {
    test('đơn chuyển khoản quá 30 phút chưa trả tiền: tự hủy, hoàn kho', async () => {
        const { token } = await newCustomer(ctx);
        const before = stockOf(ctx, 2);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['2', 2]], { paymentMethod: 'sepay' })).body;
        assert.equal(stockOf(ctx, 2), before - 2);
        ctx.db.orders.find((item) => item.id === order.id).payExpiresAt = Date.now() - 1000;
        const fresh = (await call(ctx, 'GET', `/orders/${order.id}`, { token })).body;
        assert.equal(fresh.status, 'cancelled');
        assert.equal(fresh.cancelReason, 'Quá hạn thanh toán');
        assert.equal(stockOf(ctx, 2), before);
    });

    test('đã chuyển một phần rồi đơn quá hạn: tự hủy và đánh dấu cần hoàn tiền', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['12', 2]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: 50000, content: content(order) });
        ctx.db.orders.find((item) => item.id === order.id).payExpiresAt = Date.now() - 1000;
        const fresh = (await call(ctx, 'GET', `/orders/${order.id}`, { token })).body;
        assert.deepEqual([fresh.status, fresh.paymentStatus], ['cancelled', 'refund_pending']);
    });

    test('admin ghi nhận đã nhận tiền (khách ghi sai nội dung) -> đơn trên 1 triệu tự xác nhận', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['4', 4]], { paymentMethod: 'sepay' })).body;
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${order.id}/payment`, { token, body: { paymentStatus: 'paid' } })).status,
            403,
            'khách không tự ghi nhận'
        );
        const paid = await call(ctx, 'PATCH', `/orders/${order.id}/payment`, { token: admin, body: { paymentStatus: 'paid' } });
        assert.equal(paid.status, 200);
        assert.deepEqual([paid.body.paymentStatus, paid.body.status], ['paid', 'pending']);
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${order.id}/payment`, { token: admin, body: { paymentStatus: 'paid' } })).status,
            409
        );
    });

    test('admin hủy đơn đã thanh toán -> cần hoàn tiền -> đã hoàn tiền', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['10', 2]], { paymentMethod: 'sepay' })).body;
        await webhook(ctx, { id: (tx += 1), transferAmount: order.total, content: content(order) });
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        const cancelled = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'cancelled' } });
        assert.equal(cancelled.body.paymentStatus, 'refund_pending');
        const refunded = await call(ctx, 'PATCH', `/orders/${order.id}/payment`, { token: admin, body: { paymentStatus: 'refunded' } });
        assert.equal(refunded.body.paymentStatus, 'refunded');
    });
});

describe('Hủy đơn theo luồng Shopee', () => {
    const cancel = (token, id, body) => call(ctx, 'PATCH', `/orders/${id}/status`, { token, body: { status: 'cancelled', ...body } });
    const newOrder = async (token, productId = '7') => (await placeOrder(ctx, token, await addAddress(ctx, token), [[productId, 1]])).body;

    test('chờ xác nhận: khách hủy ngay nhưng bắt buộc chọn lý do; "lý do khác" phải ghi rõ', async () => {
        const { token } = await newCustomer(ctx);
        const order = await newOrder(token);
        assert.equal((await cancel(token, order.id, {})).status, 400);
        assert.equal((await cancel(token, order.id, { reasonId: 'khong-co' })).status, 400);
        assert.equal((await cancel(token, order.id, { reasonId: 'other', note: 'a' })).status, 400);
        const done = await cancel(token, order.id, { reasonId: 'other', note: 'Đặt nhầm màu chậu' });
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(done.body.cancelReason, 'Đặt nhầm màu chậu');
        assert.equal(done.body.cancelledBy, 'customer');
    });

    test('đã xác nhận: khách không hủy trực tiếp mà gửi yêu cầu; cửa hàng đồng ý thì hủy và hoàn kho', async () => {
        const { token } = await newCustomer(ctx);
        const admin = await login(ctx, 'admin');
        const before = stockOf(ctx, 7);
        const order = await newOrder(token);
        assert.equal(
            (await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'change_mind' } })).status,
            409,
            'chưa xác nhận thì hủy trực tiếp'
        );
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        assert.equal((await cancel(token, order.id, { reasonId: 'change_mind' })).status, 403, 'đã xác nhận thì không hủy trực tiếp');
        assert.equal((await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: {} })).status, 400, 'thiếu lý do');
        const request = await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'change_address' } });
        assert.equal(request.status, 200, JSON.stringify(request.body));
        assert.equal(request.body.cancelRequest.status, 'pending');
        assert.equal(
            (await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'change_mind' } })).status,
            409,
            'chỉ gửi một lần'
        );
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'shipping' } })).status,
            409,
            'còn yêu cầu hủy thì chưa giao được'
        );
        assert.equal(
            (await call(ctx, 'PATCH', `/orders/${order.id}/cancel-request`, { token, body: { decision: 'approve' } })).status,
            403,
            'khách không tự duyệt'
        );

        const approved = await call(ctx, 'PATCH', `/orders/${order.id}/cancel-request`, { token: admin, body: { decision: 'approve' } });
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        assert.equal(approved.body.status, 'cancelled');
        assert.equal(approved.body.cancelRequest.status, 'approved');
        assert.equal(approved.body.cancelReason, 'Muốn thay đổi địa chỉ nhận hàng');
        assert.equal(stockOf(ctx, 7), before, 'hoàn kho');
    });

    test('cửa hàng từ chối yêu cầu hủy: đơn vẫn giao bình thường; đang giao thì không hủy được', async () => {
        const { token } = await newCustomer(ctx);
        const admin = await login(ctx, 'admin');
        const order = await newOrder(token);
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'found_cheaper' } });
        const rejected = await call(ctx, 'PATCH', `/orders/${order.id}/cancel-request`, {
            token: admin,
            body: { decision: 'reject', note: 'Hàng đã đóng gói' }
        });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.body.cancelRequest.status, 'rejected');
        assert.equal(rejected.body.status, 'confirmed');
        const shipping = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'shipping' } });
        assert.equal(shipping.status, 200, 'từ chối xong thì giao được');
        const late = await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'change_mind' } });
        assert.equal(late.status, 409, 'đã giao cho vận chuyển thì không hủy được');
    });

    test('cửa hàng không phản hồi quá 48 giờ: yêu cầu hủy tự được đồng ý', async () => {
        const { token } = await newCustomer(ctx);
        const admin = await login(ctx, 'admin');
        const before = stockOf(ctx, 7);
        const order = await newOrder(token);
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        await call(ctx, 'POST', `/orders/${order.id}/cancel-request`, { token, body: { reasonId: 'change_mind' } });
        ctx.db.orders.find((item) => item.id === order.id).cancelRequest.expiresAt = new Date(Date.now() - 1000).toISOString();
        const fresh = (await call(ctx, 'GET', `/orders/${order.id}`, { token })).body;
        assert.equal(fresh.status, 'cancelled');
        assert.equal(fresh.cancelRequest.status, 'approved');
        assert.equal(stockOf(ctx, 7), before);
    });

    test('thông tin cửa hàng và con số nghiệp vụ lấy từ server; admin sửa được, giá trị sai bị từ chối', async () => {
        const admin = await login(ctx, 'admin');
        const info = (await call(ctx, 'GET', '/shop')).body;
        assert.equal(info.rules.freeShippingFrom, 500000);
        assert.ok(info.rules.cancelReasons.change_mind);
        const customer = await newCustomer(ctx);
        assert.equal((await call(ctx, 'PUT', '/admin/shop', { token: customer.token, body: info.shop })).status, 403);
        assert.equal((await call(ctx, 'PUT', '/admin/shop', { token: admin, body: { ...info.shop, hotline: 'abc' } })).status, 400);
        assert.equal(
            (await call(ctx, 'PUT', '/admin/shop', { token: admin, body: { ...info.shop, facebook: 'khong-phai-link' } })).status,
            400
        );
        const saved = await call(ctx, 'PUT', '/admin/shop', {
            token: admin,
            body: { ...info.shop, hotline: '0988 111 222', name: 'Vườn Xanh' }
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal((await call(ctx, 'GET', '/shop')).body.shop.name, 'Vườn Xanh');
        await call(ctx, 'PUT', '/admin/shop', { token: admin, body: info.shop });
    });
});

describe('Gửi hóa đơn qua email', () => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 50));

    test('COD: đặt xong tự gửi hóa đơn về email tài khoản, email trong body bị bỏ qua', async () => {
        const { token, email } = await newCustomer(ctx);
        const fake = 'nguoi-khac@xanhgarden.test';
        const created = await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 1]], { email: fake });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        await wait();
        const mail = ctx.mails.find((item) => item.to === email && item.subject.includes(`Hóa đơn ${created.body.code}`));
        assert.ok(mail, 'tự gửi hóa đơn');
        assert.ok(mail.text.includes('khi nhận hàng'));
        assert.equal(
            ctx.mails.some((item) => item.to === fake),
            false
        );
    });

    test('chuyển khoản: chưa trả tiền thì chưa gửi, đổi sang COD thì gửi', async () => {
        const { token, email } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['9', 1]], { paymentMethod: 'sepay' })).body;
        await wait();
        const sent = () => ctx.mails.filter((item) => item.to === email && item.subject.includes(`Hóa đơn ${order.code}`));
        assert.equal(sent().length, 0);
        const changed = await call(ctx, 'PATCH', `/orders/${order.id}/payment-method`, { token, body: { paymentMethod: 'cod' } });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        await wait();
        assert.equal(sent().length, 1);
    });

    test('admin ghi nhận đã nhận tiền thì khách nhận hóa đơn', async () => {
        const { token, email } = await newCustomer(ctx);
        const admin = await login(ctx, 'admin');
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['10', 1]], { paymentMethod: 'sepay' })).body;
        const paid = await call(ctx, 'PATCH', `/orders/${order.id}/payment`, { token: admin, body: { paymentStatus: 'paid' } });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        await wait();
        const mail = ctx.mails.find((item) => item.to === email && item.subject.includes(`Hóa đơn ${order.code}`));
        assert.ok(mail?.text.includes('đã nhận đủ'));
    });

    test('chỉ chủ đơn hoặc nhân viên gửi được, nội dung đúng đơn, giới hạn 3 lần mỗi giờ, đơn hủy không có hóa đơn', async () => {
        const { token, email } = await newCustomer(ctx);
        const other = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['8', 2]])).body;
        const send = (who) => call(ctx, 'POST', `/orders/${order.id}/invoice-email`, { token: who });

        assert.equal((await call(ctx, 'POST', `/orders/${order.id}/invoice-email`)).status, 401);
        assert.equal((await send(other.token)).status, 403, 'khách khác không gửi được');
        const sent = await send(token);
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        assert.match(sent.body.sentTo, /\*\*\*@/);
        const mail = ctx.mails.filter((item) => item.to === email && item.subject.includes('Hóa đơn')).at(-1);
        assert.ok(mail, 'đã gửi thư hóa đơn');
        assert.ok(mail.subject.includes(order.code));
        assert.ok(mail.text.includes('TỔNG THANH TOÁN'));

        const admin = await login(ctx, 'admin');
        assert.equal((await send(admin)).status, 200, 'nhân viên gửi giúp khách');
        assert.equal((await send(token)).status, 200);
        assert.equal((await send(token)).status, 429, 'quá 3 lần trong 1 giờ');

        const second = (await placeOrder(ctx, token, await addAddress(ctx, token), [['9', 1]])).body;
        await call(ctx, 'PATCH', `/orders/${second.id}/status`, { token, body: { status: 'cancelled', reasonId: 'change_mind' } });
        assert.equal((await call(ctx, 'POST', `/orders/${second.id}/invoice-email`, { token })).status, 409);
    });
});
