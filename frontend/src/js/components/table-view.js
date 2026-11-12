import { iconButton } from '../utils/icons.js';

// Nút chuyển kiểu xem cho bảng quản trị: "Dạng bảng" (hàng tên cột đứng yên khi cuộn) hoặc "Dạng thẻ".
// Dùng: thêm data-view-key="tên-trang" vào khung .table-wrap, rồi import file này.

const VIEWS = [
    ['list', 'table', 'Xem dạng bảng'],
    ['grid', 'cards', 'Xem dạng thẻ']
];

const storageKey = (key) => `tableView:${key}`;

function savedView(key) {
    try {
        return localStorage.getItem(storageKey(key)) === 'cards' ? 'cards' : 'table';
    } catch {
        return 'table';
    }
}

// Ghi tên cột vào từng ô (data-label) để dạng thẻ biết mỗi giá trị thuộc cột nào. Bỏ qua cột đang ẩn.
function labelCells(table) {
    const names = [...table.querySelectorAll('thead th')].filter((th) => !th.hidden).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
        [...row.children].forEach((cell, index) => {
            if (cell.colSpan > 1) cell.removeAttribute('data-label');
            else cell.dataset.label = names[index] || '';
        });
    });
}

function enable(wrap) {
    const table = wrap.querySelector('table');
    if (!table) return;
    const key = wrap.dataset.viewKey;
    const bar = document.createElement('div');
    bar.className = 'view-toggle table-view-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Kiểu hiển thị');
    wrap.before(bar);

    function show(view) {
        wrap.classList.toggle('view-cards', view === 'cards');
        bar.innerHTML = VIEWS.map(([name, value, label]) =>
            iconButton(name, label, { cls: view === value ? 'active' : '', attrs: { 'data-view': value, 'aria-pressed': view === value } })
        ).join('');
        try {
            localStorage.setItem(storageKey(key), view);
        } catch {
            /* bỏ qua nếu bị chặn lưu trữ */
        }
    }
    bar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-view]');
        if (button) show(button.dataset.view);
    });

    // Bảng đổ lại dữ liệu thì ghi lại nhãn cột; bảng đang ẩn (chưa tải xong) thì ẩn luôn nút
    new MutationObserver(() => {
        labelCells(table);
        bar.hidden = table.hidden;
    }).observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    labelCells(table);
    bar.hidden = table.hidden;
    show(savedView(key));
}

document.querySelectorAll('.table-wrap[data-view-key]').forEach(enable);
