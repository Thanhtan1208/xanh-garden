// Bấm vào tên cột của bảng quản trị để sắp xếp tăng dần, bấm lại để giảm dần.
// Nhận ra ngày (12/11/2026, 14:56 5/11/26), số và tiền (16.595.000 ₫, 45%), còn lại so sánh chữ có tính số (Tháng 2 < Tháng 10).
// Bảng không muốn sắp xếp: thêm thuộc tính data-no-sort vào <table>.

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

// Giá trị dùng để so sánh của một ô: { type, value }
function sortValue(cell) {
    const text = (cell?.dataset.sort ?? cell?.textContent ?? '').trim();
    const date = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (date) {
        const time = text.match(/(\d{1,2}):(\d{2})/);
        const year = Number(date[3]) < 100 ? 2000 + Number(date[3]) : Number(date[3]);
        return {
            type: 'date',
            value: Date.UTC(year, Number(date[2]) - 1, Number(date[1]), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0)
        };
    }
    if (/^-?[\d.,\s]+\s*(đ|₫|%)?$/i.test(text) && /\d/.test(text)) {
        return { type: 'number', value: Number(text.replace(/[^\d,-]/g, '').replace(',', '.')) };
    }
    return { type: 'text', value: text };
}

function compare(a, b) {
    if (a.type === b.type && a.type !== 'text') return a.value - b.value;
    // Ô trống hoặc dấu gạch ngang luôn nằm cuối khi tăng dần
    const empty = (item) => item.type === 'text' && (item.value === '' || item.value === '—');
    if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
    return collator.compare(String(a.value), String(b.value));
}

// Hàng chi tiết (detail-row) đi liền hàng chính phía trên nên sắp xếp theo nhóm
function groupRows(tbody) {
    const groups = [];
    [...tbody.children].forEach((row) => {
        if (row.classList.contains('detail-row') && groups.length) groups.at(-1).push(row);
        else groups.push([row]);
    });
    return groups;
}

function sortTable(table, th) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const columns = [...th.parentElement.children].filter((item) => !item.hidden);
    const index = columns.indexOf(th);
    const direction = th.classList.contains('sort-asc') ? 'desc' : 'asc';
    const groups = groupRows(tbody).filter((group) => group[0].children.length > 1);
    if (groups.length < 2) return;
    groups.sort((a, b) => compare(sortValue(a[0].children[index]), sortValue(b[0].children[index])) * (direction === 'asc' ? 1 : -1));
    groups.forEach((group) => group.forEach((row) => tbody.append(row)));
    th.parentElement.querySelectorAll('th').forEach((item) => item.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
}

document.addEventListener('click', (event) => {
    const th = event.target.closest('.data-table thead th');
    const table = th?.closest('table');
    if (!th || table.hasAttribute('data-no-sort') || !th.textContent.trim()) return;
    sortTable(table, th);
});
