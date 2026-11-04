import { RULES } from '../config/shop.js';

// Phí ship và các ngưỡng lấy từ server (config/shop.js), không viết cứng ở giao diện

export const ORDER_STATUS = {
    unconfirmed: 'Chờ thanh toán',
    pending: 'Chờ xác nhận',
    confirmed: 'Đã xác nhận',
    shipping: 'Đang giao',
    delivered: 'Đã giao',
    cancelled: 'Đã hủy'
};

export const PAYMENT_METHODS = {
    cod: 'Thanh toán khi nhận hàng (COD)',
    sepay: 'Chuyển khoản QR (SePay)'
};

export const PAYMENT_STATUS = {
    unpaid: 'Chưa thanh toán',
    paid: 'Đã thanh toán',
    refund_pending: 'Cần hoàn tiền',
    refunded: 'Đã hoàn tiền'
};

export const SHIPPING_METHODS = {
    standard: 'Giao tiêu chuẩn',
    express: 'Giao nhanh'
};

export function formatPrice(price) {
    return Number(price).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });
}

export function formatDate(isoString) {
    const date = new Date(isoString);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

export function shippingFee(method, subtotal) {
    return method === 'standard' && subtotal >= RULES.freeShippingFrom ? 0 : RULES.shippingFees[method];
}
