import { api } from '../services/api-service.js';
import { requirePermission } from '../utils/auth.js';
import { escapeHtml, formatDate } from '../utils/format.js';
import { fromLocalInput, timeState, toLocalInput } from '../utils/dates.js';
import { iconButton } from '../utils/icons.js';
import { bannerImage } from '../utils/images.js';
import { confirmDialog, toast } from '../components/notify.js';
import '../components/header.js';

const eventForm = document.querySelector('#eventForm');
const bannerForm = document.querySelector('#bannerForm');
const eventBody = document.querySelector('#eventBody');
const bannerBody = document.querySelector('#bannerBody');

let events = [];
let banners = [];
let editingEvent = null;
let editingBanner = null;

const TIME_LABEL = { upcoming: ['Sắp diễn ra', 'status-pending'], running: ['Đang chạy', 'status-delivered'], ended: ['Đã kết thúc', 'status-cancelled'] };

// Sự kiện dùng "window" do server tính (lần đang chạy hoặc lần sắp tới); banner dùng ngày của chính nó.
function stateBadge(item) {
    if (!item.active) return '<span class="status status-cancelled">Đã tắt</span>';
    const [label, css] = TIME_LABEL[timeState(item.window || item)];
    return `<span class="status ${css}">${label}</span>`;
}

// Banner thuộc sự kiện chỉ hiện khi sự kiện đó đang chạy; banner mặc định chỉ hiện khi không có sự kiện nào chạy.
function bannerBadge(banner) {
    const badge = (label, css) => `<span class="status ${css}">${label}</span>`;
    if (!banner.active) return badge('Đã tắt', 'status-cancelled');
    if (timeState(banner) === 'ended') return badge('Đã kết thúc', 'status-cancelled');
    if (banner.eventId) {
        const event = events.find((item) => item.id === banner.eventId);
        if (!event?.active) return badge('Sự kiện đã tắt', 'status-cancelled');
        return timeState(event.window || event) === 'running' ? badge('Đang hiện', 'status-delivered') : badge('Chờ tới sự kiện', 'status-pending');
    }
    const eventRunning = events.some((event) => event.active && event.window && timeState(event.window) === 'running');
    return eventRunning ? badge('Tạm ẩn (đang có sự kiện)', 'status-pending') : badge('Đang hiện', 'status-delivered');
}

const shortDate = (iso) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const REPEAT_TEXT = { yearly: 'Hằng năm (dương lịch)', lunar: 'Hằng năm (âm lịch)' };

// Mô tả thời gian: sự kiện lặp ghi ngày lễ + lần diễn ra hiện tại/sắp tới (âm lịch đã đổi ra dương lịch).
function scheduleText(event) {
    const window = event.window;
    if (!event.recurrence || event.recurrence === 'once') {
        return `${formatDate(event.startAt)} → ${formatDate(event.endAt)}<small class="muted block">Một lần · ưu tiên ${event.priority}</small>`;
    }
    const range = window ? `${shortDate(window.startAt)} → ${shortDate(window.endAt)}` : '';
    const lunarNote = event.recurrence === 'lunar' && window?.holiday ? ` (năm nay rơi vào ${shortDate(window.holiday)})` : '';
    return `<b>${REPEAT_TEXT[event.recurrence]}: ${event.day}/${event.month}</b>${lunarNote}
        <small class="muted block">${timeState(window || {}) === 'running' ? 'Đang chạy' : 'Lần tới'}: ${range} · ưu tiên ${event.priority}</small>`;
}

const actions = () => `<span class="row-actions">${iconButton('edit', 'Sửa', { attrs: { 'data-action': 'edit' } })}${iconButton('trash', 'Xóa', { tone: 'danger', attrs: { 'data-action': 'delete' } })}</span>`;

function renderEvents() {
    eventBody.innerHTML = events.length ? events.map((event) => `
        <tr data-id="${event.id}">
            <td><b>${escapeHtml(event.name)}</b>${event.theme.slogan ? `<small class="muted block">${escapeHtml(event.theme.slogan)}</small>` : ''}</td>
            <td>${scheduleText(event)}</td>
            <td><span class="swatch" style="background:${event.theme.primary}"></span><span class="swatch" style="background:${event.theme.accent}"></span></td>
            <td>${stateBadge(event)}</td>
            <td>${actions()}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">Chưa có sự kiện nào.</td></tr>';

    bannerForm.elements.namedItem('eventId').innerHTML = '<option value="">Mặc định (khi không có sự kiện)</option>' +
        events.map((event) => `<option value="${event.id}">${escapeHtml(event.name)}</option>`).join('');
}

function renderBanners() {
    const eventName = (id) => events.find((event) => event.id === id)?.name || 'Mặc định';
    bannerBody.innerHTML = banners.length ? banners.map((banner) => `
        <tr data-id="${banner.id}">
            <td class="cell-product"><img src="${bannerImage(banner.image)}" alt="" class="banner-thumb"><b>${escapeHtml(banner.name)}</b></td>
            <td>${escapeHtml(eventName(banner.eventId))}</td>
            <td>${banner.link ? `<code>${escapeHtml(banner.link)}</code>` : '<span class="muted">—</span>'}</td>
            <td>${banner.order}</td>
            <td>${bannerBadge(banner)}</td>
            <td>${actions()}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="muted">Chưa có banner nào. Trang chủ đang dùng khối giới thiệu mặc định.</td></tr>';
}

// ===== Sự kiện =====
// Hiện ô nhập theo kiểu lặp: lặp hằng năm nhập ngày/tháng + số ngày trước/sau, một lần thì nhập ngày giờ cụ thể.
function syncRepeatFields() {
    const recurrence = eventForm.elements.namedItem('recurrence').value;
    document.querySelector('#onceFields').classList.toggle('hidden', recurrence !== 'once');
    document.querySelector('#yearlyFields').classList.toggle('hidden', recurrence === 'once');
    eventForm.elements.namedItem('day').max = recurrence === 'lunar' ? 29 : 31;
    document.querySelector('#repeatHint').textContent = recurrence === 'lunar'
        ? 'Nhập ngày/tháng ÂM LỊCH (ví dụ Tết = 1/1, Trung thu = 15/8). Mỗi năm hệ thống tự đổi ra ngày dương lịch.'
        : 'Ví dụ: Noel 25/12 bắt đầu trước 14 ngày, kéo dài sau 1 ngày → chạy từ 11/12 đến hết 26/12 mỗi năm.';
}
eventForm.elements.namedItem('recurrence').addEventListener('change', syncRepeatFields);

function openEvent(event) {
    editingEvent = event?.id ?? null;
    const field = (name) => eventForm.elements.namedItem(name);
    document.querySelector('#eventFormTitle').textContent = event ? `Sửa: ${event.name}` : 'Sự kiện mới';
    field('name').value = event?.name ?? '';
    field('priority').value = event?.priority ?? 0;
    field('recurrence').value = event?.recurrence || (event ? 'once' : 'yearly');
    field('day').value = event?.day ?? '';
    field('month').value = event?.month ?? '';
    field('daysBefore').value = event?.daysBefore ?? 7;
    field('daysAfter').value = event?.daysAfter ?? 0;
    field('startAt').value = toLocalInput(event?.startAt);
    field('endAt').value = toLocalInput(event?.endAt);
    syncRepeatFields();
    field('primary').value = event?.theme.primary ?? '#124d29';
    field('accent').value = event?.theme.accent ?? '#d35400';
    field('slogan').value = event?.theme.slogan ?? '';
    field('active').checked = event?.active ?? true;
    document.querySelector('#eventMessage').textContent = '';
    eventForm.classList.remove('hidden');
    field('name').focus();
}

eventForm.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    const field = (name) => eventForm.elements.namedItem(name);
    const data = {
        name: field('name').value.trim(),
        priority: Number(field('priority').value),
        recurrence: field('recurrence').value,
        day: Number(field('day').value),
        month: Number(field('month').value),
        daysBefore: Number(field('daysBefore').value || 0),
        daysAfter: Number(field('daysAfter').value || 0),
        startAt: fromLocalInput(field('startAt').value),
        endAt: fromLocalInput(field('endAt').value),
        active: field('active').checked,
        theme: { primary: field('primary').value, accent: field('accent').value, slogan: field('slogan').value.trim() }
    };
    try {
        const saved = editingEvent ? await api.put(`/admin/events/${editingEvent}`, data) : await api.post('/admin/events', data);
        events = editingEvent ? events.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...events];
        eventForm.classList.add('hidden');
        localStorage.removeItem('siteTheme'); // để giao diện áp màu mới ngay
        toast(`Đã lưu sự kiện “${saved.name}”.`, { type: 'success' });
        renderEvents();
        renderBanners();
    } catch (error) {
        document.querySelector('#eventMessage').textContent = error.message;
    }
});

eventBody.addEventListener('click', async (clickEvent) => {
    const button = clickEvent.target.closest('[data-action]');
    const event = button && events.find((item) => item.id === button.closest('tr').dataset.id);
    if (!event) return;
    if (button.dataset.action === 'edit') return openEvent(event);
    if (!await confirmDialog({ title: `Xóa sự kiện “${event.name}”?`, confirmText: 'Xóa', tone: 'danger' })) return;
    try {
        await api.delete(`/admin/events/${event.id}`);
        events = events.filter((item) => item !== event);
        localStorage.removeItem('siteTheme');
        renderEvents();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

// ===== Banner =====
function showPreview() {
    const value = bannerForm.elements.namedItem('image').value.trim();
    document.querySelector('#bannerPreview').innerHTML = value
        ? `<div class="banner-slide preview" style="background-image:url('${bannerImage(value)}')"><span class="banner-caption"><b>${escapeHtml(bannerForm.elements.namedItem('name').value || 'Tên banner')}</b></span></div>`
        : '';
}

function openBanner(banner) {
    editingBanner = banner?.id ?? null;
    const field = (name) => bannerForm.elements.namedItem(name);
    document.querySelector('#bannerFormTitle').textContent = banner ? `Sửa: ${banner.name}` : 'Banner mới';
    field('name').value = banner?.name ?? '';
    field('eventId').value = banner?.eventId ?? '';
    field('image').value = banner?.image ?? '';
    field('link').value = banner?.link ?? '';
    field('order').value = banner?.order ?? banners.length;
    field('startAt').value = toLocalInput(banner?.startAt);
    field('endAt').value = toLocalInput(banner?.endAt);
    field('active').checked = banner?.active ?? true;
    document.querySelector('#bannerFile').value = '';
    document.querySelector('#bannerMessage').textContent = '';
    bannerForm.classList.remove('hidden');
    showPreview();
    field('name').focus();
}

bannerForm.elements.namedItem('image').addEventListener('input', showPreview);
bannerForm.elements.namedItem('name').addEventListener('input', showPreview);

// Chọn ảnh từ máy: tải lên ngay để có đường dẫn, rồi mới bấm Lưu banner.
document.querySelector('#bannerFile').addEventListener('change', async (changeEvent) => {
    const file = changeEvent.target.files[0];
    if (!file) return;
    const message = document.querySelector('#bannerMessage');
    message.textContent = 'Đang tải ảnh lên...';
    try {
        const { url } = await api.upload('/admin/uploads/banner', file);
        bannerForm.elements.namedItem('image').value = url;
        message.textContent = '';
        showPreview();
    } catch (error) {
        message.textContent = error.message;
    }
});

bannerForm.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    const field = (name) => bannerForm.elements.namedItem(name);
    const data = {
        name: field('name').value.trim(),
        eventId: field('eventId').value || null,
        image: field('image').value.trim(),
        link: field('link').value.trim(),
        order: Number(field('order').value),
        startAt: fromLocalInput(field('startAt').value),
        endAt: fromLocalInput(field('endAt').value),
        active: field('active').checked
    };
    try {
        const saved = editingBanner ? await api.put(`/admin/banners/${editingBanner}`, data) : await api.post('/admin/banners', data);
        banners = (editingBanner ? banners.map((item) => (item.id === saved.id ? saved : item)) : [...banners, saved]).sort((a, b) => a.order - b.order);
        bannerForm.classList.add('hidden');
        toast(`Đã lưu banner “${saved.name}”.`, { type: 'success' });
        renderBanners();
    } catch (error) {
        document.querySelector('#bannerMessage').textContent = error.message;
    }
});

bannerBody.addEventListener('click', async (clickEvent) => {
    const button = clickEvent.target.closest('[data-action]');
    const banner = button && banners.find((item) => item.id === button.closest('tr').dataset.id);
    if (!banner) return;
    if (button.dataset.action === 'edit') return openBanner(banner);
    if (!await confirmDialog({ title: `Xóa banner “${banner.name}”?`, confirmText: 'Xóa', tone: 'danger' })) return;
    try {
        await api.delete(`/admin/banners/${banner.id}`);
        banners = banners.filter((item) => item !== banner);
        renderBanners();
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
});

document.querySelector('#newEventBtn').addEventListener('click', () => openEvent());
document.querySelector('#newBannerBtn').addEventListener('click', () => openBanner());
document.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.cancel}`).classList.add('hidden')));

async function initialize() {
    if (!requirePermission('content.manage')) return;
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load(['/admin/events', '/admin/banners'], (eventList, bannerList) => {
            events = eventList;
            banners = bannerList;
            renderEvents();
            renderBanners();
        });
    } catch (error) {
        toast(error.message, { type: 'error' });
    }
}

initialize();
