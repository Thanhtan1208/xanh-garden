import { byId, db, newId } from '../core/store.js';
import { fail } from '../core/http.js';
import { DEFAULT_VOUCHER_VALID_DAYS, MAX_WALLET_VOUCHERS, NEW_USER_DAYS } from '../core/rules.js';
import { sendMail } from '../core/mailer.js';
import { vnDate } from './sales.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;

export const describeVoucher = (voucher) => {
    const what = voucher.kind === 'shipping' ? 'phí vận chuyển' : 'đơn hàng';
    const value = voucher.type === 'percent' ? `${voucher.value}% (tối đa ${money(voucher.maxDiscount)})` : money(voucher.value);
    return `Giảm ${value} ${what}${voucher.minOrder ? `, đơn từ ${money(voucher.minOrder)}` : ''}`;
};

// Voucher còn "sống" (admin chưa tắt, nằm trong thời gian chương trình).
export function isLive(voucher, now = Date.now()) {
    return voucher.active && now >= Date.parse(voucher.startAt) && now <= Date.parse(voucher.endAt);
}

// Trạng thái hiển thị của một voucher trong ví: hết hạn được tính lúc đọc, không cần dọn dữ liệu.
export function entryStatus(entry, now = Date.now()) {
    if (entry.status === 'used') return 'used';
    return now > Date.parse(entry.expiresAt) ? 'expired' : 'available';
}

const claimsOf = (userId, voucherId) => db.userVouchers.filter((entry) => entry.userId === userId && entry.voucherId === voucherId);

function activeInWallet(userId) {
    return db.userVouchers.filter((entry) => entry.userId === userId && entryStatus(entry) === 'available').length;
}

// Lý do không cho nhận thêm voucher này (null = được nhận). Dùng cho cả nhận thủ công lẫn hệ thống tự cấp.
export function claimProblem(user, voucher, { checkPerUser = true } = {}) {
    if (!isLive(voucher)) return 'Voucher đã hết hạn hoặc chưa bắt đầu.';
    if (voucher.totalQuantity && (voucher.claimedCount || 0) >= voucher.totalQuantity) return 'Voucher đã được nhận hết.';
    if (checkPerUser && claimsOf(user.id, voucher.id).length >= voucher.perUserLimit) return 'Bạn đã nhận voucher này rồi.';
    if (activeInWallet(user.id) >= MAX_WALLET_VOUCHERS) return `Ví voucher đã đầy (tối đa ${MAX_WALLET_VOUCHERS} voucher còn hạn).`;
    return null;
}

// Tạo bản ghi trong ví. Không kiểm tra điều kiện: nơi gọi phải gọi claimProblem trước.
function addEntry(user, voucher, source, extra = {}) {
    const now = Date.now();
    const byValidDays = now + (voucher.validDays || DEFAULT_VOUCHER_VALID_DAYS) * DAY_MS;
    // Voucher tự nhận: dùng được tới hết chương trình. Voucher hệ thống tự cấp: chỉ N ngày kể từ lúc cấp (không quá hết chương trình).
    const expiresAt = new Date(source === 'claim' ? Date.parse(voucher.endAt) : Math.min(byValidDays, Date.parse(voucher.endAt))).toISOString();
    const entry = { id: newId(), userId: user.id, voucherId: voucher.id, code: voucher.code, source, issuedAt: new Date(now).toISOString(), expiresAt, status: 'available', ...extra };
    db.userVouchers.push(entry);
    voucher.claimedCount = (voucher.claimedCount || 0) + 1;
    return entry;
}

export function claimVoucher(user, voucher) {
    if (!voucher.claimable) fail(403, 'Voucher này không thể tự nhận.');
    const problem = claimProblem(user, voucher);
    if (problem) fail(409, problem);
    return addEntry(user, voucher, 'claim');
}

// ===== Voucher hệ thống tự cấp: người dùng mới và sinh nhật =====

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// Sinh nhật 29/2: năm không nhuận thì tính vào 28/2.
export function isBirthdayToday(user, now = Date.now()) {
    if (!user.birthday) return false;
    const vn = vnDate(now);
    const [, month, day] = user.birthday.split('-').map(Number);
    const [m, d] = month === 2 && day === 29 && !isLeap(vn.getUTCFullYear()) ? [2, 28] : [month, day];
    return vn.getUTCMonth() + 1 === m && vn.getUTCDate() === d;
}

export const hasOrdered = (userId) => db.orders.some((order) => String(order.userId) === String(userId));

export function isNewUser(user, now = Date.now()) {
    return !hasOrdered(user.id) && now - Date.parse(user.createdAt || 0) <= NEW_USER_DAYS * DAY_MS;
}

// Cấp voucher còn thiếu cho một người; trả về các voucher vừa được cấp. Gọi nhiều lần vẫn an toàn (không cấp trùng).
export function syncAutoVouchers(user, now = Date.now()) {
    if (user.role !== 'user' || user.verified === false) return [];
    const issued = [];
    const year = vnDate(now).getUTCFullYear();
    db.vouchers.forEach((voucher) => {
        if (voucher.audience === 'all' || !isLive(voucher, now)) return;
        if (voucher.audience === 'newUser') {
            if (!isNewUser(user, now) || claimsOf(user.id, voucher.id).length) return;
            if (claimProblem(user, voucher)) return;
            issued.push(addEntry(user, voucher, 'newUser'));
        } else if (voucher.audience === 'birthday') {
            // Mỗi năm một lần, không phụ thuộc giới hạn "mỗi người" của voucher.
            if (!isBirthdayToday(user, now) || claimsOf(user.id, voucher.id).some((entry) => entry.year === year)) return;
            if (claimProblem(user, voucher, { checkPerUser: false })) return;
            issued.push(addEntry(user, voucher, 'birthday', { year }));
        }
    });
    return issued;
}

// Quét toàn bộ người dùng (chạy định kỳ). Trả về true nếu có thay đổi cần lưu.
export function sweepAutoVouchers() {
    let changed = false;
    db.user.forEach((user) => {
        const issued = syncAutoVouchers(user);
        if (!issued.length) return;
        changed = true;
        const birthday = issued.filter((entry) => entry.source === 'birthday');
        if (birthday.length && user.email) sendBirthdayMail(user, birthday).catch((error) => console.error('[mail]', error.message));
    });
    return changed;
}

function sendBirthdayMail(user, entries) {
    const lines = entries.map((entry) => {
        const voucher = byId('vouchers', entry.voucherId);
        return `- Mã ${entry.code}: ${describeVoucher(voucher)} (dùng đến ${new Date(entry.expiresAt).toLocaleDateString('vi-VN')})`;
    });
    return sendMail({
        to: user.email,
        subject: 'Chúc mừng sinh nhật từ Xanh Garden',
        text: `Chúc mừng sinh nhật ${user.name}!\n\nXanh Garden tặng bạn quà sinh nhật:\n${lines.join('\n')}\n\nVoucher đã nằm sẵn trong "Ví voucher" của bạn, chọn khi thanh toán.\nXanh Garden`
    });
}

// ===== Gắn voucher vào đơn / trả lại khi hủy =====

export function consumeVouchers(order, applied) {
    const now = new Date().toISOString();
    applied.forEach(({ entry }) => {
        entry.status = 'used';
        entry.orderId = order.id;
        entry.usedAt = now;
        const voucher = byId('vouchers', entry.voucherId);
        if (voucher) voucher.usedCount = (voucher.usedCount || 0) + 1;
    });
}

// Hủy đơn thì trả voucher về ví (đúng một lần). Nếu voucher đã quá hạn thì tự hiển thị là hết hạn.
export function releaseVouchers(order) {
    db.userVouchers.filter((entry) => entry.orderId === order.id && entry.status === 'used').forEach((entry) => {
        entry.status = 'available';
        delete entry.orderId;
        delete entry.usedAt;
        const voucher = byId('vouchers', entry.voucherId);
        if (voucher) voucher.usedCount = Math.max(0, (voucher.usedCount || 0) - 1);
    });
}
