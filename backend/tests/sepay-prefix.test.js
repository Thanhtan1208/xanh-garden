// Ngân hàng bắt buộc tiền tố trong nội dung chuyển khoản (VD VietinBank qua SePay: SEVQR)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, call, newCustomer, placeOrder, startServer, webhook } from './helpers.js';

let ctx;
before(async () => {
    ctx = await startServer({ env: { SEPAY_CONTENT_PREFIX: 'SEVQR' } });
});
after(() => ctx.stop());

describe('Tiền tố nội dung chuyển khoản', () => {
    test('QR ghi "SEVQR <mã đơn>", tiền về với nội dung đó thì đơn được ghi nhận đã thanh toán', async () => {
        const { token } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const made = await placeOrder(ctx, token, addressId, [['1', 1]], { paymentMethod: 'sepay' });
        assert.equal(made.status, 201, JSON.stringify(made.body));
        const code = made.body.code.replace(/[^A-Z0-9]/g, '');

        const info = await call(ctx, 'GET', `/orders/${made.body.id}/payment-info`, { token });
        assert.equal(info.body.content, `SEVQR ${code}`);
        assert.match(info.body.qrUrl, new RegExp(`des=SEVQR%20${code}`));

        // ngân hàng thường thêm mã giao dịch phía trước, bỏ dấu cách
        await webhook(ctx, {
            id: 9001,
            transferType: 'in',
            transferAmount: made.body.total,
            content: `CT DEN:123 SEVQR${code} thanh toan`
        });
        const order = await call(ctx, 'GET', `/orders/${made.body.id}`, { token });
        assert.equal(order.body.paymentStatus, 'paid');
    });
});
