// Thông tin cửa hàng và các con số nghiệp vụ (phí ship, ngưỡng chuyển khoản...) hiển thị trên website.
// Nguồn thật nằm ở server: GET /api/shop (thông tin cửa hàng admin sửa ở trang "Thông tin cửa hàng", con số nghiệp vụ lấy từ server).
// Giá trị dưới đây chỉ là mặc định cho lần mở đầu tiên; sau đó dùng bản đã nhớ trong localStorage để trang hiện đúng ngay.
const CACHE_KEY = 'shopInfo';

export const SHOP = {
    name: 'Xanh Garden',
    tagline: 'Cây cảnh văn phòng & quà tặng xanh',
    hotline: '0901 234 567',
    email: 'hotro@xanhgarden.vn',
    address: 'TP. Hồ Chí Minh',
    hours: '8:00 – 21:00, tất cả các ngày',
    facebook: 'https://facebook.com/',
    zalo: 'https://zalo.me/0901234567',
    warrantyDays: 7
};

export const RULES = {
    freeShippingFrom: 500000,
    shippingFees: { standard: 30000, express: 50000 },
    highValueFrom: 1000000,
    maxCodTotal: 5000000,
    paymentMinutes: 30,
    cancelRequestHours: 48,
    cancelReasons: {
        change_mind: 'Tôi đổi ý, không còn nhu cầu mua',
        change_items: 'Muốn đổi sản phẩm hoặc số lượng',
        change_address: 'Muốn thay đổi địa chỉ nhận hàng',
        found_cheaper: 'Tìm được nơi bán giá tốt hơn',
        payment_issue: 'Gặp vấn đề khi thanh toán',
        other: 'Lý do khác'
    }
};

function apply(data) {
    if (data?.shop) Object.assign(SHOP, data.shop);
    if (data?.rules) Object.assign(RULES, data.rules);
}

try {
    apply(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
} catch {
    /* chưa có bản nhớ thì dùng mặc định */
}

const snapshot = () => JSON.stringify({ shop: SHOP, rules: RULES });
const listeners = [];
// Gọi lại khi dữ liệu từ server khác với bản đang hiển thị (ví dụ admin vừa đổi hotline)
export const onShopChange = (callback) => listeners.push(callback);

// Lấy bản mới nhất ở nền; khác thì cập nhật bản nhớ và báo cho các trang vẽ lại
export const shopReady = fetch('/api/shop')
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
        if (!data) return;
        const before = snapshot();
        apply(data);
        try {
            localStorage.setItem(CACHE_KEY, snapshot());
        } catch {
            /* bỏ qua nếu bị chặn lưu trữ */
        }
        if (snapshot() !== before) listeners.forEach((callback) => callback());
    })
    .catch(() => {});

export const telLink = (phone = SHOP.hotline) => `tel:${phone.replace(/\s/g, '')}`;
