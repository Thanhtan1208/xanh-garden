// Công thức tiền của đơn hàng: MỘT nơi duy nhất, dùng chung cho thống kê doanh thu (routes/admin.js)
// và phần phân tích gợi ý (services/insights.js) để hai nơi luôn ra cùng một con số.
import { byId } from '../core/store.js';

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const vnDate = (iso) => new Date(Date.parse(iso) + VN_OFFSET_MS);

// Tính từ chi tiết đơn (items), không dùng số liệu sinh sẵn.
export const goodsOf = (order) => order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
// Tiền khách thực trả: hàng - giảm giá + phí ship - giảm phí ship (đối chiếu với order.total).
export const paidOf = (order) => goodsOf(order) - (order.discount || 0) + (order.shippingFee || 0) - (order.shippingDiscount || 0);
// Giá vốn một dòng hàng: giá vốn chụp lúc đặt; đơn cũ chưa có thì lấy giá vốn hiện tại của sản phẩm.
export const unitCostOf = (item) => item.cost ?? byId('products', item.id)?.costPrice ?? 0;
export const costOf = (order) => order.items.reduce((sum, item) => sum + unitCostOf(item) * item.qty, 0);
// Tiền bán hàng = hàng - giảm giá (không tính phí vận chuyển, vì đó là tiền trả cho đơn vị vận chuyển).
export const salesOf = (order) => goodsOf(order) - (order.discount || 0);
// DOANH THU = tiền bán - giá vốn (giá nhập).
export const revenueOf = (order) => salesOf(order) - costOf(order);
// Doanh thu một dòng hàng (chưa chia giảm giá của đơn).
export const itemRevenue = (item) => (item.price - unitCostOf(item)) * item.qty;
export const unitsOf = (order) => order.items.reduce((sum, item) => sum + item.qty, 0);

// Thời điểm đơn chuyển sang "đã giao"; đơn cũ không có lịch sử thì lấy lần cập nhật cuối.
export function deliveredAt(order) {
    const entry = [...order.history].reverse().find((item) => item.status === 'delivered');
    return entry?.at || order.updatedAt || order.createdAt;
}
