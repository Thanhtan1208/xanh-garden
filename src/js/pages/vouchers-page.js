import { api } from '../services/api-service.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { toast } from '../components/notify.js';
import '../components/header.js';

const box = document.querySelector('#voucherBox');
const tabs = document.querySelector('#voucherTabs');
const birthdayBox = document.querySelector('#birthdayBox');
const user = getCurrentUser();

let tab = 'hall';
let hall = [];
let wallet = [];
let birthday = null;

const SOURCE = { claim: 'Đã nhận', newUser: 'Quà người dùng mới', birthday: 'Quà sinh nhật' };
const STATUS = { available: ['Còn dùng được', 'status-delivered'], used: ['Đã dùng', 'status-confirmed'], expired: ['Hết hạn', 'status-cancelled'] };

function scopeText(voucher) {
    if (voucher.scope === 'newProduct') return 'Chỉ sản phẩm mới';
    if (voucher.scope === 'category') return 'Một số danh mục';
    if (voucher.scope === 'product') return 'Một số sản phẩm';
    return 'Toàn bộ sản phẩm';
}

// Một thẻ voucher: bên trái là mức giảm, bên phải là điều kiện và nút hành động.
function card(voucher, { action = '', extra = '', state = '' } = {}) {
    return `
        <article class="voucher-ticket${state ? ` ${state}` : ''}">
            <div class="voucher-value">
                <b>${voucher.type === 'percent' ? `${voucher.value}%` : formatPrice(voucher.value)}</b>
                <small>${voucher.kind === 'shipping' ? 'Phí vận chuyển' : 'Giảm đơn hàng'}</small>
            </div>
            <div class="voucher-info">
                <b>${escapeHtml(voucher.name)}</b>
                <small>${voucher.type === 'percent' ? `Tối đa ${formatPrice(voucher.maxDiscount)} · ` : ''}${voucher.minOrder ? `Đơn từ ${formatPrice(voucher.minOrder)}` : 'Không yêu cầu đơn tối thiểu'}</small>
                <small>${scopeText(voucher)} · HSD ${formatDate(voucher.endAt)}</small>
                ${voucher.remaining !== null && voucher.remaining !== undefined ? `<small>Còn ${voucher.remaining} lượt nhận</small>` : ''}
                ${extra}
            </div>
            <div class="voucher-action">${action}</div>
        </article>`;
}

function renderHall() {
    if (!hall.length) {
        box.innerHTML = '<div class="empty-state"><h2>Hiện chưa có voucher nào để nhận</h2><p>Hãy quay lại sau nhé.</p></div>';
        return;
    }
    box.innerHTML = hall.map((voucher) => card(voucher, {
        state: voucher.claimed ? 'claimed' : '',
        action: voucher.claimed
            ? `<span class="status status-delivered">${icon('check', { size: 14 })} Đã nhận</span>`
            : `<button type="button" class="btn btn-sm" data-claim="${voucher.id}">Nhận</button>`
    })).join('');
}

function renderWallet() {
    if (!user) {
        box.innerHTML = '<div class="empty-state"><h2>Đăng nhập để xem ví voucher</h2><a class="btn" href="./login.html">Đăng nhập</a></div>';
        return;
    }
    const rows = wallet.filter((row) => row.voucher);
    if (!rows.length) {
        box.innerHTML = '<div class="empty-state"><h2>Ví voucher đang trống</h2><p>Nhận voucher ở tab Kho voucher.</p></div>';
        return;
    }
    box.innerHTML = rows.map((row) => {
        const [label, css] = STATUS[row.status];
        return card({ ...row.voucher, endAt: row.expiresAt }, {
            state: row.status === 'available' ? '' : 'disabled',
            extra: `<small>${SOURCE[row.source] || 'Voucher'}</small>`,
            action: `<span class="status ${css}">${label}</span>${row.status === 'available' ? '<a class="btn btn-sm btn-outline" href="./cart.html">Dùng ngay</a>' : ''}`
        });
    }).join('');
}

function render() {
    tabs.querySelectorAll('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    birthdayBox.classList.toggle('hidden', !(tab === 'wallet' && user && !isManagementRole(user) && !birthday));
    if (tab === 'hall') renderHall(); else renderWallet();
}

tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (!button) return;
    tab = button.dataset.tab;
    render();
});

box.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-claim]');
    if (!button) return;
    if (!user) {
        sessionStorage.setItem('redirectAfterLogin', 'vouchers.html');
        window.location.assign('./login.html');
        return;
    }
    if (isManagementRole(user)) { toast('Tài khoản quản lý không nhận voucher khách hàng.', { type: 'info' }); return; }
    button.disabled = true;
    try {
        const entry = await api.post('/vouchers/claim', { voucherId: button.dataset.claim });
        wallet.unshift(entry);
        hall = hall.map((voucher) => (voucher.id === button.dataset.claim ? { ...voucher, claimed: true } : voucher));
        toast(`Đã nhận voucher “${entry.voucher.name}”. Xem ở tab Ví của tôi.`, { type: 'success' });
        renderHall();
    } catch (error) {
        toast(error.message, { type: 'error' });
        button.disabled = false;
    }
});

document.querySelector('#birthdayBtn').addEventListener('click', async () => {
    const message = document.querySelector('#birthdayMessage');
    message.textContent = '';
    const value = document.querySelector('#birthdayInput').value;
    if (!value) { message.textContent = 'Vui lòng chọn ngày sinh.'; return; }
    try {
        await api.put('/vouchers/birthday', { birthday: value });
        birthday = value;
        toast('Đã lưu ngày sinh. Bạn sẽ nhận quà đúng ngày sinh nhật.', { type: 'success' });
        wallet = (await api.get('/vouchers/mine')).vouchers; // đúng hôm nay là sinh nhật thì quà đã được tặng ngay
        render();
    } catch (error) {
        message.textContent = error.message;
    }
});

async function initialize() {
    document.querySelector('#birthdayInput').max = new Date().toISOString().slice(0, 10);
    if (new URLSearchParams(window.location.search).get('tab') === 'wallet') tab = 'wallet';
    const paths = user && !isManagementRole(user) ? ['/vouchers', '/vouchers/mine'] : ['/vouchers'];
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load(paths, (hallData, mine) => {
            hall = hallData;
            if (mine) {
                wallet = mine.vouchers;
                birthday = mine.birthday;
            }
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
