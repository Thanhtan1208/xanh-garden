import { randomInt } from 'node:crypto';
import { fail, signValue } from './http.js';

export const CODE_TTL_MS = 3 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const hashCode = (code, scope) => signValue(`${scope}:${code}`);

// Tạo mã 6 chữ số; chỉ lưu bản băm (HMAC) nên đọc db.json không lộ mã.
export function issueCode(scope, ttlMs = CODE_TTL_MS) {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const now = Date.now();
    return { code, record: { hash: hashCode(code, scope), expiresAt: now + ttlMs, sentAt: now, attempts: 0 } };
}

export function assertCanResend(record) {
    if (record && Date.now() - record.sentAt < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - record.sentAt)) / 1000);
        fail(429, `Vui lòng đợi ${wait} giây trước khi yêu cầu gửi lại mã.`);
    }
}

// Ném lỗi nếu mã sai/hết hạn/nhập sai quá nhiều lần. Trả về khi mã đúng.
export function checkCode(record, input, scope) {
    if (!record) fail(400, 'Chưa có mã xác nhận. Vui lòng yêu cầu gửi mã.');
    if (Date.now() > record.expiresAt) fail(400, 'Mã xác nhận đã hết hạn. Vui lòng yêu cầu gửi lại mã.');
    if (record.attempts >= MAX_ATTEMPTS) fail(429, 'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu gửi lại mã mới.');
    const value = String(input ?? '').trim();
    if (!/^\d{6}$/.test(value) || hashCode(value, scope) !== record.hash) {
        record.attempts += 1;
        return false;
    }
    return true;
}
