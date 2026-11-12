import { api } from '../services/api-service.js';
import '../components/table-view.js';
import { requirePermission } from '../utils/auth.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { fromLocalInput, timeState, toLocalInput } from '../utils/dates.js';
import { iconButton } from '../utils/icons.js';
import { confirmDialog, toast } from '../components/notify.js';
import '../components/header.js';

const form = document.querySelector('#voucherForm');
const body = document.querySelector('#body');
const field = (name) => form.elements.namedItem(name);

let vouchers = [];
let categories = [];
let products = [];
let editing = null;

const AUDIENCE = { all: 'Mọi khách', newUser: 'Người dùng mới', birthday: 'Sinh nhật' };
const SCOPE = { all: 'Toàn bộ', newProduct: 'Sản phẩm mới', category: 'Theo danh mục', product: 'Theo sản phẩm' };
const TIME = {
    upcoming: ['Sắp diễn ra', 'status-pending'],
    running: ['Đang chạy', 'status-delivered'],
    ended: ['Đã kết thúc', 'status-cancelled']
};

function render() {
    body.innerHTML = vouchers.length
        ? vouchers
              .map((voucher) => {
                  const [label, css] = voucher.active ? TIME[timeState(voucher)] : ['Đã tắt', 'status-cancelled'];
                  const sold = voucher.totalQuantity && voucher.claimedCount >= voucher.totalQuantity;
                  return `
        <tr data-id="${voucher.id}">
            <td><b>${escapeHtml(voucher.code)}</b><small class="muted block">${escapeHtml(voucher.name)}</small><small class="muted block">${AUDIENCE[voucher.audience]}${voucher.claimable ? ' · trong Kho voucher' : ' · tự tặng'}</small></td>
            <td>${voucher.type === 'percent' ? `${voucher.value}% <small class="muted block">tối đa ${formatPrice(voucher.maxDiscount)}</small>` : formatPrice(voucher.value)}<small class="muted block">${voucher.kind === 'shipping' ? 'Phí vận chuyển' : 'Đơn hàng'}</small></td>
            <td>${voucher.minOrder ? `Từ ${formatPrice(voucher.minOrder)}` : 'Không'}<small class="muted block">${SCOPE[voucher.scope]}</small></td>
            <td>${formatDate(voucher.startAt)}<small class="muted block">→ ${formatDate(voucher.endAt)}</small></td>
            <td>${voucher.claimedCount}${voucher.totalQuantity ? ` / ${voucher.totalQuantity}` : ''} · ${voucher.usedCount}</td>
            <td><span class="status ${css}">${label}</span>${sold ? '<small class="muted block">Hết lượt</small>' : ''}</td>
            <td><span class="row-actions">${iconButton('edit', 'Sửa', { attrs: { 'data-action': 'edit' } })}${voucher.claimedCount ? '' : iconButton('trash', 'Xóa', { tone: 'danger', attrs: { 'data-action': 'delete' } })}</span></td>
        </tr>`;
              })
              .join('')
        : '<tr><td colspan="7" class="muted">Chưa có voucher nào.</td></tr>';
}

// Ẩn/hiện ô theo lựa chọn để admin không nhập điều kiện vô nghĩa (VD: voucher ship không chọn được phạm vi).
function syncForm(selected = []) {
    const percent = field('type').value === 'percent';
    document.querySelector('#valueHint').textContent = percent ? '(% từ 1 đến 70)' : '(₫)';
    document.querySelector('#maxField').classList.toggle('hidden', !percent);
    field('value').step = percent ? 1 : 1000;
    const scopeLocked = field('kind').value === 'shipping' || field('audience').value === 'birthday';
    if (scopeLocked) field('scope').value = 'all';
    field('scope').disabled = scopeLocked;
    const scope = field('scope').value;
    const box = document.querySelector('#scopeBox');
    box.classList.toggle('hidden', !['category', 'product'].includes(scope));
    if (scope === 'category' || scope === 'product') {
        const list = scope === 'category' ? categories : products;
        const current = selected.length ? selected : [...document.querySelectorAll('#scopeList input:checked')].map((input) => input.value);
        document.querySelector('#scopeList').innerHTML = list
            .map(
                (item) => `
            <label class="check-inline"><input type="checkbox" value="${item.id}" ${current.includes(String(item.id)) ? 'checked' : ''}> ${escapeHtml(item.name)}</label>`
            )
            .join('');
    }
}
['type', 'kind', 'audience', 'scope'].forEach((name) => field(name).addEventListener('change', () => syncForm()));

function openForm(voucher) {
    editing = voucher?.id ?? null;
    document.querySelector('#formTitle').textContent = voucher ? `Sửa: ${voucher.code}` : 'Voucher mới';
    const start = new Date();
    const end = new Date(Date.now() + 30 * 86400000);
    field('code').value = voucher?.code ?? '';
    field('name').value = voucher?.name ?? '';
    field('kind').value = voucher?.kind ?? 'order';
    field('audience').value = voucher?.audience ?? 'all';
    field('type').value = voucher?.type ?? 'percent';
    field('value').value = voucher?.value ?? 10;
    field('maxDiscount').value = voucher?.maxDiscount ?? 50000;
    field('minOrder').value = voucher?.minOrder ?? 0;
    field('scope').value = voucher?.scope ?? 'all';
    field('startAt').value = toLocalInput(voucher?.startAt ?? start.toISOString());
    field('endAt').value = toLocalInput(voucher?.endAt ?? end.toISOString());
    field('totalQuantity').value = voucher?.totalQuantity ?? 0;
    field('perUserLimit').value = voucher?.perUserLimit ?? 1;
    field('validDays').value = voucher?.validDays ?? 30;
    field('active').checked = voucher?.active ?? true;
    // Đã có người nhận: khóa các ô điều kiện (server cũng chặn).
    const locked = Boolean(voucher?.claimedCount);
    ['code', 'kind', 'audience', 'type', 'value', 'maxDiscount', 'minOrder', 'scope', 'startAt', 'perUserLimit', 'validDays'].forEach(
        (name) => {
            field(name).disabled = locked;
        }
    );
    syncForm(voucher?.scopeIds?.map(String) || []);
    if (locked) field('scope').disabled = true;
    document.querySelector('#formMessage').textContent = locked
        ? 'Voucher đã có người nhận: chỉ sửa được tên, ngày kết thúc, tổng số lượng và bật/tắt.'
        : '';
    form.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = {
        code: field('code').value.trim().toUpperCase(),
        name: field('name').value.trim(),
        kind: field('kind').value,
        audience: field('audience').value,
        type: field('type').value,
        value: Number(field('value').value),
        maxDiscount: field('type').value === 'percent' ? Number(field('maxDiscount').value) : undefined,
        minOrder: Number(field('minOrder').value || 0),
        scope: field('scope').value,
        scopeIds: [...document.querySelectorAll('#scopeList input:checked')].map((input) => input.value),
        startAt: fromLocalInput(field('startAt').value),
        endAt: fromLocalInput(field('endAt').value),
        totalQuantity: Number(field('totalQuantity').value || 0),
        perUserLimit: Number(field('perUserLimit').value || 1),
        validDays: Number(field('validDays').value || 30),
        active: field('active').checked
    };
    // Voucher đã có người nhận: chỉ gửi các trường được phép đổi (server giữ nguyên phần còn lại).
    const locked = editing && vouchers.find((item) => item.id === editing)?.claimedCount;
    const payload = locked ? { name: data.name, endAt: data.endAt, totalQuantity: data.totalQuantity, active: data.active } : data;
    try {
        const saved = editing ? await api.put(`/admin/vouchers/${editing}`, payload) : await api.post('/admin/vouchers', payload);
        vouchers = editing ? vouchers.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...vouchers];
        form.classList.add('hidden');
        toast(`Đã lưu voucher ${saved.code}.`, { type: 'success' });
        render();
    } catch (error) {
        document.querySelector('#formMessage').textContent = error.message;
    }
});

body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    const voucher = button && vouchers.find((item) => item.id === button.closest('tr').dataset.id);
    if (!voucher) return;
    if (button.dataset.action === 'edit') return openForm(voucher);
    if (!(await confirmDialog({ title: `Xóa voucher ${voucher.code}?`, confirmText: 'Xóa', tone: 'danger' }))) return;
    try {
        await api.delete(`/admin/vouchers/${voucher.id}`);
        vouchers = vouchers.filter((item) => item !== voucher);
        render();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

document.querySelector('#newBtn').addEventListener('click', () => openForm());
document.querySelector('#cancelBtn').addEventListener('click', () => form.classList.add('hidden'));

async function initialize() {
    if (!requirePermission('vouchers.manage')) return;
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load(['/admin/vouchers', '/categories', '/products'], (voucherList, categoryList, productList) => {
            vouchers = voucherList;
            categories = categoryList;
            products = productList;
            render();
        });
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

initialize();
