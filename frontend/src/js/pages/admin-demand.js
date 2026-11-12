// Tab "Nhu cầu khách hàng" của trang Thống kê: tổng hợp hành vi truy cập thành báo cáo cho admin.
import { api } from '../services/api-service.js';
import { toast } from '../components/notify.js';
import { escapeHtml, formatPrice } from '../utils/format.js';
import { productImage } from '../utils/images.js';
import { heroCard, txRow } from '../components/bank-ui.js';
import { getCurrentUser } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { downloadWorkbook } from '../services/excel-service.js';

const el = (id) => document.querySelector(`#${id}`);
const PREVIEW_ROWS = 8;
const LEVELS = {
    high: ['Nhu cầu cao', 'lv-high'],
    medium: ['Trung bình', 'lv-medium'],
    low: ['Thấp', 'lv-low'],
    none: ['Chưa có dữ liệu', 'lv-none']
};
const INSIGHT = { danger: ['stop', 'red'], warning: ['clock', 'orange'], info: ['chat', 'blue'], good: ['check', 'green'] };
const PAGE_NAME = {
    index: 'Trang chủ',
    products: 'Danh sách sản phẩm',
    'product-detail': 'Chi tiết sản phẩm',
    cart: 'Giỏ hàng',
    checkout: 'Thanh toán',
    'order-success': 'Đặt hàng xong',
    'my-orders': 'Đơn hàng của tôi',
    login: 'Đăng nhập',
    dangky: 'Đăng ký',
    feedback: 'Góp ý'
};

let days = 30;
let data = null;
let expanded = false;
let loaded = false;

function duration(seconds) {
    if (!seconds) return '—';
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes} phút ${String(seconds % 60).padStart(2, '0')} giây` : `${seconds} giây`;
}

function renderKpis() {
    const { summary } = data;
    el('demandKpi').innerHTML = heroCard({
        label: `Khách truy cập · ${data.days} ngày gần nhất`,
        value: summary.visitors,
        sub: `<span class="delta-vs">${summary.returning} khách quay lại · ${summary.sessions} phiên truy cập</span>`,
        stats: [
            { label: 'Trang / phiên', value: summary.pagesPerSession },
            { label: 'Thời gian ở lại TB', value: duration(summary.avgSessionSec) },
            {
                label: 'Tỉ lệ thoát',
                value: `${summary.bounceRate}%`,
                note: 'xem 1 trang rồi rời đi',
                warn: summary.bounceRate >= 60 && summary.sessions >= 5
            },
            { label: 'Tỉ lệ chuyển đổi', value: `${summary.conversion}%`, note: 'truy cập → đặt hàng' }
        ]
    });
}

function renderInsights() {
    el('demandInsights').innerHTML = data.insights
        .map((item) => {
            const [iconName, tone] = INSIGHT[item.level] || INSIGHT.info;
            return txRow({ iconName, tone, title: escapeHtml(item.title), sub: escapeHtml(item.detail) });
        })
        .join('');
}

function renderFunnel() {
    const max = Math.max(data.funnel[0].count, 1);
    el('demandFunnel').innerHTML = data.funnel
        .map(
            (step, index) => `
        <div class="funnel-row">
            <span class="funnel-name">${step.label}</span>
            <span class="funnel-track"><i style="width:${(step.count / max) * 100}%"></i></span>
            <span class="funnel-value"><b>${step.count}</b><small>${index === 0 ? '100%' : `${step.ofPrevious}% bước trước`}</small></span>
        </div>`
        )
        .join('');
    el('demandFunnelTable').innerHTML =
        `<thead><tr><th>Bước</th><th>Khách</th><th>% tổng</th><th>% bước trước</th></tr></thead><tbody>${data.funnel.map((step, index) => `<tr><td>${escapeHtml(step.label)}</td><td>${step.count}</td><td>${step.ofTotal}%</td><td>${index ? `${step.ofPrevious}%` : '—'}</td></tr>`).join('')}</tbody>`;
}

function renderHours() {
    const max = Math.max(...data.hours, 1);
    const peak = data.hours.indexOf(Math.max(...data.hours));
    el('demandHours').innerHTML = data.hours
        .map(
            (count, hour) => `
        <div class="hour-col${count && hour === peak ? ' peak' : ''}" title="${hour}h–${hour + 1}h: ${count} lượt xem">
            <i style="height:${(count / max) * 100}%"></i>
            <span>${hour % 3 === 0 ? hour : ''}</span>
        </div>`
        )
        .join('');
    el('demandHoursTable').innerHTML =
        `<thead><tr><th>Giờ</th><th>Lượt xem</th></tr></thead><tbody>${data.hours.map((count, hour) => `<tr><td>${hour}:00–${hour + 1}:00</td><td>${count}</td></tr>`).join('')}</tbody>`;

    const { mobile, desktop } = data.devices;
    const total = mobile + desktop;
    el('demandDevices').innerHTML = total
        ? `
        <div class="split-bar" role="img" aria-label="Tỉ lệ thiết bị">
            ${desktop ? `<i class="seg-a" style="width:${(desktop / total) * 100}%"></i>` : ''}
            ${mobile ? `<i class="seg-b" style="width:${(mobile / total) * 100}%"></i>` : ''}
        </div>
        <div class="legend"><span><i class="dot seg-a"></i>Máy tính ${Math.round((desktop / total) * 100)}%</span><span><i class="dot seg-b"></i>Điện thoại ${Math.round((mobile / total) * 100)}%</span></div>`
        : '';
}

function renderProducts() {
    const rows = data.products.filter((row) => row.views > 0 || row.cartEvents > 0 || row.ordered > 0);
    const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);
    el('demandProducts').innerHTML = shown.length
        ? shown
              .map((row) => {
                  const [label, cls] = LEVELS[row.level];
                  return `<tr>
            <td class="cell-product"><img src="${productImage(row.image)}" alt=""><b>${escapeHtml(row.name)}</b></td>
            <td>${row.views}<small class="muted"> (${row.viewers} người)</small></td>
            <td>${duration(row.avgDwellSec)}</td>
            <td>${row.cartEvents}<small class="muted"> (${row.cartRate}%)</small></td>
            <td>${row.ordered}</td>
            <td>${row.stock <= 0 ? '<span class="status status-cancelled">Hết</span>' : row.stock}</td>
            <td><span class="level ${cls}">${label}</span><small class="muted"> ${row.score}/100</small></td>
        </tr>`;
              })
              .join('')
        : '<tr><td colspan="7" class="muted">Chưa có lượt xem sản phẩm nào trong khoảng này.</td></tr>';
    const more = el('demandMore');
    more.classList.toggle('hidden', rows.length <= PREVIEW_ROWS);
    more.textContent = expanded ? 'Thu gọn' : `Xem tất cả ${rows.length} sản phẩm`;
}

function bars(rows, valueOf, labelOf, noteOf) {
    const max = Math.max(...rows.map(valueOf), 1);
    return rows
        .map(
            (row) => `
        <div class="hbar"><span class="hbar-name">${labelOf(row)}</span>
            <span class="hbar-value">${valueOf(row)}<small>${noteOf(row)}</small></span>
            <span class="hbar-track"><i style="width:${(valueOf(row) / max) * 100}%"></i></span></div>`
        )
        .join('');
}

function renderSide() {
    const categories = data.categories.filter((row) => row.views > 0);
    el('demandCategories').innerHTML = categories.length
        ? bars(
              categories,
              (row) => row.views,
              (row) => escapeHtml(row.name),
              (row) => ` lượt xem · ${row.carts} giỏ`
          )
        : '<p class="muted">Chưa có dữ liệu.</p>';
    el('demandCategoriesTable').innerHTML =
        `<thead><tr><th>Danh mục</th><th>Lượt xem</th><th>Lượt thêm giỏ</th><th>Số đã đặt</th></tr></thead><tbody>${categories.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.views}</td><td>${row.carts}</td><td>${row.ordered}</td></tr>`).join('')}</tbody>`;

    el('demandKeywords').innerHTML = data.keywords.length
        ? `<ul class="kw-list">${data.keywords
              .map(
                  (row) => `
            <li><span>${escapeHtml(row.q)}</span><b>${row.count}</b>${row.noResult ? '<em class="level lv-high bad">Chưa có SP</em>' : `<small class="muted">${row.results} kết quả</small>`}</li>`
              )
              .join('')}</ul>`
        : '<p class="muted">Chưa có ai tìm kiếm.</p>';
    el('demandKeywordsTable').innerHTML =
        `<thead><tr><th>Từ khóa</th><th>Lượt tìm</th><th>Khách</th><th>Kết quả TB</th><th>Chưa có sản phẩm</th></tr></thead><tbody>${data.keywords.map((row) => `<tr><td>${escapeHtml(row.q)}</td><td>${row.count}</td><td>${row.visitors}</td><td>${row.results}</td><td>${row.noResult ? 'Có' : 'Không'}</td></tr>`).join('')}</tbody>`;

    el('demandPages').innerHTML = data.topPages.length
        ? bars(
              data.topPages,
              (row) => row.views,
              (row) => escapeHtml(PAGE_NAME[row.page] || row.page),
              (row) => ` lượt · ${duration(row.avgDwellSec)}`
          )
        : '<p class="muted">Chưa có dữ liệu.</p>';
    el('demandPagesTable').innerHTML =
        `<thead><tr><th>Trang</th><th>Lượt xem</th><th>Thời gian xem TB</th></tr></thead><tbody>${data.topPages.map((row) => `<tr><td>${escapeHtml(PAGE_NAME[row.page] || row.page)}</td><td>${row.views}</td><td>${duration(row.avgDwellSec)}</td></tr>`).join('')}</tbody>`;
}

function render() {
    el('demandNote').textContent = data.hasData
        ? `Dữ liệu ${data.days} ngày gần nhất, ẩn danh (không lưu thông tin cá nhân).`
        : 'Chưa ghi nhận lượt truy cập nào. Số liệu xuất hiện khi khách bắt đầu xem website.';
    renderKpis();
    renderInsights();
    renderFunnel();
    renderHours();
    renderProducts();
    renderSide();
    const urgent = data.insights.filter((item) => ['danger', 'warning'].includes(item.level)).length;
    const badge = el('demandBadge');
    badge.textContent = urgent;
    badge.classList.toggle('hidden', !urgent);
}

async function load() {
    try {
        data = await api.get(`/admin/demand?days=${days}`);
        loaded = true;
        render();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

document.querySelector('#demandRange').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    days = Number(button.dataset.days);
    document.querySelectorAll('#demandRange button').forEach((item) => item.classList.toggle('active', item === button));
    expanded = false;
    load();
});
el('demandMore').addEventListener('click', () => {
    expanded = !expanded;
    renderProducts();
});

// Báo cáo CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt).
el('demandExport').addEventListener('click', () => {
    if (!data) return;
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
        [
            'Sản phẩm',
            'Danh mục',
            'Giá',
            'Tồn kho',
            'Lượt xem',
            'Người xem',
            'Thời gian xem TB (giây)',
            'Lượt thêm giỏ',
            'Tỉ lệ thêm giỏ (%)',
            'Số lượng đã đặt',
            'Điểm quan tâm',
            'Mức nhu cầu'
        ]
    ].concat(
        data.products.map((row) => [
            row.name,
            row.category,
            row.price,
            row.stock,
            row.views,
            row.viewers,
            row.avgDwellSec,
            row.cartEvents,
            row.cartRate,
            row.ordered,
            row.score,
            LEVELS[row.level][0]
        ])
    );
    rows.push([], ['Nhận định']);
    data.insights.forEach((item) => rows.push([item.title, item.detail]));
    const blob = new Blob(['﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `nhu-cau-khach-hang-${data.days}-ngay.csv`
    });
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Đã xuất báo cáo nhu cầu khách hàng.', { type: 'success' });
});

el('demandXlsx').addEventListener('click', async () => {
    if (!data) return;
    try {
        await downloadWorkbook(`nhu-cau-khach-hang-${data.days}-ngay.xlsx`, [
            { name: 'Tong quan', rows: [['Chỉ số', 'Giá trị'], ...Object.entries(data.summary).map(([key, value]) => [key, value])] },
            {
                name: 'Phieu chuyen doi',
                rows: [
                    ['Bước', 'Khách', '% tổng', '% bước trước'],
                    ...data.funnel.map((row, index) => [row.label, row.count, row.ofTotal, index ? row.ofPrevious : ''])
                ]
            },
            {
                name: 'San pham',
                rows: [
                    [
                        'Sản phẩm',
                        'Danh mục',
                        'Giá',
                        'Tồn kho',
                        'Lượt xem',
                        'Người xem',
                        'Thời gian xem TB giây',
                        'Lượt thêm giỏ',
                        'Tỉ lệ thêm giỏ %',
                        'Số lượng đặt',
                        'Điểm nhu cầu',
                        'Mức nhu cầu'
                    ],
                    ...data.products.map((row) => [
                        row.name,
                        row.category,
                        row.price,
                        row.stock,
                        row.views,
                        row.viewers,
                        row.avgDwellSec,
                        row.cartEvents,
                        row.cartRate,
                        row.ordered,
                        row.score,
                        LEVELS[row.level][0]
                    ])
                ]
            },
            {
                name: 'Danh muc',
                rows: [
                    ['Danh mục', 'Lượt xem', 'Lượt thêm giỏ', 'Số đã đặt'],
                    ...data.categories.map((row) => [row.name, row.views, row.carts, row.ordered])
                ]
            },
            {
                name: 'Tu khoa',
                rows: [
                    ['Từ khóa', 'Lượt tìm', 'Khách', 'Kết quả TB', 'Chưa có sản phẩm'],
                    ...data.keywords.map((row) => [row.q, row.count, row.visitors, row.results, row.noResult ? 'Có' : 'Không'])
                ]
            },
            { name: 'Khung gio', rows: [['Giờ', 'Lượt xem'], ...data.hours.map((count, hour) => [`${hour}:00-${hour + 1}:00`, count])] },
            {
                name: 'Trang xem',
                rows: [
                    ['Trang', 'Lượt xem', 'Thời gian xem TB giây'],
                    ...data.topPages.map((row) => [PAGE_NAME[row.page] || row.page, row.views, row.avgDwellSec])
                ]
            },
            {
                name: 'Nhan dinh',
                rows: [['Mức độ', 'Nhận định', 'Gợi ý'], ...data.insights.map((row) => [row.level, row.title, row.detail])]
            }
        ]);
        toast('Đã xuất báo cáo nhu cầu Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
});

// Chỉ tải dữ liệu khi admin mở tab này (tiết kiệm tài nguyên); riêng số đỏ trên tab thì tải sau khi trang mở xong.
document.querySelector('#dashTabs').addEventListener('click', (event) => {
    if (event.target.closest('[data-tab="demand"]') && !loaded) load();
});
if (hasPermission('customers.analytics', getCurrentUser())) {
    if (sessionStorage.getItem('dashTab') === 'demand') load();
    else setTimeout(() => !loaded && load(), 1500);
}
