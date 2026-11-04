import { api } from '../services/api-service.js';
import { addToCart } from '../services/cart-service.js';
import { isFavorite } from '../services/favorite-service.js';
import { trackAddToCart } from '../services/tracker.js';
import { bindAddToCart, discountPercent, priceBlock, productBadges, ratingStars, renderProductCard } from '../components/product-card.js';
import { updateCartBadge } from '../components/header.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { RULES, SHOP } from '../config/shop.js';
import { icon } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { confirmDialog, notifyError, toast } from '../components/notify.js';

const MAX_LINE_QUANTITY = 20;
const productId = new URLSearchParams(window.location.search).get('id');
const user = getCurrentUser();
const admin = isManagementRole(user);

const REVIEW_NOTICES = {
    login: 'Đăng nhập để viết đánh giá.',
    admin: '',
    not_purchased: 'Chỉ khách đã nhận hàng mới có thể đánh giá sản phẩm này.',
    reviewed: 'Bạn đã đánh giá sản phẩm này.'
};

let product = null;
let reviews = [];
let related = [];

const stars = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);
const $ = (selector) => document.querySelector(selector);

// Thông số hiển thị theo danh mục (cây để bàn, phong thủy, sen đá, chậu...), chỉ hiện trường đã có giá trị.
function renderSpecs(category) {
    const rows = (category.specFields || []).filter(({ key }) => product.specs?.[key]);
    if (!rows.length) return '<p class="muted">Sản phẩm chưa có thông số chi tiết.</p>';
    return `<dl class="specs">${rows.map(({ key, label }) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(product.specs[key])}</dd></div>`).join('')}</dl>`;
}

// "Ánh sáng: Chịu bóng" -> chip có icon mặt trời; "Tưới nước: 1 lần/tuần" -> chip giọt nước.
function quickCare() {
    const chips = (product.care || []).map((line) => {
        const [label, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (!value) return '';
        const name = /ánh sáng/i.test(label) ? 'sun' : /tưới/i.test(label) ? 'drop' : 'leaf';
        return `<span>${icon(name, { size: 15 })} ${escapeHtml(value)}</span>`;
    });
    if (product.specs?.size) chips.push(`<span>${icon('sprout', { size: 15 })} ${escapeHtml(product.specs.size)}</span>`);
    if (product.specs?.difficulty) chips.push(`<span>${icon('check', { size: 15 })} Chăm sóc: ${escapeHtml(product.specs.difficulty.toLowerCase())}</span>`);
    return chips.filter(Boolean).length ? `<div class="quick-care">${chips.join('')}</div>` : '';
}

function renderProduct(category) {
    document.title = `${product.name} - Xanh Garden`;
    $('#breadcrumb').innerHTML = `
        <a href="./index.html">Trang chủ</a><span>›</span><a href="./products.html?category=${encodeURIComponent(category.id)}">${escapeHtml(category.name)}</a><span>›</span><span>${escapeHtml(product.name)}</span>`;

    const soldOut = product.stock <= 0;
    const maxQuantity = Math.min(product.stock, MAX_LINE_QUANTITY);
    const percent = discountPercent(product);
    $('#productDetail').innerHTML = `
        <div class="detail-image">
            <img src="${productImage(product.image)}" alt="${escapeHtml(product.name)}">
            <span class="pc-badges">${productBadges(product)}</span>
        </div>
        <div class="detail-info">
            <a class="eyebrow" href="./products.html?category=${encodeURIComponent(category.id)}">${escapeHtml(category.name)}</a>
            <h1>${escapeHtml(product.name)}</h1>
            <div class="detail-meta">
                <span id="ratingLine"></span>
                ${product.sold ? `<span>Đã bán ${product.sold}</span>` : ''}
                <span>Mã SP: ${escapeHtml(String(product.id).toUpperCase())}</span>
                <span class="stock ${soldOut ? 'out' : ''}">${soldOut ? 'Tạm hết hàng' : product.stock <= 5 ? `Chỉ còn ${product.stock} sản phẩm` : 'Còn hàng'}</span>
            </div>
            <div class="price-box">${priceBlock(product)}${percent ? `<span class="badge badge-sale">-${percent}%</span>` : ''}</div>
            <p class="detail-summary">${escapeHtml(product.description)}</p>
            ${quickCare()}
            ${admin ? '<p class="notice">Bạn đang xem bằng tài khoản quản lý (không đặt hàng được).</p>' : `
            <div class="qty-row">
                <div class="qty-stepper">
                    <button type="button" id="qtyMinus" aria-label="Giảm" ${soldOut ? 'disabled' : ''}>−</button>
                    <input type="number" id="qty" value="1" min="1" max="${maxQuantity}" aria-label="Số lượng" ${soldOut ? 'disabled' : ''}>
                    <button type="button" id="qtyPlus" aria-label="Tăng" ${soldOut ? 'disabled' : ''}>+</button>
                </div>
                <button type="button" class="btn btn-outline" id="addBtn" ${soldOut ? 'disabled' : ''}>${icon('cart', { size: 18 })} Thêm vào giỏ</button>
                <button type="button" class="btn btn-accent" id="buyNowBtn" ${soldOut ? 'disabled' : ''}>Mua ngay</button>
            </div>
            <button type="button" class="detail-fav${isFavorite(product.id) ? ' on' : ''}" data-fav="${escapeHtml(product.id)}">${icon('heart', { size: 18 })} Thêm vào yêu thích</button>`}
            ${product.newPromoPercent ? `<p class="notice">Ưu đãi sản phẩm mới: giảm ${product.newPromoPercent}% khi thanh toán (tự áp dụng).</p>` : ''}
            <div class="policy-box">
                <div>${icon('truck', { size: 22 })}<span>Giao hàng toàn quốc · <b>Miễn phí</b> cho đơn từ ${formatPrice(RULES.freeShippingFrom)}</span></div>
                <div>${icon('shield', { size: 22 })}<span>Bảo hành cây ${SHOP.warrantyDays} ngày – đổi cây mới nếu hư do vận chuyển</span></div>
                <div>${icon('pay', { size: 22 })}<span>Thanh toán khi nhận hàng (COD) hoặc chuyển khoản VietQR</span></div>
            </div>
        </div>`;

    $('#descPanel').innerHTML = `
        ${product.specs?.meaning ? `<p><b>Ý nghĩa:</b> ${escapeHtml(product.specs.meaning)}${product.specs.placement ? `. <b>Vị trí đặt gợi ý:</b> ${escapeHtml(product.specs.placement)}` : ''}.</p>` : ''}
        ${product.care?.length ? `<h3>Hướng dẫn chăm sóc</h3><ul class="care">${product.care.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        ${product.specs?.pet ? `<p class="notice">Lưu ý thú cưng: ${escapeHtml(product.specs.pet)}</p>` : ''}
        <p class="muted detail-note">Cây là sản phẩm sống: kích thước, màu lá thực tế có thể chênh nhẹ so với ảnh. Xem thêm <a href="./info.html?page=cham-soc">Cẩm nang chăm cây</a>.</p>`;
    $('#specPanel').innerHTML = renderSpecs(category);

    if (admin) return;

    const input = $('#qty');
    const readQuantity = () => {
        const value = Math.min(maxQuantity, Math.max(1, Number.parseInt(input.value, 10) || 1));
        input.value = value;
        return value;
    };
    $('#qtyMinus').addEventListener('click', () => { input.value = Number(input.value) - 1; readQuantity(); });
    $('#qtyPlus').addEventListener('click', () => { input.value = Number(input.value) + 1; readQuantity(); });
    input.addEventListener('change', readQuantity);

    const addCurrent = () => {
        const quantity = readQuantity();
        const result = addToCart(product.id, quantity, maxQuantity);
        updateCartBadge();
        if (!result.limited) trackAddToCart(product.id, quantity);
        return { quantity, result };
    };

    $('#addBtn').addEventListener('click', () => {
        const { quantity, result } = addCurrent();
        if (result.limited) {
            toast(`Giỏ hàng đã đạt mức tối đa ${maxQuantity} sản phẩm cho “${product.name}”.`, { type: 'warning', title: 'Đã đạt giới hạn' });
        } else {
            toast(`Đã thêm ${quantity} × “${product.name}” vào giỏ hàng.`, { type: 'success', title: 'Thêm vào giỏ thành công', action: { label: 'Xem giỏ hàng →', href: './cart.html' } });
        }
    });
    $('#buyNowBtn').addEventListener('click', () => {
        addCurrent();
        window.location.assign('./cart.html');
    });
}

function renderReviews() {
    const average = reviews.length ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length : 0;

    $('#ratingLine').innerHTML = reviews.length
        ? `${ratingStars(average)} <a href="#detailTabs" data-open-reviews>${average.toFixed(1)} (${reviews.length} đánh giá)</a>`
        : '<span>Chưa có đánh giá</span>';
    $('#reviewTabBtn').textContent = `Đánh giá (${reviews.length})`;

    $('#reviewSummary').innerHTML = reviews.length ? `
        <div class="review-score"><b>${average.toFixed(1)}</b><span class="stars">${stars(Math.round(average))}</span><small>${reviews.length} đánh giá</small></div>
        <div class="review-bars">${[5, 4, 3, 2, 1].map((star) => {
            const count = reviews.filter((review) => review.rating === star).length;
            return `<div><span>${star} sao</span><div class="bar"><i style="width:${(count / reviews.length) * 100}%"></i></div><span>${count}</span></div>`;
        }).join('')}</div>` : '';

    $('#reviewList').innerHTML = reviews.length
        ? reviews.map((review) => `
            <article class="review-item">
                <div class="review-head">
                    <b>${escapeHtml(review.userName)}</b>
                    <span class="stars">${stars(review.rating)}</span>
                    <small class="muted">${formatDate(review.createdAt)}</small>
                    ${admin || review.userId === user?.id
                        ? `<button class="btn btn-sm btn-danger" data-delete-review="${review.id}">Xóa</button>` : ''}
                </div>
                <p>${escapeHtml(review.comment)}</p>
                ${review.media?.length ? `<div class="review-media">${review.media.map((item) => item.type === 'video'
                    ? `<video controls preload="metadata" src="${escapeHtml(item.url)}"></video>`
                    : `<button type="button" class="media-thumb" data-full="${escapeHtml(item.url)}"><img src="${escapeHtml(item.url)}" alt="Ảnh đánh giá" loading="lazy"></button>`).join('')}</div>` : ''}
            </article>`).join('')
        : '<p class="empty">Chưa có đánh giá nào.</p>';
}

const MAX_IMAGES = 5;
const MAX_VIDEOS = 1;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

// Thu nhỏ ảnh lớn (tối đa 1600px) trước khi gửi để tải nhanh và tiết kiệm dung lượng.
async function shrinkImage(file) {
    if (file.type === 'image/gif' || file.size < 600 * 1024) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        return blob && blob.size < file.size ? blob : file;
    } catch {
        return file;
    }
}

function openLightbox(source) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay lightbox';
    overlay.innerHTML = `<img src="${escapeHtml(source)}" alt="Ảnh đánh giá phóng to">`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
}

async function setupReviewForm() {
    const form = $('#reviewForm');
    const { canReview, reason } = await api.get(`/products/${product.id}/review-status`);
    $('#reviewNotice').innerHTML = canReview ? '' : (REVIEW_NOTICES[reason] || '').replace('Đăng nhập', '<a href="./login.html">Đăng nhập</a>');
    if (!canReview) return;

    form.classList.remove('hidden');
    let rating = 5;
    const buttons = [...form.querySelectorAll('[data-star]')];
    const paint = () => buttons.forEach((button) => button.classList.toggle('on', Number(button.dataset.star) <= rating));
    paint();
    $('#starInput').addEventListener('click', (event) => {
        const button = event.target.closest('[data-star]');
        if (!button) return;
        rating = Number(button.dataset.star);
        paint();
    });

    // ----- Ảnh/video đính kèm: tải lên ngay khi chọn, hiện xem trước và trạng thái từng tệp -----
    const attachments = [];
    let nextAttachment = 0;
    const mediaInput = $('#mediaInput');
    const mediaPreview = $('#mediaPreview');

    const renderMedia = () => {
        mediaPreview.innerHTML = attachments.map((item) => `
            <div class="media-item ${item.state}" data-id="${item.id}">
                ${item.kind === 'image' ? `<img src="${item.previewUrl}" alt="">` : `<video src="${item.previewUrl}" muted preload="metadata"></video><span class="media-play">▶</span>`}
                ${item.state === 'uploading' ? '<span class="media-state">Đang tải…</span>' : item.state === 'error' ? '<span class="media-state bad">Lỗi</span>' : ''}
                <button type="button" class="media-remove" data-remove="${item.id}" aria-label="Bỏ tệp này">×</button>
            </div>`).join('');
    };

    const addFiles = async (files) => {
        for (const file of files) {
            const kind = IMAGE_TYPES.includes(file.type) ? 'image' : VIDEO_TYPES.includes(file.type) ? 'video' : null;
            if (!kind) { toast(`“${file.name}” không phải ảnh (JPG, PNG, WebP, GIF) hoặc video (MP4, WebM).`, { type: 'warning' }); continue; }
            if (attachments.filter((item) => item.kind === kind).length >= (kind === 'image' ? MAX_IMAGES : MAX_VIDEOS)) {
                toast(kind === 'image' ? `Chỉ được đính kèm tối đa ${MAX_IMAGES} ảnh.` : `Chỉ được đính kèm tối đa ${MAX_VIDEOS} video.`, { type: 'warning' });
                continue;
            }
            const blob = kind === 'image' ? await shrinkImage(file) : file;
            if (blob.size > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) {
                toast(`“${file.name}” quá lớn (${kind === 'image' ? 'ảnh tối đa 5 MB' : 'video tối đa 25 MB'}).`, { type: 'warning' });
                continue;
            }
            const item = { id: ++nextAttachment, kind, previewUrl: URL.createObjectURL(blob), state: 'uploading', uploadId: null };
            attachments.push(item);
            renderMedia();
            api.upload('/uploads/reviews', blob)
                .then((result) => { item.uploadId = result.id; item.state = 'done'; })
                .catch((error) => { item.state = 'error'; toast(error.message, { type: 'error' }); })
                .finally(renderMedia);
        }
    };

    mediaInput.addEventListener('change', async () => {
        const files = [...mediaInput.files];
        mediaInput.value = '';
        await addFiles(files);
    });
    mediaPreview.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove]');
        if (!button) return;
        const index = attachments.findIndex((item) => item.id === Number(button.dataset.remove));
        if (index >= 0) URL.revokeObjectURL(attachments.splice(index, 1)[0].previewUrl);
        renderMedia();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = $('#reviewMessage');
        if (attachments.some((item) => item.state === 'uploading')) { message.textContent = 'Ảnh/video đang được tải lên, vui lòng đợi một chút.'; return; }
        if (attachments.some((item) => item.state === 'error')) { message.textContent = 'Có tệp tải lên bị lỗi. Hãy bỏ tệp đó (bấm ×) rồi gửi lại.'; return; }
        message.textContent = '';
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            const saved = await api.post('/reviews', {
                productId: product.id,
                rating,
                comment: form.elements.namedItem('comment').value,
                media: attachments.map((item) => item.uploadId)
            });
            reviews.unshift(saved);
            form.classList.add('hidden');
            $('#reviewNotice').textContent = 'Cảm ơn bạn đã đánh giá.';
            renderReviews();
        } catch (error) {
            message.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    });
}

$('#reviewList').addEventListener('click', async (event) => {
    const thumb = event.target.closest('.media-thumb');
    if (thumb) return openLightbox(thumb.dataset.full);
    const button = event.target.closest('[data-delete-review]');
    if (!button || !await confirmDialog({ title: 'Xóa đánh giá?', message: 'Đánh giá này sẽ bị xóa vĩnh viễn.', confirmText: 'Xóa', tone: 'danger' })) return;

    try {
        await api.delete(`/reviews/${button.dataset.deleteReview}`);
        window.location.reload();
    } catch (error) {
        notifyError(error);
    }
});

// Tab Mô tả / Thông số / Đánh giá.
function openTab(name) {
    document.querySelectorAll('.detail-tab-buttons [data-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === name);
        button.setAttribute('aria-selected', String(button.dataset.tab === name));
    });
    document.querySelectorAll('#detailTabs [data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
}
$('#detailTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) openTab(button.dataset.tab);
});
$('#productDetail').addEventListener('click', (event) => {
    if (!event.target.closest('[data-open-reviews]')) return;
    event.preventDefault();
    openTab('reviews');
    $('#detailTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Gắn 1 lần: phần sản phẩm tương tự có thể được vẽ lại khi dữ liệu mới về
bindAddToCart($('#relatedList'), () => related);

async function initialize() {
    try {
        if (!productId) throw new Error('Thiếu mã sản phẩm.');

        const id = encodeURIComponent(productId);
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load([`/products/${id}`, '/categories', `/products/${id}/reviews`, '/products'], (productData, categories, reviewData, allProducts) => {
            product = productData;
            reviews = reviewData;
            const category = categories.find((item) => String(item.id) === String(product.categoryId));
            // Sản phẩm tương tự: cùng danh mục trước, thiếu thì bổ sung sản phẩm còn hàng khác.
            const others = allProducts.filter((item) => item.id !== product.id && item.stock > 0);
            related = [...others.filter((item) => String(item.categoryId) === String(product.categoryId)),
                ...others.filter((item) => String(item.categoryId) !== String(product.categoryId))].slice(0, 4);

            renderProduct(category || { id: '', name: 'Khác' });
            renderReviews();
            $('#detailTabs').classList.remove('hidden');
            if (window.location.hash === '#reviews') openTab('reviews');
            $('#relatedList').innerHTML = related.map(renderProductCard).join('');
            $('#relatedSection').classList.toggle('hidden', !related.length);
            // Ẩn "Đang tải" ngay khi đã vẽ, không đợi phần đánh giá bên dưới
            $('#loading').classList.add('hidden');
        });
        await setupReviewForm();
    } catch (error) {
        $('#error').textContent = error.message;
        $('#error').classList.remove('hidden');
    } finally {
        $('#loading').classList.add('hidden');
    }
}

initialize();
