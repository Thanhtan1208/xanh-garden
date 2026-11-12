import { api } from '../services/api-service.js';
import { cartReady, clearCart, getCart } from '../services/cart-service.js';
import { updateCartBadge } from '../components/header.js';
import { requireCustomer } from '../utils/auth.js';
import { escapeHtml, formatDate, formatPrice, shippingFee } from '../utils/format.js';
import { RULES } from '../config/shop.js';
import { icon, iconButton } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { confirmDialog, infoDialog, toast } from '../components/notify.js';
import { trackCheckoutStart } from '../services/tracker.js';

const form = document.querySelector('#checkoutForm');
const summary = document.querySelector('#checkoutSummary');
const submitButton = form.querySelector('button[type="submit"]');
const addressList = document.querySelector('#addressList');
const addressForm = document.querySelector('#addressForm');
const addressMessage = document.querySelector('#addressMessage');
const voucherList = document.querySelector('#voucherList');
const voucherMessage = document.querySelector('#voucherMessage');
const addressField = { name: '#addrName', phone: '#addrPhone', address: '#addrAddress', isDefault: '#addrDefault' };

let items = [];
let addresses = [];
let selectedId = null;
let editingId = null;
let quote = null; // kết quả tính giá mới nhất từ server (nguồn sự thật)
let wallet = []; // voucher trong ví kèm "dùng được cho đơn này không"
const selectedVouchers = new Set();
let firstQuote = true;
const field = (name) => form.elements.namedItem(name);
const input = (key) => document.querySelector(addressField[key]);

document.querySelector('#addAddressBtn').insertAdjacentHTML('afterbegin', icon('plus', { size: 15 }));
document.querySelector('#backToCart').insertAdjacentHTML('afterbegin', icon('back', { size: 16 }));

// Số liệu hiển thị: dùng bản server tính; trong lúc chờ thì ước tính tạm để không nhảy trống.
function totals() {
    if (quote) return quote;
    const goods = items.reduce((total, item) => total + item.price * item.qty, 0);
    const fee = shippingFee(field('shippingMethod').value, goods);
    return { goods, discount: 0, promo: null, shippingFee: fee, shippingDiscount: 0, total: goods + fee, applied: [] };
}

// Tiền hàng trên 1 triệu: khóa COD và chọn sẵn chuyển khoản (server cũng chặn), đơn sẽ được webhook SePay xác nhận khi tiền về.
function syncPaymentChoice(goods) {
    const prepay = goods > RULES.highValueFrom;
    const cod = form.querySelector('input[name="paymentMethod"][value="cod"]');
    cod.disabled = prepay;
    cod.closest('.option-card').classList.toggle('disabled', prepay);
    if (prepay && cod.checked) form.querySelector('input[name="paymentMethod"][value="sepay"]').checked = true;
}

function renderSummary() {
    const { goods, discount, promo, shippingFee: fee, shippingDiscount, total } = totals();
    syncPaymentChoice(goods);
    summary.innerHTML = `
        <h2>Đơn hàng của bạn</h2>
        <div class="line-items">
            ${items
                .map(
                    (item) => `
                <div class="line-item">
                    <img src="${productImage(item.image)}" alt="${escapeHtml(item.name)}">
                    <div><b>${escapeHtml(item.name)}</b><small>Số lượng: ${item.qty}</small></div>
                    <span>${formatPrice(item.price * item.qty)}</span>
                </div>`
                )
                .join('')}
        </div>
        <div class="summary-line"><span>Tạm tính</span><b>${formatPrice(goods)}</b></div>
        ${promo ? `<div class="summary-line discount"><span>${icon('gift', { size: 14 })} ${escapeHtml(promo.name)}</span><b>− ${formatPrice(promo.amount)}</b></div>` : ''}
        ${discount ? `<div class="summary-line discount"><span>${icon('ticket', { size: 14 })} Giảm giá voucher</span><b>− ${formatPrice(discount)}</b></div>` : ''}
        <div class="summary-line"><span>Phí vận chuyển</span><b>${fee ? formatPrice(fee) : 'Miễn phí'}</b></div>
        ${shippingDiscount ? `<div class="summary-line discount"><span>${icon('ticket', { size: 14 })} Giảm phí vận chuyển</span><b>− ${formatPrice(shippingDiscount)}</b></div>` : ''}
        <div class="summary-total"><span>Tổng thanh toán</span><b>${formatPrice(total)}</b></div>
        ${goods > RULES.highValueFrom ? `<p class="notice">Đơn có tiền hàng trên ${formatPrice(RULES.highValueFrom)} cần chuyển khoản QR. Tiền về là đơn được <b>xác nhận tự động</b>, không cần nhập mã.</p>` : ''}
        ${field('paymentMethod').value === 'cod' && total > RULES.maxCodTotal ? `<p class="notice danger">Đơn trên ${formatPrice(RULES.maxCodTotal)} không áp dụng COD, hãy chọn chuyển khoản.</p>` : ''}`;
}

// Voucher
const voucherText = (voucher) =>
    (voucher.kind === 'shipping' ? 'Giảm phí vận chuyển' : 'Giảm đơn hàng') +
    ` ${voucher.type === 'percent' ? `${voucher.value}% (tối đa ${formatPrice(voucher.maxDiscount)})` : formatPrice(voucher.value)}` +
    (voucher.minOrder ? ` · đơn từ ${formatPrice(voucher.minOrder)}` : '');

function renderVouchers() {
    if (!wallet.length) {
        voucherList.innerHTML = '<p class="muted">Bạn chưa có voucher nào dùng được. Nhập mã ở trên hoặc nhận thêm ở Kho voucher.</p>';
        return;
    }
    voucherList.innerHTML = wallet
        .map(
            (row) => `
        <label class="voucher-card${row.usable ? '' : ' disabled'}${selectedVouchers.has(row.id) ? ' selected' : ''}">
            <input type="checkbox" value="${row.id}" ${selectedVouchers.has(row.id) ? 'checked' : ''} ${row.usable ? '' : 'disabled'}>
            <span class="voucher-ico">${icon('ticket', { size: 22 })}</span>
            <span class="voucher-body">
                <b>${escapeHtml(row.name)}</b>
                <small>${escapeHtml(voucherText(row))}</small>
                <small>HSD ${formatDate(row.expiresAt)}</small>
                ${row.usable ? `<em>Tiết kiệm ${formatPrice(row.amount)}</em>` : `<em class="why">${escapeHtml(row.reason)}</em>`}
            </span>
        </label>`
        )
        .join('');
}

// Hỏi server tính lại giá theo địa chỉ/vận chuyển/voucher đang chọn. Gọi lại mỗi khi các yếu tố đó đổi.
let quoteSeq = 0;
async function refreshQuote() {
    const seq = (quoteSeq += 1);
    try {
        const result = await api.post('/orders/quote', {
            items: items.map(({ id, qty }) => ({ id, qty })),
            shippingMethod: field('shippingMethod').value,
            voucherIds: [...selectedVouchers]
        });
        if (seq !== quoteSeq) return null; // đã có lần hỏi mới hơn
        quote = result;
        wallet = result.wallet;
        // Lần đầu: tự chọn voucher có lợi nhất cho mỗi loại (giống TikTok); khách có thể bỏ chọn.
        if (firstQuote) {
            firstQuote = false;
            ['order', 'shipping'].forEach((kind) => {
                const best = wallet.filter((row) => row.kind === kind && row.usable).sort((a, b) => b.amount - a.amount)[0];
                if (best) selectedVouchers.add(best.id);
            });
            if (selectedVouchers.size) return refreshQuote();
        }
        // Voucher bị server loại (hết hạn, không đủ điều kiện...) thì bỏ chọn và báo lý do.
        result.problems.forEach((problem) => {
            selectedVouchers.delete(problem.id);
            voucherMessage.textContent = problem.reason;
        });
    } catch (error) {
        if (seq !== quoteSeq) return null;
        toast(error.message, { type: 'error' });
    }
    renderVouchers();
    renderSummary();
    return quote;
}

voucherList.addEventListener('change', (event) => {
    const box = event.target.closest('input[type="checkbox"]');
    if (!box) return;
    voucherMessage.textContent = '';
    const row = wallet.find((item) => item.id === box.value);
    if (box.checked) {
        // Mỗi loại chỉ chọn 1 voucher: chọn cái mới thì bỏ cái cũ cùng loại.
        wallet.filter((item) => item.kind === row.kind).forEach((item) => selectedVouchers.delete(item.id));
        selectedVouchers.add(row.id);
    } else {
        selectedVouchers.delete(row.id);
    }
    refreshQuote();
});

document.querySelector('#applyVoucherBtn').addEventListener('click', async () => {
    const code = document.querySelector('#voucherCode').value.trim();
    voucherMessage.textContent = '';
    if (!code) {
        voucherMessage.textContent = 'Vui lòng nhập mã voucher.';
        return;
    }
    try {
        const entry = await api.post('/vouchers/claim', { code });
        document.querySelector('#voucherCode').value = '';
        selectedVouchers.add(entry.id);
        toast(`Đã nhận voucher “${entry.voucher.name}”.`, { type: 'success' });
        await refreshQuote();
        // Nếu voucher vừa nhận không dùng được cho đơn này, refreshQuote đã bỏ chọn và ghi lý do.
    } catch (error) {
        voucherMessage.textContent = error.message;
    }
});

// Địa chỉ
function renderAddresses() {
    if (!addresses.some((item) => item.id === selectedId)) {
        selectedId = (addresses.find((item) => item.isDefault) || addresses[0])?.id ?? null;
    }
    addressList.innerHTML = addresses.length
        ? addresses
              .map(
                  (item) => `
        <div class="option-card address-card" data-id="${item.id}">
            <input type="radio" name="addressId" value="${item.id}" ${item.id === selectedId ? 'checked' : ''}>
            <span>
                <b>${escapeHtml(item.fullName)} · ${escapeHtml(item.phone)} ${item.isDefault ? '<em class="tag tag-praise">Mặc định</em>' : ''}</b>
                <small>${escapeHtml(item.address)}</small>
                <span class="address-actions">
                    ${iconButton('edit', 'Sửa địa chỉ', { attrs: { 'data-action': 'edit' } })}
                    ${item.isDefault ? '' : iconButton('star', 'Đặt làm mặc định', { attrs: { 'data-action': 'default' } })}
                    ${iconButton('trash', 'Xóa địa chỉ', { tone: 'danger', attrs: { 'data-action': 'delete' } })}
                </span>
            </span>
        </div>`
              )
              .join('')
        : '<p class="muted">Bạn chưa có địa chỉ nào. Hãy thêm địa chỉ nhận hàng.</p>';
}

function openAddressForm(entry) {
    editingId = entry?.id ?? null;
    document.querySelector('#addressFormTitle').textContent = entry ? 'Sửa địa chỉ' : 'Địa chỉ mới';
    input('name').value = entry?.fullName ?? '';
    input('phone').value = entry?.phone ?? '';
    input('address').value = entry?.address ?? '';
    input('isDefault').checked = entry?.isDefault ?? addresses.length === 0;
    addressMessage.textContent = '';
    addressForm.classList.remove('hidden');
    input('name').focus();
}

const closeAddressForm = () => addressForm.classList.add('hidden');

document.querySelector('#addAddressBtn').addEventListener('click', () => openAddressForm());
document.querySelector('#cancelAddressBtn').addEventListener('click', closeAddressForm);

document.querySelector('#saveAddressBtn').addEventListener('click', async () => {
    const data = {
        fullName: input('name').value.trim(),
        phone: input('phone').value.trim(),
        address: input('address').value.trim(),
        isDefault: input('isDefault').checked
    };
    try {
        addresses = editingId ? await api.put(`/addresses/${editingId}`, data) : await api.post('/addresses', data);
        if (!editingId) selectedId = addresses[addresses.length - 1].id;
        closeAddressForm();
        renderAddresses();
    } catch (error) {
        addressMessage.textContent = error.message;
    }
});

addressList.addEventListener('click', async (event) => {
    const card = event.target.closest('.address-card');
    if (!card) return;
    const id = card.dataset.id;
    const action = event.target.closest('[data-action]')?.dataset.action;
    try {
        if (action === 'edit') openAddressForm(addresses.find((item) => item.id === id));
        else if (action === 'default') {
            const entry = addresses.find((item) => item.id === id);
            addresses = await api.put(`/addresses/${id}`, { ...entry, isDefault: true });
            renderAddresses();
        } else if (action === 'delete') {
            if (!(await confirmDialog({ title: 'Xóa địa chỉ này?', confirmText: 'Xóa', tone: 'danger' }))) return;
            addresses = await api.delete(`/addresses/${id}`);
            renderAddresses();
        } else if (event.target.name === 'addressId') selectedId = id;
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

form.addEventListener('change', (event) => {
    if (event.target.name === 'shippingMethod')
        refreshQuote(); // phí ship đổi kéo theo voucher vận chuyển
    else if (event.target.name === 'paymentMethod') renderSummary();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!selectedId) {
        toast('Vui lòng chọn hoặc thêm địa chỉ nhận hàng.', { type: 'error' });
        return;
    }

    submitButton.disabled = true;
    const fresh = await refreshQuote(); // luôn chốt theo giá mới nhất của server trước khi đặt
    submitButton.disabled = false;
    if (!fresh) return;

    const { goods, total } = fresh;
    if (field('paymentMethod').value === 'cod' && total > RULES.maxCodTotal) {
        toast(`Đơn trên ${formatPrice(RULES.maxCodTotal)} không áp dụng COD. Vui lòng chọn chuyển khoản.`, { type: 'error' });
        return;
    }
    if (goods > RULES.highValueFrom) {
        const address = addresses.find((item) => item.id === selectedId);
        const agreed = await confirmDialog({
            title: 'Xác nhận đặt đơn giá trị lớn',
            message: `Đơn có giá trị hàng trên ${formatPrice(RULES.highValueFrom)} cần chuyển khoản QR trong ${RULES.paymentMinutes} phút. Tiền về là đơn được xác nhận tự động và hóa đơn được gửi tới email của bạn.`,
            rows: [
                ['Tổng thanh toán', formatPrice(total), true],
                ['Số sản phẩm', `${items.reduce((sum, item) => sum + item.qty, 0)} (${items.length} loại)`],
                ['Người nhận', `${address.fullName} · ${address.phone}`],
                ['Địa chỉ', address.address],
                ['Thanh toán', field('paymentMethod').value === 'cod' ? 'Khi nhận hàng (COD)' : 'Chuyển khoản QR (SePay)'],
                ['Email nhận hóa đơn', field('email').value]
            ],
            confirmText: 'Đặt hàng & thanh toán',
            cancelText: 'Kiểm tra lại'
        });
        if (!agreed) return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Đang tạo đơn hàng...';
    try {
        const order = await api.post('/orders', {
            items: items.map(({ id, qty }) => ({ id, qty })),
            addressId: selectedId,
            note: field('note').value.trim(),
            shippingMethod: field('shippingMethod').value,
            paymentMethod: field('paymentMethod').value,
            voucherIds: [...selectedVouchers]
        });
        clearCart();
        updateCartBadge();
        window.location.assign(`./order-success.html?code=${encodeURIComponent(order.code)}`);
    } catch (error) {
        toast(error.message, { type: 'error' });
        if (error.data?.voucherId) {
            selectedVouchers.delete(error.data.voucherId);
            refreshQuote();
        }
        submitButton.disabled = false;
        submitButton.textContent = 'Xác nhận đặt hàng';
    }
});

async function initialize() {
    const user = requireCustomer();
    if (!user) return;

    await cartReady;
    const cart = getCart();
    if (!cart.length) {
        window.location.replace('./cart.html');
        return;
    }

    try {
        const [products, book] = await Promise.all([api.get('/products'), api.get('/addresses')]);
        addresses = book;
        items = cart
            .map((entry) => {
                const product = products.find((item) => String(item.id) === entry.id);
                return product ? { ...product, id: String(product.id), qty: entry.qty } : null;
            })
            .filter(Boolean);

        const problem = items.find((item) => item.stock < item.qty);
        if (!items.length || problem) {
            await infoDialog(
                'Cần điều chỉnh giỏ hàng',
                problem
                    ? `“${problem.name}” chỉ còn ${problem.stock} sản phẩm. Vui lòng điều chỉnh giỏ hàng.`
                    : 'Giỏ hàng không còn sản phẩm hợp lệ.'
            );
            window.location.replace('./cart.html');
            return;
        }

        field('email').value = user.email;
        renderAddresses();
        renderSummary();
        await refreshQuote();
        trackCheckoutStart();
        if (!addresses.length) openAddressForm();
    } catch (error) {
        toast(error.message, { type: 'error' });
        submitButton.disabled = true;
    }
}

initialize();
