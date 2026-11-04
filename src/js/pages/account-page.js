import { api } from '../services/api-service.js';
import { bindAddToCart, renderProductCard } from '../components/product-card.js';
import { paintFavorites } from '../services/favorite-service.js';
import { confirmDialog, toast } from '../components/notify.js';
import { requireCustomer } from '../utils/auth.js';
import { ORDER_STATUS, escapeHtml, formatPrice } from '../utils/format.js';
import { icon, iconButton } from '../utils/icons.js';
import { bindPasswordHints, passwordProblem } from '../utils/password.js';
import { bindSendCode } from '../services/password-otp.js';
import '../components/header.js';
import '../utils/password-toggle.js';

// Trang "Tài khoản của tôi": thông tin, sổ địa chỉ, sản phẩm yêu thích, đổi mật khẩu.
const user = requireCustomer();
const $ = (selector) => document.querySelector(selector);
const TABS = ['info', 'addresses', 'favorites', 'password'];
let addresses = [];
let favorites = [];
let editingId = null;
// Tab đã tải dữ liệu thì lần sau mở lại hiện ngay, không tải và vẽ lại (tránh giật)
const loadedTabs = new Set();

document.querySelectorAll('#accountNav [data-nav-icon]').forEach((item) => {
    item.insertAdjacentHTML('afterbegin', icon(item.dataset.navIcon, { size: 18 }));
});

function showTab(tab) {
    const name = TABS.includes(tab) ? tab : 'info';
    document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
    document.querySelectorAll('#accountNav [data-tab]').forEach((link) => link.classList.toggle('active', link.dataset.tab === name));
    const titles = { info: 'Tài khoản của tôi', addresses: 'Sổ địa chỉ', favorites: 'Sản phẩm yêu thích', password: 'Đổi mật khẩu' };
    const crumb = $('#crumbTitle');
    if (crumb) crumb.textContent = titles[name];
    if (name === 'addresses' && !loadedTabs.has(name)) loadAddresses().then(() => loadedTabs.add(name));
    if (name === 'favorites') loadFavorites();
}

$('#accountNav').addEventListener('click', (event) => {
    const link = event.target.closest('[data-tab]');
    if (!link) return;
    event.preventDefault();
    window.history.replaceState(null, '', `./account.html?tab=${link.dataset.tab}`);
    showTab(link.dataset.tab);
});

// ===== Thông tin =====
// Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
function loadInfo() {
    return api.load(['/vouchers/mine', '/orders'], renderInfo);
}

function renderInfo(wallet, orders) {
    $('#infoRows').innerHTML = `
        <div><dt>Tên đăng nhập</dt><dd>${escapeHtml(user.name)}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(user.email)}</dd></div>
        <div><dt>Ngày sinh</dt><dd>${wallet.birthday ? new Date(`${wallet.birthday}T00:00:00`).toLocaleDateString('vi-VN') : '<span class="muted">Chưa khai báo</span>'}</dd></div>`;
    $('#birthdayForm').classList.toggle('hidden', Boolean(wallet.birthday));
    $('#birthdayInput').max = new Date().toISOString().slice(0, 10);

    const active = orders.filter((order) => !['delivered', 'cancelled'].includes(order.status));
    const delivered = orders.filter((order) => order.status === 'delivered');
    const vouchers = wallet.vouchers.filter((row) => row.status === 'available').length;
    const latest = orders[0];
    $('#summaryList').innerHTML = `
        <a class="tx-row" href="./my-orders.html"><span class="tx-icon tone-orange">${active.length}</span><span class="tx-body"><b>Đơn đang xử lý</b><small>Chờ xác nhận, đang chuẩn bị hoặc đang giao</small></span><span class="tx-amount">›</span></a>
        <a class="tx-row" href="./my-orders.html"><span class="tx-icon tone-green">${delivered.length}</span><span class="tx-body"><b>Đơn đã nhận</b><small>Tổng chi tiêu ${formatPrice(delivered.reduce((sum, order) => sum + order.total, 0))}</small></span><span class="tx-amount">›</span></a>
        <a class="tx-row" href="./vouchers.html"><span class="tx-icon tone-blue">${vouchers}</span><span class="tx-body"><b>Voucher có thể dùng</b><small>Trong ví voucher của bạn</small></span><span class="tx-amount">›</span></a>
        ${latest ? `<a class="tx-row" href="./my-orders.html"><span class="tx-icon tone-gray">#</span><span class="tx-body"><b>Đơn gần nhất ${escapeHtml(latest.code)}</b><small>${ORDER_STATUS[latest.status] || latest.status} · ${formatPrice(latest.total)}</small></span><span class="tx-amount">›</span></a>` : ''}`;
}

$('#birthdayForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#birthdayMessage');
    message.textContent = '';
    try {
        await api.put('/vouchers/birthday', { birthday: $('#birthdayInput').value });
        toast('Đã lưu ngày sinh. Quà sinh nhật sẽ tự vào ví voucher đúng ngày.', { type: 'success' });
        loadInfo();
    } catch (error) {
        message.textContent = error.message;
    }
});

// ===== Sổ địa chỉ =====
const addressForm = $('#addressForm');
const addressField = (name) => addressForm.elements.namedItem(name);

function renderAddresses() {
    $('#addressBook').innerHTML = addresses.length ? addresses.map((item) => `
        <div class="address-row${item.isDefault ? ' default' : ''}" data-id="${item.id}">
            <span>
                <b>${escapeHtml(item.fullName)} · ${escapeHtml(item.phone)} ${item.isDefault ? '<em class="tag tag-praise">Mặc định</em>' : ''}</b>
                <small>${escapeHtml(item.address)}</small>
            </span>
            <span class="row-actions">
                ${item.isDefault ? '' : iconButton('star', 'Đặt làm mặc định', { attrs: { 'data-action': 'default' } })}
                ${iconButton('edit', 'Sửa địa chỉ', { attrs: { 'data-action': 'edit' } })}
                ${iconButton('trash', 'Xóa địa chỉ', { tone: 'danger', attrs: { 'data-action': 'delete' } })}
            </span>
        </div>`).join('') : '<p class="muted">Bạn chưa lưu địa chỉ nào. Thêm địa chỉ để đặt hàng nhanh hơn.</p>';
}

async function loadAddresses() {
    addresses = await api.get('/addresses');
    renderAddresses();
}

function openAddressForm(entry) {
    editingId = entry?.id ?? null;
    $('#addressFormTitle').textContent = entry ? 'Sửa địa chỉ' : 'Địa chỉ mới';
    addressField('fullName').value = entry?.fullName ?? '';
    addressField('phone').value = entry?.phone ?? '';
    addressField('address').value = entry?.address ?? '';
    addressField('isDefault').checked = entry?.isDefault ?? !addresses.length;
    $('#addressMessage').textContent = '';
    addressForm.classList.remove('hidden');
    addressField('fullName').focus();
}

$('#newAddressBtn').addEventListener('click', () => openAddressForm());
$('#cancelAddressBtn').addEventListener('click', () => addressForm.classList.add('hidden'));
addressForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = {
        fullName: addressField('fullName').value.trim(), phone: addressField('phone').value.trim(),
        address: addressField('address').value.trim(), isDefault: addressField('isDefault').checked
    };
    try {
        addresses = editingId ? await api.put(`/addresses/${editingId}`, data) : await api.post('/addresses', data);
        addressForm.classList.add('hidden');
        renderAddresses();
        toast('Đã lưu địa chỉ.', { type: 'success' });
    } catch (error) {
        $('#addressMessage').textContent = error.message;
    }
});

$('#addressBook').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const entry = addresses.find((item) => item.id === button.closest('[data-id]').dataset.id);
    try {
        if (button.dataset.action === 'edit') return openAddressForm(entry);
        if (button.dataset.action === 'default') addresses = await api.put(`/addresses/${entry.id}`, { ...entry, isDefault: true });
        if (button.dataset.action === 'delete') {
            if (!await confirmDialog({ title: 'Xóa địa chỉ này?', message: entry.address, confirmText: 'Xóa', tone: 'danger' })) return;
            addresses = await api.delete(`/addresses/${entry.id}`);
        }
        renderAddresses();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

// ===== Yêu thích =====
bindAddToCart($('#favoriteList'), () => favorites);
async function loadFavorites() {
    const list = await api.get('/favorites');
    // Danh sách không đổi thì giữ nguyên, không vẽ lại
    if (loadedTabs.has('favorites') && list.map((product) => product.id).join() === favorites.map((product) => product.id).join()) return;
    loadedTabs.add('favorites');
    favorites = list;
    $('#favoriteList').innerHTML = favorites.length
        ? favorites.map(renderProductCard).join('')
        : '<div class="empty-state full-column"><h2>Chưa có sản phẩm yêu thích</h2><p>Bấm biểu tượng trái tim trên sản phẩm để lưu lại xem sau.</p><a class="btn" href="./products.html">Xem sản phẩm</a></div>';
    paintFavorites($('#favoriteList'));
}

// ===== Đổi mật khẩu =====
const passwordForm = $('#passwordForm');
const passwordField = (name) => passwordForm.elements.namedItem(name);
bindSendCode(passwordForm);
bindPasswordHints(passwordField('newPassword'), $('#pwRules'), () => [user.name, user.email.split('@')[0]]);
passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#passwordMessage');
    message.classList.remove('ok');
    const newPassword = passwordField('newPassword').value;
    const problem = passwordProblem(newPassword, user.name, user.email.split('@')[0]);
    if (problem) { message.textContent = problem; return; }
    if (newPassword !== passwordField('confirmPassword').value) { message.textContent = 'Mật khẩu nhập lại không khớp.'; return; }
    if (!/^\d{6}$/.test(passwordField('code').value.trim())) { message.textContent = 'Vui lòng nhập mã xác nhận 6 số đã gửi về email.'; return; }
    try {
        await api.post('/auth/change-password', { currentPassword: passwordField('currentPassword').value, newPassword, code: passwordField('code').value.trim() });
        passwordForm.reset();
        message.textContent = 'Đã đổi mật khẩu. Lần đăng nhập sau hãy dùng mật khẩu mới.';
        message.classList.add('ok');
    } catch (error) {
        message.textContent = error.message;
    }
});

if (user) {
    $('#avatar').textContent = user.name.slice(0, 1).toUpperCase();
    $('#accName').textContent = user.name;
    $('#accEmail').textContent = user.email;
    showTab(new URLSearchParams(window.location.search).get('tab'));
    loadInfo().catch((error) => toast(error.message, { type: 'error' }));
}
