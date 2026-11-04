import { db } from '../core/store.js';
import { CANCEL_REASONS, CANCEL_REQUEST_TTL_MS, FREE_SHIPPING_FROM, HIGH_VALUE_FROM, MAX_COD_TOTAL, PAYMENT_TTL_MS, SETTINGS_DEFAULTS, SHIPPING_FEES, SHOP_DEFAULTS } from '../core/rules.js';

// Cài đặt cửa hàng do admin chỉnh trên giao diện (db.settings); thiếu giá trị nào thì dùng mặc định trong core/rules.js.
export function getSettings() {
    const saved = db.settings || {};
    return {
        newProductDays: saved.newProductDays ?? SETTINGS_DEFAULTS.newProductDays,
        restockDays: saved.restockDays ?? SETTINGS_DEFAULTS.restockDays,
        newPromo: { ...SETTINGS_DEFAULTS.newPromo, ...(saved.newPromo || {}) }
    };
}

// Khuyến mãi sản phẩm mới đang chạy: đã bật và đang trong khoảng thời gian đã đặt.
export function activeNewPromo(now = Date.now()) {
    const { newPromo } = getSettings();
    if (!newPromo.enabled || !newPromo.startAt || !newPromo.endAt) return null;
    if (now < Date.parse(newPromo.startAt) || now > Date.parse(newPromo.endAt)) return null;
    return newPromo;
}

// Thông tin cửa hàng: admin sửa trên giao diện (db.settings.shop), thiếu thì dùng mặc định.
export const getShop = () => ({ ...SHOP_DEFAULTS, ...((db.settings || {}).shop || {}) });

// Các con số nghiệp vụ giao diện cần hiển thị (phí ship, ngưỡng chuyển khoản...). Nguồn duy nhất là server, giao diện không viết cứng.
export function publicRules() {
    return {
        freeShippingFrom: FREE_SHIPPING_FROM,
        shippingFees: SHIPPING_FEES,
        highValueFrom: HIGH_VALUE_FROM,
        maxCodTotal: MAX_COD_TOTAL,
        paymentMinutes: Math.round(PAYMENT_TTL_MS / 60000),
        cancelReasons: CANCEL_REASONS,
        cancelRequestHours: Math.round(CANCEL_REQUEST_TTL_MS / 3600000)
    };
}
