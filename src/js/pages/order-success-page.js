import { api } from '../services/api-service.js';
import '../components/header.js';
import { requireCustomer } from '../utils/auth.js';
import { escapeHtml, formatPrice } from '../utils/format.js';
import { RULES } from '../config/shop.js';
import { confirmDialog, toast } from '../components/notify.js';
import { icon } from '../utils/icons.js';
import { trackOrderOnce } from '../services/tracker.js';

const container = document.querySelector('#orderSuccess');
const code = new URLSearchParams(window.location.search).get('code');
const POLL_MS = 4000;

let pollTimer = null;
let cooldownTimer = null;

const links = `
    <div class="button-row">
        <a class="btn" href="./my-orders.html">Xem đơn hàng của tôi</a>
        <a class="btn btn-outline" href="./products.html">Tiếp tục mua sắm</a>
    </div>`;

const card = (inner) => { container.innerHTML = `<div class="success-card">${inner}</div>`; };

// Đổi COD <-> chuyển khoản QR khi đơn chưa thanh toán và cửa hàng chưa xác nhận (server kiểm tra lại).
async function switchPayment(order, paymentMethod) {
    const label = paymentMethod === 'cod' ? 'thanh toán khi nhận hàng (COD)' : 'chuyển khoản QR';
    if (!await confirmDialog({ title: 'Đổi phương thức thanh toán?', message: `Đơn ${order.code} sẽ chuyển sang ${label}.`, confirmText: 'Đổi phương thức', cancelText: 'Giữ nguyên' })) return;
    try {
        render(await api.patch(`/orders/${order.id}/payment-method`, { paymentMethod }));
        toast(`Đã chuyển sang ${label}.`, { type: 'success' });
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

async function renderPayment(order) {
    const info = await api.get(`/orders/${order.id}/payment-info`);
    card(`
        <p class="eyebrow">Chờ thanh toán</p>
        <h1>Quét mã để thanh toán</h1>
        ${order.status === 'unconfirmed' ? `<p class="notice">Đơn trên ${formatPrice(RULES.highValueFrom)} được <b>xác nhận tự động</b> ngay khi hệ thống nhận đủ tiền. Không cần nhập mã nào.</p>` : ''}
        <img class="qr" src="${escapeHtml(info.qrUrl)}" alt="Mã QR thanh toán đơn ${escapeHtml(order.code)}">
        <dl class="pay-info">
            <div><dt>Ngân hàng</dt><dd>${escapeHtml(info.bank)}</dd></div>
            <div><dt>Số tài khoản</dt><dd>${escapeHtml(info.account)}</dd></div>
            <div><dt>Chủ tài khoản</dt><dd>${escapeHtml(info.accountName)}</dd></div>
            <div><dt>Số tiền</dt><dd><b>${formatPrice(info.amount)}</b></dd></div>
            <div><dt>Nội dung chuyển khoản</dt><dd><b>${escapeHtml(info.content)}</b></dd></div>
        </dl>
        <p class="muted">Giữ nguyên nội dung và số tiền. Hệ thống tự ghi nhận khi SePay báo tiền về.</p>
        <p id="countdown" class="msg"></p>
        ${order.total <= RULES.maxCodTotal && order.subtotal <= RULES.highValueFrom ? '<p><button type="button" id="toCodBtn" class="link-button">Đổi sang thanh toán khi nhận hàng (COD)</button></p>' : ''}
        ${links}`);
    document.querySelector('#toCodBtn')?.addEventListener('click', () => switchPayment(order, 'cod'));

    const tick = () => {
        const left = Math.max(0, Math.round((info.expiresAt - Date.now()) / 1000));
        document.querySelector('#countdown').textContent = `Còn ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} để thanh toán`;
    };
    if (info.expiresAt) {
        tick();
        cooldownTimer = setInterval(tick, 1000);
    }
    pollTimer = setInterval(async () => {
        try {
            const fresh = await api.get(`/orders/${order.id}`);
            // Tiền về (webhook SePay đã ghi nhận) hoặc đơn bị hủy/đổi trạng thái: hiển thị lại.
            if (fresh.paymentStatus !== order.paymentStatus || fresh.status !== order.status || fresh.paymentMethod !== order.paymentMethod) render(fresh);
        } catch { /* mạng chập chờn: thử lại ở lần sau */ }
    }, POLL_MS);
}

function render(order) {
    clearInterval(pollTimer);
    clearInterval(cooldownTimer);

    if (order.status !== 'cancelled') trackOrderOnce(order.code);
    if (order.status === 'cancelled') {
        return card(`
            <p class="eyebrow danger-text">Đơn đã hủy</p>
            <h1>Đơn ${escapeHtml(order.code)} đã bị hủy</h1>
            <p>${escapeHtml(order.cancelReason || 'Hàng đã được trả về kho.')}</p>
            ${order.paymentStatus === 'refund_pending' ? '<p>Khoản tiền đã thanh toán sẽ được hoàn lại cho bạn.</p>' : ''}
            ${links}`);
    }
    if (order.paymentMethod === 'sepay' && order.paymentStatus === 'unpaid') return renderPayment(order).catch((error) => card(`<p class="error-message">${escapeHtml(error.message)}</p>${links}`));

    const canSwitchToQr = order.paymentMethod === 'cod' && order.status === 'pending' && order.paymentStatus === 'unpaid';
    card(`
        <span class="success-icon">${icon('check', { size: 34 })}</span>
        <p class="eyebrow">${order.paymentStatus === 'paid' ? 'Đã nhận thanh toán' : 'Đặt hàng thành công'}</p>
        <h1>${order.paymentStatus === 'paid' ? 'Đơn hàng đã được xác nhận' : 'Cảm ơn bạn đã đặt hàng'}</h1>
        <p>Mã đơn hàng: <b>${escapeHtml(order.code)}</b></p>
        <p>Tổng thanh toán: <b>${formatPrice(order.total)}</b> · ${order.paymentStatus === 'paid' ? 'đã thanh toán' : 'thanh toán khi nhận hàng'}</p>
        <p>${order.paymentStatus === 'paid'
            ? `Thông tin đơn đã được gửi tới <b>${escapeHtml(order.customer.email)}</b>. Cửa hàng sẽ sớm chuẩn bị và giao hàng.`
            : `Chúng tôi sẽ liên hệ số <b>${escapeHtml(order.customer.phone)}</b> để xác nhận đơn.`}</p>
        ${canSwitchToQr ? '<p><button type="button" id="toQrBtn" class="link-button">Muốn chuyển khoản trước? Đổi sang thanh toán QR</button></p>' : ''}
        ${links}`);
    document.querySelector('#toQrBtn')?.addEventListener('click', () => switchPayment(order, 'sepay'));
}

async function load() {
    try {
        if (!code) throw new Error('Thiếu mã đơn hàng.');
        render(await api.get(`/orders/${encodeURIComponent(code)}`));
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <h1>Không tìm thấy đơn hàng</h1>
                <p>${escapeHtml(error.message)}</p>
                <a class="btn" href="./index.html">Về trang chủ</a>
            </div>`;
    }
}

if (requireCustomer()) load();
