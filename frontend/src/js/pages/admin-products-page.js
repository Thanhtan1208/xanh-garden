import { api } from '../services/api-service.js';
import '../components/table-view.js';
import '../components/header.js';
import { requirePermission } from '../utils/auth.js';
import { getCurrentUser } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { productImage } from '../utils/images.js';
import { fromLocalInput, toLocalInput } from '../utils/dates.js';
import { confirmDialog, toast } from '../components/notify.js';
import { downloadWorkbook, readWorkbook } from '../services/excel-service.js';
import { TEN_FONT, napFontTiengViet } from '../components/invoice.js';

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
const canSeeSales = hasPermission('dashboard.sales', getCurrentUser());

// dữ liệu lấy từ server về
let products = [];
let categories = [];
let loaded = false;
let salesById = new Map(); // doanh thu từng sản phẩm (chỉ tải khi có quyền xem doanh thu)

// Danh mục
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

// Danh sách sản phẩm
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

// danh sách đang hiện trên bảng (theo ô tìm kiếm, sắp xếp, lọc sắp hết), xuất file cũng lấy đúng danh sách này
function visibleProducts() {
    const keyword = document.getElementById('search').value.trim().toLowerCase();
    const lowOnly = document.getElementById('lowOnly').checked;
    return products
        .filter((product) => product.name.toLowerCase().includes(keyword) && (!lowOnly || product.stock <= LOW_STOCK_AT))
        .sort(SORTS[document.getElementById('sortSelect').value]);
}

// hiển thị sản phẩm lên bảng
function renderProducts() {
    // chưa tải xong sản phẩm thì chưa vẽ (tránh hiện nhầm "Không có sản phẩm nào")
    if (!loaded) return;
    const list = visibleProducts();

    // danh sách luôn làm mới
    productList.innerHTML = '';
    if (list.length === 0) {
        productList.innerHTML = '<tr><td colspan="9" class="muted">Không có sản phẩm nào</td></tr>';
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
            <td><b>${escapeHtml(product.name)}</b>${product.isNew ? ' <em class="tag tag-praise">Mới</em>' : product.restocked ? ' <em class="tag tag-praise">Mới về</em>' : ''}${product.newUntil ? `<small class="muted block">Nhãn Mới đến ${formatDate(product.newUntil)}</small>` : ''}${product.promoUntil ? `<small class="muted block">Giảm giá đến ${formatDate(product.promoUntil)}</small>` : ''}</td>
            <td>${escapeHtml(cat?.name || 'Chưa có danh mục')}</td>
            <td>${formatPrice(product.price)}${product.oldPrice > product.price ? `<small class="muted block"><s>${formatPrice(product.oldPrice)}</s></small>` : ''}</td>
            <td>${stockText(product)}</td>
            ${canSeeSales ? salesCells(product.id) : ''}
            <td>${arrival ? formatDate(arrival) : '<span class="muted">—</span>'}</td>
            <td>
                <span class="row-actions">
                    ${canManageProducts ? `<button type="button" class="btn btn-sm btn-outline editBtn" data-id="${product.id}">Sửa</button>` : ''}
                    <button type="button" class="btn btn-sm btn-outline importRowBtn" data-id="${product.id}">Nhập</button>
                    <button type="button" class="btn btn-sm btn-outline historyBtn" data-id="${product.id}">Lịch sử</button>
                    ${canSeeSales ? `<button type="button" class="btn btn-sm btn-outline salesBtn" data-id="${product.id}">Doanh thu</button>` : ''}
                    ${canManageProducts ? `<button type="button" class="btn btn-sm btn-danger deleteBtn" data-id="${product.id}">Xóa</button>` : ''}
                </span>
            </td>`;
        // thêm dòng vào bảng
        productList.appendChild(tr);
    });
}

// Hai cột: số lượng đã giao và doanh thu hàng của sản phẩm
function salesCells(id) {
    const sales = salesById.get(String(id));
    return `<td>${sales ? sales.delivered : '—'}${sales?.inFlight ? `<small class="muted block">${sales.inFlight} đang xử lý</small>` : ''}</td><td><b>${sales ? formatPrice(sales.revenue) : '—'}</b></td>`;
}

// lấy sản phẩm về (có bản nhớ thì hiện ngay, dữ liệu mới về thì vẽ lại)
function loadProducts() {
    if (canSeeSales) {
        document.querySelectorAll('.sales-col').forEach((th) => (th.hidden = false));
        api.get('/admin/product-sales')
            .then((rows) => {
                salesById = new Map(rows.map((row) => [row.id, row]));
                if (loaded) renderProducts();
            })
            .catch((error) => toast(`Không tải được doanh thu sản phẩm: ${error.message}`, { type: 'error' }));
    }
    return api.load('/products', (data) => {
        products = data;
        loaded = true;
        renderProducts();
        document.getElementById('loading').classList.add('hidden');
    });
}

// Thông số theo danh mục (màu sắc, kích thước, chất liệu...)
function renderSpecFields(categoryId, values = {}) {
    const fields = categories.find((category) => category.id == categoryId)?.specFields || [];
    document.getElementById('specFields').innerHTML =
        fields
            .map(
                ({ key, label }) => `
        <label>${escapeHtml(label)}
            <input type="text" data-spec="${key}" maxlength="100" value="${escapeHtml(values[key] || '')}">
        </label>`
            )
            .join('') || '<p class="muted">Chọn danh mục để nhập thông số.</p>';
}

function collectSpecs() {
    return Object.fromEntries(
        [...document.querySelectorAll('#specFields [data-spec]')].map((input) => [input.dataset.spec, input.value.trim()])
    );
}

categorySelect.addEventListener('change', () => renderSpecFields(categorySelect.value, collectSpecs()));

// Xóa / sửa
// phương thức xóa
async function deleteProduct(id) {
    const sanpham = products.find((p) => String(p.id) === String(id));
    // hỏi lại trước khi xóa
    if (
        !(await confirmDialog({
            title: `Xóa “${sanpham?.name}”?`,
            message: 'Bạn có chắc muốn xóa sản phẩm này không?',
            confirmText: 'Xóa',
            tone: 'danger'
        }))
    )
        return;
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

// Tab: "Danh sách sản phẩm" và "Thêm sản phẩm" (đổi tên thành "Sửa sản phẩm" khi đang sửa)
function showTab(name) {
    document.querySelectorAll('#prodTabs button').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('prodTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('button[data-tab]');
    if (tab) showTab(tab.dataset.tab);
});

// phương thức sửa: đổ dữ liệu lên form và chuyển form sang chế độ sửa
function editProduct(id) {
    updateForm(id);
    document.getElementById('formTitle').textContent = 'Sửa sản phẩm';
    document.getElementById('addTab').textContent = 'Sửa sản phẩm';
    submitBtn.textContent = 'Cập nhật';
    cancelBtn.hidden = false;
    showTab('add');
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
    document.getElementById('promoUntil').value = toLocalInput(sanpham.promoUntil);
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
    if (button.classList.contains('salesBtn')) showSales(id);
});

// Ảnh sản phẩm
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

// Thêm / cập nhật
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
    document.getElementById('addTab').textContent = 'Thêm sản phẩm';
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
        promoUntil: fromLocalInput(document.getElementById('promoUntil').value),
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
        // xong thì làm trống form, về tab danh sách và tải lại bảng sản phẩm
        resetForm();
        showTab('list');
        await loadProducts();
    } catch (error) {
        formMessage.textContent = error.message;
    } finally {
        submitBtn.disabled = false;
    }
});

// bấm "Hủy sửa" thì quay form về chế độ thêm và về tab danh sách
cancelBtn.addEventListener('click', () => {
    resetForm();
    showTab('list');
});

// tìm kiếm, sắp xếp, lọc sắp hết hàng
document.getElementById('search').addEventListener('input', renderProducts);
document.getElementById('sortSelect').addEventListener('change', renderProducts);
document.getElementById('lowOnly').addEventListener('change', renderProducts);

// Nhập hàng (phiếu nhập): cộng vào tồn kho và ghi nhật ký
const importForm = document.getElementById('importForm');
function openImport(id) {
    showTab('list');
    importForm.elements.namedItem('productId').innerHTML = [...products]
        .sort(SORTS.name)
        .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (còn ${item.stock})</option>`)
        .join('');
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
        const result = await api.patch(`/admin/products/${id}/stock`, {
            add: Number(importForm.elements.namedItem('add').value),
            note: importForm.elements.namedItem('note').value.trim()
        });
        importForm.classList.add('hidden');
        toast(`Đã nhập kho. Tồn hiện tại: ${result.stock}.`, { type: 'success' });
        await loadProducts();
    } catch (error) {
        document.getElementById('importMessage').textContent = error.message;
    }
});

// Lịch sử nhập/xuất của một sản phẩm
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
        tbody.innerHTML = logs.length
            ? logs
                  .map(
                      (log) => `
            <tr>
                <td>${formatDate(log.createdAt)}</td>
                <td>${LOG_TYPE[log.type] || log.type}</td>
                <td class="${log.qty > 0 ? 'up' : 'down'}">${log.qty > 0 ? '+' : ''}${log.qty}</td>
                <td>${log.balanceAfter}</td>
                <td>${escapeHtml(log.note)}</td>
                <td>${escapeHtml(log.by)}</td>
            </tr>`
                  )
                  .join('')
            : '<tr><td colspan="6" class="muted">Chưa có biến động nào được ghi nhận.</td></tr>';
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="error-message">${escapeHtml(error.message)}</td></tr>`;
    }
}
// Doanh thu một sản phẩm: tổng và 12 tháng gần nhất
function showSales(id) {
    const sanpham = products.find((p) => String(p.id) === String(id));
    const sales = salesById.get(String(id));
    const box = document.getElementById('salesBox');
    document.getElementById('salesTitle').textContent = `Doanh thu: ${sanpham?.name || ''}`;
    const cards = [
        ['Đã giao', sales?.delivered ?? 0],
        ['Doanh thu hàng', formatPrice(sales?.revenue ?? 0)],
        ['Giá bán trung bình', formatPrice(sales?.average ?? 0)],
        ['Đang xử lý', sales?.inFlight ?? 0],
        ['Đã hủy', sales?.cancelled ?? 0],
        ['Số đơn đã giao', sales?.orders ?? 0]
    ];
    document.getElementById('salesSummary').innerHTML = cards
        .map(([label, value]) => `<div class="sales-card"><span>${label}</span><b>${value}</b></div>`)
        .join('');
    document.getElementById('salesBody').innerHTML = (sales?.months || [])
        .map(
            (month) =>
                `<tr><td>${month.key.slice(5)}/${month.key.slice(0, 4)}</td><td>${month.units}</td><td>${formatPrice(month.revenue)}</td></tr>`
        )
        .join('');
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('closeSalesBtn').addEventListener('click', () => document.getElementById('salesBox').classList.add('hidden'));
document.getElementById('closeHistoryBtn').addEventListener('click', () => document.getElementById('historyBox').classList.add('hidden'));

// Cài đặt sản phẩm mới và khuyến mãi
const settingsForm = document.getElementById('settingsForm');
const settingsField = (name) => settingsForm.elements.namedItem(name);

function fillSettings(settings) {
    const promo = settings.newPromo;
    settingsField('newProductDays').value = settings.newProductDays;
    settingsField('restockDays').value = settings.restockDays;
    settingsField('promoEnabled').checked = promo.enabled;
    settingsField('percent').value = promo.percent;
    settingsField('maxDiscount').value = promo.maxDiscount;
    settingsField('minOrder').value = promo.minOrder;
    settingsField('promoDays').value = promo.days;
    document.getElementById('promoState').textContent = promo.enabled
        ? `Đang bật: sản phẩm mới được giảm ${promo.percent}% trong ${promo.days} ngày đầu, nhãn "Mới" hiện ${settings.newProductDays} ngày.`
        : 'Khuyến mãi đang tắt.';
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
                days: Number(settingsField('promoDays').value)
            }
        });
        fillSettings(saved);
        await loadProducts(); // nhãn Mới của các sản phẩm đổi theo số ngày mới
        toast('Đã lưu cài đặt sản phẩm mới.', { type: 'success' });
    } catch (error) {
        message.textContent = error.message;
    }
});

// Xuất Excel, xuất PDF, nhập từ Excel
// cột của file Excel: [tên cột trong file, tên thuộc tính gửi lên server]
const EXCEL_COLUMNS = [
    ['ID', 'id'],
    ['Tên sản phẩm', 'name'],
    ['Danh mục', 'category'],
    ['Giá bán', 'price'],
    ['Giá gốc', 'oldPrice'],
    ['Tồn kho', 'stock'],
    ['Ảnh', 'image'],
    ['Mô tả', 'description']
];
const categoryName = (product) => categories.find((c) => c.id == product.categoryId)?.name || '';

// file xuất ra sửa xong nhập lại được luôn nên cùng cột với file nhập
async function exportExcel() {
    try {
        await downloadWorkbook('san-pham.xlsx', [
            {
                name: 'San pham',
                rows: [
                    EXCEL_COLUMNS.map(([title]) => title),
                    ...visibleProducts().map((product) => [
                        product.id,
                        product.name,
                        categoryName(product),
                        product.price,
                        product.oldPrice || '',
                        product.stock,
                        product.image,
                        product.description
                    ])
                ],
                widths: [24, 30, 22, 12, 12, 10, 26, 60]
            }
        ]);
        toast('Đã xuất danh sách sản phẩm ra Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
}

// phương thức xuất file PDF (jsPDF + autoTable, làm theo bài B16 của cô)
async function exportPdf() {
    const list = visibleProducts();
    if (list.length === 0) {
        toast('Không có sản phẩm để xuất PDF.', { type: 'warning' });
        return;
    }
    const button = document.getElementById('exportPdfBtn');
    // vô hiệu hóa nút trong khi đang xuất
    button.disabled = true;
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        await napFontTiengViet(doc);
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(18);
        doc.text('Danh sách sản phẩm', 105, 20, { align: 'center' });
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(11);
        doc.text(`Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}`, 105, 28, { align: 'center' });
        doc.autoTable({
            head: [['STT', 'Tên sản phẩm', 'Danh mục', 'Giá bán', 'Tồn kho']],
            body: list.map((product, index) => [index + 1, product.name, categoryName(product), formatPrice(product.price), product.stock]),
            startY: 36,
            theme: 'grid',
            // bảng cũng phải dùng font tiếng Việt
            styles: { font: TEN_FONT, fontSize: 10 },
            headStyles: { font: TEN_FONT, fontStyle: 'bold', fillColor: [46, 125, 50], halign: 'center' },
            columnStyles: {
                0: { halign: 'center', cellWidth: 14 },
                3: { halign: 'right', cellWidth: 32 },
                4: { halign: 'center', cellWidth: 20 }
            }
        });
        doc.save('danh-sach-san-pham.pdf');
    } catch (error) {
        toast(`Không xuất được PDF: ${error.message}`, { type: 'error' });
    } finally {
        // luôn bật lại nút sau khi xử lý xong
        button.disabled = false;
    }
}

// hiện các dòng lỗi server trả về, không có lỗi thì ẩn khung
function showExcelErrors(errors) {
    if (errors.length) showTab('list');
    document.getElementById('excelErrors').classList.toggle('hidden', !errors.length);
    document.getElementById('excelErrorsTitle').textContent = `File có ${errors.length} dòng lỗi, chưa lưu dòng nào`;
    document.getElementById('excelErrorList').innerHTML = errors
        .map(({ line, message }) => `<li><b>Dòng ${line}:</b> ${escapeHtml(message)}</li>`)
        .join('');
}

// phương thức import file excel: trình duyệt đọc file, server kiểm tra rồi mới lưu
async function importExcel(file) {
    showExcelErrors([]);
    try {
        const data = await readWorkbook(file);
        if (data.length === 0) {
            toast('File Excel không có dữ liệu.', { type: 'warning' });
            return;
        }
        if (!('Tên sản phẩm' in data[0])) {
            toast('File không đúng mẫu. Hãy bấm "Xuất Excel" rồi sửa trên file đó.', { type: 'error' });
            return;
        }
        const agreed = await confirmDialog({
            title: `Nhập ${data.length} dòng từ file Excel?`,
            message:
                'Dòng có ID sẽ cập nhật sản phẩm đó (không đổi tồn kho), dòng không có ID sẽ tạo sản phẩm mới. Sản phẩm không có trong file vẫn giữ nguyên.',
            confirmText: 'Nhập'
        });
        if (!agreed) return;
        // đổi tên cột tiếng Việt thành tên thuộc tính
        const rows = data.map((row) => Object.fromEntries(EXCEL_COLUMNS.map(([title, key]) => [key, row[title]])));
        const { created, updated } = await api.post('/admin/products/import', { rows }, { timeout: 30000 });
        toast(`Đã tạo ${created} và cập nhật ${updated} sản phẩm.`, { type: 'success' });
        await loadProducts();
    } catch (error) {
        if (error.data?.errors) showExcelErrors(error.data.errors);
        else toast(error.message, { type: 'error' });
    }
}

document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
document.getElementById('importExcelBtn').addEventListener('click', () => document.getElementById('excelFile').click());
document.getElementById('excelFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    // chọn lại đúng file cũ vẫn chạy
    event.target.value = '';
    if (file) importExcel(file);
});
document.getElementById('closeExcelErrorsBtn').addEventListener('click', () => showExcelErrors([]));

// Gọi hàm thực thi
async function initialize() {
    if (!requirePermission('products.view')) return;
    document.getElementById('addTab').classList.toggle('hidden', !canManageProducts);
    settingsForm.classList.toggle('hidden', !canManageProducts);
    document.getElementById('importExcelBtn').classList.toggle('hidden', !canManageProducts);
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
