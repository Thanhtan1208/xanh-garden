import { api } from '../services/api-service.js';
import { CATEGORY_INFO, cachedCategories } from '../services/catalog-service.js';
import {
    addCartButton,
    bindAddToCart,
    discountPercent,
    favoriteButton,
    priceBlock,
    productBadges,
    renderProductCard,
    soldOutMark
} from '../components/product-card.js';
import '../components/header.js';
import { escapeHtml } from '../utils/format.js';
import { icon, iconButton } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { trackFilter, trackSearch } from '../services/tracker.js';

const PAGE_SIZE = 12;
const params = new URLSearchParams(window.location.search);
const SORTS = ['', 'best', 'newest', 'asc', 'desc', 'name'];
const state = {
    categoryId: params.get('category') || '',
    search: params.get('q') || '',
    price: '',
    sort: SORTS.includes(params.get('sort')) ? params.get('sort') : '',
    inStock: false,
    sale: false,
    view: 'grid',
    page: 1
};

let categories = [];
let products = [];

const $ = (selector) => document.querySelector(selector);
const productList = $('#productList');
const searchInput = $('#searchInput');
const viewToggle = $('#viewToggle');

bindAddToCart(productList, () => products);
searchInput.value = state.search;
$('#sortSelect').value = state.sort;

// Tìm không phân biệt dấu: "kim tien" vẫn ra "Kim tiền".
const plain = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd');

// Điện thoại: khối bộ lọc thu gọn, bấm "Bộ lọc" mới mở.
const filterToggle = $('#filterToggle');
filterToggle.insertAdjacentHTML('afterbegin', icon('list', { size: 15 }));
filterToggle.addEventListener('click', () => {
    const open = $('#shopSidebar').classList.toggle('open');
    filterToggle.setAttribute('aria-expanded', String(open));
});

function renderViewToggle() {
    viewToggle.innerHTML = [
        ['grid', 'grid', 'Xem dạng lưới'],
        ['list', 'list', 'Xem dạng danh sách']
    ]
        .map(([view, name, label]) =>
            iconButton(name, label, {
                cls: state.view === view ? 'active' : '',
                attrs: { 'data-view': view, 'aria-pressed': state.view === view }
            })
        )
        .join('');
}
renderViewToggle();

const arrivalTime = (product) => Date.parse(product.lastImportedAt || product.createdAt || 0) || 0;
const categoryOf = (id) => categories.find((item) => String(item.id) === String(id));

// Chưa có sản phẩm thì để trống số đếm (danh mục vẫn hiện đủ để cột trái không bị nhảy)
function renderCategories() {
    $('#categoryList').innerHTML = [{ id: '', name: 'Tất cả sản phẩm' }, ...categories]
        .map((category) => {
            const count = category.id
                ? products.filter((product) => String(product.categoryId) === String(category.id)).length
                : products.length;
            return `<button type="button" class="side-item${String(category.id) === state.categoryId ? ' active' : ''}" data-category="${escapeHtml(category.id)}">
                <span>${escapeHtml(category.name)}</span><small>${products.length ? count : ''}</small>
            </button>`;
        })
        .join('');
}

// Tiêu đề, mô tả ngắn và đường dẫn theo danh mục / từ khóa đang xem.
function renderHeading() {
    const category = categoryOf(state.categoryId);
    const title = category ? category.name : 'Tất cả sản phẩm';
    $('#shopTitle').textContent = title;
    $('#shopIntro').textContent = category
        ? CATEGORY_INFO[category.id]?.text || ''
        : 'Cây để bàn, cây phong thủy, cây lọc không khí, sen đá và chậu cảnh – giao hàng toàn quốc.';
    document.title = `${title} - Xanh Garden`;
    const crumb = $('#crumbTitle');
    if (crumb) crumb.textContent = category ? category.name : 'Sản phẩm';
    const chips = [];
    if (state.search)
        chips.push(
            `<span class="chip-filter">Từ khóa: “${escapeHtml(state.search)}” <button type="button" data-clear="search" aria-label="Bỏ từ khóa">×</button></span>`
        );
    if (state.price)
        chips.push(
            `<span class="chip-filter">Giá: ${escapeHtml($(`input[name="price"][value="${state.price}"]`)?.parentElement.textContent.trim() || '')} <button type="button" data-clear="price" aria-label="Bỏ lọc giá">×</button></span>`
        );
    $('#activeFilters').innerHTML = chips.join('');
}

// Dạng danh sách: ảnh trái, thông tin giữa, giá + nút phải.
function renderRowCard(product) {
    const name = escapeHtml(product.name);
    const soldOut = product.stock <= 0;
    const href = `./product-detail.html?id=${encodeURIComponent(product.id)}`;
    return `
        <article class="row-card${soldOut ? ' soldout' : ''}">
            <a href="${href}" class="row-image">
                <img src="${productImage(product.image)}" alt="${name}" loading="lazy">
                ${soldOutMark(product)}
                <span class="pc-badges">${productBadges(product)}</span>
            </a>
            <div class="row-info">
                <span class="row-cat">${escapeHtml(categoryOf(product.categoryId)?.name || '')}</span>
                <h3><a href="${href}">${name}</a></h3>
                <p class="row-desc">${escapeHtml(product.description || '')}</p>
                <p class="row-spec">${escapeHtml([product.specs?.size, product.specs?.pot || product.specs?.material].filter(Boolean).join(' · '))}</p>
                <span class="row-stock${soldOut ? ' out' : ''}">${soldOut ? 'Hết hàng' : `Còn ${product.stock} sản phẩm`}${product.sold ? ` · Đã bán ${product.sold}` : ''}</span>
            </div>
            <div class="row-buy">
                <div class="pc-price">${priceBlock(product)}</div>
                ${addCartButton(product)}
                ${favoriteButton(product).replace('fav-btn', 'fav-btn fav-inline')}
            </div>
        </article>`;
}

function filterProducts() {
    const [min, max] = state.price ? state.price.split('-') : [];
    const words = plain(state.search).split(/\s+/).filter(Boolean);
    const result = products.filter((product) => {
        const haystack = plain(`${product.name} ${product.description || ''} ${categoryOf(product.categoryId)?.name || ''}`);
        return (
            (!state.categoryId || String(product.categoryId) === state.categoryId) &&
            (!state.inStock || product.stock > 0) &&
            (!state.sale || discountPercent(product) > 0) &&
            (!min || product.price >= Number(min)) &&
            (!max || product.price < Number(max)) &&
            words.every((word) => haystack.includes(word))
        );
    });

    if (state.sort === 'asc') result.sort((a, b) => a.price - b.price);
    if (state.sort === 'desc') result.sort((a, b) => b.price - a.price);
    if (state.sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (state.sort === 'newest') result.sort((a, b) => arrivalTime(b) - arrivalTime(a));
    if (state.sort === 'best') result.sort((a, b) => (b.sold || 0) - (a.sold || 0));
    // Mặc định: còn hàng lên trước, hết hàng xuống cuối.
    if (!state.sort) result.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));
    return result;
}

function render() {
    const result = filterProducts();
    const totalPages = Math.ceil(result.length / PAGE_SIZE);
    const safePageCount = Math.max(1, totalPages);
    state.page = Math.min(Math.max(1, state.page), safePageCount);
    const pageItems = result.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    renderHeading();
    $('#resultCount').textContent = `${result.length} sản phẩm`;
    productList.className = state.view === 'grid' ? 'product-grid' : 'product-rows';
    productList.innerHTML = pageItems.length
        ? pageItems.map(state.view === 'grid' ? renderProductCard : renderRowCard).join('')
        : `<div class="empty-state"><h2>Không tìm thấy sản phẩm phù hợp</h2><p>Thử bỏ bớt bộ lọc hoặc tìm với từ khóa khác.</p><a class="btn" href="./products.html">Xem tất cả sản phẩm</a></div>`;

    if (totalPages <= 1) {
        $('#pagination').innerHTML = '';
        return;
    }
    let start = Math.max(1, state.page - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    $('#pagination').innerHTML = `
        <button type="button" class="page-btn page-step" data-page="${state.page - 1}"${state.page === 1 ? ' disabled' : ''}>Trước</button>
        ${start > 1 ? `<button type="button" class="page-btn" data-page="1">1</button>${start > 2 ? '<span class="page-ellipsis">…</span>' : ''}` : ''}
        ${pages.map((page) => `<button type="button" class="page-btn${page === state.page ? ' active' : ''}" data-page="${page}"${page === state.page ? ' aria-current="page"' : ''}>${page}</button>`).join('')}
        ${end < totalPages ? `${end < totalPages - 1 ? '<span class="page-ellipsis">…</span>' : ''}<button type="button" class="page-btn" data-page="${totalPages}">${totalPages}</button>` : ''}
        <button type="button" class="page-btn page-step" data-page="${state.page + 1}"${state.page === totalPages ? ' disabled' : ''}>Sau</button>`;
}

function update(changes) {
    Object.assign(state, { page: 1 }, changes);
    render();
}

$('#categoryList').addEventListener('click', (event) => {
    const button = event.target.closest('.side-item');
    if (!button) return;
    state.categoryId = button.dataset.category;
    renderCategories();
    update({});
    if (window.matchMedia('(max-width: 900px)').matches) {
        $('#shopSidebar').classList.remove('open');
        filterToggle.setAttribute('aria-expanded', 'false');
    }
    trackFilter(state.categoryId);
    const url = new URL(window.location.href);
    if (state.categoryId) url.searchParams.set('category', state.categoryId);
    else url.searchParams.delete('category');
    window.history.replaceState(null, '', url);
});

$('#activeFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    if (button.dataset.clear === 'search') {
        searchInput.value = '';
        update({ search: '' });
    }
    if (button.dataset.clear === 'price') {
        $('input[name="price"][value=""]').checked = true;
        update({ price: '' });
    }
});

$('#pagination').addEventListener('click', (event) => {
    const button = event.target.closest('.page-btn');
    if (!button) return;
    state.page = Number(button.dataset.page);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

viewToggle.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    state.view = button.dataset.view;
    renderViewToggle();
    update({ view: button.dataset.view });
});

$('#resetBtn').addEventListener('click', () => {
    searchInput.value = '';
    $('#sortSelect').value = '';
    $('#inStockOnly').checked = false;
    $('#saleOnly').checked = false;
    $('input[name="price"][value=""]').checked = true;
    state.categoryId = '';
    renderCategories();
    update({ search: '', price: '', sort: '', inStock: false, sale: false });
});

// Ghi nhận từ khóa sau khi khách ngừng gõ ~1,2 giây (kèm số kết quả) để biết nhu cầu tìm kiếm thật.
let searchTimer = null;
searchInput.addEventListener('input', (event) => {
    update({ search: event.target.value.trim() });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => state.search.length >= 2 && trackSearch(state.search.toLowerCase(), filterProducts().length), 1200);
});
$('#priceFilter').addEventListener('change', (event) => update({ price: event.target.value }));
$('#sortSelect').addEventListener('change', (event) => update({ sort: event.target.value }));
$('#inStockOnly').addEventListener('change', (event) => update({ inStock: event.target.checked }));
$('#saleOnly').addEventListener('change', (event) => update({ sale: event.target.checked }));

async function initialize() {
    // Danh mục đã nhớ (dùng chung với menu) vẽ ngay để cột trái và tiêu đề có sẵn chỗ
    categories = cachedCategories() || [];
    renderCategories();
    renderHeading();
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load(['/categories', '/products'], (categoryList, productList) => {
            categories = categoryList;
            products = productList;
            renderCategories();
            render();
            $('#loading').classList.add('hidden');
        });
        if (state.search) trackSearch(state.search.toLowerCase(), filterProducts().length);
    } catch (error) {
        $('#error').textContent = error.message;
        $('#error').classList.remove('hidden');
    } finally {
        $('#loading').classList.add('hidden');
    }
}

initialize();
