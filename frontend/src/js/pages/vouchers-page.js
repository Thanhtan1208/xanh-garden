import { api } from '../services/api-service.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { toast } from '../components/notify.js';
import '../components/header.js';

// Một trang duy nhất: Voucher của bạn → Voucher có thể nhận → Đã dùng / hết hạn (thu gọn)
const box = document.querySelector('#voucherBox');
const birthdayBox = document.querySelector('#birthdayBox');
const user = getCurrentUser();
const isCustomer = Boolean(user) && !isManagementRole(user);

let hall = [];
let wallet = [];
let birthday = null;

// Chỉ ghi nguồn cho quà tặng; voucher tự bấm nhận thì không cần nhãn
const SOURCE = { newUser: 'Quà người dùng mới', birthday: 'Quà sinh nhật' };
const sourceTag = (row) => (SOURCE[row.source] ? `<small>${SOURCE[row.source]}</small>` : '');
const DONE = { used: ['Đã dùng', 'status-confirmed'], expired: ['Hết hạn', 'status-cancelled'] };
// Voucher đã có trong ví: hạn dùng theo ví, không hiện "Còn x lượt nhận" của kho
const owned = (row) => ({ ...row.voucher, endAt: row.expiresAt, remaining: null });

function scopeText(voucher) {
    if (voucher.scope === 'newProduct') return 'Chỉ sản phẩm mới';
    if (voucher.scope === 'category') return 'Một số danh mục';
    if (voucher.scope === 'product') return 'Một số sản phẩm';
    return 'Toàn bộ sản phẩm';
}

// Một thẻ voucher: bên trái là mức giảm, bên phải là điều kiện và nút hành động
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

const heading = (title, count = 0) => `<h2 class="voucher-heading">${title}${count ? ` (${count})` : ''}</h2>`;
const note = (html) => `<p class="voucher-note muted">${html}</p>`;

// Voucher còn dùng được (cả quà tặng tự vào ví); sắp hết hạn xếp trước
function mineHtml() {
    if (!user) return heading('Voucher của bạn') + note('<a href="./login.html" data-login>Đăng nhập</a> để nhận và xem voucher của bạn.');
    if (!isCustomer) return '';
    const rows = wallet
        .filter((row) => row.voucher && row.status === 'available')
        .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    if (!rows.length) return heading('Voucher của bạn') + note('Bạn chưa có voucher nào. Bấm "Nhận" ở danh sách bên dưới.');
    const cards = rows.map((row) => {
        // Còn dưới 3 ngày thì nhắc rõ để khách dùng kịp
        const daysLeft = Math.ceil((Date.parse(row.expiresAt) - Date.now()) / 86400000);
        const soon = daysLeft <= 3 ? `<small class="error-message">Sắp hết hạn: còn ${daysLeft} ngày</small>` : '';
        return card(owned(row), {
            extra: `${sourceTag(row)}${soon}`,
            action: '<a class="btn btn-sm" href="./cart.html">Dùng ngay</a>'
        });
    });
    return heading('Voucher của bạn', rows.length) + cards.join('');
}

// Voucher ai cũng nhận được; cái đã nhận nằm ở mục trên nên không lặp lại
function hallHtml() {
    const open = hall.filter((voucher) => !voucher.claimed);
    if (!open.length)
        return (
            heading('Voucher có thể nhận') +
            note(hall.length ? 'Bạn đã nhận hết voucher đang có.' : 'Hiện chưa có voucher nào để nhận, hãy quay lại sau nhé.')
        );
    const cards = open.map((voucher) =>
        card(voucher, { action: `<button type="button" class="btn btn-sm" data-claim="${voucher.id}">Nhận</button>` })
    );
    return heading('Voucher có thể nhận', open.length) + cards.join('');
}

function historyHtml() {
    const rows = wallet.filter((row) => row.voucher && row.status !== 'available');
    if (!rows.length) return '';
    const cards = rows.map((row) => {
        const [label, css] = DONE[row.status] || DONE.expired;
        return card(owned(row), {
            state: 'disabled',
            extra: sourceTag(row),
            action: `<span class="status ${css}">${label}</span>`
        });
    });
    return `<details class="voucher-history"><summary>Đã dùng / hết hạn (${rows.length})</summary><div class="voucher-grid">${cards.join('')}</div></details>`;
}

function render() {
    birthdayBox.classList.toggle('hidden', !(isCustomer && !birthday));
    // Giữ mục lịch sử đang mở khi vẽ lại
    const historyOpen = box.querySelector('.voucher-history')?.open;
    box.innerHTML = mineHtml() + hallHtml() + historyHtml();
    if (historyOpen) box.querySelector('.voucher-history').open = true;
}

// Đăng nhập xong quay lại trang này
function goLogin() {
    sessionStorage.setItem('redirectAfterLogin', 'vouchers.html');
    window.location.assign('./login.html');
}

box.addEventListener('click', async (event) => {
    if (event.target.closest('[data-login]')) {
        event.preventDefault();
        goLogin();
        return;
    }
    const button = event.target.closest('[data-claim]');
    if (!button) return;
    if (!user) {
        goLogin();
        return;
    }
    if (!isCustomer) {
        toast('Tài khoản quản lý không nhận voucher khách hàng.', { type: 'info' });
        return;
    }
    button.disabled = true;
    try {
        const entry = await api.post('/vouchers/claim', { voucherId: button.dataset.claim });
        wallet.unshift(entry);
        hall = hall.map((voucher) => (voucher.id === button.dataset.claim ? { ...voucher, claimed: true } : voucher));
        toast(`Đã nhận voucher “${entry.voucher.name}”, xem ở mục Voucher của bạn.`, { type: 'success' });
        render(); // voucher vừa nhận chuyển lên mục trên
    } catch (error) {
        toast(error.message, { type: 'error' });
        button.disabled = false;
    }
});

document.querySelector('#birthdayBtn').addEventListener('click', async () => {
    const message = document.querySelector('#birthdayMessage');
    message.textContent = '';
    const value = document.querySelector('#birthdayInput').value;
    if (!value) {
        message.textContent = 'Vui lòng chọn ngày sinh.';
        return;
    }
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
    const paths = isCustomer ? ['/vouchers', '/vouchers/mine'] : ['/vouchers'];
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
