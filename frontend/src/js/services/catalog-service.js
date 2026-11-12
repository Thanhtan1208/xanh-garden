import { api } from './api-service.js';

// Danh mục sản phẩm dùng ở menu của mọi trang. Nhớ trong sessionStorage để menu hiện ngay khi chuyển trang
// (không hết hạn theo phút để menu không bị trống rồi nhảy); header vẫn tải lại từ server ở nền mỗi trang.
const KEY = 'categories';

export function cachedCategories() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        return cached ? cached.list : null;
    } catch {
        return null;
    }
}

let pending = null;
export function getCategories() {
    pending ||= api.get('/categories').then((list) => {
        try {
            sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list }));
        } catch {
            /* bị chặn lưu trữ: bỏ qua */
        }
        return list;
    });
    return pending;
}

// Ảnh minh họa cho từng danh mục (sản phẩm tiêu biểu) và câu mô tả ngắn hiển thị ở trang chủ/trang sản phẩm.
export const CATEGORY_INFO = {
    1: { image: 'p10.png', text: 'Nhỏ gọn cho bàn học, bàn làm việc' },
    2: { image: 'p5.png', text: 'Tài lộc, may mắn – hợp quà khai trương, tân gia' },
    3: { image: 'p1.png', text: 'Dễ chăm, chịu bóng, đặt trong nhà' },
    4: { image: 'p9.png', text: 'Ít tưới, thích nắng, nhỏ xinh' },
    5: { image: 'p11.png', text: 'Chậu sứ, chậu xi măng, đất trồng' }
};
