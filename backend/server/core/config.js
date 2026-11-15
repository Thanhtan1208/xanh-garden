// Cấu hình khi chạy thật (NODE_ENV=production): kiểm tra trước khi mở cổng, thiếu thứ bắt buộc thì dừng ngay
// thay vì chạy với khóa mặc định đã công khai trong mã nguồn.
import { existsSync } from 'node:fs';
import { db, save } from './store.js';
import { DEV_SECRET, hashPassword, verifyPassword } from './http.js';
import { FRONTEND_DIST } from './paths.js';
import { isManagementRole } from './permissions.js';
import { passwordProblem } from './rules.js';
import { DEV_SEPAY_KEY } from '../services/sepay.js';

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Mật khẩu tài khoản admin trong data/db.sample.json (ghi trong README nên ai cũng biết).
export const DEMO_PASSWORD = 'Demo@Garden2026';

// TRUST_PROXY: số proxy đứng trước server (VD 1 trên Render), true/false, hoặc danh sách IP.
// Mặc định chỉ tin proxy chạy cùng máy (Caddy, Nginx, Cloudflare Tunnel) để đọc đúng IP của khách.
export function trustProxy(value = process.env.TRUST_PROXY) {
    if (value === undefined || value === '') return 'loopback';
    if (/^\d+$/.test(value)) return Number(value);
    if (value === 'true' || value === 'false') return value === 'true';
    return value;
}

const usesDemoPassword = (user) => isManagementRole(user) && verifyPassword(DEMO_PASSWORD, user.passwordHash);

// ADMIN_PASSWORD: thay mật khẩu mẫu của tài khoản quản lý. Chỉ đổi tài khoản còn dùng mật khẩu mẫu,
// nên các lần khởi động sau không đổi gì nữa. Trả về lỗi nếu mật khẩu mới chưa đạt chính sách mật khẩu.
export function applyAdminPassword(password = process.env.ADMIN_PASSWORD, users = db.user) {
    if (!password) return null;
    if (password === DEMO_PASSWORD) return 'ADMIN_PASSWORD đang trùng mật khẩu mẫu.';
    const problem = passwordProblem(password);
    if (problem) return `ADMIN_PASSWORD chưa đạt: ${problem}`;
    const targets = users.filter(usesDemoPassword);
    if (!targets.length) return null;
    const now = new Date().toISOString();
    targets.forEach((user) => {
        user.passwordHash = hashPassword(password);
        user.passwordResetAt = now; // token đã cấp bằng mật khẩu mẫu hết hiệu lực
    });
    save();
    console.log(`[config] Đã thay mật khẩu mẫu của: ${targets.map((user) => user.name).join(', ')}`);
    return null;
}

// errors: phải sửa mới chạy được. warnings: vẫn chạy nhưng có chức năng không dùng được.
export function checkConfig({ env = process.env, users = db.user, dist = FRONTEND_DIST } = {}) {
    const errors = [];
    const warnings = [];
    const secret = env.AUTH_SECRET || '';
    if (secret.length < 32 || secret === DEV_SECRET) {
        errors.push('AUTH_SECRET: đặt một chuỗi ngẫu nhiên dài ít nhất 32 ký tự (khóa ký token đăng nhập).');
    }
    if (!env.SEPAY_API_KEY || env.SEPAY_API_KEY === DEV_SEPAY_KEY) {
        errors.push(
            `SEPAY_API_KEY: đặt khóa webhook riêng (chưa nối SePay thì đặt chuỗi ngẫu nhiên), khóa thử "${DEV_SEPAY_KEY}" ai cũng biết.`
        );
    }
    const demo = users.filter(usesDemoPassword).map((user) => user.name);
    if (demo.length) {
        errors.push(`Tài khoản ${demo.join(', ')} còn dùng mật khẩu mẫu: đặt ADMIN_PASSWORD để server tự thay khi khởi động.`);
    }
    if (!env.SMTP_HOST) warnings.push('Chưa đặt SMTP_HOST: email (mã xác minh, mã đặt lại mật khẩu) chỉ in ra log, khách không nhận được.');
    if (!existsSync(dist)) warnings.push(`Không thấy bản build frontend (${dist}): server chỉ phục vụ API.`);
    return { errors, warnings };
}
