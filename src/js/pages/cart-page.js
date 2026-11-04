import { api } from '../services/api-service.js';
import { cartReady, clearCart, getCart, removeFromCart, setCartQuantity } from '../services/cart-service.js';
import { updateCartBadge } from '../components/header.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatPrice } from '../utils/format.js';
import { RULES } from '../config/shop.js';
import { icon, iconButton } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { confirmDialog, toast } from '../components/notify.js';

const MAX_LINE_QUANTITY = 20;
const cartBox = document.querySelector('#cartBox');
let productsById = new Map();

if (isManagementRole(getCurrentUser())) window.location.replace('./admin-dashboard.html');

const limitOf = (product) => Math.min(product.stock, MAX_LINE_QUANTITY);

function render() {
    // Giỏ hàng chỉ lưu id + số lượng; giá và tồn kho luôn lấy mới từ server.
    const items = getCart()
        .map((item) => ({ ...item, product: productsById.get(item.id) }))
        .filter((item) => item.product);
    updateCartBadge();

    if (!items.length) {
        cartBox.innerHTML = `
            <div class="empty-state">
                ${icon('cart', { size: 48 })}
                <h2>Giỏ hàng đang trống</h2>
                <p>Hãy chọn thêm cây xanh cho không gian của bạn.</p>
                <a class="btn" href="./products.html">Tiếp tục mua sắm</a>
            </div>`;
        return;
    }

    const subtotal = items.reduce((total, item) => total + item.product.price * item.qty, 0);
    const missing = Math.max(0, RULES.freeShippingFrom - subtotal);
    const rows = items.map(({ product, qty }) => {
        const name = escapeHtml(product.name);
        return `
        <article class="cart-row">
            <a href="./product-detail.html?id=${product.id}"><img src="${productImage(product.image)}" alt="${name}"></a>
            <div class="cart-name">
                <a href="./product-detail.html?id=${product.id}">${name}</a>
                <small>${formatPrice(product.price)}${product.oldPrice > product.price ? ` <s>${formatPrice(product.oldPrice)}</s>` : ''}</small>
                ${product.stock <= 5 ? `<small class="danger-text">Chỉ còn ${product.stock} sản phẩm</small>` : ''}
            </div>
            <div class="cart-qty">
                <button data-action="decrease" data-id="${product.id}" aria-label="Giảm số lượng" title="Giảm">${icon('minus', { size: 14 })}</button>
                <input class="cart-qty-input" type="number" min="1" max="${limitOf(product)}"
                       value="${qty}" data-id="${product.id}" aria-label="Số lượng ${name}">
                <button data-action="increase" data-id="${product.id}" aria-label="Tăng số lượng" title="Tăng"
                        ${qty >= limitOf(product) ? 'disabled' : ''}>${icon('plus', { size: 14 })}</button>
            </div>
            <div class="cart-sub">${formatPrice(product.price * qty)}</div>
            ${iconButton('trash', `Xóa ${product.name} khỏi giỏ`, { tone: 'danger', cls: 'cart-remove', attrs: { 'data-action': 'remove', 'data-id': product.id } })}
        </article>`;
    }).join('');

    cartBox.innerHTML = `
        <div class="cart-layout">
            <section>
                <div class="cart-toolbar">
                    <span>${items.length} loại sản phẩm · ${items.reduce((total, item) => total + item.qty, 0)} cái</span>
                    <button type="button" class="btn btn-sm btn-danger" id="clearCartBtn" title="Xóa toàn bộ giỏ hàng">${icon('trash', { size: 15 })} Xóa tất cả</button>
                </div>
                <div class="cart-head"><span>Sản phẩm</span><span></span><span>Số lượng</span><span>Thành tiền</span><span></span></div>
                ${rows}
                <a class="back" href="./products.html">${icon('back', { size: 16 })} Tiếp tục mua sắm</a>
            </section>
            <aside class="order-summary">
                <h2>Tóm tắt đơn hàng</h2>
                <div class="summary-line"><span>Tạm tính</span><b>${formatPrice(subtotal)}</b></div>
                <div class="summary-line"><span>Phí vận chuyển</span><span>Tính ở bước thanh toán</span></div>
                <div class="freeship">
                    ${missing ? `Mua thêm <b>${formatPrice(missing)}</b> để được <b>miễn phí vận chuyển</b>` : `${icon('check', { size: 15 })} Đơn hàng được <b>miễn phí vận chuyển</b> (giao tiêu chuẩn)`}
                    <div class="freeship-bar"><i style="width:${Math.min(100, (subtotal / RULES.freeShippingFrom) * 100)}%"></i></div>
                </div>
                <div class="summary-total"><span>Tạm tính</span><b>${formatPrice(subtotal)}</b></div>
                <button class="btn btn-block btn-lg btn-accent" id="checkoutBtn">Tiến hành đặt hàng</button>
                <p class="muted continue-link">Áp dụng mã giảm giá ở bước thanh toán</p>
            </aside>
        </div>`;
}

cartBox.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.id === 'clearCartBtn') {
        if (await confirmDialog({ title: 'Xóa toàn bộ giỏ hàng?', message: 'Tất cả sản phẩm trong giỏ sẽ bị xóa.', confirmText: 'Xóa giỏ hàng', tone: 'danger' })) {
            clearCart();
            render();
            toast('Đã xóa toàn bộ sản phẩm khỏi giỏ hàng.', { type: 'info' });
        }
        return;
    }

    if (button.id === 'checkoutBtn') {
        if (!getCurrentUser()) sessionStorage.setItem('redirectAfterLogin', 'checkout.html');
        window.location.assign(getCurrentUser() ? './checkout.html' : './login.html');
        return;
    }

    const { id, action } = button.dataset;
    const product = productsById.get(String(id));
    const item = getCart().find((entry) => entry.id === String(id));
    if (!product || !item) return;

    if (action === 'increase') setCartQuantity(id, item.qty + 1, limitOf(product));
    if (action === 'decrease') setCartQuantity(id, item.qty - 1, limitOf(product));
    if (action === 'remove') removeFromCart(id);
    render();
});

cartBox.addEventListener('change', (event) => {
    const input = event.target.closest('.cart-qty-input');
    const product = input && productsById.get(String(input.dataset.id));
    if (!product) return;
    setCartQuantity(input.dataset.id, input.value, limitOf(product));
    render();
});

async function initialize() {
    try {
        await cartReady; // giỏ lưu theo tài khoản: chờ đồng bộ với server xong rồi mới hiển thị
        const products = await api.get('/products');
        productsById = new Map(products.map((product) => [String(product.id), product]));

        // Dọn sản phẩm đã bị xóa hoặc hết hàng khỏi giỏ.
        getCart().forEach((item) => {
            const product = productsById.get(item.id);
            if (!product || product.stock <= 0) removeFromCart(item.id);
            else if (item.qty > limitOf(product)) setCartQuantity(item.id, limitOf(product), limitOf(product));
        });
        render();
    } catch (error) {
        cartBox.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    }
}

initialize();
