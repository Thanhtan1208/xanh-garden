import { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS, SHIPPING_METHODS, escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { productImage } from '../utils/images.js';

const STATUS_FLOW = ['pending', 'confirmed', 'shipping', 'delivered'];

// Quy tắc chuyển trạng thái phía giao diện (server mới là nơi quyết định cuối cùng).
export const NEXT_STATUS_LABEL = {
    pending: 'Xác nhận đơn',
    confirmed: 'Bắt đầu giao',
    shipping: 'Xác nhận đã giao'
};
export function nextStatus(order) {
    const index = STATUS_FLOW.indexOf(order.status);
    return index < 0 ? null : STATUS_FLOW[index + 1] ?? null;
}
// Đang giao vẫn hủy được: dùng khi giao không thành công (khách không nhận hàng), hàng hoàn về kho
export const canAdminCancel = (order) => ['unconfirmed', 'pending', 'confirmed', 'shipping'].includes(order.status);
// Giống Shopee: chưa được cửa hàng xác nhận thì khách hủy ngay; đã xác nhận (chưa giao vận chuyển) thì gửi yêu cầu hủy; đã giao vận chuyển thì không hủy được
export const canUserCancel = (order) => ['unconfirmed', 'pending'].includes(order.status);
export const canRequestCancel = (order) => order.status === 'confirmed' && !order.cancelRequest;
export const hasPendingCancelRequest = (order) => order.status === 'confirmed' && order.cancelRequest?.status === 'pending';
export const needsAttention = (order) => order.status === 'unconfirmed' ||
    (order.status === 'pending' && order.paymentMethod === 'sepay' && order.paymentStatus === 'unpaid');

export const statusBadge = (status) => `<span class="status status-${status}">${ORDER_STATUS[status] || status}</span>`;

export const paymentBadge = (order) =>
    `<span class="status pay-${order.paymentStatus}">${PAYMENT_STATUS[order.paymentStatus] || ''}</span>`;

export function cancelRequestNote(order) {
    const request = order.cancelRequest;
    if (!request || order.status === 'cancelled') return '';
    if (request.status === 'pending') return `<p class="timeline-pending">Yêu cầu hủy đơn đã gửi (${escapeHtml(request.reason)}). Đang chờ cửa hàng phản hồi, quá hạn không phản hồi đơn sẽ tự được hủy.</p>`;
    if (request.status === 'rejected') return `<p class="timeline-pending">Cửa hàng đã từ chối yêu cầu hủy${request.note ? `: ${escapeHtml(request.note)}` : ''}. Đơn sẽ được giao như bình thường.</p>`;
    return '';
}

export function renderTimeline(order) {
    if (order.status === 'unconfirmed') return '<p class="timeline-pending">Đơn trên 1 triệu: chuyển khoản xong là đơn được xác nhận tự động.</p>';
    if (order.status === 'cancelled') return `<p class="timeline-cancelled">Đơn hàng ${order.cancelledBy === 'customer' ? 'đã được hủy theo yêu cầu của khách' : 'đã bị hủy'}${order.cancelReason ? `: ${escapeHtml(order.cancelReason)}` : ''}.</p>`;

    const current = STATUS_FLOW.indexOf(order.status);
    return `<ol class="timeline">${STATUS_FLOW.map((status, index) => `
        <li class="${index <= current ? 'done' : ''}"><i>${index < current ? '✓' : index + 1}</i><span>${ORDER_STATUS[status]}</span></li>`).join('')}</ol>${cancelRequestNote(order)}`;
}

export function renderOrderItems(order) {
    return order.items.map((item) => `
        <div class="line-item">
            <img src="${productImage(item.image)}" alt="${escapeHtml(item.name)}">
            <div>
                <a href="./product-detail.html?id=${item.id}"><b>${escapeHtml(item.name)}</b></a>
                <small>${formatPrice(item.price)} × ${item.qty}</small>
            </div>
            <span>${formatPrice(item.price * item.qty)}</span>
        </div>`).join('');
}

// Tên mã voucher đã dùng cho đơn (đơn cũ chưa có voucher thì không có gì).
const voucherCodes = (order, kind) => {
    const codes = (order.vouchers || []).filter((voucher) => voucher.kind === kind).map((voucher) => escapeHtml(voucher.code));
    return codes.length ? ` (${codes.join(', ')})` : '';
};

export function renderOrderDetails(order) {
    const customer = order.customer;
    return `
        <div class="order-detail-grid">
            <div>
                <h4>Thông tin nhận hàng</h4>
                <p><b>${escapeHtml(customer.fullName)}</b> · ${escapeHtml(customer.phone)}</p>
                <p>${escapeHtml(customer.email)}</p>
                <p>${escapeHtml(customer.address)}</p>
                ${customer.note ? `<p class="muted">Ghi chú: ${escapeHtml(customer.note)}</p>` : ''}
            </div>
            <div>
                <h4>Thanh toán và vận chuyển</h4>
                <p>${PAYMENT_METHODS[order.paymentMethod]} · ${paymentBadge(order)}</p>
                <p>${SHIPPING_METHODS[order.shippingMethod]}</p>
                <p class="muted">Đặt lúc ${formatDate(order.createdAt)}</p>
            </div>
        </div>
        <div class="line-items">${renderOrderItems(order)}</div>
        <div class="summary-line"><span>Tạm tính</span><b>${formatPrice(order.subtotal)}</b></div>
        ${order.discount ? `<div class="summary-line discount"><span>Giảm giá${voucherCodes(order, 'order')}</span><b>− ${formatPrice(order.discount)}</b></div>` : ''}
        <div class="summary-line"><span>Phí vận chuyển</span><b>${order.shippingFee ? formatPrice(order.shippingFee) : 'Miễn phí'}</b></div>
        ${order.shippingDiscount ? `<div class="summary-line discount"><span>Giảm phí vận chuyển${voucherCodes(order, 'shipping')}</span><b>− ${formatPrice(order.shippingDiscount)}</b></div>` : ''}
        <div class="summary-total"><span>Tổng thanh toán</span><b>${formatPrice(order.total)}</b></div>`;
}
