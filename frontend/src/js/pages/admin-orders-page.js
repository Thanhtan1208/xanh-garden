import { api } from '../services/api-service.js';
import '../components/table-view.js';
import {
    NEXT_STATUS_LABEL,
    canAdminCancel,
    hasPendingCancelRequest,
    nextStatus,
    paymentBadge,
    renderOrderDetails,
    renderTimeline,
    statusBadge
} from '../components/order-view.js';
import { xuatHoaDon } from '../components/invoice.js';
import '../components/header.js';
import { requirePermission } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { getCurrentUser } from '../utils/auth.js';
import { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS, escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { choiceDialog, confirmDialog, toast } from '../components/notify.js';
import { heroCard } from '../components/bank-ui.js';
import { icon, iconButton } from '../utils/icons.js';
import { downloadWorkbook } from '../services/excel-service.js';

const orderBody = document.querySelector('#orderBody');
const orderTable = document.querySelector('#orderTable');
const emptyMessage = document.querySelector('#emptyMessage');
const actionMessage = document.querySelector('#actionMessage');
const statusFilter = document.querySelector('#statusFilter');
const canManagePayments = hasPermission('payments.manage', getCurrentUser());

let orders = [];
let loaded = false;
let keyword = '';
let sortMode = 'newest';
const expanded = new Set();

document.querySelector('#exportBtn').insertAdjacentHTML('afterbegin', icon('download', { size: 15 }));

statusFilter.innerHTML =
    '<option value="">Tất cả trạng thái</option>' +
    Object.entries(ORDER_STATUS)
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join('');

// Lọc theo thời gian (giờ Việt Nam, UTC+7): áp dụng cho cả dải thống kê lẫn danh sách đơn
const yearSelect = document.querySelector('#yearSelect');
const quarterSelect = document.querySelector('#quarterSelect');
const monthSelect = document.querySelector('#monthSelect');
let scope = 'all';

monthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Tháng ${i + 1}</option>`).join('');

const vnDate = (iso) => new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);

function inPeriod(order) {
    if (scope === 'all') return true;
    const at = vnDate(order.createdAt);
    if (at.getUTCFullYear() !== Number(yearSelect.value)) return false;
    if (scope === 'year') return true;
    const month = at.getUTCMonth() + 1;
    return scope === 'quarter' ? Math.ceil(month / 3) === Number(quarterSelect.value) : month === Number(monthSelect.value);
}

function syncPeriodControls() {
    document.querySelectorAll('#scopeSeg button').forEach((button) => button.classList.toggle('active', button.dataset.scope === scope));
    yearSelect.classList.toggle('hidden', scope === 'all');
    quarterSelect.classList.toggle('hidden', scope !== 'quarter');
    monthSelect.classList.toggle('hidden', scope !== 'month');
}

function fillYears() {
    const now = vnDate(new Date().toISOString());
    const years = [...new Set([now.getUTCFullYear(), ...orders.map((order) => vnDate(order.createdAt).getUTCFullYear())])].sort(
        (a, b) => b - a
    );
    yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
    quarterSelect.value = String(Math.floor(now.getUTCMonth() / 3) + 1);
    monthSelect.value = String(now.getUTCMonth() + 1);
}

// Thẻ tổng quan: doanh thu thực nhận (tổng tiền khách trả của đơn đã giao) + số đơn theo trạng thái.
// Chưa có dữ liệu thì vẽ khung với giá trị "…" để thẻ có sẵn chỗ, phần bên dưới không bị đẩy xuống
function renderStats() {
    const scoped = orders.filter(inPeriod);
    const count = (...statuses) => (loaded ? scoped.filter((order) => statuses.includes(order.status)).length : '…');
    const delivered = scoped.filter((order) => order.status === 'delivered');
    const units = delivered.reduce((total, order) => total + order.items.reduce((sum, item) => sum + item.qty, 0), 0);
    const revenue = delivered.reduce((total, order) => total + order.total, 0);
    document.querySelector('#stats').innerHTML = heroCard({
        label: 'Doanh thu từ đơn đã giao',
        value: loaded ? formatPrice(revenue) : '…',
        sub: `<span class="delta-vs">${loaded ? `${delivered.length} đơn đã giao · ${units} sản phẩm · tổng ${scoped.length} đơn` : 'Đang tải số liệu…'}</span>`,
        stats: [
            { label: 'Chờ xác nhận', value: count('pending'), warn: loaded && count('pending') > 0 },
            { label: 'Đơn trên 1 triệu chờ chuyển khoản', value: count('unconfirmed') },
            { label: 'Đang xử lý / giao', value: count('confirmed', 'shipping') },
            { label: 'Đã hủy', value: count('cancelled') }
        ]
    });
}

document.querySelector('#scopeSeg').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    scope = button.dataset.scope;
    syncPeriodControls();
    render();
});
[yearSelect, quarterSelect, monthSelect].forEach((select) => select.addEventListener('change', () => render()));

function visibleOrders() {
    const result = orders.filter((order) => {
        const { fullName, phone, email } = order.customer;
        return (
            inPeriod(order) &&
            (!statusFilter.value || order.status === statusFilter.value) &&
            `${order.code} ${fullName} ${phone} ${email}`.toLowerCase().includes(keyword)
        );
    });

    const sorters = {
        newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
        oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
        highest: (a, b) => b.total - a.total
    };
    return result.sort(sorters[sortMode]);
}

function renderOrders() {
    const result = visibleOrders();
    orderTable.hidden = !result.length;
    emptyMessage.classList.toggle('hidden', result.length > 0);

    orderBody.innerHTML = result
        .map(
            (order) => `
        <tr data-id="${order.id}">
            <td><b>${escapeHtml(order.code)}</b></td>
            <td>${escapeHtml(order.customer.fullName)}<br><small class="muted">${escapeHtml(order.customer.phone)}</small></td>
            <td>${formatDate(order.createdAt)}</td>
            <td><b>${formatPrice(order.total)}</b></td>
            <td>${statusBadge(order.status)}${hasPendingCancelRequest(order) ? '<br><span class="status status-cancelled">Khách yêu cầu hủy</span>' : ''}<br>${paymentBadge(order)}</td>
            <td><span class="row-actions">
                ${canManagePayments && order.paymentStatus === 'unpaid' && ['pending', 'confirmed'].includes(order.status) && order.paymentMethod === 'sepay' ? '<button class="btn btn-sm btn-accent" data-action="paid">Đã nhận tiền</button>' : ''}
                ${canManagePayments && order.paymentStatus === 'refund_pending' ? '<button class="btn btn-sm btn-accent" data-action="refunded">Đã hoàn tiền</button>' : ''}
                ${hasPendingCancelRequest(order) ? '<button class="btn btn-sm btn-danger" data-action="approve-cancel">Đồng ý hủy</button><button class="btn btn-sm btn-outline" data-action="reject-cancel">Từ chối</button>' : ''}
                ${nextStatus(order) && !hasPendingCancelRequest(order) ? `<button class="btn btn-sm" data-action="advance">${NEXT_STATUS_LABEL[order.status]}</button>` : ''}
                ${canAdminCancel(order) ? iconButton('close', order.status === 'shipping' ? 'Giao không thành công (hoàn hàng)' : 'Hủy đơn', { tone: 'danger', attrs: { 'data-action': 'cancel' } }) : ''}
                ${order.status !== 'cancelled' ? iconButton('download', 'Xuất hóa đơn PDF', { attrs: { 'data-action': 'invoice' } }) : ''}
                ${order.status !== 'cancelled' ? iconButton('mail', 'Gửi hóa đơn về email khách', { attrs: { 'data-action': 'invoice-email' } }) : ''}
                ${iconButton(expanded.has(order.id) ? 'chevronUp' : 'chevronDown', expanded.has(order.id) ? 'Thu gọn' : 'Xem chi tiết', { attrs: { 'data-action': 'toggle' } })}
            </span></td>
        </tr>
        ${expanded.has(order.id) ? `<tr class="detail-row"><td colspan="6">${renderTimeline(order)}${renderOrderDetails(order)}</td></tr>` : ''}`
        )
        .join('');
}

const render = () => {
    renderStats();
    renderOrders();
};

// Xuất danh sách đang lọc ra CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt).
document.querySelector('#exportBtn').addEventListener('click', () => {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    // Excel tự đổi chuỗi giống số/ngày (SĐT mất số 0, ngày hiện ####); bọc ="..." để giữ nguyên là chữ
    const text = (value) => `="${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
        ['Mã đơn', 'Khách hàng', 'SĐT', 'Ngày đặt', 'Sản phẩm', 'Tổng tiền', 'Thanh toán', 'Trạng thái thanh toán', 'Trạng thái']
    ].concat(
        visibleOrders().map((order) => [
            order.code,
            order.customer.fullName,
            { text: order.customer.phone },
            { text: formatDate(order.createdAt) },
            order.items.map((item) => `${item.name} x${item.qty}`).join('; '),
            order.total,
            PAYMENT_METHODS[order.paymentMethod],
            PAYMENT_STATUS[order.paymentStatus] || order.paymentStatus,
            ORDER_STATUS[order.status]
        ])
    );
    const blob = new Blob(
        [
            '\ufeff' +
                rows.map((row) => row.map((value) => (value?.text !== undefined ? text(value.text) : cell(value))).join(',')).join('\r\n')
        ],
        { type: 'text/csv;charset=utf-8' }
    );
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'don-hang.csv' });
    link.click();
    URL.revokeObjectURL(link.href);
});

document.querySelector('#exportXlsxBtn').addEventListener('click', async () => {
    try {
        const rows = visibleOrders();
        await downloadWorkbook('don-hang.xlsx', [
            {
                name: 'Don hang',
                widths: [18, 20, 13, 24, 18, 50, 14, 30, 20, 16],
                rows: [
                    [
                        'Mã đơn',
                        'Khách hàng',
                        'SĐT',
                        'Email',
                        'Ngày đặt',
                        'Sản phẩm',
                        'Tổng tiền',
                        'Thanh toán',
                        'Trạng thái thanh toán',
                        'Trạng thái'
                    ],
                    ...rows.map((order) => [
                        order.code,
                        order.customer.fullName,
                        order.customer.phone,
                        order.customer.email,
                        formatDate(order.createdAt),
                        order.items.map((item) => `${item.name} x${item.qty}`).join('; '),
                        order.total,
                        PAYMENT_METHODS[order.paymentMethod],
                        PAYMENT_STATUS[order.paymentStatus] || order.paymentStatus,
                        ORDER_STATUS[order.status]
                    ])
                ]
            }
        ]);
        toast('Đã xuất danh sách đơn hàng Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
});

document.querySelector('#orderSearch').addEventListener('input', (event) => {
    keyword = event.target.value.trim().toLowerCase();
    renderOrders();
});
statusFilter.addEventListener('change', renderOrders);
document.querySelector('#sortSelect').addEventListener('change', (event) => {
    sortMode = event.target.value;
    renderOrders();
});

orderBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    const order = button && orders.find((entry) => entry.id === button.closest('tr').dataset.id);
    if (!order) return;

    if (button.dataset.action === 'toggle') {
        if (!expanded.delete(order.id)) expanded.add(order.id);
        renderOrders();
        return;
    }

    if (button.dataset.action === 'invoice') {
        // xuất hóa đơn PDF của đơn này, thông báo hiện ở #actionMessage
        xuatHoaDon(order, button, actionMessage);
        return;
    }

    if (['paid', 'refunded'].includes(button.dataset.action)) {
        const text =
            button.dataset.action === 'paid'
                ? `Xác nhận đã nhận đủ ${formatPrice(order.total)} cho đơn ${order.code}?`
                : `Xác nhận đã hoàn tiền cho đơn ${order.code}?`;
        if (
            !(await confirmDialog({
                title: button.dataset.action === 'paid' ? 'Ghi nhận đã nhận tiền?' : 'Ghi nhận đã hoàn tiền?',
                message: text,
                confirmText: 'Xác nhận'
            }))
        )
            return;
        try {
            Object.assign(order, await api.patch(`/orders/${order.id}/payment`, { paymentStatus: button.dataset.action }));
            toast(`Đơn ${order.code}: cập nhật thanh toán thành công.`, { type: 'success' });
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
        render();
        return;
    }

    if (button.dataset.action === 'invoice-email') {
        button.disabled = true;
        try {
            const result = await api.post(`/orders/${order.id}/invoice-email`);
            toast(`Đã gửi hóa đơn ${order.code} tới ${result.sentTo}.`, { type: 'success' });
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
        button.disabled = false;
        return;
    }

    if (['approve-cancel', 'reject-cancel'].includes(button.dataset.action)) {
        const approve = button.dataset.action === 'approve-cancel';
        const choice = await choiceDialog({
            title: approve ? `Đồng ý hủy đơn ${order.code}?` : `Từ chối yêu cầu hủy đơn ${order.code}?`,
            message: approve
                ? `Lý do khách chọn: ${order.cancelRequest.reason}. Tồn kho sẽ được hoàn lại${order.paymentStatus === 'paid' ? ' và đơn được đánh dấu cần hoàn tiền' : ''}.`
                : 'Đơn sẽ tiếp tục được xử lý và giao như bình thường. Ghi lý do để khách biết (không bắt buộc).',
            noteLabel: 'Lý do từ chối (hiện cho khách)',
            noteOptional: true,
            confirmText: approve ? 'Đồng ý hủy' : 'Từ chối',
            tone: approve ? 'danger' : 'primary'
        });
        if (!choice) return;
        try {
            Object.assign(
                order,
                await api.patch(`/orders/${order.id}/cancel-request`, { decision: approve ? 'approve' : 'reject', note: choice.note })
            );
            toast(approve ? `Đã hủy đơn ${order.code}.` : `Đã từ chối yêu cầu hủy đơn ${order.code}.`, { type: 'success' });
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
        render();
        return;
    }

    const isCancel = button.dataset.action === 'cancel';
    // Đơn đang giao bị hủy = giao không thành công (khách không nhận), hàng hoàn về kho
    const failedDelivery = order.status === 'shipping';
    const dialog = failedDelivery
        ? {
              title: `Giao không thành công: ${order.code}?`,
              message:
                  'Khách không nhận hàng / không liên lạc được. Đơn sẽ bị hủy, hàng hoàn về kho' +
                  (order.paymentStatus === 'paid' ? ' và đơn được đánh dấu cần hoàn tiền.' : '.'),
              confirmText: 'Xác nhận giao không thành công'
          }
        : {
              title: `Hủy đơn ${order.code}?`,
              message: 'Tồn kho sẽ được hoàn lại. Thao tác này không thể hoàn tác.',
              confirmText: 'Hủy đơn'
          };
    let reason = '';
    if (isCancel && failedDelivery) {
        if (!(await confirmDialog({ ...dialog, cancelText: 'Quay lại', tone: 'danger' }))) return;
    } else if (isCancel) {
        // Cửa hàng chủ động hủy: ghi lý do để khách biết (không bắt buộc)
        const choice = await choiceDialog({
            title: dialog.title,
            message: dialog.message,
            noteLabel: 'Lý do hủy (hiện cho khách, không bắt buộc)',
            noteOptional: true,
            confirmText: dialog.confirmText,
            tone: 'danger'
        });
        if (!choice) return;
        reason = choice.note;
    }

    button.disabled = true;
    try {
        const status = isCancel ? 'cancelled' : nextStatus(order);
        Object.assign(order, await api.patch(`/orders/${order.id}/status`, { status, ...(reason ? { reason } : {}) }));
        toast(`Đơn ${order.code}: ${ORDER_STATUS[order.status]}.`, { type: 'success', title: 'Đã cập nhật đơn hàng' });
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
    render();
});

async function initialize() {
    if (!requirePermission('orders.view')) return;
    renderStats();
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load('/orders', (data) => {
            orders = data;
            loaded = true;
            fillYears();
            render();
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
