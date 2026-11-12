import { api } from '../services/api-service.js';
import { cachedSite, getSite } from '../services/site-service.js';
import { CATEGORY_INFO, cachedCategories } from '../services/catalog-service.js';
import { bindAddToCart, ratingStars, renderProductCard } from '../components/product-card.js';
import { escapeHtml, formatPrice } from '../utils/format.js';
import { RULES, SHOP } from '../config/shop.js';
import { icon } from '../utils/icons.js';
import { bannerImage, gardenPhoto, productImage } from '../utils/images.js';
import '../components/header.js';

const FEATURED_COUNT = 8;
const NEW_COUNT = 4;
const SLIDE_MS = 5000;
let products = [];

const $ = (selector) => document.querySelector(selector);
bindAddToCart($('#productList'), () => products);
bindAddToCart($('#newList'), () => products);

// Banner mặc định khi không có sự kiện: ảnh chụp thật tại vườn kèm lời giới thiệu.
const DEFAULT_SLIDES = [
    {
        image: gardenPhoto(5),
        eyebrow: 'Sen đá – xương rồng',
        title: 'Nhỏ xinh, ít tưới, hợp bàn làm việc và ban công',
        cta: 'Xem sen đá',
        link: './products.html?category=4'
    },
    {
        image: gardenPhoto(1),
        eyebrow: 'Giao hàng toàn quốc',
        title: `Miễn phí vận chuyển cho đơn từ ${formatPrice(RULES.freeShippingFrom)}`,
        text: `Bảo hành cây ${SHOP.warrantyDays} ngày nếu hư do vận chuyển`,
        cta: 'Mua sắm ngay',
        link: './products.html'
    },
    {
        image: gardenPhoto(7),
        eyebrow: 'Quà tặng xanh',
        title: 'Cây phong thủy, cỏ may mắn – món quà lớn lên mỗi ngày',
        cta: 'Chọn quà tặng',
        link: './products.html?category=2'
    }
];

// Banner trượt
const box = $('#heroSlider');
let items = [];
let dots = [];
let current = 0;
let timer = null;

const go = (index) => {
    current = (index + items.length) % items.length;
    items.forEach((item, position) => {
        item.classList.toggle('active', position === current);
        item.toggleAttribute('aria-hidden', position !== current);
        item.tabIndex = position === current ? 0 : -1;
    });
    dots.forEach((dot, position) => dot.classList.toggle('active', position === current));
};
const start = () => {
    clearInterval(timer);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => go(current + 1), SLIDE_MS);
};
// Gắn sự kiện 1 lần, banner vẽ lại khi có dữ liệu mới không bị gắn trùng
box.addEventListener('click', (event) => {
    const control = event.target.closest('[data-dir], [data-go]');
    if (!control) return;
    event.preventDefault();
    go(control.dataset.dir ? current + Number(control.dataset.dir) : Number(control.dataset.go));
    start();
});
box.addEventListener('mouseenter', () => clearInterval(timer));
box.addEventListener('mouseleave', start);

function renderSlider(site) {
    const eventSlides = site.banners.map((banner) => ({
        image: bannerImage(banner.image),
        eyebrow: site.event?.name || 'Ưu đãi',
        title: banner.name,
        text: site.event?.theme?.slogan || '',
        cta: 'Xem ngay',
        link: banner.link || './products.html',
        event: true
    }));
    const slides = [...eventSlides, ...DEFAULT_SLIDES];
    box.innerHTML = `
        <div class="slides">
            ${slides
                .map(
                    (slide, index) => `
                <a class="slide${index ? '' : ' active'}${slide.event ? ' slide-event' : ''}" href="${escapeHtml(slide.link)}" ${index ? 'tabindex="-1" aria-hidden="true"' : ''}>
                    <img src="${escapeHtml(slide.image)}" alt="" ${index ? 'loading="lazy"' : ''}>
                    <span class="slide-caption">
                        <small>${escapeHtml(slide.eyebrow)}</small>
                        <b>${escapeHtml(slide.title)}</b>
                        ${slide.text ? `<span>${escapeHtml(slide.text)}</span>` : ''}
                        <em class="btn btn-accent">${escapeHtml(slide.cta)}</em>
                    </span>
                </a>`
                )
                .join('')}
        </div>
        <button type="button" class="slider-arrow prev" data-dir="-1" aria-label="Banner trước">${icon('chevronLeft', { size: 22 })}</button>
        <button type="button" class="slider-arrow next" data-dir="1" aria-label="Banner sau">${icon('chevronRight', { size: 22 })}</button>
        <div class="slider-dots">${slides.map((_, index) => `<button type="button" class="${index ? '' : 'active'}" data-go="${index}" aria-label="Banner ${index + 1}"></button>`).join('')}</div>`;

    items = [...box.querySelectorAll('.slide')];
    dots = [...box.querySelectorAll('.slider-dots button')];
    current = 0;
    start();
}

// Thanh sự kiện: tên + khẩu hiệu + thời gian còn lại (không có sự kiện thì ẩn).
function renderEvent(event, banner) {
    const bar = $('#eventBar');
    bar.classList.toggle('hidden', !event);
    if (!event) return;
    const days = Math.max(0, Math.ceil((Date.parse(event.endAt) - Date.now()) / 86400000));
    bar.innerHTML = `<div class="container">
        ${icon('gift', { size: 16 })}<b>${escapeHtml(event.name)}</b>${event.theme.slogan ? `<span>${escapeHtml(event.theme.slogan)}</span>` : ''}
        <small>${icon('clock', { size: 14 })} ${days > 1 ? `Còn ${days} ngày` : 'Kết thúc hôm nay'}</small>
        ${banner?.link ? `<a class="event-link" href="${escapeHtml(banner.link)}">Xem ngay ›</a>` : ''}
    </div>`;
}

// Danh mục
// all = null khi chưa có sản phẩm: vẫn vẽ danh mục để có sẵn chỗ, số lượng để trống
function renderCategories(categories, all) {
    const count = (id) => (all ? all.filter((product) => String(product.categoryId) === String(id)).length : '');
    $('#heroCategories').innerHTML =
        categories
            .map(
                (category) => `
        <a href="./products.html?category=${encodeURIComponent(category.id)}">
            <img src="${productImage(CATEGORY_INFO[category.id]?.image)}" alt="">
            <span>${escapeHtml(category.name)}</span><small>${count(category.id)}</small>
        </a>`
            )
            .join('') + '<a href="./products.html" class="all">Xem tất cả sản phẩm ›</a>';
}

// Chọn cây theo không gian đặt cây (mỗi ô dẫn tới danh mục phù hợp).
function renderSpaces() {
    const spaces = [
        {
            title: 'Bàn làm việc, bàn học',
            text: 'Cây mini, ít tưới, không chiếm chỗ',
            link: './products.html?category=1',
            image: 'p10.png'
        },
        {
            title: 'Phòng khách & quà tặng',
            text: 'Kim tiền, kim ngân, phát tài mang ý nghĩa tài lộc',
            link: './products.html?category=2',
            image: 'p4.png'
        },
        {
            title: 'Phòng ít ánh sáng',
            text: 'Lưỡi hổ, lan ý chịu bóng, lọc không khí',
            link: './products.html?category=3',
            image: 'p6.png'
        },
        {
            title: 'Ban công nhiều nắng',
            text: 'Sen đá, xương rồng thích nắng, chịu hạn',
            link: './products.html?category=4',
            image: 'p8.png'
        }
    ];
    $('#spaceGrid').innerHTML = spaces
        .map(
            (space) => `
        <a class="space-card" href="${space.link}">
            <img src="${productImage(space.image)}" alt="" loading="lazy">
            <span><b>${space.title}</b><small>${space.text}</small><em>Xem gợi ý ›</em></span>
        </a>`
        )
        .join('');
}

function renderGallery() {
    const box = $('#gardenGallery');
    box.innerHTML = [5, 1, 7, 2, 4]
        .map(
            (index) => `
        <button type="button" class="gallery-item" data-full="${gardenPhoto(index)}" aria-label="Xem ảnh lớn">
            <img src="${gardenPhoto(index)}" alt="Ảnh thực tế cây tại vườn Xanh Garden" loading="lazy">
        </button>`
        )
        .join('');
    box.addEventListener('click', (event) => {
        const item = event.target.closest('.gallery-item');
        if (!item) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay lightbox';
        overlay.innerHTML = `<img src="${escapeHtml(item.dataset.full)}" alt="Ảnh thực tế tại vườn">`;
        const close = () => {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        };
        const onKey = (keyEvent) => {
            if (keyEvent.key === 'Escape') close();
        };
        overlay.addEventListener('click', close);
        document.addEventListener('keydown', onKey);
        document.body.append(overlay);
    });
}

function renderGuides() {
    const guides = [
        {
            page: 'cham-soc',
            icon: 'drop',
            title: 'Tưới cây thế nào cho đúng?',
            text: 'Ánh sáng, tưới nước, đất và bón phân cho cây trồng chậu.'
        },
        { page: 'chon-cay', icon: 'sprout', title: 'Chọn cây theo nhu cầu', text: 'Theo chỗ đặt, ánh sáng, mức bận rộn và ngân sách.' },
        {
            page: 'doi-tra',
            icon: 'shield',
            title: 'Bảo hành & đổi trả',
            text: `Bảo hành ${SHOP.warrantyDays} ngày nếu cây hư do vận chuyển.`
        },
        {
            page: 'mua-hang',
            icon: 'truck',
            title: 'Vận chuyển & thanh toán',
            text: `Phí ship, freeship từ ${formatPrice(RULES.freeShippingFrom)}, COD và VietQR.`
        }
    ];
    $('#guideGrid').innerHTML = guides
        .map(
            (guide) => `
        <a class="guide-card" href="./info.html?page=${guide.page}">
            <span class="guide-icon">${icon(guide.icon, { size: 26 })}</span>
            <b>${guide.title}</b><small>${guide.text}</small><em>Đọc thêm ›</em>
        </a>`
        )
        .join('');
}

// Không có đánh giá thì ẩn mục này
function renderTestimonials(reviews) {
    $('#reviewSection').classList.toggle('hidden', !reviews.length);
    $('#testimonials').innerHTML = reviews
        .map(
            (review) => `
        <figure class="testimonial">
            ${ratingStars(review.rating)}
            <blockquote>“${escapeHtml(review.comment)}”</blockquote>
            <figcaption>
                <img src="${escapeHtml(review.photo || productImage(review.productImage))}" alt="" loading="lazy">
                <span><b>${escapeHtml(review.userName)}</b><small>Đã mua <a href="./product-detail.html?id=${encodeURIComponent(review.productId)}">${escapeHtml(review.productName)}</a> · ${new Date(review.createdAt).toLocaleDateString('vi-VN')}</small></span>
            </figcaption>
        </figure>`
        )
        .join('');
}

function showSite(site) {
    renderSlider(site);
    renderEvent(site.event, site.banners[0]);
}

async function initialize() {
    // Banner + thanh sự kiện: vẽ ngay bằng bản đã nhớ, bản mới từ server khác thì vẽ lại
    const savedSite = cachedSite();
    if (savedSite) showSite(savedSite);
    getSite().then((site) => {
        if (JSON.stringify(site) !== JSON.stringify(savedSite)) showSite(site);
    });
    // Danh mục đã nhớ (dùng chung với menu) vẽ ngay để các mục bên dưới không bị đẩy xuống
    const savedCategories = cachedCategories();
    if (savedCategories) renderCategories(savedCategories, null);
    renderSpaces();
    renderGallery();
    renderGuides();
    api.load('/reviews/latest?limit=3', renderTestimonials).catch(() => {});
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        const paths = ['/categories', '/products', `/products/featured?limit=${FEATURED_COUNT}`, `/products/new?limit=${NEW_COUNT}`];
        await api.load(paths, (categories, all, featured, fresh) => {
            products = [...featured, ...fresh];
            renderCategories(categories, all);
            $('#featuredTitle').textContent = `Bán chạy tháng ${new Date().getMonth() + 1}`;
            $('#productList').innerHTML = featured.map(renderProductCard).join('');
            $('#newList').innerHTML = fresh.map(renderProductCard).join('');
            $('#newSection').classList.toggle('hidden', !fresh.length);
            $('#loading').classList.add('hidden');
        });
    } catch (error) {
        $('#error').textContent = error.message;
        $('#error').classList.remove('hidden');
    } finally {
        $('#loading').classList.add('hidden');
    }
}

initialize();
