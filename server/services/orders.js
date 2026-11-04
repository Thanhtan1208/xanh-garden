import { byId, db, save } from '../core/store.js';
import { logStock } from './inventory.js';
import { releaseVouchers } from './vouchers.js';

// Bản trả về client: không lộ dữ liệu nội bộ (bản băm mã xác nhận email của đơn cũ).
export function publicOrder(order) {
    const { emailConfirm, ...rest } = order;
    return rest;
}

export function setStatus(order, status, by, note) {
    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;
    order.history.push({ status, at: now, by, ...(note ? { note } : {}) });
}

/**
 * Ghi nhận đơn đã thanh toán (webhook SePay báo tiền về, hoặc admin ghi nhận tay).
 * Đơn trên 1 triệu đang "chờ thanh toán" (unconfirmed) được XÁC NHẬN TỰ ĐỘNG: chuyển sang "chờ cửa hàng xác nhận" (pending).
 * Trả về true nếu đơn vừa được xác nhận tự động.
 */
export function markPaid(order, { by, note }) {
    const now = new Date().toISOString();
    order.paymentStatus = 'paid';
    order.paidAt = now;
    delete order.payExpiresAt;
    order.updatedAt = now;
    order.history.push({ status: order.status, at: now, by, note });
    if (order.status !== 'unconfirmed') return false;
    setStatus(order, 'pending', by, 'Đơn được xác nhận tự động vì đã nhận đủ tiền');
    return true;
}

// Hủy đơn: hoàn kho và trả voucher về ví đúng một lần (đơn đã hủy thì không làm lại),
// đánh dấu cần hoàn tiền nếu đã thanh toán, hoặc đã nhận một phần tiền (khách chuyển thiếu rồi đơn bị hủy).
export function cancelOrder(order, by) {
    if (order.status === 'cancelled') return;
    order.items.forEach((item) => {
        const product = byId('products', item.id);
        if (!product) return;
        product.stock += item.qty;
        logStock(product, 'cancel_return', item.qty, { note: `Hủy đơn ${order.code}`, by });
    });
    releaseVouchers(order);
    const partlyPaid = db.payments.some((payment) => payment.orderCode === order.code && payment.result === 'underpaid' && !payment.handled);
    if (order.paymentStatus === 'paid' || (order.paymentStatus === 'unpaid' && partlyPaid)) order.paymentStatus = 'refund_pending';
    setStatus(order, 'cancelled', by);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Hủy đơn theo yêu cầu của khách (đã được đồng ý, hoặc cửa hàng không phản hồi quá hạn): ghi lý do và đóng yêu cầu.
export function approveCancelRequest(order, by) {
    const request = order.cancelRequest;
    cancelOrder(order, by);
    order.cancelReason = request?.reason || order.cancelReason;
    order.cancelledBy = 'customer';
    if (request) { request.status = 'approved'; request.decidedAt = new Date().toISOString(); request.decidedBy = by; }
}

// Tự hủy đơn chuyển khoản quá hạn thanh toán (kể cả đơn trên 1 triệu đang chờ thanh toán để xác nhận) để trả hàng về kho,
// và dọn tài khoản đăng ký dở quá 24 giờ chưa xác minh email.
export function sweepExpired() {
    const now = Date.now();
    let changed = false;

    db.orders.forEach((order) => {
        const waitingPayment = order.paymentStatus === 'unpaid' &&
            (order.status === 'unconfirmed' || (order.status === 'pending' && order.paymentMethod === 'sepay'));
        // confirmExpiresAt: hạn của đơn cũ tạo từ thời còn xác nhận bằng mã email.
        const deadline = order.payExpiresAt || (order.status === 'unconfirmed' ? order.confirmExpiresAt : null);
        if (waitingPayment && deadline && now > deadline) {
            cancelOrder(order, 'system');
            order.cancelReason = 'Quá hạn thanh toán';
            changed = true;
        }
    });

    // Khách gửi yêu cầu hủy mà cửa hàng không phản hồi quá hạn: tự đồng ý (giống Shopee), đơn chưa giao cho vận chuyển.
    db.orders.forEach((order) => {
        const request = order.cancelRequest;
        if (request?.status === 'pending' && order.status === 'confirmed' && now > Date.parse(request.expiresAt)) {
            approveCancelRequest(order, 'Hệ thống (cửa hàng không phản hồi đúng hạn)');
            changed = true;
        }
    });

    const before = db.user.length;
    db.user = db.user.filter((user) => !(user.verified === false && now - Date.parse(user.createdAt || 0) > DAY_MS));
    if (db.user.length !== before) changed = true;

    if (changed) save();
}
