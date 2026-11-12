import { addToCart } from '../services/cart-service.js';
import { isFavorite } from '../services/favorite-service.js';
import { trackAddToCart } from '../services/tracker.js';
import { updateCartBadge } from './header.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatPrice } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { toast } from './notify.js';

// Phần trăm giảm khi sản phẩm có giá gốc (oldPrice) cao hơn giá bán.
export const discountPercent = (product) =>
    product.oldPrice > product.price ? Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100) : 0;

// Chữ "Hết hàng" đè lên giữa ảnh sản phẩm.
export const soldOutMark = (product) => (product.stock <= 0 ? '<span class="soldout-mark">Hết hàng</span>' : '');

// Nhãn trên ảnh: % giảm / bán chạy tháng này / mới / mới về (server tính isNew, restocked, soldMonth). Hết hàng thì không hiện nhãn nào.
export function productBadges(product) {
    if (product.stock <= 0) return '';
    const badges = [];
    const percent = discountPercent(product);
    if (percent) badges.push(`<span class="badge badge-sale">-${percent}%</span>`);
    if (product.source === 'month' && product.soldMonth > 0) badges.push('<span class="badge badge-hot">Bán chạy</span>');
    if (product.newPromoPercent) badges.push(`<span class="badge badge-sale">Mới -${product.newPromoPercent}%</span>`);
    else if (product.isNew) badges.push('<span class="badge badge-new">Mới</span>');
    else if (product.restocked) badges.push('<span class="badge badge-restock">Mới về</span>');
    return badges.join('');
}

// Sao đánh giá (tô theo điểm trung bình).
export const ratingStars = (rating) =>
    `<span class="rate" aria-label="${rating} trên 5 sao"><span class="rate-fill" style="width:${Math.max(0, Math.min(100, (rating / 5) * 100))}%">★★★★★</span>★★★★★</span>`;

export function priceBlock(product) {
    return `<span class="price">${formatPrice(product.price)}</span>${product.oldPrice > product.price ? `<s class="old-price">${formatPrice(product.oldPrice)}</s>` : ''}`;
}

export const favoriteButton = (product) =>
    isManagementRole(getCurrentUser())
        ? ''
        : `<button type="button" class="fav-btn${isFavorite(product.id) ? ' on' : ''}" data-fav="${escapeHtml(product.id)}" aria-pressed="${isFavorite(product.id)}" aria-label="Yêu thích ${escapeHtml(product.name)}" title="Thêm vào yêu thích">${icon('heart', { size: 18 })}</button>`;

// Nút thêm vào giỏ (admin không mua hàng nên không có).
export const addCartButton = (product, { compact = false } = {}) => {
    if (isManagementRole(getCurrentUser())) return '';
    const soldOut = product.stock <= 0;
    if (compact) {
        return `<button type="button" class="add-cart icon-btn icon-btn-primary" data-id="${product.id}" aria-label="${soldOut ? 'Hết hàng' : 'Thêm vào giỏ'}" title="${soldOut ? 'Hết hàng' : 'Thêm vào giỏ'}" ${soldOut ? 'disabled' : ''}>${icon(soldOut ? 'stop' : 'cart')}</button>`;
    }
    return `<button type="button" class="add-cart btn-cart" data-id="${product.id}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Hết hàng' : `${icon('cart', { size: 16 })} Thêm vào giỏ`}</button>`;
};

function metaLine(product) {
    const parts = [];
    if (product.ratingCount) parts.push(`${ratingStars(product.rating)}<small>(${product.ratingCount})</small>`);
    if (product.stock <= 0) parts.push('<small class="low">Hết hàng</small>');
    else if (product.sold) parts.push(`<small>Đã bán ${product.sold}</small>`);
    else if (product.stock <= 5) parts.push(`<small class="low">Chỉ còn ${product.stock}</small>`);
    return parts.length ? `<div class="pc-meta">${parts.join('')}</div>` : '<div class="pc-meta"></div>';
}

export function renderProductCard(product) {
    const name = escapeHtml(product.name);
    const href = `./product-detail.html?id=${encodeURIComponent(product.id)}`;
    return `
        <article class="product-card${product.stock <= 0 ? ' soldout' : ''}">
            <div class="pc-media">
                <a href="${href}" class="pc-image"><img src="${productImage(product.image)}" alt="${name}" loading="lazy"></a>
                ${soldOutMark(product)}
                <span class="pc-badges">${productBadges(product)}</span>
                ${favoriteButton(product)}
            </div>
            <div class="pc-body">
                <h3 class="pc-name"><a href="${href}" title="${name}">${name}</a></h3>
                ${metaLine(product)}
                <div class="pc-price">${priceBlock(product)}</div>
                ${addCartButton(product)}
            </div>
        </article>`;
}

// Gắn sự kiện "Thêm vào giỏ" một lần cho cả danh sách (event delegation).
export function bindAddToCart(container, getProducts) {
    container.addEventListener('click', (event) => {
        const button = event.target.closest('.add-cart');
        if (!button || button.disabled) return;

        const product = getProducts().find((item) => String(item.id) === button.dataset.id);
        if (!product) return;

        const result = addToCart(product.id, 1, Math.min(product.stock, 20));
        updateCartBadge();
        if (result.limited) {
            toast(`“${product.name}” chỉ còn ${product.stock} sản phẩm, giỏ hàng đã ở mức tối đa.`, {
                type: 'warning',
                title: 'Đã đạt giới hạn'
            });
        } else {
            trackAddToCart(product.id, 1);
            toast(`Đã thêm “${product.name}” vào giỏ hàng.`, {
                type: 'success',
                title: 'Thêm vào giỏ thành công',
                action: { label: 'Xem giỏ hàng', href: './cart.html' }
            });
        }
    });
}
