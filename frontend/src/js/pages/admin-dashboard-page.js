import { api } from '../services/api-service.js';
import '../components/header.js';
import { getCurrentUser, requirePermission } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { productImage } from '../utils/images.js';
import { toast } from '../components/notify.js';
import { deltaPill, emptyRow, heroCard, txRow } from '../components/bank-ui.js';
import { downloadWorkbook } from '../services/excel-service.js';
import './admin-demand.js';
import './admin-customers.js';

// Trang Thống kê: 4 tab (Doanh thu, Kho & vận hành, Nhu cầu khách — xem admin-demand.js, Đánh giá).
// Mỗi tab mở đầu bằng một thẻ tổng quan lớn, bên dưới là biểu đồ và các danh sách dạng "lịch sử giao dịch".
const el = (id) => document.querySelector(`#${id}`);
const yearSelect = el('yearSelect');
const quarterSelect = el('quarterSelect');
const monthSelect = el('monthSelect');
const dateSelect = el('dateSelect');
const periodButtons = [...document.querySelectorAll('#periodSeg button')];

let period = 'month';
let lastData = null;
const currentUser = getCurrentUser();
const canViewSales = hasPermission('dashboard.sales', currentUser);
const canManagePayments = hasPermission('payments.manage', currentUser);
const canManageInventory = hasPermission('inventory.manage', currentUser);

monthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Tháng ${i + 1}</option>`).join('');
// Mở trang là xem tháng và quý hiện tại
monthSelect.value = String(new Date().getMonth() + 1);
quarterSelect.value = String(Math.floor(new Date().getMonth() / 3) + 1);
// Ngày mặc định khi chọn xem theo Ngày hoặc Tuần là hôm nay (giờ máy, dạng YYYY-MM-DD)
dateSelect.value = new Date().toLocaleDateString('sv-SE');

// Tab
function showTab(name) {
    const allowed = {
        revenue: canViewSales,
        inventory: hasPermission('dashboard.operations', currentUser),
        demand: canViewSales && hasPermission('customers.analytics', currentUser),
        reviews: canViewSales,
        customers: canViewSales && hasPermission('customers.analytics', currentUser)
    };
    if (!allowed[name]) name = canViewSales ? 'revenue' : 'inventory';
    const scrollY = window.scrollY;
    document.querySelectorAll('#dashTabs button').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
    window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    try {
        sessionStorage.setItem('dashTab', name);
    } catch {
        /* bỏ qua nếu bị chặn lưu trữ */
    }
}
el('dashTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('button[data-tab]');
    if (tab) showTab(tab.dataset.tab);
});
try {
    showTab(sessionStorage.getItem('dashTab') || 'revenue');
} catch {
    showTab('revenue');
}

// Kiểu hiển thị: Biểu đồ hoặc Bảng (bảng mở sẵn mọi mục "Xem số liệu dạng bảng", ẩn phần biểu đồ)
function showView(view) {
    const asTable = view === 'table';
    document.querySelector('.dash').classList.toggle('view-table', asTable);
    document.querySelectorAll('details.chart-table').forEach((box) => (box.open = asTable));
    document.querySelectorAll('#viewSeg button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    try {
        localStorage.setItem('dashView', view);
    } catch {
        /* bỏ qua nếu bị chặn lưu trữ */
    }
}
el('viewSeg').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) showView(button.dataset.view);
});
try {
    showView(localStorage.getItem('dashView') === 'table' ? 'table' : 'chart');
} catch {
    showView('chart');
}

function setBadge(id, count) {
    el(id).textContent = count;
    el(id).classList.toggle('hidden', !count);
}

// Số tiền rút gọn cho trục biểu đồ: 1,2 tr / 3,4 tỷ.
function short(value) {
    const fmt = (number) => number.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    if (value >= 1e9) return `${fmt(value / 1e9)} tỷ`;
    if (value >= 1e6) return `${fmt(value / 1e6)} tr`;
    if (value >= 1e3) return `${fmt(value / 1e3)} k`;
    return String(value);
}

// Trục tung tròn số: 4 khoảng đều nhau, mỗi khoảng là 1, 2, 5 × 10^n.
function niceTop(value) {
    if (value <= 0) return 4;
    const raw = value / 4;
    const power = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((unit) => unit * power).find((step) => step >= raw) * 4;
}

// "2026-11-12" -> "12/11/2026"
const viDate = (iso) => iso.split('-').reverse().join('/');
const periodText = ({ year, period: kind, quarter, month, date, from, to }) =>
    kind === 'day'
        ? `Ngày ${viDate(date)}`
        : kind === 'week'
          ? `Tuần ${viDate(from)} – ${viDate(to)}`
          : kind === 'quarter'
            ? `Quý ${quarter}/${year}`
            : kind === 'month'
              ? `Tháng ${month}/${year}`
              : `Năm ${year}`;

// Doanh thu
// Chỉ số phụ: kỳ trước chưa có số liệu thì không hiện gì (tránh lặp chữ "chưa có số liệu").
const statDelta = (current, previous) => (previous ? deltaPill(current, previous) : '');
// Chữ viết tắt cho vòng tròn của danh mục: "Cây lọc không khí" -> "LK", "Sen đá & xương rồng" -> "SĐ".
const initials = (name) =>
    name
        .split(/\s+/)
        .filter((word) => !['cây', '&'].includes(word.toLowerCase()))
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('');

function renderRevenueHero(data) {
    const { summary, previous, filter } = data;
    const vs = previous.label.toLowerCase();
    el('revenueHero').innerHTML = heroCard({
        label: `Doanh thu thực nhận · ${periodText(filter)}`,
        value: formatPrice(summary.revenue),
        sub: deltaPill(summary.revenue, previous.revenue, vs),
        stats: [
            { label: 'Đơn đã giao', value: summary.deliveredOrders, note: statDelta(summary.deliveredOrders, previous.orders) },
            { label: 'Sản phẩm đã bán', value: summary.units, note: statDelta(summary.units, previous.units) },
            {
                label: 'Giá trị TB / đơn',
                value: formatPrice(summary.averageOrder),
                note: statDelta(summary.averageOrder, previous.average)
            },
            { label: 'Đã giảm giá (voucher)', value: formatPrice(summary.discount || 0) },
            {
                label: 'Tỉ lệ hủy đơn',
                value: `${summary.cancelRate}%`,
                note: `${summary.cancelledOrders}/${summary.allOrders} đơn`,
                warn: summary.cancelRate >= 20
            }
        ]
    });
}

// Dữ liệu của biểu đồ: xem tháng thì theo từng ngày so với tháng trước, xem quý hoặc năm thì 12 tháng so với năm trước.
function chartData({ filter, previous, days, prevDays, months, prevMonths }) {
    // Ngày: 24 giờ; tuần: 7 ngày. Hàng có sẵn nhãn (label) từ server.
    if (filter.period === 'day' || filter.period === 'week')
        return { byDay: true, labeled: true, rows: days, prevRows: prevDays, curName: periodText(filter), prevName: previous.label };
    return filter.period === 'month'
        ? {
              byDay: true,
              rows: days,
              prevRows: prevDays,
              curName: `T${filter.month}/${filter.year}`,
              prevName: previous.label.replace('Tháng ', 'T')
          }
        : { byDay: false, rows: months, prevRows: prevMonths, curName: String(filter.year), prevName: String(filter.year - 1) };
}

// Biểu đồ đường SVG: kỳ đang xem (vùng tô) và kỳ so sánh (nét đứt). Xem quý hoặc năm thì bấm vào tháng để xem theo ngày.
function renderMonthChart(data) {
    const { filter } = data;
    const { byDay, labeled, rows, prevRows, curName, prevName } = chartData(data);
    const W = 720;
    const H = 240;
    const left = 48;
    const right = 12;
    const top = 16;
    const bottom = 28;
    const max = niceTop(Math.max(...rows.map((row) => row.revenue), ...prevRows.map((row) => row.revenue)));
    const step = (W - left - right) / (rows.length - 1);
    const last = rows.length - 1;
    const x = (index) => left + index * step;
    const y = (value) => top + (1 - value / max) * (H - top - bottom);
    const line = (list) => list.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(row.revenue).toFixed(1)}`).join(' ');
    const area = `${line(rows)} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`;
    const inFocus = (row) => byDay || filter.period === 'year' || Math.ceil(row.month / 3) === filter.quarter;
    // Theo ngày thì chỉ ghi vài mốc cho đỡ rối
    // Theo giờ chỉ ghi vài mốc; theo tuần ghi hết 7 ngày
    const axisLabel = (row, index) =>
        labeled
            ? filter.period === 'day'
                ? index % 3 === 0
                    ? row.label
                    : ''
                : row.label.split(' ')[0]
            : byDay
              ? [1, 5, 10, 15, 20, 25, 30].includes(row.day)
                  ? row.day
                  : ''
              : `T${row.month}`;

    el('chartTitle').textContent = labeled
        ? `Doanh thu ${filter.period === 'day' ? 'theo giờ' : 'theo ngày'} · ${curName}`
        : byDay
          ? `Doanh thu theo ngày · Tháng ${filter.month}/${filter.year}`
          : `Doanh thu 12 tháng · Năm ${filter.year}`;
    el('monthLegend').innerHTML = `<span><i class="dot cur"></i>${curName}</span><span><i class="dot prev"></i>${prevName}</span>`;
    el('monthChart').classList.toggle('by-day', byDay);
    el('monthChart').innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${el('chartTitle').textContent}">
            <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--green)" stop-opacity=".28"/><stop offset="1" stop-color="var(--green)" stop-opacity="0"/></linearGradient></defs>
            ${[0, 1, 2, 3, 4]
                .map((step) => {
                    const value = (max / 4) * step;
                    return `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(value)}" y2="${y(value)}"/><text class="axis" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${value ? short(value) : '0'}</text>`;
                })
                .join('')}
            <path class="area" d="${area}" fill="url(#areaFill)"/>
            <path class="line-prev" d="${line(prevRows)}"/>
            <path class="line-cur" d="${line(rows)}"/>
            ${rows
                .map(
                    (row, index) => `
                <g class="pt${inFocus(row) ? '' : ' dim'}" data-index="${index}">
                    <rect x="${x(index) - step / 2}" y="${top}" width="${step}" height="${H - top - bottom}" class="hit"/>
                    <circle cx="${x(index)}" cy="${y(row.revenue)}" r="${byDay ? 3 : 4}"/>
                    <text class="axis" x="${x(index)}" y="${H - 8}" text-anchor="middle">${axisLabel(row, index)}</text>
                </g>`
                )
                .join('')}
        </svg>`;

    const rowName = (row) => (labeled ? row.label : byDay ? `Ngày ${row.day}` : `Tháng ${row.month}`);
    el('monthTable').innerHTML =
        `<thead><tr><th>${filter.period === 'day' ? 'Giờ' : byDay ? 'Ngày' : 'Tháng'}</th><th>${curName}</th><th>Số đơn</th><th>${prevName}</th></tr></thead><tbody>${rows
            .map(
                (row, index) =>
                    `<tr><td>${rowName(row)}</td><td>${formatPrice(row.revenue)}</td><td>${row.orders}</td><td>${formatPrice(prevRows[index].revenue)}</td></tr>`
            )
            .join('')}</tbody>`;
}

const tooltip = (() => {
    const box = document.createElement('div');
    box.className = 'chart-tip hidden';
    document.body.append(box);
    return {
        show(html, event) {
            box.innerHTML = html;
            box.classList.remove('hidden');
            const x = Math.min(event.clientX + 14, window.innerWidth - box.offsetWidth - 8);
            box.style.left = `${Math.max(8, x)}px`;
            box.style.top = `${Math.max(8, event.clientY - box.offsetHeight - 12)}px`;
        },
        hide() {
            box.classList.add('hidden');
        }
    };
})();

el('monthChart').addEventListener('mousemove', (event) => {
    const point = event.target.closest('.pt');
    if (!point || !lastData) return tooltip.hide();
    const { byDay, labeled, rows, prevRows, prevName } = chartData(lastData);
    const index = Number(point.dataset.index);
    const cur = rows[index];
    const prev = prevRows[index];
    const { month, year } = lastData.filter;
    tooltip.show(
        `<b>${labeled ? cur.label : byDay ? `Ngày ${cur.day}/${month}/${year}` : `Tháng ${cur.month}/${year}`}</b>
        <div><i class="dot cur"></i>${formatPrice(cur.revenue)} · ${cur.orders} đơn</div>
        <div><i class="dot prev"></i>${prevName}: ${formatPrice(prev.revenue)}</div>
        <div>${deltaPill(cur.revenue, prev.revenue)}</div>
        ${byDay ? '' : '<small>Bấm để xem theo ngày của tháng này</small>'}`,
        event
    );
});
el('monthChart').addEventListener('mouseleave', () => tooltip.hide());
el('monthChart').addEventListener('click', (event) => {
    const point = event.target.closest('.pt');
    if (!point || ['month', 'day', 'week'].includes(lastData?.filter.period)) return;
    tooltip.hide();
    period = 'month';
    monthSelect.value = lastData.months[Number(point.dataset.index)].month;
    load();
});

function renderLists(data) {
    const { quarters, byCategory, byPayment, summary, filter, topProducts } = data;

    const yearTotal = quarters.reduce((sum, row) => sum + row.revenue, 0);
    const bestQuarter = Math.max(...quarters.map((row) => row.revenue));
    el('quarterTotal').textContent = `Tổng ${formatPrice(yearTotal)}`;
    el('quarterList').innerHTML = quarters
        .map((row) =>
            txRow({
                letter: `Q${row.quarter}`,
                tone: filter.period === 'quarter' && filter.quarter === row.quarter ? 'blue' : 'gray',
                title: `Quý ${row.quarter}${bestQuarter > 0 && row.revenue === bestQuarter ? ' <em class="chip chip-best">Cao nhất</em>' : ''}`,
                sub: `${row.orders} đơn · ${row.units} sản phẩm`,
                amount: formatPrice(row.revenue),
                note: yearTotal ? `${Math.round((row.revenue / yearTotal) * 100)}%` : '',
                bar: yearTotal ? (row.revenue / yearTotal) * 100 : 0,
                attrs: `data-quarter="${row.quarter}"`
            })
        )
        .join('');
    el('quarterTable').innerHTML =
        `<thead><tr><th>Quý</th><th>Doanh thu</th><th>Đơn</th><th>Sản phẩm</th></tr></thead><tbody>${quarters.map((row) => `<tr><td>Quý ${row.quarter}</td><td>${formatPrice(row.revenue)}</td><td>${row.orders}</td><td>${row.units}</td></tr>`).join('')}</tbody>`;

    const goods = summary.goods || 0;
    el('categoryList').innerHTML = byCategory.length
        ? byCategory
              .map((row) =>
                  txRow({
                      letter: initials(row.name),
                      tone: 'green',
                      title: escapeHtml(row.name),
                      amount: formatPrice(row.revenue),
                      note: goods ? `${Math.round((row.revenue / goods) * 100)}%` : '',
                      bar: goods ? (row.revenue / goods) * 100 : 0
                  })
              )
              .join('')
        : emptyRow('Chưa có đơn đã giao trong kỳ này.');
    el('categoryTable').innerHTML =
        `<thead><tr><th>Danh mục</th><th>Doanh thu</th><th>Tỉ trọng</th></tr></thead><tbody>${byCategory.length ? byCategory.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${formatPrice(row.revenue)}</td><td>${goods ? Math.round((row.revenue / goods) * 100) : 0}%</td></tr>`).join('') : '<tr><td colspan="3">Chưa có dữ liệu.</td></tr>'}</tbody>`;

    const methods = [
        ['cod', 'Thanh toán khi nhận (COD)', 'seg-a', 'box'],
        ['sepay', 'Chuyển khoản QR (SePay)', 'seg-b', 'pay']
    ];
    const sum = methods.reduce((s, [key]) => s + byPayment[key].revenue, 0);
    el('paymentSplit').innerHTML = sum
        ? `
        <div class="split-bar" role="img" aria-label="Tỉ lệ doanh thu theo hình thức thanh toán">
            ${methods.map(([key, , cls]) => (byPayment[key].revenue ? `<i class="${cls}" style="width:${(byPayment[key].revenue / sum) * 100}%"></i>` : '')).join('')}
        </div>
        <div class="tx-list">${methods
            .map(([key, label, , iconName]) =>
                txRow({
                    iconName,
                    tone: key === 'cod' ? 'green' : 'blue',
                    title: label,
                    sub: `${byPayment[key].orders} đơn`,
                    amount: formatPrice(byPayment[key].revenue),
                    note: `${Math.round((byPayment[key].revenue / sum) * 100)}%`
                })
            )
            .join('')}</div>`
        : emptyRow('Chưa có đơn đã giao trong kỳ này.');
    el('paymentTable').innerHTML =
        `<thead><tr><th>Phương thức</th><th>Doanh thu</th><th>Đơn</th></tr></thead><tbody>${methods.map(([key, label]) => `<tr><td>${label}</td><td>${formatPrice(byPayment[key].revenue)}</td><td>${byPayment[key].orders}</td></tr>`).join('')}</tbody>`;

    el('topProducts').innerHTML = topProducts.length
        ? topProducts
              .map((row, index) =>
                  txRow({
                      letter: String(index + 1),
                      tone: index === 0 ? 'orange' : 'gray',
                      title: escapeHtml(row.name),
                      sub: `${row.qty} sản phẩm`,
                      amount: formatPrice(row.revenue)
                  })
              )
              .join('')
        : emptyRow('Chưa có đơn đã giao trong kỳ này.');
    el('topProductsTable').innerHTML =
        `<thead><tr><th>Sản phẩm</th><th>Số lượng</th><th>Doanh thu hàng</th></tr></thead><tbody>${topProducts.length ? topProducts.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.qty}</td><td>${formatPrice(row.revenue)}</td></tr>`).join('') : '<tr><td colspan="3">Chưa có dữ liệu.</td></tr>'}</tbody>`;
}

el('quarterList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-quarter]');
    if (!row) return;
    period = 'quarter';
    quarterSelect.value = row.dataset.quarter;
    load();
});

// Đánh giá & cải thiện
const IMPROVEMENT = {
    rating: ['star', 'orange'],
    stock: ['box', 'red'],
    sales: ['chevronDown', 'gray'],
    feedback: ['reply', 'blue'],
    payment: ['pay', 'red']
};

function renderReviews(data) {
    const { ratings, summary, improvements, recentBadReviews } = data;
    setBadge('reviewBadge', improvements.length + recentBadReviews.length);
    el('reviewHero').innerHTML = heroCard({
        label: 'Điểm đánh giá trung bình',
        value: ratings.count ? `${ratings.average} <small>/ 5</small>` : '—',
        sub: `<span class="delta-vs">${ratings.count} lượt đánh giá từ khách đã nhận hàng</span>`,
        stats: [
            { label: 'Đơn chờ xác nhận', value: summary.waiting, warn: summary.waiting > 0 },
            { label: 'Phản hồi chưa trả lời', value: summary.openFeedbacks, warn: summary.openFeedbacks > 0 },
            { label: 'Việc cần cải thiện', value: improvements.length, warn: improvements.length > 0 }
        ]
    });

    const maxCount = Math.max(...ratings.distribution.map((row) => row.count), 1);
    el('ratings').innerHTML = ratings.count
        ? `<div class="tx-list">${[...ratings.distribution]
              .reverse()
              .map((row) =>
                  txRow({
                      letter: `${row.star}★`,
                      tone: row.star >= 4 ? 'green' : row.star === 3 ? 'gray' : 'red',
                      title: `${row.star} sao`,
                      amount: String(row.count),
                      bar: (row.count / maxCount) * 100
                  })
              )
              .join('')}</div>`
        : emptyRow('Chưa có đánh giá nào.');
    el('ratingTable').innerHTML =
        `<thead><tr><th>Số sao</th><th>Số đánh giá</th></tr></thead><tbody>${ratings.distribution.map((row) => `<tr><td>${row.star} sao</td><td>${row.count}</td></tr>`).join('')}</tbody>`;

    el('improvements').innerHTML = improvements.length
        ? improvements
              .map((item) => {
                  const [iconName, tone] = IMPROVEMENT[item.type] || ['stop', 'gray'];
                  return txRow({ iconName, tone, title: escapeHtml(item.name), sub: escapeHtml(item.detail) });
              })
              .join('')
        : emptyRow('Mọi thứ đang ổn.');

    el('badReviews').innerHTML = recentBadReviews.length
        ? recentBadReviews
              .slice(0, 5)
              .map((review) =>
                  txRow({
                      letter: `${review.rating}★`,
                      tone: 'red',
                      title: escapeHtml(review.productName),
                      sub: `“${escapeHtml(review.comment)}” · ${escapeHtml(review.userName)}`,
                      note: formatDate(review.createdAt)
                  })
              )
              .join('')
        : emptyRow('Không có đánh giá xấu nào.');
}

function render(data) {
    const { filter } = data;
    yearSelect.innerHTML = data.years
        .map((year) => `<option value="${year}"${year === filter.year ? ' selected' : ''}>${year}</option>`)
        .join('');
    period = filter.period;
    periodButtons.forEach((button) => button.classList.toggle('active', button.dataset.period === period));
    quarterSelect.value = String(filter.quarter);
    monthSelect.value = String(filter.month);
    quarterSelect.classList.toggle('hidden', period !== 'quarter');
    monthSelect.classList.toggle('hidden', period !== 'month');
    dateSelect.value = filter.date;
    dateSelect.classList.toggle('hidden', period !== 'day' && period !== 'week');
    yearSelect.classList.toggle('hidden', period === 'day' || period === 'week');

    lastData = data;
    renderRevenueHero(data);
    renderMonthChart(data);
    renderLists(data);
    renderReviews(data);
}

async function load() {
    const params = new URLSearchParams({ period, quarter: quarterSelect.value, month: monthSelect.value });
    if (dateSelect.value) params.set('date', dateSelect.value);
    if (yearSelect.value) params.set('year', yearSelect.value);
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load(`/admin/stats?${params}`, (data) => {
            render(data);
            el('error').classList.add('hidden');
            el('dashboard').classList.remove('hidden');
            el('loading').classList.add('hidden');
        });
    } catch (error) {
        el('error').textContent = error.message;
        el('error').classList.remove('hidden');
    } finally {
        el('loading').classList.add('hidden');
    }
}

periodButtons.forEach((button) =>
    button.addEventListener('click', () => {
        period = button.dataset.period;
        load();
    })
);
[yearSelect, quarterSelect, monthSelect, dateSelect].forEach((select) => select.addEventListener('change', load));

async function exportRevenueReport() {
    if (!lastData) return;
    const {
        filter,
        summary,
        previous,
        days,
        prevDays,
        months,
        prevMonths,
        quarters,
        byCategory,
        byPayment,
        topProducts,
        ratings,
        recentBadReviews
    } = lastData;
    try {
        await downloadWorkbook(`doanh-thu-${filter.year}-${filter.period}.xlsx`, [
            {
                name: 'Tong quan',
                rows: [
                    ['Chỉ số', 'Giá trị'],
                    ['Kỳ', periodText(filter)],
                    ['Doanh thu thực nhận', summary.revenue],
                    ['Doanh thu hàng', summary.goods],
                    ['Phí vận chuyển', summary.shipping],
                    ['Giảm giá', summary.discount],
                    ['Đơn đã giao', summary.deliveredOrders],
                    ['Sản phẩm đã bán', summary.units],
                    ['Giá trị trung bình mỗi đơn', summary.averageOrder],
                    ['Doanh thu kỳ trước', previous.revenue]
                ]
            },
            ...(['month', 'day', 'week'].includes(filter.period)
                ? [
                      {
                          name: filter.period === 'day' ? 'Theo gio' : 'Theo ngay',
                          rows: [
                              [filter.period === 'day' ? 'Giờ' : 'Ngày', periodText(filter), 'Số đơn', previous.label],
                              ...days.map((row, index) => [row.label ?? row.day, row.revenue, row.orders, prevDays[index].revenue])
                          ]
                      }
                  ]
                : []),
            {
                name: 'Theo thang',
                rows: [
                    ['Tháng', String(filter.year), 'Số đơn', String(filter.year - 1)],
                    ...months.map((row, index) => [row.month, row.revenue, row.orders, prevMonths[index].revenue])
                ]
            },
            {
                name: 'Theo quy',
                rows: [['Quý', 'Doanh thu', 'Đơn', 'Sản phẩm'], ...quarters.map((row) => [row.quarter, row.revenue, row.orders, row.units])]
            },
            { name: 'Danh muc', rows: [['Danh mục', 'Doanh thu'], ...byCategory.map((row) => [row.name, row.revenue])] },
            {
                name: 'Thanh toan',
                rows: [
                    ['Phương thức', 'Doanh thu', 'Đơn'],
                    ...[
                        ['COD', byPayment.cod],
                        ['SePay', byPayment.sepay]
                    ].map(([name, row]) => [name, row.revenue, row.orders])
                ]
            },
            {
                name: 'San pham',
                rows: [['Sản phẩm', 'Số lượng', 'Doanh thu hàng'], ...topProducts.map((row) => [row.name, row.qty, row.revenue])]
            },
            {
                name: 'Danh gia',
                rows: [
                    ['Số sao', 'Số đánh giá'],
                    ...ratings.distribution.map((row) => [row.star, row.count]),
                    [],
                    ['Sản phẩm', 'Sao', 'Nhận xét', 'Ngày'],
                    ...recentBadReviews.map((row) => [row.productName, row.rating, row.comment, row.createdAt])
                ]
            }
        ]);
        toast('Đã xuất báo cáo doanh thu Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
}

el('revenueExport').addEventListener('click', exportRevenueReport);
el('reviewsExport').addEventListener('click', exportRevenueReport);

// Kho & vận hành
let inventory = null;
let invFilter = 'all';
let invExpanded = false;
const INV_PREVIEW = 6;
const STOCK_BADGE = {
    ok: '',
    low: '<span class="status status-pending">Sắp hết</span>',
    out: '<span class="status status-cancelled">Hết hàng</span>'
};
const TODO_ICON = {
    pending: 'clock',
    confirmed: 'box',
    shipping: 'send',
    unconfirmed: 'chat',
    unpaid: 'pay',
    refund: 'refresh',
    complaint: 'reply',
    payments: 'pay',
    integrity: 'stop'
};
const PAYMENT_RESULT = {
    no_order: 'Không khớp đơn nào',
    underpaid: 'Chuyển thiếu tiền',
    overpaid: 'Chuyển thừa tiền (cần hoàn phần dư)',
    duplicate_payment: 'Đơn đã thanh toán trước đó',
    order_cancelled: 'Đơn đã hủy (cần hoàn tiền)'
};

function renderInventory() {
    const { totals, todo, products, payments, integrity } = inventory;
    el('invHero').innerHTML = heroCard({
        label: 'Giá trị hàng tồn kho (theo giá bán)',
        value: formatPrice(totals.value),
        sub: `<span class="delta-vs">${totals.units} sản phẩm trong kho · ${totals.products} mặt hàng</span>`,
        stats: [
            { label: 'Sắp hết hàng', value: totals.low, note: `còn 1–${inventory.lowStockAt}`, warn: totals.low > 0 },
            { label: 'Hết hàng', value: totals.out, note: 'cần nhập thêm', warn: totals.out > 0 },
            { label: 'Việc đang chờ', value: todo.reduce((sum, item) => sum + item.count, 0) }
        ]
    });

    const pending = todo.filter((item) => item.count > 0);
    el('todoList').innerHTML = pending.length
        ? pending
              .map((item) =>
                  txRow({
                      iconName: TODO_ICON[item.key] || 'clock',
                      tone: item.urgent ? 'red' : 'green',
                      title: escapeHtml(item.label),
                      amount: String(item.count),
                      href: item.href.startsWith('#') ? '' : item.href
                  })
              )
              .join('')
        : emptyRow('Không có việc nào tồn đọng.');

    el('alertList').innerHTML =
        payments.length || integrity.length
            ? [
                  ...payments.map(
                      (payment) => `<div class="tx-row">
            <span class="tx-icon tone-red">${icon('pay', { size: 18 })}</span>
            <span class="tx-body"><b>${escapeHtml(PAYMENT_RESULT[payment.result] || payment.result)}</b><small>${payment.orderCode ? `Đơn ${escapeHtml(payment.orderCode)}` : 'Không có đơn'} · ${formatDate(payment.receivedAt)} · “${escapeHtml(payment.content)}”</small></span>
            <span class="tx-amount"><b>${formatPrice(payment.amount)}</b>${canManagePayments ? `<button type="button" class="link-button" data-handled="${payment.id}">Đã xử lý</button>` : ''}</span>
        </div>`
                  ),
                  ...integrity.map((text) => txRow({ iconName: 'stop', tone: 'red', title: 'Dữ liệu bất thường', sub: escapeHtml(text) }))
              ].join('')
            : emptyRow('Không có cảnh báo nào.');

    const attention = totals.low + totals.out + todo.filter((item) => item.urgent).reduce((sum, item) => sum + item.count, 0);
    setBadge('invBadge', attention);

    const keyword = el('invSearch').value.trim().toLowerCase();
    const rows = products
        .filter((product) => (invFilter === 'all' || product.status === invFilter) && product.name.toLowerCase().includes(keyword))
        .sort((a, b) => ({ out: 0, low: 1, ok: 2 })[a.status] - { out: 0, low: 1, ok: 2 }[b.status] || a.stock - b.stock);
    el('invEmpty').classList.toggle('hidden', rows.length > 0);
    el('invTable').hidden = !rows.length;
    const shown = invExpanded || keyword ? rows : rows.slice(0, INV_PREVIEW);
    el('invMore').classList.toggle('hidden', keyword !== '' || rows.length <= INV_PREVIEW);
    el('invMore').textContent = invExpanded ? 'Thu gọn' : `Xem tất cả ${rows.length} sản phẩm`;
    el('invBody').innerHTML = shown
        .map(
            (product) => `
        <tr data-id="${product.id}" class="inv-${product.status}">
            <td class="cell-product"><img src="${productImage(product.image)}" alt=""><span><b>${escapeHtml(product.name)}</b><small class="muted block">${escapeHtml(product.category)} · ${formatPrice(product.price)}</small></span></td>
            <td><b>${product.stock}</b> ${STOCK_BADGE[product.status]}</td>
            <td>${product.inFlight}</td>
            <td>${product.sold}</td>
            <td>${formatPrice(product.value)}</td>
            <td>${product.arrivedAt ? formatDate(product.arrivedAt) : '<span class="muted">—</span>'}</td>
            <td>${canManageInventory ? `<form class="restock" data-id="${product.id}"><input type="number" min="1" max="100000" step="1" placeholder="SL" aria-label="Số lượng nhập thêm"><button class="icon-btn icon-btn-primary" type="submit" aria-label="Nhập kho" title="Nhập kho">${icon('plus')}</button></form>` : '—'}</td>
        </tr>`
        )
        .join('');
}

el('alertList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-handled]');
    if (!button) return;
    try {
        await api.patch(`/admin/payments/${button.dataset.handled}/handled`);
        toast('Đã đánh dấu giao dịch là đã xử lý.', { type: 'success' });
        await loadInventory();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

async function loadInventory() {
    try {
        await api.load('/admin/inventory', (data) => {
            inventory = data;
            renderInventory();
            if (!canViewSales) {
                el('dashboard').classList.remove('hidden');
                el('loading').classList.add('hidden');
            }
        });
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

el('inventoryExport').addEventListener('click', async () => {
    if (!inventory) return;
    const keyword = el('invSearch').value.trim().toLowerCase();
    const products = inventory.products.filter(
        (product) => (invFilter === 'all' || product.status === invFilter) && product.name.toLowerCase().includes(keyword)
    );
    try {
        await downloadWorkbook('ton-kho.xlsx', [
            {
                name: 'Ton kho',
                rows: [
                    ['Sản phẩm', 'Danh mục', 'Giá bán', 'Tồn kho', 'Trong đơn', 'Đã bán', 'Giá trị tồn', 'Ngày nhập gần nhất'],
                    ...products.map((row) => [
                        row.name,
                        row.category,
                        row.price,
                        row.stock,
                        row.inFlight,
                        row.sold,
                        row.value,
                        row.arrivedAt || ''
                    ])
                ]
            }
        ]);
        toast('Đã xuất báo cáo tồn kho Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
});

el('invMore').addEventListener('click', () => {
    invExpanded = !invExpanded;
    renderInventory();
});
el('invSearch').addEventListener('input', () => inventory && renderInventory());
el('invSeg').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    invFilter = button.dataset.f;
    invExpanded = false;
    el('invSeg')
        .querySelectorAll('button')
        .forEach((item) => item.classList.toggle('active', item === button));
    renderInventory();
});
el('invBody').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target.closest('.restock');
    const add = Number(form.querySelector('input').value);
    if (!Number.isInteger(add) || add < 1) return toast('Nhập số lượng nguyên lớn hơn 0.', { type: 'warning' });
    try {
        const result = await api.patch(`/admin/products/${form.dataset.id}/stock`, { add });
        toast(`Đã nhập thêm ${add}. Tồn kho hiện tại: ${result.stock}.`, { type: 'success', title: 'Nhập hàng thành công' });
        await loadInventory();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

if (requirePermission('dashboard.operations')) {
    document.querySelectorAll('#dashTabs button').forEach((button) => {
        const allowed = button.dataset.tab === 'inventory' || canViewSales;
        button.classList.toggle('hidden', !allowed);
    });
    showTab(sessionStorage.getItem('dashTab') || (canViewSales ? 'revenue' : 'inventory'));
    if (canViewSales) load();
    loadInventory();
}
