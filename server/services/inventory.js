import { db, newId, version } from '../core/store.js';
import { activeNewPromo, getSettings } from './settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Mọi lần tồn kho thay đổi đều ghi một dòng nhật ký: nhập hàng, bán, hoàn kho khi hủy đơn, điều chỉnh.
// qty là số thay đổi (nhập/hoàn là số dương, bán là số âm); balanceAfter là tồn kho sau thay đổi.
// Gọi SAU khi đã cập nhật product.stock. Việc lưu xuống đĩa do nơi gọi (save()) đảm nhiệm.
export function logStock(product, type, qty, { note = '', by = 'system' } = {}) {
    if (!qty) return null;
    const now = new Date().toISOString();
    const entry = { id: newId(), productId: String(product.id), type, qty, balanceAfter: product.stock, note: String(note).slice(0, 200), by, createdAt: now };
    db.stockLogs.push(entry);
    if (type === 'import') product.lastImportedAt = now;
    return entry;
}

const within = (iso, days) => Boolean(iso) && Date.now() - Date.parse(iso) <= days * DAY_MS;

// Số đã bán (đơn đã được cửa hàng chốt) và điểm đánh giá trung bình của từng sản phẩm.
// Tính một lần rồi dùng lại cho tới lần ghi dữ liệu kế tiếp, để danh sách nhiều sản phẩm không phải duyệt lại toàn bộ đơn/đánh giá.
const SOLD_STATUSES = new Set(['confirmed', 'shipping', 'delivered']);
let statsCache = { version: -1, sold: new Map(), ratings: new Map() };
function productStats() {
    if (statsCache.version === version) return statsCache;
    const sold = new Map();
    const ratings = new Map();
    db.orders.forEach((order) => {
        if (!SOLD_STATUSES.has(order.status)) return;
        order.items.forEach((item) => sold.set(String(item.id), (sold.get(String(item.id)) || 0) + item.qty));
    });
    db.reviews.forEach((review) => {
        const row = ratings.get(String(review.productId)) || { sum: 0, count: 0 };
        row.sum += review.rating;
        row.count += 1;
        ratings.set(String(review.productId), row);
    });
    statsCache = { version, sold, ratings };
    return statsCache;
}

// Sản phẩm trả cho client: thêm cờ isNew (vừa tạo), restocked (vừa nhập thêm), số đã bán và điểm đánh giá.
export function presentProduct(product) {
    const isNew = isNewProduct(product);
    const restocked = !isNew && within(product.lastImportedAt, getSettings().restockDays);
    const promo = isNew ? activeNewPromo() : null;
    const { sold, ratings } = productStats();
    const rating = ratings.get(String(product.id));
    return {
        ...product, isNew, restocked,
        newPromoPercent: promo ? promo.percent : 0,
        sold: sold.get(String(product.id)) || 0,
        rating: rating ? Math.round((rating.sum / rating.count) * 10) / 10 : 0,
        ratingCount: rating?.count || 0
    };
}

// Admin đặt hạn riêng (newUntil) thì theo hạn đó; không đặt thì tính theo số ngày chung kể từ lúc tạo sản phẩm.
export const isNewProduct = (product) => (product.newUntil
    ? Date.now() <= Date.parse(product.newUntil)
    : within(product.createdAt, getSettings().newProductDays));

// Thời điểm hàng về gần nhất, dùng để sắp xếp "mới nhất" (sản phẩm cũ chưa có ngày thì xếp cuối).
export const arrivalTime = (product) => Date.parse(product.lastImportedAt || product.createdAt || 0) || 0;
