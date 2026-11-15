// Kiểm tra phía trình duyệt để báo lỗi nhanh; server vẫn kiểm tra lại toàn bộ (server/rules.js).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[A-Za-z0-9_.]+$/;

import { passwordProblem } from './password.js';

const fail = (field, message) => ({ field, message });

export function validateRegistration({ name, email, password, confirmPassword }) {
    if (name.length < 3 || name.length > 20) return fail('name', 'Tên đăng nhập phải từ 3 đến 20 ký tự.');
    if (!NAME_PATTERN.test(name)) return fail('name', 'Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới và dấu chấm.');
    if (!EMAIL_PATTERN.test(email)) return fail('email', 'Email không hợp lệ.');
    const weak = passwordProblem(password, name, email.split('@')[0]);
    if (weak) return fail('password', weak);
    if (password !== confirmPassword) return fail('confirmPassword', 'Mật khẩu xác nhận không khớp.');
    return null;
}

// Số di động Việt Nam 10 số, giống backend/server/core/address.js
const MOBILE_PATTERN = /^(?:0|\+?84)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;

// Địa chỉ lưu từ trước khi có quy tắc mới (thiếu tỉnh/phường, số nhà hoặc số điện thoại sai): phải sửa mới đặt hàng được
export const addressNeedsUpdate = (entry) =>
    !entry?.province || !entry.ward || !entry.street || !MOBILE_PATTERN.test(String(entry.phone || '').replace(/[\s.-]/g, ''));
export const ADDRESS_UPDATE_NOTE = 'Địa chỉ này thiếu Tỉnh/Phường hoặc số điện thoại chưa đúng. Bấm sửa để cập nhật trước khi đặt hàng.';

// Form có nhiều mục bắt buộc (VD địa chỉ): tô đỏ ô còn trống, báo tên các mục thiếu, đưa con trỏ về ô thiếu đầu tiên.
// fields: [[ô nhập, tên mục, còn thiếu?], ...]. Trả về true nếu đã đủ.
export function checkRequired(fields, messageBox) {
    fields.forEach(([input, , empty]) => {
        input.classList.toggle('invalid', empty);
        // Khách gõ lại thì bỏ tô đỏ
        if (empty) input.addEventListener('input', () => input.classList.remove('invalid'), { once: true });
    });
    const missing = fields.filter(([, , empty]) => empty);
    if (!missing.length) return true;
    messageBox.textContent = `Vui lòng nhập đủ: ${missing.map(([, label]) => label).join(', ')}.`;
    missing[0][0].focus();
    return false;
}
