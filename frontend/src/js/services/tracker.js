// Ghi nhận hành vi khách để phân tích nhu cầu (tương tự Google Analytics nhưng lưu trên máy chủ của cửa hàng).
// Chỉ dùng mã ẩn danh ngẫu nhiên; không lưu họ tên, email, địa chỉ. Tôn trọng "Do Not Track" và bỏ qua quản trị viên.
import { getToken, getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const enabled = navigator.doNotTrack !== '1' && !isManagementRole(getCurrentUser());

function randomId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stored(storage, key, create) {
    try {
        let value = storage.getItem(key);
        if (!value) {
            value = create();
            storage.setItem(key, value);
        }
        return value;
    } catch {
        return create(); // trình duyệt chặn lưu trữ: dùng mã tạm cho trang này
    }
}

const visitorId = stored(localStorage, 'xg_vid', randomId);

// Phiên mới khi mở tab mới hoặc quay lại sau hơn 30 phút không hoạt động.
function sessionId() {
    try {
        const last = Number(sessionStorage.getItem('xg_last') || 0);
        if (last && Date.now() - last > SESSION_IDLE_MS) sessionStorage.removeItem('xg_sid');
        sessionStorage.setItem('xg_last', String(Date.now()));
    } catch {
        /* bỏ qua */
    }
    return stored(sessionStorage, 'xg_sid', randomId);
}

const device = window.matchMedia('(max-width: 768px)').matches ? 'm' : 'd';
const page = (window.location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
const params = new URLSearchParams(window.location.search);
const pageProduct = page === 'product-detail' ? params.get('id') : undefined;

function send(event) {
    if (!enabled) return;
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // keepalive để yêu cầu vẫn được gửi khi khách đóng tab hoặc chuyển trang.
    fetch('/api/track', {
        method: 'POST',
        headers,
        keepalive: true,
        body: JSON.stringify({ events: [{ v: visitorId, s: sessionId(), dev: device, ...event }] })
    }).catch(() => {
        /* theo dõi lỗi không được làm hỏng trang */
    });
}

export const trackAddToCart = (pid, qty = 1) => send({ type: 'add_cart', pid: String(pid), qty, page });
export const trackSearch = (q, n) => q && send({ type: 'search', q, n, page });
export const trackFilter = (cat) => send({ type: 'filter', cat: String(cat || 'all'), page });
export const trackCheckoutStart = () => send({ type: 'checkout', page });
export function trackOrderOnce(code) {
    try {
        if (sessionStorage.getItem(`xg_ord_${code}`)) return;
        sessionStorage.setItem(`xg_ord_${code}`, '1');
    } catch {
        /* bỏ qua */
    }
    send({ type: 'order', page });
}

// Lượt xem trang và thời gian ở lại (chỉ tính lúc tab đang hiển thị)
if (enabled) {
    send({ type: 'pv', page, pid: pageProduct });

    let shownAt = document.visibilityState === 'visible' ? Date.now() : null;
    let accumulated = 0;

    const flush = () => {
        if (shownAt) {
            accumulated += Date.now() - shownAt;
            shownAt = null;
        }
        if (accumulated >= 500) {
            send({ type: 'leave', page, pid: pageProduct, dur: accumulated });
            accumulated = 0;
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
        else shownAt = Date.now();
    });
    window.addEventListener('pagehide', flush);
}
