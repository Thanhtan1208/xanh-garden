import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { db, newId, save } from '../core/store.js';
import { ApiError, handle } from '../core/http.js';
import { SEPAY, normalizeText, transferContent } from '../services/sepay.js';
import { markPaid } from '../services/orders.js';
import { sendPaidMail } from '../services/order-mail.js';

const router = Router();

function authorized(header = '') {
    const expected = Buffer.from(`Apikey ${SEPAY.apiKey}`);
    const actual = Buffer.from(String(header));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Webhook SePay: https://docs.sepay.vn/tich-hop-webhooks.html
// Ngân hàng báo có tiền vào tài khoản -> SePay gọi POST /api/payments/sepay/webhook (header "Authorization: Apikey ...").
// Server tìm đơn theo nội dung chuyển khoản (mã đơn bỏ dấu gạch), kiểm tra số tiền rồi ghi nhận thanh toán.
// Đơn trên 1 triệu đang "chờ thanh toán" sẽ được XÁC NHẬN TỰ ĐỘNG tại đây (thay cho bước nhập mã email trước đây).
// Luôn trả { success: true } khi đã ghi nhận giao dịch (kể cả giao dịch không khớp đơn) để SePay không gửi lại.
router.post('/sepay/webhook', handle((req, res) => {
    if (!authorized(req.headers.authorization)) throw new ApiError(401, 'Sai API key.');

    const body = req.body || {};
    if (body.transferType !== 'in') return res.json({ success: true });

    const txId = String(body.id ?? '');
    if (!txId) throw new ApiError(400, 'Thiếu mã giao dịch.');
    if (db.payments.some((payment) => payment.txId === txId)) return res.json({ success: true, duplicate: true });

    const amount = Number(body.transferAmount);
    const haystack = normalizeText(`${body.code ?? ''} ${body.content ?? ''}`);
    const order = db.orders.find((item) => item.paymentMethod === 'sepay' && haystack.includes(transferContent(item)));

    let mail = null;
    const payment = {
        id: newId(), txId, amount: Number.isFinite(amount) ? amount : 0, content: String(body.content ?? '').slice(0, 300),
        orderCode: order?.code || null, receivedAt: new Date().toISOString(), result: 'paid'
    };
    // Các lần chuyển thiếu trước đó của cùng đơn (khách chuyển bù lần sau thì cộng dồn).
    const partials = order ? db.payments.filter((item) => item.orderCode === order.code && item.result === 'underpaid' && !item.handled) : [];
    const received = partials.reduce((sum, item) => sum + item.amount, payment.amount);

    if (!order) payment.result = 'no_order';
    else if (order.paymentStatus === 'paid' || order.paymentStatus === 'refund_pending') payment.result = 'duplicate_payment';
    else if (order.status === 'cancelled') {
        order.paymentStatus = 'refund_pending'; // khách chuyển tiền sau khi đơn đã bị hủy: cần hoàn lại
        payment.result = 'order_cancelled';
    } else if (received < order.total) {
        payment.result = 'underpaid';
    } else {
        const note = partials.length
            ? `Nhận đủ ${received.toLocaleString('vi-VN')} ₫ qua ${partials.length + 1} lần chuyển khoản`
            : `Nhận ${payment.amount.toLocaleString('vi-VN')} ₫ qua webhook`;
        const autoConfirmed = markPaid(order, { by: 'SePay', note });
        if (received > order.total) payment.result = 'overpaid';
        payment.autoConfirmed = autoConfirmed;
        // Các lần chuyển thiếu đã được cộng đủ: không còn là giao dịch bất thường.
        partials.forEach((item) => { item.handled = true; item.handledAt = payment.receivedAt; item.settledBy = txId; });
        mail = () => sendPaidMail(order, { autoConfirmed });
    }

    db.payments.push(payment);
    save();
    mail?.(); // gửi email sau khi đã lưu, không chặn phản hồi cho SePay
    res.json({ success: true });
}));

export default router;
