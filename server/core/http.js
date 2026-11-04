import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { byId } from './store.js';
import { hasPermission } from './permissions.js';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET = process.env.AUTH_SECRET || 'xanh-garden-dev-secret';

export class ApiError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

export const fail = (status, message, extra) => { throw new ApiError(status, message, extra); };

export function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
}

const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');

export function createToken(user) {
    const payload = Buffer.from(JSON.stringify({ sub: user.id, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

function readToken(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
}

export const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

export { sign as signValue };

// Vai trò luôn lấy từ db, không tin dữ liệu client gửi lên.
export function authenticate(req, _res, next) { 
    const header = req.headers.authorization || '';
    try {
        const data = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null;
        const user = data ? byId('user', data.sub) || null : null;
        // Phiên đăng nhập cấp trước lúc admin đặt lại mật khẩu thì không còn hiệu lực.
        const revoked = user?.passwordResetAt && !(data.iat >= Date.parse(user.passwordResetAt));
        req.user = revoked ? null : user;
    } catch {
        req.user = null;
    }
    next();
}

export function requireRole(role) {
    return (req, _res, next) => {
        if (!req.user) return next(new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.'));
        if (role && req.user.role !== role) return next(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.'));
        return next();
    };
}

export function requirePermission(permission) {
    return (req, _res, next) => {
        if (!req.user) return next(new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.'));
        if (!hasPermission(req.user, permission)) return next(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.'));
        return next();
    };
}

// Bọc handler để lỗi ném ra (sync hoặc async) đi thẳng vào error middleware.
// Mọi thay đổi kho/đơn hàng được làm trong phần đồng bộ (không await giữa chừng) nên hai
// request đồng thời không thể cùng đọc một số tồn kho cũ.
export const handle = (fn) => (req, res, next) => {
    try {
        Promise.resolve(fn(req, res)).catch(next);
    } catch (error) {
        next(error);
    }
};
