import { Router } from 'express';
import { byId, db, save } from '../core/store.js';
import { fail, handle, requireRole } from '../core/http.js';
import { parseBirthday } from '../core/rules.js';
import { claimVoucher, describeVoucher, entryStatus, isLive, syncAutoVouchers } from '../services/vouchers.js';

const router = Router();

// Bản công khai của voucher (không lộ số liệu nội bộ như đã dùng/đã nhận).
const publicVoucher = (voucher) => ({
    id: voucher.id,
    code: voucher.code,
    name: voucher.name,
    kind: voucher.kind,
    type: voucher.type,
    value: voucher.value,
    maxDiscount: voucher.maxDiscount,
    minOrder: voucher.minOrder,
    audience: voucher.audience,
    scope: voucher.scope,
    scopeIds: voucher.scopeIds,
    startAt: voucher.startAt,
    endAt: voucher.endAt,
    description: describeVoucher(voucher),
    remaining: voucher.totalQuantity ? Math.max(0, voucher.totalQuantity - (voucher.claimedCount || 0)) : null
});

// Kho voucher: những voucher ai cũng có thể bấm nhận (đang diễn ra, còn số lượng).
router.get(
    '/',
    handle((req, res) => {
        const list = db.vouchers.filter(
            (voucher) =>
                voucher.claimable && isLive(voucher) && (!voucher.totalQuantity || (voucher.claimedCount || 0) < voucher.totalQuantity)
        );
        res.json(
            list.map((voucher) => ({
                ...publicVoucher(voucher),
                claimed: req.user
                    ? db.userVouchers.filter((entry) => entry.userId === req.user.id && entry.voucherId === voucher.id).length >=
                      voucher.perUserLimit
                    : false
            }))
        );
    })
);

const walletRow = ({ entry, voucher, status }) => ({
    id: entry.id,
    status,
    source: entry.source,
    issuedAt: entry.issuedAt,
    expiresAt: entry.expiresAt,
    orderId: entry.orderId || null,
    voucher: voucher ? publicVoucher(voucher) : null
});

// Ví voucher của tôi. Mỗi lần xem sẽ cấp nốt voucher người dùng mới / sinh nhật nếu đủ điều kiện mà chưa được cấp.
router.get(
    '/mine',
    requireRole('user'),
    handle((req, res) => {
        const user = byId('user', req.user.id);
        if (syncAutoVouchers(user).length) save();
        const rows = db.userVouchers
            .filter((entry) => entry.userId === user.id)
            .map((entry) => ({ entry, voucher: byId('vouchers', entry.voucherId), status: entryStatus(entry) }))
            .sort((a, b) => b.entry.issuedAt.localeCompare(a.entry.issuedAt));
        res.json({ birthday: user.birthday || null, vouchers: rows.map(walletRow) });
    })
);

// Nhận voucher từ kho bằng id hoặc nhập mã.
router.post(
    '/claim',
    requireRole('user'),
    handle((req, res) => {
        const user = byId('user', req.user.id);
        const code = String(req.body?.code || '')
            .trim()
            .toUpperCase();
        const voucher =
            (req.body?.voucherId && byId('vouchers', req.body.voucherId)) ||
            (code && db.vouchers.find((item) => item.code === code)) ||
            fail(404, 'Mã voucher không tồn tại.');
        // Voucher không công khai (người dùng mới/sinh nhật) không thể nhận bằng cách nhập mã.
        if (!voucher.claimable) fail(403, 'Voucher này không thể tự nhận. Hệ thống sẽ tự tặng khi bạn đủ điều kiện.');
        const entry = claimVoucher(user, voucher);
        save();
        res.status(201).json(walletRow({ entry, voucher, status: entryStatus(entry) }));
    })
);

// Ngày sinh chỉ khai báo được một lần (chống đổi ngày sinh liên tục để nhận quà nhiều lần).
router.put(
    '/birthday',
    requireRole('user'),
    handle((req, res) => {
        const user = byId('user', req.user.id);
        if (user.birthday) fail(409, 'Bạn đã khai ngày sinh. Vui lòng liên hệ cửa hàng nếu cần thay đổi.');
        user.birthday = parseBirthday(req.body?.birthday);
        user.birthdaySetAt = new Date().toISOString();
        syncAutoVouchers(user); // hôm nay đúng sinh nhật thì nhận quà ngay
        save();
        res.json({ birthday: user.birthday });
    })
);

export default router;
