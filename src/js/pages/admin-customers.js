import { api } from '../services/api-service.js';
import { toast } from '../components/notify.js';
import { formatDate } from '../utils/format.js';
import { heroCard } from '../components/bank-ui.js';
import { downloadWorkbook } from '../services/excel-service.js';

const $ = (selector) => document.querySelector(selector);
let days = 30;
let report = null;
let loaded = false;

function render() {
    const { summary, daily } = report;
    $('#customerKpi').innerHTML = heroCard({
        label: `Khách truy cập ẩn danh · ${days} ngày`,
        value: summary.visitors.toLocaleString('vi-VN'),
        sub: `${summary.previousVisitors.toLocaleString('vi-VN')} khách trong kỳ liền trước · không ghép với tài khoản`,
        stats: [
            { label: 'Tài khoản khách hàng', value: summary.registeredCustomers },
            { label: 'Đăng ký trong kỳ', value: summary.newRegistrations },
            { label: 'Chưa từng đặt đơn', value: summary.neverOrderedCustomers, note: `Mới đăng ký kỳ này: ${summary.neverOrderedRegistrations}` },
            { label: 'Khách có đơn trong kỳ', value: summary.buyers, note: `${summary.orders} đơn không bị hủy` },
            { label: 'Mua lần đầu', value: summary.firstTimeBuyers },
            { label: 'Khách quay lại', value: summary.repeatBuyers, note: `${summary.previousBuyers} khách mua trong kỳ liền trước` }
        ]
    });
    $('#customerDailyTable').innerHTML = `
        <thead><tr><th>Ngày</th><th>Khách truy cập</th><th>Lượt xem</th><th>Đăng ký</th><th>Chưa có đơn</th><th>Khách có đơn</th><th>Mua lần đầu</th><th>Quay lại</th><th>Số đơn</th></tr></thead>
        <tbody>${daily.map((row) => `<tr>
            <td>${formatDate(`${row.date}T00:00:00`)}</td><td>${row.visitors}</td><td>${row.pageViews}</td>
            <td>${row.registrations}</td><td>${row.neverOrderedRegistrations}</td><td>${row.buyers}</td>
            <td>${row.firstTimeBuyers}</td><td>${row.repeatBuyers}</td><td>${row.orders}</td>
        </tr>`).join('')}</tbody>`;
}

async function load() {
    try {
        report = await api.get(`/admin/customer-analytics?days=${days}`);
        loaded = true;
        render();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

$('#customerRange').addEventListener('click', (event) => {
    const button = event.target.closest('[data-days]');
    if (!button) return;
    days = Number(button.dataset.days);
    $('#customerRange').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    load();
});

function exportRows() {
    return [
        ['Ngày', 'Khách truy cập ẩn danh', 'Lượt xem trang', 'Tài khoản đăng ký', 'Đăng ký chưa từng đặt đơn', 'Khách có đơn', 'Khách mua lần đầu', 'Khách quay lại', 'Số đơn'],
        ...report.daily.map((row) => [row.date, row.visitors, row.pageViews, row.registrations, row.neverOrderedRegistrations, row.buyers, row.firstTimeBuyers, row.repeatBuyers, row.orders])
    ];
}

$('#customerCsv').addEventListener('click', () => {
    if (!report) return;
    const csv = exportRows().map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `khach-hang-${days}-ngay.csv` });
    link.click();
    URL.revokeObjectURL(url);
});

$('#customerXlsx').addEventListener('click', async () => {
    if (!report) return;
    try {
        await downloadWorkbook(`khach-hang-${days}-ngay.xlsx`, [
            { name: 'Tổng quan', rows: [['Chỉ số', 'Giá trị'], ...Object.entries(report.summary), [], ['Định nghĩa', 'Giải thích'], ...Object.entries(report.definitions)] },
            { name: 'Theo ngày', rows: exportRows() }
        ]);
        toast('Đã xuất báo cáo khách hàng Excel.', { type: 'success' });
    } catch (error) {
        toast(`Không xuất được Excel: ${error.message}`, { type: 'error' });
    }
});

$('#dashTabs').addEventListener('click', (event) => {
    if (event.target.closest('[data-tab="customers"]') && !loaded) load();
});

if (sessionStorage.getItem('dashTab') === 'customers') load();
