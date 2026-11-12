import { api } from './api-service.js';
import { getCurrentUser, getToken } from '../utils/auth.js';

// Giỏ hàng: các hàm đọc/ghi vẫn đồng bộ trên localStorage (giao diện phản hồi ngay), còn khi đã đăng nhập
// thì mọi thay đổi được đẩy lên server (debounce) để giỏ gắn với TÀI KHOẢN: đổi máy hay đăng nhập lại vẫn còn.
//   - Khách chưa đăng nhập: khóa "cart".
//   - Khách đã đăng nhập:   khóa "cart:<userId>"; lần tải trang đầu tiên sẽ gộp giỏ của khách vào giỏ tài khoản.
const GUEST_KEY = 'cart';
const PUSH_DELAY_MS = 500;

const normalizeId = (id) => String(id ?? '').trim();

function normalizeQuantity(value) {
    const quantity = Number.parseInt(value, 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function normalizeCart(items) {
    if (!Array.isArray(items)) return [];

    const mergedItems = new Map();
    items.forEach((item) => {
        const id = normalizeId(item?.id);
        const quantity = normalizeQuantity(item?.qty);
        if (!id || !quantity) return;
        mergedItems.set(id, (mergedItems.get(id) || 0) + quantity);
    });

    return Array.from(mergedItems, ([id, qty]) => ({ id, qty }));
}

// Chỉ tài khoản khách hàng mới có giỏ trên server (admin không mua hàng).
const syncedUser = () => {
    const user = getCurrentUser();
    return user && user.role === 'user' && getToken() ? user : null;
};
const keyFor = (user) => (user ? `cart:${user.id}` : GUEST_KEY);
const currentKey = () => keyFor(getCurrentUser());

function readKey(key) {
    try {
        return normalizeCart(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
        localStorage.removeItem(key);
        return [];
    }
}

const writeKey = (key, cart) => localStorage.setItem(key, JSON.stringify(normalizeCart(cart)));

// Đồng bộ lên server
let version = 0; // tăng mỗi lần giỏ thay đổi; dùng để không ghi đè thay đổi mới hơn bằng phản hồi cũ
let pushTimer = null;

const dirtyKey = (user) => `${keyFor(user)}:dirty`;

function schedulePush() {
    const user = syncedUser();
    if (!user) return;
    localStorage.setItem(dirtyKey(user), '1');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        push().catch(() => {});
    }, PUSH_DELAY_MS);
}

async function push() {
    const user = syncedUser();
    if (!user) return;
    const sent = version;
    const result = await api.put('/cart', { items: readKey(keyFor(user)) });
    if (sent === version) {
        // Server đã loại sản phẩm hết hàng/không còn và giới hạn theo tồn kho: lấy bản đó làm chuẩn.
        writeKey(keyFor(user), result.items);
        localStorage.removeItem(dirtyKey(user));
    }
}

// Gọi trước khi đăng xuất để thay đổi chưa kịp gửi không bị mất.
export async function flushCart() {
    if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        await push().catch(() => {});
    }
}

export function forgetAccountCart(user) {
    if (!user) return;
    localStorage.removeItem(keyFor(user));
    localStorage.removeItem(dirtyKey(user));
}

// Tải trang: đưa giỏ trên trình duyệt và giỏ trên server về một bản thống nhất.
async function syncCart() {
    const user = syncedUser();
    if (!user) return;
    try {
        const guest = readKey(GUEST_KEY);
        if (guest.length || localStorage.getItem(dirtyKey(user))) {
            // Có hàng khách thêm lúc chưa đăng nhập, hoặc thay đổi chưa gửi từ lần trước: gộp lên server.
            const local = readKey(keyFor(user));
            const result = guest.length
                ? await api.post('/cart/merge', { items: [...guest, ...local] })
                : await api.put('/cart', { items: local });
            writeKey(keyFor(user), result.items);
            localStorage.removeItem(GUEST_KEY);
            localStorage.removeItem(dirtyKey(user));
        } else {
            writeKey(keyFor(user), (await api.get('/cart')).items);
        }
    } catch {
        // Mất mạng/server lỗi: vẫn dùng bản trên trình duyệt, lần tải sau sẽ đồng bộ lại.
    }
}

export const cartReady = syncCart();

// Đóng/chuyển trang khi còn thay đổi chưa gửi: gửi nốt bằng keepalive để không mất.
window.addEventListener('pagehide', () => {
    const user = syncedUser();
    if (!pushTimer || !user) return;
    fetch('/api/cart', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ items: readKey(keyFor(user)) })
    }).catch(() => {});
});

// API giỏ hàng (giữ nguyên chữ ký cũ)
function saveCart(cart) {
    writeKey(currentKey(), cart);
    version += 1;
    schedulePush();
}

export function getCart() {
    return readKey(currentKey());
}

export function addToCart(productId, quantity = 1, stock = Number.POSITIVE_INFINITY) {
    const id = normalizeId(productId);
    const amount = normalizeQuantity(quantity);
    const maxStock = Number.isFinite(Number(stock)) ? Math.max(0, Number(stock)) : Number.POSITIVE_INFINITY;
    if (!id || !amount || maxStock === 0) return { quantity: 0, limited: true };

    const cart = getCart();
    const item = cart.find((entry) => entry.id === id);
    const currentQuantity = item?.qty || 0;
    const nextQuantity = Math.min(currentQuantity + amount, maxStock);

    if (item) item.qty = nextQuantity;
    else cart.push({ id, qty: nextQuantity });
    saveCart(cart);

    return { quantity: nextQuantity, limited: nextQuantity < currentQuantity + amount };
}

export function setCartQuantity(productId, quantity, stock = Number.POSITIVE_INFINITY) {
    const id = normalizeId(productId);
    const cart = getCart();
    const item = cart.find((entry) => entry.id === id);
    if (!item) return { quantity: 0, limited: false };

    const requestedQuantity = normalizeQuantity(quantity);
    if (!requestedQuantity) {
        removeFromCart(id);
        return { quantity: 0, limited: false };
    }

    const maxStock = Number.isFinite(Number(stock)) ? Math.max(0, Number(stock)) : Number.POSITIVE_INFINITY;
    item.qty = Math.min(requestedQuantity, maxStock);
    if (item.qty === 0) {
        removeFromCart(id);
        return { quantity: 0, limited: true };
    }

    saveCart(cart);
    return { quantity: item.qty, limited: item.qty < requestedQuantity };
}

export function removeFromCart(productId) {
    const id = normalizeId(productId);
    saveCart(getCart().filter((item) => item.id !== id));
}

export function clearCart() {
    saveCart([]);
}

export function cartCount() {
    return getCart().reduce((total, item) => total + item.qty, 0);
}
