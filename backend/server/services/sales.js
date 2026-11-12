import { db } from '../core/store.js';
import { arrivalTime } from './inventory.js';

// Giờ Việt Nam (UTC+7), cùng cách tính với thống kê doanh thu của admin.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const vnDate = (time = Date.now()) => new Date(new Date(time).getTime() + VN_OFFSET_MS);

// Đơn được tính là "đã bán": đã được cửa hàng chốt (không còn chờ xác nhận và không bị hủy).
const SOLD_STATUSES = new Set(['confirmed', 'shipping', 'delivered']);

// Cửa sổ tháng dương lịch theo giờ VN: [from, to) tính bằng timestamp UTC.
export function monthWindow(offset = 0, now = Date.now()) {
    const vn = vnDate(now);
    const from = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + offset, 1) - VN_OFFSET_MS;
    const to = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + offset + 1, 1) - VN_OFFSET_MS;
    const start = new Date(from + VN_OFFSET_MS);
    return { from, to, label: `${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}` };
}

// Số lượng bán theo sản phẩm trong khoảng thời gian, tính từ chi tiết hóa đơn (bản chụp lúc đặt).
export function unitsSold({ from, to }) {
    const sold = new Map();
    db.orders.forEach((order) => {
        if (!SOLD_STATUSES.has(order.status)) return;
        const at = Date.parse(order.createdAt);
        if (!(at >= from && at < to)) return;
        order.items.forEach((item) => sold.set(String(item.id), (sold.get(String(item.id)) || 0) + item.qty));
    });
    return sold;
}

// Sản phẩm bán chạy theo THÁNG hiện tại. Sắp theo số bán giảm dần; bằng nhau thì sản phẩm hàng về mới hơn đứng trước.
// Nếu tháng này chưa đủ sản phẩm có doanh số (đầu tháng/cửa hàng mới) thì bổ sung từ tháng trước, rồi tới hàng mới nhất,
// để trang chủ không bao giờ trống. Sản phẩm hết hàng không được đề xuất.
export function bestSellers(limit = 8) {
    const thisMonth = unitsSold(monthWindow(0));
    const lastMonth = unitsSold(monthWindow(-1));
    const available = db.products.filter((product) => product.stock > 0);
    const byScore = (map) => (a, b) => (map.get(String(b.id)) || 0) - (map.get(String(a.id)) || 0) || arrivalTime(b) - arrivalTime(a);

    const picked = [];
    const take = (list, source) =>
        list.forEach((product) => {
            if (picked.length < limit && !picked.some((entry) => entry.product === product)) picked.push({ product, source });
        });
    take(available.filter((product) => thisMonth.has(String(product.id))).sort(byScore(thisMonth)), 'month');
    take(available.filter((product) => lastMonth.has(String(product.id))).sort(byScore(lastMonth)), 'lastMonth');
    take(
        [...available].sort((a, b) => arrivalTime(b) - arrivalTime(a)),
        'newest'
    );

    return picked.map(({ product, source }, index) => ({
        product,
        rank: index + 1,
        source, // month = bán chạy tháng này
        soldMonth: thisMonth.get(String(product.id)) || 0
    }));
}
