import { api } from './api-service.js';

// Giao diện theo sự kiện: lấy sự kiện đang chạy + banner từ server và áp màu chủ đề lên toàn bộ trang bằng CSS variables.
// Bản đã tải được nhớ trong localStorage (không hết hạn theo phút) để trang sau áp màu ngay, không bị nháy màu mặc định;
// mỗi trang vẫn hỏi lại server ở nền nên màu luôn được cập nhật.
const CACHE_KEY = 'siteTheme';

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
function shade(hex, amount) {
    const number = Number.parseInt(hex.slice(1), 16);
    const mix = (channel) => clamp(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
    const [r, g, b] = [(number >> 16) & 255, (number >> 8) & 255, number & 255].map(mix);
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function applyTheme(theme) {
    const style = document.documentElement.style;
    ['--green', '--green-dark', '--accent', '--accent-dark'].forEach((name) => style.removeProperty(name));
    if (!theme) return;
    // primary là màu nền thanh menu (đậm); màu nút/liên kết nhạt hơn một chút để vẫn đọc rõ trên nền trắng.
    style.setProperty('--green-dark', theme.primary);
    style.setProperty('--green', shade(theme.primary, 0.12));
    style.setProperty('--accent', theme.accent);
    style.setProperty('--accent-dark', shade(theme.accent, -0.2));
}

function readCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        const endAt = cached?.site?.event?.endAt;
        // Sự kiện trong bản nhớ đã kết thúc thì bỏ, dùng màu mặc định
        return cached && !(endAt && Date.parse(endAt) < Date.now()) ? cached.site : null;
    } catch {
        return null;
    }
}

// Bản đã nhớ (không gọi server) để trang vẽ banner/thanh sự kiện ngay khi mở
export const cachedSite = () => readCache();

let pending = null;
export function getSite() {
    pending ||= api.get('/site').then((site) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), site })); } catch { /* bỏ qua nếu bị chặn */ }
        applyTheme(site.event?.theme);
        return site;
    }).catch(() => ({ event: null, banners: [] }));
    return pending;
}

// Áp màu từ bản nhớ ngay lập tức (đồng bộ) rồi làm mới ở nền.
const cached = readCache();
if (cached) applyTheme(cached.event?.theme);
getSite();
