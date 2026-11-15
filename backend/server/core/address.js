// Quy tắc số điện thoại và địa chỉ giao hàng (Việt Nam).
import { readFileSync } from 'node:fs';

// Số di động Việt Nam: 03x, 05x, 07x, 08x, 09x (10 số), viết 0xxxxxxxxx hoặc +84xxxxxxxxx
const MOBILE_PATTERN = /^(?:0|\+?84)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;

// Trả về số dạng 0xxxxxxxxx, hoặc null nếu không phải số di động Việt Nam
export function normalizePhone(value) {
    const raw = String(value || '').replace(/[\s.-]/g, '');
    const match = raw.match(MOBILE_PATTERN);
    return match ? `0${raw.slice(raw.length - 9)}` : null;
}

// Đơn vị hành chính hiện hành (từ 1/7/2025): 34 tỉnh/thành, mỗi tỉnh gồm các phường/xã, không còn cấp quận/huyện.
// Dạng [[tỉnh, [phường/xã...]]...], nguồn provinces.open-api.vn (bản v2).
// Giao diện lấy cùng dữ liệu này qua GET /api/divisions để làm ô chọn.
export const DIVISIONS = JSON.parse(readFileSync(new URL('../data/vn-divisions.json', import.meta.url), 'utf8'));

// Địa chỉ bắt buộc đủ 3 phần, kiểm tra theo thứ tự ô nhập: tỉnh/thành -> phường/xã -> số nhà, tên đường.
// Tỉnh và phường phải có thật, phường phải thuộc tỉnh. Số nhà, tên đường khách tự gõ, chỉ cần không trống.
// Trả về câu báo lỗi, hoặc null nếu đủ.
export function addressProblem({ province, ward, street } = {}) {
    const found = DIVISIONS.find(([name]) => name === province);
    if (!found) return 'Vui lòng chọn Tỉnh/Thành phố.';
    if (!ward) return 'Vui lòng chọn Phường/Xã.';
    if (!found[1].includes(ward)) return `${ward} không thuộc ${province}. Vui lòng chọn lại Phường/Xã.`;
    if (!String(street || '').trim()) return 'Vui lòng nhập số nhà, tên đường.';
    return null;
}

// Ghép thành một dòng địa chỉ để in trên đơn hàng, hóa đơn, email: số nhà, phường/xã, tỉnh/thành
export const joinAddress = ({ street, ward, province }) => [street, ward, province].filter(Boolean).join(', ');
