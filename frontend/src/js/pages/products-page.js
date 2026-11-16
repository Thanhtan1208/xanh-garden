import { api } from '../services/api-service.js';
import { CATEGORY_INFO, NO_CATEGORY, cachedCategories } from '../services/catalog-service.js';
import { bindAddToCart, discountPercent, renderProductCard } from '../components/product-card.js';
import '../components/header.js';
import { escapeHtml } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { trackFilter, trackSearch } from '../services/tracker.js';

const PAGE_SIZE = 12;
const params = new URLSearchParams(window.location.search);
const SORTS = ['', 'best', 'newest', 'asc', 'desc'];
// Từ khóa lấy từ ô tìm kiếm trên header (?q=), trang này không có ô tìm riêng
const state = {
    categoryId: params.get('category') || '',
    search: params.get('q') || '',
    price: '',
    sort: SORTS.includes(params.get('sort')) ? params.get('sort') : '',
    sale: false,
    page: 1
};

let categories = [];
let products = [];

const $ = (selector) => document.querySelector(selector);
const productList = $('#productList');

bindAddToCart(productList, () => products);

// Ghi bộ lọc lên địa chỉ trang để tải lại hay gửi link vẫn giữ đúng
function setUrlParam(name, value) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
    window.history.replaceState(null, '', url);
}

// Bỏ từ khóa: xóa cả chữ trong ô tìm kiếm trên header
function clearSearch() {
    const headerInput = document.querySelector('.header-search input');
    if (headerInput) headerInput.value = '';
    setUrlParam('q', '');
}

// Tìm không phân biệt dấu: "kim tien" vẫn ra "Kim tiền".
const plain = (text) =>
    String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd');

// Điện thoại: khối bộ lọc thu gọn, bấm "Bộ lọc" mới mở.
const filterToggle = $('#filterToggle');
filterToggle.insertAdjacentHTML('afterbegin', icon('list', { size: 16 }));
filterToggle.addEventListener('click', () => {
    const open = $('#shopSidebar').classList.toggle('open');
    filterToggle.setAttribute('aria-expanded', String(open));
});

const arrivalTime = (product) => Date.parse(product.lastImportedAt || product.createdAt || 0) || 0;
// Sản phẩm của danh mục đã bị xóa không thuộc danh mục nào: khách thấy chúng trong mục "Khác"
const NO_CATEGORY_ENTRY = { id: NO_CATEGORY, name: 'Khác' };
const isUncategorized = (product) => product.categoryId === null || product.categoryId === undefined;
const categoryOf = (id) => (id === NO_CATEGORY ? NO_CATEGORY_ENTRY : categories.find((item) => String(item.id) === String(id)));

// Chưa có sản phẩm thì để trống số đếm (danh mục vẫn hiện đủ để cột trái không bị nhảy)
function renderCategories() {
    const hasOthers = products.some(isUncategorized);
    $('#categoryList').innerHTML = [{ id: '', name: 'Tất cả sản phẩm' }, ...categories, ...(hasOthers ? [NO_CATEGORY_ENTRY] : [])]
        .map((category) => {
            const count = !category.id
                ? products.length
                : category.id === NO_CATEGORY
                  ? products.filter(isUncategorized).length
                  : products.filter((product) => String(product.categoryId) === String(category.id)).length;
            return `<button type="button" class="side-item${String(category.id) === state.categoryId ? ' active' : ''}" data-category="${escapeHtml(category.id)}">
                <span>${escapeHtml(category.name)}</span><small>${products.length ? count : ''}</small>
            </button>`;
        })
        .join('');
}

// Tiêu đề, mô tả ngắn của danh mục và các bộ lọc đang bật (bấm × để bỏ).
function renderHeading() {
    const category = categoryOf(state.categoryId);
    const title = category ? category.name : 'Tất cả sản phẩm';
    $('#shopTitle').textContent = title;
    $('#shopIntro').textContent = category ? CATEGORY_INFO[category.id]?.text || '' : '';
    document.title = `${title} - Xanh Garden`;
    const chips = [];
    if (state.search)
        chips.push(
            `<span class="chip-filter">Từ khóa: “${escapeHtml(state.search)}” <button type="button" data-clear="search" aria-label="Bỏ từ khóa">×</button></span>`
        );
    if (state.price)
        chips.push(
            `<span class="chip-filter">Giá: ${escapeHtml($(`input[name="price"][value="${state.price}"]`)?.parentElement.textContent.trim() || '')} <button type="button" data-clear="price" aria-label="Bỏ lọc giá">×</button></span>`
        );
    if (state.sale)
        chips.push(
            `<span class="chip-filter">Đang giảm giá <button type="button" data-clear="sale" aria-label="Bỏ lọc giảm giá">×</button></span>`
        );
    $('#activeFilters').innerHTML = chips.join('');
    // Nút "Xóa bộ lọc" chỉ hiện khi đang có bộ lọc
    $('#resetBtn').classList.toggle('hidden', !(state.categoryId || state.search || state.price || state.sale || state.sort));
    $('#sortBar')
        .querySelectorAll('[data-sort]')
        .forEach((button) => {
            const active = button.dataset.sort === state.sort;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
}

function filterProducts() {
    const [min, max] = state.price ? state.price.split('-') : [];
    const words = plain(state.search).split(/\s+/).filter(Boolean);
    const result = products.filter((product) => {
        const haystack = plain(`${product.name} ${product.description || ''} ${categoryOf(product.categoryId)?.name || ''}`);
        return (
            (!state.categoryId ||
                (state.categoryId === NO_CATEGORY ? isUncategorized(product) : String(product.categoryId) === state.categoryId)) &&
            (!state.sale || discountPercent(product) > 0) &&
            (!min || product.price >= Number(min)) &&
            (!max || product.price < Number(max)) &&
            words.every((word) => haystack.includes(word))
        );
    });

    if (state.sort === 'asc') result.sort((a, b) => a.price - b.price);
    if (state.sort === 'desc') result.sort((a, b) => b.price - a.price);
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
    productList.innerHTML = pageItems.length
        ? pageItems.map(renderProductCard).join('')
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
    setUrlParam('category', state.categoryId);
});

$('#activeFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    if (button.dataset.clear === 'search') {
        clearSearch();
        update({ search: '' });
    }
    if (button.dataset.clear === 'price') {
        $('input[name="price"][value=""]').checked = true;
        update({ price: '' });
    }
    if (button.dataset.clear === 'sale') {
        $('#saleOnly').checked = false;
        update({ sale: false });
    }
});

// Thanh sắp xếp dạng nút (giống Shopee): bấm là đổi ngay
$('#sortBar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    setUrlParam('sort', button.dataset.sort);
    update({ sort: button.dataset.sort });
});

$('#pagination').addEventListener('click', (event) => {
    const button = event.target.closest('.page-btn');
    if (!button) return;
    state.page = Number(button.dataset.page);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#resetBtn').addEventListener('click', () => {
    clearSearch();
    setUrlParam('category', '');
    setUrlParam('sort', '');
    $('#saleOnly').checked = false;
    $('input[name="price"][value=""]').checked = true;
    state.categoryId = '';
    renderCategories();
    update({ search: '', price: '', sort: '', sale: false });
});

$('#priceFilter').addEventListener('change', (event) => update({ price: event.target.value }));
$('#saleOnly').addEventListener('change', (event) => update({ sale: event.target.checked }));

async function initialize() {
    // Danh mục đã nhớ vẽ ngay để cột trái và tiêu đề có sẵn chỗ
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
        // Đường dẫn ?category= trỏ tới danh mục đã bị xóa (hoặc mục Khác không còn sản phẩm): về tất cả sản phẩm
        const known = state.categoryId === NO_CATEGORY ? products.some(isUncategorized) : categoryOf(state.categoryId);
        if (state.categoryId && !known) {
            state.categoryId = '';
            setUrlParam('category', '');
            renderCategories();
            render();
        }
        if (state.search) trackSearch(state.search.toLowerCase(), filterProducts().length);
    } catch (error) {
        $('#error').textContent = error.message;
        $('#error').classList.remove('hidden');
    } finally {
        $('#loading').classList.add('hidden');
    }
}

initialize();
