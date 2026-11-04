import { clearSession, getCurrentUser, getToken } from '../utils/auth.js';

const API_BASE_URL = '/api';
const REQUEST_TIMEOUT = 8000;

async function request(path, { method = 'GET', data, timeout = REQUEST_TIMEOUT } = {}) {
    const headers = {};
    const token = getToken();
    // Thao tác đổi dữ liệu (đặt/hủy đơn, sửa sản phẩm...) thì bỏ bản nhớ để trang sau tải mới; giỏ hàng và chat không ảnh hưởng
    if (method !== 'GET' && !/^\/(cart|chat)\b/.test(path)) clearApiCache();
    if (data) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers,
            body: data ? JSON.stringify(data) : undefined,
            signal: controller.signal
        });

        const body = response.status === 204 ? null : await response.json().catch(() => null);
        if (!response.ok) {
            // Token hết hạn hoặc không hợp lệ: xóa phiên để người dùng đăng nhập lại.
            if (response.status === 401 && token) {
                clearSession();
                clearApiCache();
            }
            if (!body?.message) {
                // Không có JSON từ API: Vite không nối được tới server (chưa chạy) hoặc mở sai địa chỉ.
                throw new Error(response.status >= 500
                    ? 'Không kết nối được máy chủ API. Hãy chạy "npm run server" rồi tải lại trang.'
                    : `Không tìm thấy API (HTTP ${response.status}). Hãy mở trang qua "npm run dev" (http://localhost:5173).`);
            }
            throw Object.assign(new Error(body.message), { data: body });
        }
        return body;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('Máy chủ không phản hồi. Vui lòng thử lại.');
        if (error instanceof TypeError) throw new Error('Không kết nối được máy chủ. Hãy chạy npm run server.');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Tải một tệp (ảnh/video) lên: gửi thẳng nội dung tệp, Content-Type là loại tệp.
async function upload(path, blob) {
    const token = getToken();
    const headers = { 'Content-Type': blob.type || 'application/octet-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: blob, signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message || 'Không tải được tệp lên. Vui lòng thử lại.');
        return body;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('Tải tệp quá lâu. Vui lòng thử lại.');
        if (error instanceof TypeError) throw new Error('Không kết nối được máy chủ để tải tệp.');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ===== Chuyển trang không giật: vẽ ngay bằng dữ liệu đã nhớ rồi cập nhật ở nền (stale-while-revalidate) =====
// Bản nhớ nằm trong sessionStorage theo tài khoản: mất khi đóng tab, bị xóa khi đăng xuất hoặc khi có thao tác đổi dữ liệu.
const CACHE_PREFIX = 'apiCache:';
const cacheKey = (path) => `${CACHE_PREFIX}${getCurrentUser()?.id || 'guest'}:${path}`;

function readCache(path) {
    try {
        return sessionStorage.getItem(cacheKey(path));
    } catch {
        return null;
    }
}

function writeCache(path, text) {
    try {
        sessionStorage.setItem(cacheKey(path), text);
    } catch { /* bộ nhớ đầy hoặc bị chặn: bỏ qua */ }
}

export function clearApiCache() {
    try {
        Object.keys(sessionStorage).filter((key) => key.startsWith(CACHE_PREFIX)).forEach((key) => sessionStorage.removeItem(key));
    } catch { /* bỏ qua */ }
}

// Tải dữ liệu để vẽ trang: paths là 1 đường dẫn hoặc mảng, render nhận kết quả theo đúng thứ tự.
// Đã có bản nhớ thì render chạy NGAY, trước khi trình duyệt vẽ khung đầu, nên trang hiện đủ nội dung, không nhảy;
// sau đó vẫn hỏi server, dữ liệu mới khác bản nhớ thì render lại tại chỗ.
async function load(paths, render) {
    const list = Array.isArray(paths) ? paths : [paths];
    const cached = list.map(readCache);
    if (cached.every(Boolean)) render(...cached.map((text) => JSON.parse(text)));
    const fresh = await Promise.all(list.map((path) => request(path)));
    const texts = fresh.map((data) => JSON.stringify(data));
    texts.forEach((text, index) => writeCache(list[index], text));
    if (texts.some((text, index) => text !== cached[index])) render(...fresh);
    return fresh;
}

export const api = {
    upload,
    load,
    get: (path) => request(path),
    post: (path, data, options) => request(path, { method: 'POST', data, ...options }),
    patch: (path, data) => request(path, { method: 'PATCH', data: data ?? {} }),
    put: (path, data) => request(path, { method: 'PUT', data }),
    delete: (path) => request(path, { method: 'DELETE' })
};
