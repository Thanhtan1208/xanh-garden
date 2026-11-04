import { api } from '../services/api-service.js';
import '../components/header.js';
import { requirePermission } from '../utils/auth.js';
import { getCurrentUser } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { productImage } from '../utils/images.js';
import { fromLocalInput, timeState, toLocalInput } from '../utils/dates.js';
import { confirmDialog, toast } from '../components/notify.js';

// Quản lý sản phẩm: làm theo bài B17 của cô (1 form dùng chung cho thêm và sửa, bảng có nút Sửa / Xóa)

// lấy phần tử của DOM
const form = document.getElementById('productForm');
const productList = document.getElementById('productList');
const categorySelect = document.getElementById('productCategory');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');
const preView = document.getElementById('preview');
const imageInput = document.getElementById('productImage');
const formMessage = document.getElementById('formMessage');

const LOW_STOCK_AT = 5;
const canManageProducts = hasPermission('products.manage', getCurrentUser());

// dữ liệu lấy từ server về
let products = [];
let categories = [];
let loaded = false;

// ===== Danh mục =====
// đổ danh mục vào ô chọn, giữ lại lựa chọn đang có (khi dữ liệu mới về trong lúc đang sửa)
function renderCategoryOptions() {
    const current = categorySelect.value;
    categorySelect.innerHTML = '';
    // option mặc định "Chọn danh mục"
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Chọn danh mục';
    placeholder.disabled = true;
    categorySelect.appendChild(placeholder);
    // mỗi danh mục là 1 option: value là id, chữ hiển thị là tên
    categories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        categorySelect.appendChild(option);
    });
    categorySelect.value = current;
}

// lấy danh mục về (có bản nhớ thì hiện ngay, dữ liệu mới về thì vẽ lại)
function loadCategories() {
    return api.load('/categories', (data) => {
        categories = data;
        renderCategoryOptions();
        // cập nhật lại tên danh mục trong bảng
        renderProducts();
    });
}

// ===== Danh sách sản phẩm =====
const arrivalTime = (product) => Date.parse(product.lastImportedAt || product.createdAt || 0) || 0;
const SORTS = {
    arrival: (a, b) => arrivalTime(b) - arrivalTime(a),
    name: (a, b) => a.name.localeCompare(b.name, 'vi'),
    stock: (a, b) => a.stock - b.stock
};

function stockText(product) {
    if (product.stock <= 0) return '<span class="status status-cancelled">Hết hàng</span>';
    if (product.stock <= LOW_STOCK_AT) return `<span class="status status-pending">Còn ${product.stock}</span>`;
    return product.stock;
}

// hiển thị sản phẩm lên bảng (theo ô tìm kiếm, sắp xếp, lọc sắp hết)
function renderProducts() {
    // chưa tải xong sản phẩm thì chưa vẽ (tránh hiện nhầm "Không có sản phẩm nào")
    if (!loaded) return;
    const keyword = document.getElementById('search').value.trim().toLowerCase();
    const lowOnly = document.getElementById('lowOnly').checked;
    const list = products
        .filter((product) => product.name.toLowerCase().includes(keyword) && (!lowOnly || product.stock <= LOW_STOCK_AT))
        .sort(SORTS[document.getElementById('sortSelect').value]);

    // danh sách luôn làm mới
    productList.innerHTML = '';
    if (list.length === 0) {
        productList.innerHTML = '<tr><td colspan="7" class="muted">Không có sản phẩm nào</td></tr>';
        return;
    }
    list.forEach((product) => {
        // hiển thị tên danh mục chứ không phải mã danh mục (dùng == vì id có thể là chuỗi hoặc số)
        const cat = categories.find((c) => c.id == product.categoryId);
        const arrival = product.lastImportedAt || product.createdAt;
        // tạo dòng
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img class="table-thumb" src="${productImage(product.image)}" alt="${escapeHtml(product.name)}"></td>
            <td><b>${escapeHtml(product.name)}</b>${product.isNew ? ' <em class="tag tag-praise">Mới</em>' : product.restocked ? ' <em class="tag tag-praise">Mới về</em>' : ''}${product.newUntil ? `<small class="muted block">Nhãn Mới đến ${formatDate(product.newUntil)}</small>` : ''}</td>
            <td>${escapeHtml(cat?.name || 'Chưa có danh mục')}</td>
            <td>${formatPrice(product.price)}${product.oldPrice > product.price ? `<small class="muted block"><s>${formatPrice(product.oldPrice)}</s></small>` : ''}</td>
            <td>${stockText(product)}</td>
            <td>${arrival ? formatDate(arrival) : '<span class="muted">—</span>'}</td>
            <td>
                <span class="row-actions">
                    ${canManageProducts ? `<button type="button" class="btn btn-sm btn-outline editBtn" data-id="${product.id}">Sửa</button>` : ''}
                    <button type="button" class="btn btn-sm btn-outline importRowBtn" data-id="${product.id}">Nhập</button>
                    <button type="button" class="btn btn-sm btn-outline historyBtn" data-id="${product.id}">Lịch sử</button>
                    ${canManageProducts ? `<button type="button" class="btn btn-sm btn-danger deleteBtn" data-id="${product.id}">Xóa</button>` : ''}
                </span>
            </td>`;
        // thêm dòng vào bảng
        productList.appendChild(tr);
    });
}

// lấy sản phẩm về (có bản nhớ thì hiện ngay, dữ liệu mới về thì vẽ lại)
function loadProducts() {
    return api.load('/products', (data) => {
        products = data;
        loaded = true;
        renderProducts();
        document.getElementById('loading').classList.add('hidden');
    });
}

// ===== Thông số theo danh mục (màu sắc, kích thước, chất liệu...) =====
function renderSpecFields(categoryId, values = {}) {
    const fields = categories.find((category) => category.id == categoryId)?.specFields || [];
    document.getElementById('specFields').innerHTML = fields.map(({ key, label }) => `
        <label>${escapeHtml(label)}
            <input type="text" data-spec="${key}" maxlength="100" value="${escapeHtml(values[key] || '')}">
        </label>`).join('') || '<p class="muted">Chọn danh mục để nhập thông số.</p>';
}

function collectSpecs() {
    return Object.fromEntries([...document.querySelectorAll('#specFields [data-spec]')].map((input) => [input.dataset.spec, input.value.trim()]));
}

categorySelect.addEventListener('change', () => renderSpecFields(categorySelect.value, collectSpecs()));

// ===== Xóa / sửa =====
// phương thức xóa
async function deleteProduct(id) {
    const sanpham = products.find((p) => String(p.id) === String(id));
    // hỏi lại trước khi xóa
    if (!await confirmDialog({ title: `Xóa “${sanpham?.name}”?`, message: 'Bạn có chắc muốn xóa sản phẩm này không?', confirmText: 'Xóa', tone: 'danger' })) return;
    try {
        await api.delete(`/admin/products/${id}`);
        // nếu đang sửa đúng sản phẩm vừa xóa thì làm trống form
        if (document.getElementById('productId').value === String(id)) resetForm();
        toast('Đã xóa sản phẩm.', { type: 'success' });
        // xóa xong thì tải lại danh sách sản phẩm
        await loadProducts();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

// phương thức sửa: đổ dữ liệu lên form và chuyển form sang chế độ sửa
function editProduct(id) {
    updateForm(id);
    document.getElementById('formTitle').textContent = 'Sửa sản phẩm';
    submitBtn.textContent = 'Cập nhật';
    cancelBtn.hidden = false;
    form.scrollIntoView({ behavior: 'smooth' });
}

// đổ thông tin sản phẩm lên các ô trong form
function updateForm(id) {
    const sanpham = products.find((p) => String(p.id) === String(id));
    if (!sanpham) return;
    document.getElementById('productId').value = sanpham.id;
    document.getElementById('name').value = sanpham.name;
    document.getElementById('price').value = sanpham.price;
    document.getElementById('oldPrice').value = sanpham.oldPrice || '';
    document.getElementById('stock').value = sanpham.stock;
    document.getElementById('newUntil').value = toLocalInput(sanpham.newUntil);
    categorySelect.value = sanpham.categoryId;
    imageInput.value = sanpham.image;
    document.getElementById('description').value = sanpham.description || '';
    renderSpecFields(sanpham.categoryId, sanpham.specs);
    formMessage.textContent = '';
    // hiện ảnh xem trước của sản phẩm đang sửa
    showPreview(sanpham.image);
}

// bắt sự kiện bấm các nút trong bảng (dùng closest để bấm trúng chữ trong nút vẫn nhận)
productList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const id = button.dataset.id;
    if (button.classList.contains('deleteBtn')) await deleteProduct(id);
    if (button.classList.contains('editBtn')) editProduct(id);
    if (button.classList.contains('importRowBtn')) openImport(id);
    if (button.classList.contains('historyBtn')) showHistory(id);
});

// ===== Ảnh sản phẩm =====
// hiện ảnh xem trước, không có ảnh thì ẩn đi
function showPreview(url) {
    preView.src = url ? productImage(url) : '';
    preView.hidden = !url;
}

// gõ hoặc dán tên ảnh thì hiện ảnh xem trước luôn
imageInput.addEventListener('input', () => showPreview(imageInput.value.trim()));

// chọn file ảnh: tải lên server rồi điền đường dẫn vào ô ảnh
document.getElementById('imageFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        formMessage.textContent = 'Ảnh tối đa 5 MB.';
        return;
    }
    formMessage.textContent = 'Đang tải ảnh lên...';
    try {
        const { url } = await api.upload('/admin/uploads/product', file);
        imageInput.value = url;
        showPreview(url);
        formMessage.textContent = '';
    } catch (error) {
        formMessage.textContent = error.message;
    }
});

// ===== Thêm / cập nhật =====
// đưa form về trạng thái ban đầu ("Thêm sản phẩm")
function resetForm() {
    form.reset();
    // input hidden không bị form.reset() xóa nên phải gán tay
    document.getElementById('productId').value = '';
    categorySelect.value = '';
    renderSpecFields('');
    showPreview('');
    formMessage.textContent = '';
    document.getElementById('formTitle').textContent = 'Thêm sản phẩm';
    submitBtn.textContent = 'Thêm sản phẩm';
    cancelBtn.hidden = true;
}

// bấm "Thêm sản phẩm" hoặc "Cập nhật"
form.addEventListener('submit', async (event) => {
    // chặn hành vi mặc định là tải lại trang
    event.preventDefault();
    // có id => đang sửa, rỗng => đang thêm mới
    const id = document.getElementById('productId').value;
    // gom dữ liệu trên form thành 1 object sản phẩm (value của input là chuỗi nên đổi sang số)
    const oldPrice = document.getElementById('oldPrice').value;
    const sanpham = {
        name: document.getElementById('name').value.trim(),
        price: Number(document.getElementById('price').value),
        oldPrice: oldPrice ? Number(oldPrice) : null,
        stock: Number(document.getElementById('stock').value),
        newUntil: fromLocalInput(document.getElementById('newUntil').value),
        categoryId: Number(categorySelect.value),
        image: imageInput.value.trim(),
        description: document.getElementById('description').value.trim(),
        specs: collectSpecs()
    };
    submitBtn.disabled = true;
    try {
        if (id) {
            // có id => cập nhật (server chỉ ghi đè các trường gửi lên, giữ nguyên ngày tạo, cách chăm sóc...)
            await api.put(`/admin/products/${id}`, sanpham);
            toast('Cập nhật sản phẩm thành công!', { type: 'success' });
        } else {
            // không có id => thêm mới, server tự tạo id
            await api.post('/admin/products', sanpham);
            toast('Thêm sản phẩm thành công!', { type: 'success' });
        }
        // xong thì làm trống form và tải lại bảng sản phẩm
        resetForm();
        await loadProducts();
    } catch (error) {
        formMessage.textContent = error.message;
    } finally {
        submitBtn.disabled = false;
    }
});

// bấm "Hủy sửa" thì quay form về chế độ thêm
cancelBtn.addEventListener('click', resetForm);

// tìm kiếm, sắp xếp, lọc sắp hết hàng
document.getElementById('search').addEventListener('input', renderProducts);
document.getElementById('sortSelect').addEventListener('change', renderProducts);
document.getElementById('lowOnly').addEventListener('change', renderProducts);

// ===== Nhập hàng (phiếu nhập): cộng vào tồn kho và ghi nhật ký =====
const importForm = document.getElementById('importForm');
function openImport(id) {
    importForm.elements.namedItem('productId').innerHTML = [...products].sort(SORTS.name)
        .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (còn ${item.stock})</option>`).join('');
    if (id) importForm.elements.namedItem('productId').value = id;
    importForm.elements.namedItem('add').value = '';
    importForm.elements.namedItem('note').value = '';
    document.getElementById('importMessage').textContent = '';
    importForm.classList.remove('hidden');
    importForm.scrollIntoView({ behavior: 'smooth' });
    importForm.elements.namedItem('add').focus({ preventScroll: true });
}
document.getElementById('importBtn').addEventListener('click', () => openImport());
document.getElementById('cancelImportBtn').addEventListener('click', () => importForm.classList.add('hidden'));
importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = importForm.elements.namedItem('productId').value;
    try {
        const result = await api.patch(`/admin/products/${id}/stock`, { add: Number(importForm.elements.namedItem('add').value), note: importForm.elements.namedItem('note').value.trim() });
        importForm.classList.add('hidden');
        toast(`Đã nhập kho. Tồn hiện tại: ${result.stock}.`, { type: 'success' });
        await loadProducts();
    } catch (error) {
        document.getElementById('importMessage').textContent = error.message;
    }
});

// ===== Lịch sử nhập/xuất của một sản phẩm =====
const LOG_TYPE = { import: 'Nhập hàng', sale: 'Bán (đặt đơn)', cancel_return: 'Hoàn kho (hủy đơn)', adjust: 'Điều chỉnh' };
async function showHistory(id) {
    const sanpham = products.find((p) => String(p.id) === String(id));
    const box = document.getElementById('historyBox');
    document.getElementById('historyTitle').textContent = `Lịch sử nhập/xuất: ${sanpham?.name || ''}`;
    box.classList.remove('hidden');
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Đang tải...</td></tr>';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const logs = await api.get(`/admin/stock-logs?productId=${encodeURIComponent(id)}&limit=100`);
        tbody.innerHTML = logs.length ? logs.map((log) => `
            <tr>
                <td>${formatDate(log.createdAt)}</td>
                <td>${LOG_TYPE[log.type] || log.type}</td>
                <td class="${log.qty > 0 ? 'up' : 'down'}">${log.qty > 0 ? '+' : ''}${log.qty}</td>
                <td>${log.balanceAfter}</td>
                <td>${escapeHtml(log.note)}</td>
                <td>${escapeHtml(log.by)}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="muted">Chưa có biến động nào được ghi nhận.</td></tr>';
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="error-message">${escapeHtml(error.message)}</td></tr>`;
    }
}
document.getElementById('closeHistoryBtn').addEventListener('click', () => document.getElementById('historyBox').classList.add('hidden'));

// ===== Cài đặt sản phẩm mới và khuyến mãi =====
const settingsForm = document.getElementById('settingsForm');
const settingsField = (name) => settingsForm.elements.namedItem(name);
const STATE_TEXT = { upcoming: 'Chưa đến giờ bắt đầu', running: 'Đang chạy', ended: 'Đã kết thúc' };

function fillSettings(settings) {
    const promo = settings.newPromo;
    settingsField('newProductDays').value = settings.newProductDays;
    settingsField('restockDays').value = settings.restockDays;
    settingsField('promoEnabled').checked = promo.enabled;
    settingsField('percent').value = promo.percent;
    settingsField('maxDiscount').value = promo.maxDiscount;
    settingsField('minOrder').value = promo.minOrder;
    settingsField('startAt').value = toLocalInput(promo.startAt);
    settingsField('endAt').value = toLocalInput(promo.endAt);
    document.getElementById('promoState').textContent = promo.enabled && promo.startAt && promo.endAt ? `Trạng thái: ${STATE_TEXT[timeState(promo)]}` : 'Khuyến mãi đang tắt';
}

settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('settingsMessage');
    message.textContent = '';
    try {
        const saved = await api.put('/admin/settings', {
            newProductDays: Number(settingsField('newProductDays').value),
            restockDays: Number(settingsField('restockDays').value),
            newPromo: {
                enabled: settingsField('promoEnabled').checked,
                percent: Number(settingsField('percent').value),
                maxDiscount: Number(settingsField('maxDiscount').value),
                minOrder: Number(settingsField('minOrder').value || 0),
                startAt: fromLocalInput(settingsField('startAt').value),
                endAt: fromLocalInput(settingsField('endAt').value)
            }
        });
        fillSettings(saved);
        await loadProducts();   // nhãn Mới của các sản phẩm đổi theo số ngày mới
        toast('Đã lưu cài đặt sản phẩm mới.', { type: 'success' });
    } catch (error) {
        message.textContent = error.message;
    }
});

// ===== Gọi hàm thực thi =====
async function initialize() {
    if (!requirePermission('products.view')) return;
    form.classList.toggle('hidden', !canManageProducts);
    settingsForm.classList.toggle('hidden', !canManageProducts);
    renderSpecFields('');
    try {
        await Promise.all([loadCategories(), loadProducts(), canManageProducts ? api.get('/admin/settings').then(fillSettings) : null]);
    } catch (error) {
        document.getElementById('error').textContent = error.message;
        document.getElementById('error').classList.remove('hidden');
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

initialize();
