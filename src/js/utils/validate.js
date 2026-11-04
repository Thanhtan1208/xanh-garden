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
