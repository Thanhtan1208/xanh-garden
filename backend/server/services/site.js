import { db } from '../core/store.js';
import { lunarToSolar } from './lunar.js';

// Giao diện theo sự kiện: chọn sự kiện đang chạy và banner tương ứng.
// Sự kiện có 3 kiểu lặp:
//  - once:   một lần, theo startAt/endAt cố định.
//  - yearly: hằng năm theo dương lịch (Noel 25/12, Halloween 31/10, 20/10...).
//  - lunar:  hằng năm theo âm lịch (Tết 1/1, Trung thu 15/8...), ngày dương lịch tự tính lại mỗi năm.
// Sự kiện lặp chạy từ (ngày lễ - daysBefore) 00:00 đến hết (ngày lễ + daysAfter), theo giờ Việt Nam.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// Khoảng diễn ra của sự kiện lặp ở năm `year` (năm âm lịch nếu lặp theo âm lịch).
function occurrence(event, year) {
    let anchor;
    if (event.recurrence === 'lunar') {
        anchor = lunarToSolar(event.day, event.month, year);
    } else {
        const day = event.month === 2 && event.day === 29 && !isLeap(year) ? 28 : event.day; // 29/2 năm không nhuận -> 28/2
        anchor = { day, month: event.month, year };
    }
    const anchorStart = Date.UTC(anchor.year, anchor.month - 1, anchor.day) - VN_OFFSET_MS;
    return {
        startAt: new Date(anchorStart - (event.daysBefore || 0) * DAY_MS).toISOString(),
        endAt: new Date(anchorStart + ((event.daysAfter || 0) + 1) * DAY_MS - 1).toISOString(),
        holiday: new Date(anchorStart).toISOString()
    };
}

// Khoảng đang diễn ra (nếu đang trong sự kiện) hoặc lần sắp tới gần nhất; sự kiện một lần trả về chính nó.
export function eventWindow(event, time = Date.now()) {
    if (!event.recurrence || event.recurrence === 'once') return { startAt: event.startAt, endAt: event.endAt, holiday: null };
    const year = new Date(time + VN_OFFSET_MS).getUTCFullYear();
    // Xét cả năm trước/năm sau vì khoảng sự kiện có thể vắt qua năm mới (Tết, Noel - Tết dương lịch...).
    const windows = [year - 1, year, year + 1, year + 2].map((y) => occurrence(event, y));
    return (
        windows.find((w) => time >= Date.parse(w.startAt) && time <= Date.parse(w.endAt)) ||
        windows.find((w) => Date.parse(w.startAt) > time)
    );
}

const isRunning = (window, time) => Boolean(window) && time >= Date.parse(window.startAt) && time <= Date.parse(window.endAt);

// Sự kiện đang diễn ra (kèm startAt/endAt của lần đang chạy): trùng thời gian thì ưu tiên cao hơn thắng,
// bằng nhau thì sự kiện bắt đầu muộn hơn (cụ thể hơn) thắng.
export function currentEvent(time = Date.now()) {
    return (
        db.events
            .filter((event) => event.active)
            .map((event) => ({ ...event, ...eventWindow(event, time) }))
            .filter((event) => isRunning(event, time))
            .sort((a, b) => b.priority - a.priority || b.startAt.localeCompare(a.startAt))[0] || null
    );
}

const bannerLive = (banner, time) =>
    (!banner.startAt || time >= Date.parse(banner.startAt)) && (!banner.endAt || time <= Date.parse(banner.endAt));

// Banner hiển thị: của sự kiện đang chạy; không có sự kiện (hoặc sự kiện chưa gắn banner nào) thì dùng banner mặc định.
export function activeBanners(event, time = Date.now()) {
    const live = db.banners.filter((banner) => banner.active && bannerLive(banner, time));
    const forEvent = event ? live.filter((banner) => banner.eventId === event.id) : [];
    const list = forEvent.length ? forEvent : live.filter((banner) => !banner.eventId);
    return list.sort((a, b) => a.order - b.order).map(({ id, name, image, link }) => ({ id, name, image, link }));
}
