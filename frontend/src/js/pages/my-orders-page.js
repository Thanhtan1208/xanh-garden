import { api } from '../services/api-service.js';
import { addToCart, selectOnly } from '../services/cart-service.js';
import {
    canRequestCancel,
    canUserCancel,
    needsAttention,
    renderOrderDetails,
    renderTimeline,
    statusBadge
} from '../components/order-view.js';
import { RULES } from '../config/shop.js';
import { xuatHoaDon } from '../components/invoice.js';
import { updateCartBadge } from '../components/header.js';
import { requireCustomer } from '../utils/auth.js';
import { ORDER_STATUS, escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { choiceDialog, confirmDialog, toast } from '../components/notify.js';

const tabs = document.querySelector('#statusTabs');
const orderList = document.querySelector('#orderList');
const actionMessage = document.querySelector('#actionMessage');

let orders = [];
let loaded = false;
let filterStatus = '';
let keyword = '';
const expanded = new Set();

// Tab "Chờ thanh toán" gồm cả đơn chuyển khoản chưa trả tiền (giống Shopee), các tab khác theo trạng thái
const TAB_MATCH = {
    unconfirmed: needsAttention,
    pending: (order) => order.status === 'pending' && !needsAttention(order)
};
const inTab = (order, status) => !status || (TAB_MATCH[status] ? TAB_MATCH[status](order) : order.status === status);

// Chưa có dữ liệu thì vẽ tab không kèm số đếm, để thanh tab có sẵn chỗ ngay từ đầu
function renderTabs() {
    const entries = [['', 'Tất cả'], ...Object.entries(ORDER_STATUS)];
    tabs.innerHTML = entries
        .map(([status, label]) => {
            const count = orders.filter((order) => inTab(order, status)).length;
            return `<button class="tab${status === filterStatus ? ' active' : ''}" data-status="${status}">${label}${loaded ? ` (${count})` : ''}</button>`;
        })
        .join('');
}

// Nút đánh giá: 1 sản phẩm thì mở thẳng tab đánh giá, nhiều sản phẩm thì mở chi tiết để chọn từng món
function reviewButton(order) {
    if (order.status !== 'delivered') return '';
    return order.items.length === 1
        ? `<a class="btn btn-accent" href="./product-detail.html?id=${order.items[0].id}#reviews">${icon('star', { size: 16 })} Đánh giá</a>`
        : `<button type="button" class="btn btn-accent" data-action="review">${icon('star', { size: 16 })} Đánh giá (${order.items.length} sản phẩm)</button>`;
}

function orderCard(order) {
    return `
        <article class="order-card" data-id="${order.id}">
            <div class="order-card-head">
                <div><b>${escapeHtml(order.code)}</b><small class="muted">${formatDate(order.createdAt)}</small></div>
                ${statusBadge(needsAttention(order) ? 'unconfirmed' : order.status)}
            </div>
            ${renderTimeline(order)}
            <div class="order-preview">
                ${order.items
                    .slice(0, 4)
                    .map(
                        (item) =>
                            `<img src="${productImage(item.image)}" alt="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}" width="52" height="52">`
                    )
                    .join('')}
                <span class="muted">${order.items.reduce((total, item) => total + item.qty, 0)} sản phẩm</span>
                <b class="order-total">${formatPrice(order.total)}</b>
            </div>
            ${expanded.has(order.id) ? `<div class="order-body">${renderOrderDetails(order, { review: true })}</div>` : ''}
            ${order.status === 'shipping' && order.autoReceiveAt ? `<p class="order-hint">Nhận được hàng rồi thì bấm "Đã nhận được hàng". Nếu bạn không bấm, hệ thống tự xác nhận vào ${formatDate(order.autoReceiveAt)}.</p>` : ''}
            <div class="order-actions">
                <button type="button" class="btn btn-sm btn-outline" data-action="toggle" aria-expanded="${expanded.has(order.id)}">${icon(expanded.has(order.id) ? 'chevronUp' : 'chevronDown', { size: 14 })} ${expanded.has(order.id) ? 'Thu gọn' : 'Xem chi tiết'}</button>
                ${order.status !== 'cancelled' ? `<button type="button" class="btn btn-sm btn-outline" data-action="invoice">${icon('download', { size: 14 })} Xuất hóa đơn</button>` : ''}
                <a class="btn btn-sm btn-outline" href="./feedback.html?order=${encodeURIComponent(order.code)}">Phản ánh</a>
                <span class="order-main-actions">
                    ${canUserCancel(order) ? `<button type="button" class="btn btn-danger" data-action="cancel">${icon('close', { size: 16 })} Hủy đơn</button>` : ''}
                    ${canRequestCancel(order) ? `<button type="button" class="btn btn-danger" data-action="cancel-request">${icon('close', { size: 16 })} Yêu cầu hủy đơn</button>` : ''}
                    ${['delivered', 'cancelled'].includes(order.status) ? `<button type="button" class="btn btn-outline" data-action="reorder">${icon('refresh', { size: 16 })} Mua lại</button>` : ''}
                    ${needsAttention(order) ? `<a class="btn btn-accent" href="./order-success.html?code=${encodeURIComponent(order.code)}">Thanh toán ngay</a>` : ''}
                    ${order.status === 'shipping' ? `<button type="button" class="btn btn-accent" data-action="received">${icon('check', { size: 16 })} Đã nhận được hàng</button>` : ''}
                    ${reviewButton(order)}
                </span>
            </div>
        </article>`;
}

// Dựng thẻ của mọi đơn một lần; đổi tab/tìm kiếm chỉ ẩn hiện thẻ nên trang không bị giật
function renderOrders() {
    if (!orders.length) {
        orderList.innerHTML = `
            <div class="empty-state">
                <h2>Bạn chưa có đơn hàng nào</h2>
                <a class="btn" href="./products.html">Mua sắm ngay</a>
            </div>`;
        return;
    }
    orderList.innerHTML =
        orders.map(orderCard).join('') +
        `
        <div class="empty-state hidden" id="noMatch">
            <h2>Không có đơn hàng phù hợp</h2>
            <a class="btn" href="./products.html">Mua sắm ngay</a>
        </div>`;
    applyFilter();
}

function applyFilter() {
    let shown = 0;
    orderList.querySelectorAll('.order-card').forEach((card) => {
        const order = orders.find((entry) => entry.id === card.dataset.id);
        const match =
            inTab(order, filterStatus) &&
            (!keyword ||
                order.code.toLowerCase().includes(keyword) ||
                order.items.some((item) => item.name.toLowerCase().includes(keyword)));
        card.hidden = !match;
        if (match) shown++;
    });
    orderList.querySelector('#noMatch')?.classList.toggle('hidden', shown > 0);
}

// Chỉ vẽ lại thẻ của đơn vừa thay đổi
function updateCard(order) {
    const card = orderList.querySelector(`.order-card[data-id="${order.id}"]`);
    if (card) card.outerHTML = orderCard(order);
    applyFilter();
}

tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (!button) return;
    filterStatus = button.dataset.status;
    tabs.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    applyFilter();
    // Đang cuộn xuống mà danh sách ngắn lại: đưa thanh tab về ngay dưới header để màn hình không bị giật
    const headerBottom = document.querySelector('#siteHeader').getBoundingClientRect().bottom;
    const tabsTop = tabs.getBoundingClientRect().top;
    if (tabsTop < headerBottom) window.scrollBy({ top: tabsTop - headerBottom - 8, behavior: 'instant' });
});

document.querySelector('#orderSearch').addEventListener('input', (event) => {
    keyword = event.target.value.trim().toLowerCase();
    applyFilter();
});

orderList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    const order = button && orders.find((entry) => entry.id === button.closest('.order-card').dataset.id);
    if (!order) return;

    if (button.dataset.action === 'toggle') {
        if (!expanded.delete(order.id)) expanded.add(order.id);
        updateCard(order);
    } else if (button.dataset.action === 'review') {
        // mở chi tiết đơn, mỗi sản phẩm có nút "Đánh giá" riêng
        expanded.add(order.id);
        updateCard(order);
        orderList.querySelector(`.order-card[data-id="${order.id}"] .line-review`)?.focus();
    } else if (button.dataset.action === 'received') {
        // Khách xác nhận đã nhận hàng (giống Shopee): đơn chuyển sang "Đã giao"
        const agreed = await confirmDialog({
            title: `Đã nhận được đơn ${order.code}?`,
            message: 'Chỉ bấm khi bạn đã nhận và kiểm tra hàng. Sau khi xác nhận, đơn chuyển sang "Đã giao".',
            confirmText: 'Đã nhận được hàng',
            cancelText: 'Chưa nhận'
        });
        if (!agreed) return;
        button.disabled = true;
        try {
            Object.assign(order, await api.patch(`/orders/${order.id}/status`, { status: 'delivered' }));
            toast(`Cảm ơn bạn! Đơn ${order.code} đã hoàn thành, hãy đánh giá sản phẩm nhé.`, { type: 'success' });
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
        renderTabs();
        updateCard(order);
    } else if (button.dataset.action === 'invoice') {
        // xuất hóa đơn PDF của đơn này, thông báo hiện ở #actionMessage
        xuatHoaDon(order, button, actionMessage);
    } else if (button.dataset.action === 'reorder') {
        // Mua lại: thêm vào giỏ và chỉ chọn các món của đơn này
        order.items.forEach((item) => addToCart(item.id, item.qty));
        selectOnly(...order.items.map((item) => item.id));
        updateCartBadge();
        window.location.assign('./cart.html');
    } else if (button.dataset.action === 'cancel' || button.dataset.action === 'cancel-request') {
        // Chưa được xác nhận: hủy ngay. Đã xác nhận: gửi yêu cầu để cửa hàng đồng ý (giống Shopee). Cả hai đều phải chọn lý do.
        const request = button.dataset.action === 'cancel-request';
        const choice = await choiceDialog({
            title: request ? `Yêu cầu hủy đơn ${order.code}?` : `Hủy đơn ${order.code}?`,
            message: request
                ? `Cửa hàng đã xác nhận đơn nên cần đồng ý yêu cầu của bạn (tự đồng ý sau ${RULES.cancelRequestHours} giờ nếu không phản hồi). Hãy chọn lý do:`
                : `Hàng sẽ được trả về kho.${order.paymentStatus === 'paid' ? ' Đơn đã thanh toán nên cửa hàng sẽ hoàn tiền cho bạn.' : ''} Hãy chọn lý do hủy:`,
            choices: RULES.cancelReasons,
            noteLabel: 'Ghi rõ lý do của bạn',
            confirmText: request ? 'Gửi yêu cầu hủy' : 'Hủy đơn',
            cancelText: 'Giữ đơn',
            tone: 'danger'
        });
        if (!choice) return;
        button.disabled = true;
        try {
            Object.assign(
                order,
                request
                    ? await api.post(`/orders/${order.id}/cancel-request`, choice)
                    : await api.patch(`/orders/${order.id}/status`, { status: 'cancelled', ...choice })
            );
            toast(request ? `Đã gửi yêu cầu hủy đơn ${order.code}, vui lòng chờ cửa hàng phản hồi.` : `Đã hủy đơn ${order.code}.`, {
                type: 'success'
            });
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
        renderTabs();
        updateCard(order);
    }
});

async function initialize() {
    if (!requireCustomer()) return;
    renderTabs();
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load('/orders', (data) => {
            orders = data;
            loaded = true;
            renderTabs();
            renderOrders();
            document.querySelector('#loading').classList.add('hidden');
        });
    } catch (error) {
        document.querySelector('#error').textContent = error.message;
        document.querySelector('#error').classList.remove('hidden');
    } finally {
        document.querySelector('#loading').classList.add('hidden');
    }
}

initialize();
