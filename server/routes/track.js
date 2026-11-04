import { Router } from 'express';
import { record } from '../services/analytics.js';
import { ApiError, handle } from '../core/http.js';
import { isManagementRole } from '../core/permissions.js';

const router = Router();

const TYPES = new Set(['pv', 'leave', 'add_cart', 'search', 'filter', 'checkout', 'order']);
const ID = /^[a-z0-9]{8,32}$/;
const SLUG = /^[\w.\-]{1,40}$/;

// Giới hạn tần suất theo IP để không ai làm đầy nhật ký (240 sự kiện/phút).
const hits = new Map();
function limited(ip) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.reset) {
        hits.set(ip, { count: 1, reset: now + 60000 });
        return false;
    }
    entry.count += 1;
    return entry.count > 240;
}
setInterval(() => { const now = Date.now(); hits.forEach((value, key) => { if (now > value.reset) hits.delete(key); }); }, 300000).unref();

const int = (value, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : undefined;
};
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

// Chỉ nhận các trường đã biết, ép kiểu và giới hạn độ dài; không lưu thông tin cá nhân.
function clean(raw, userId, now) {
    if (!raw || !TYPES.has(raw.type) || !ID.test(raw.v || '') || !ID.test(raw.s || '')) return null;
    const event = { t: now, type: raw.type, v: raw.v, s: raw.s };
    if (userId) event.u = userId;
    if (typeof raw.page === 'string' && SLUG.test(raw.page)) event.page = raw.page;
    const pid = text(raw.pid, 24);
    if (pid && /^[\w-]+$/.test(pid)) event.pid = pid;
    if (raw.dur !== undefined) event.dur = int(raw.dur, 0, 1800000);
    if (raw.type === 'search') {
        const q = text(raw.q, 60)?.toLowerCase();
        if (!q) return null;
        event.q = q;
        event.n = int(raw.n, 0, 9999) ?? 0;
    }
    if (raw.type === 'filter') {
        event.cat = text(raw.cat, 24);
        if (raw.price) event.price = text(raw.price, 20);
    }
    if (raw.type === 'add_cart') event.qty = int(raw.qty, 1, 99) ?? 1;
    if (raw.dev === 'm' || raw.dev === 'd') event.dev = raw.dev;
    return event;
}

router.post('/', handle((req, res) => {
    if (limited(req.ip)) throw new ApiError(429, 'Quá nhiều yêu cầu.');
    if (isManagementRole(req.user)) return res.status(204).end(); // không ghi lại hành vi của role quản lý
    const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, 10) : [];
    const now = Date.now();
    const accepted = list.map((raw) => clean(raw, req.user?.id, now)).filter(Boolean);
    if (accepted.length) record(accepted);
    res.status(204).end();
}));

export default router;
