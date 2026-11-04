import express, { Router } from 'express';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { byId, db, newId, save } from '../core/store.js';
import { fail, handle, requirePermission, requireRole } from '../core/http.js';
import { MAX_IMAGE_BYTES, BANNER_DIR, PRODUCT_DIR, removeBannerFile, sniff } from '../services/uploads.js';
import { parseBanner, parseEvent, parseVoucher, parseVoucherUpdate } from '../core/rules.js';
import { eventWindow } from '../services/site.js';

// Nội dung cửa hàng do admin quản lý: banner, sự kiện (giao diện theo chủ đề), voucher và nhật ký kho.
const router = Router();
router.use(requireRole());

const now = () => new Date().toISOString();

// ===== Banner =====
router.get('/banners', requirePermission('content.manage'), handle((_req, res) => res.json([...db.banners].sort((a, b) => a.order - b.order))));

router.post('/banners', requirePermission('content.manage'), handle((req, res) => {
    const banner = { id: newId(), ...parseBanner(req.body, db.events), createdAt: now() };
    db.banners.push(banner);
    save();
    res.status(201).json(banner);
}));

router.put('/banners/:id', requirePermission('content.manage'), handle((req, res) => {
    const banner = byId('banners', req.params.id) || fail(404, 'Không tìm thấy banner.');
    const oldImage = banner.image;
    Object.assign(banner, parseBanner(req.body, db.events));
    if (oldImage !== banner.image && !db.banners.some((other) => other.image === oldImage)) removeBannerFile(oldImage);
    save();
    res.json(banner);
}));

router.delete('/banners/:id', requirePermission('content.manage'), handle((req, res) => {
    const banner = byId('banners', req.params.id) || fail(404, 'Không tìm thấy banner.');
    db.banners.splice(db.banners.indexOf(banner), 1);
    if (!db.banners.some((other) => other.image === banner.image)) removeBannerFile(banner.image);
    save();
    res.status(204).end();
}));

// Tải ảnh (banner / ảnh sản phẩm): nhận thẳng nội dung ảnh (không cần multipart), chỉ nhận ảnh thật và tối đa 5 MB.
const imageUpload = (dir, urlPrefix) => [express.raw({ type: 'image/*', limit: '6mb' }), handle(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || !buffer.length) fail(400, 'Không nhận được ảnh. Chỉ chấp nhận JPG, PNG, WebP, GIF.');
    const kind = sniff(buffer);
    if (!kind || kind.type !== 'image') fail(400, 'Tệp không phải ảnh hợp lệ (JPG, PNG, WebP, GIF).');
    if (buffer.length > MAX_IMAGE_BYTES) fail(413, `Ảnh quá lớn (tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
    const file = `${newId().replace(/[^A-Za-z0-9]/g, 'x')}${Date.now().toString(36)}.${kind.ext}`;
    await writeFile(join(dir, file), buffer, { flag: 'wx' });
    res.status(201).json({ url: `${urlPrefix}/${file}` });
})];

router.post('/uploads/banner', requirePermission('content.manage'), ...imageUpload(BANNER_DIR, '/uploads/banners'));
// Ảnh sản phẩm thật (chụp tại vườn) thay cho ảnh minh họa có sẵn; ảnh không còn sản phẩm/đơn nào dùng sẽ được dọn.
router.post('/uploads/product', requirePermission('products.manage'), ...imageUpload(PRODUCT_DIR, '/uploads/products'));

// ===== Sự kiện / chủ đề giao diện =====
// Kèm "window": lần đang diễn ra hoặc lần sắp tới (sự kiện lặp tự tính theo năm hiện tại, âm lịch tự đổi ra dương lịch).
const eventRow = (event) => ({ ...event, window: eventWindow(event) || null });

router.get('/events', requirePermission('content.manage'), handle((_req, res) => {
    const rows = db.events.map(eventRow);
    // Đang chạy/sắp tới xếp theo thời gian gần nhất; sự kiện một lần đã kết thúc xuống cuối.
    const key = (row) => (!row.window ? '3' : Date.parse(row.window.endAt) < Date.now() ? '2' : '1') + (row.window?.startAt || '');
    res.json(rows.sort((a, b) => key(a).localeCompare(key(b))));
}));

router.post('/events', requirePermission('content.manage'), handle((req, res) => {
    const event = { id: newId(), ...parseEvent(req.body), createdAt: now() };
    db.events.push(event);
    save();
    res.status(201).json(eventRow(event));
}));

router.put('/events/:id', requirePermission('content.manage'), handle((req, res) => {
    const event = byId('events', req.params.id) || fail(404, 'Không tìm thấy sự kiện.');
    Object.assign(event, parseEvent(req.body));
    save();
    res.json(eventRow(event));
}));

router.delete('/events/:id', requirePermission('content.manage'), handle((req, res) => {
    const event = byId('events', req.params.id) || fail(404, 'Không tìm thấy sự kiện.');
    const used = db.banners.filter((banner) => banner.eventId === event.id).length;
    if (used) fail(409, `Sự kiện đang có ${used} banner. Hãy xóa hoặc chuyển các banner đó trước.`);
    db.events.splice(db.events.indexOf(event), 1);
    save();
    res.status(204).end();
}));

// ===== Voucher =====
const voucherRow = (voucher) => ({ ...voucher, claimedCount: voucher.claimedCount || 0, usedCount: voucher.usedCount || 0 });

router.get('/vouchers', requirePermission('vouchers.manage'), handle((_req, res) => res.json([...db.vouchers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(voucherRow))));

router.post('/vouchers', requirePermission('vouchers.manage'), handle((req, res) => {
    const data = parseVoucher(req.body, db);
    if (db.vouchers.some((voucher) => voucher.code === data.code)) fail(409, 'Mã voucher đã tồn tại.');
    const voucher = { id: newId(), ...data, claimedCount: 0, usedCount: 0, createdAt: now() };
    db.vouchers.push(voucher);
    save();
    res.status(201).json(voucherRow(voucher));
}));

// Voucher đã có người nhận thì không được đổi điều kiện/mức giảm (tránh thay đổi quyền lợi của khách đang giữ);
// chỉ cho đổi tên, thời gian kết thúc, tổng số lượng (không thấp hơn số đã nhận) và bật/tắt.
const LOCKED_FIELDS = ['code', 'kind', 'type', 'value', 'maxDiscount', 'minOrder', 'audience', 'scope', 'scopeIds', 'startAt', 'perUserLimit', 'validDays'];

router.put('/vouchers/:id', requirePermission('vouchers.manage'), handle((req, res) => {
    const voucher = byId('vouchers', req.params.id) || fail(404, 'Không tìm thấy voucher.');
    let data;
    if ((voucher.claimedCount || 0) > 0) {
        if (LOCKED_FIELDS.some((key) => Object.hasOwn(req.body || {}, key))) {
            fail(409, 'Voucher đã có người nhận nên không thể đổi điều kiện hoặc mức giảm. Hãy tắt voucher này và tạo voucher mới.');
        }
        data = parseVoucherUpdate(req.body, voucher);
    } else {
        data = parseVoucher({ ...voucher, ...req.body, code: req.body?.code ?? voucher.code }, db);
        if (db.vouchers.some((other) => other !== voucher && other.code === data.code)) fail(409, 'Mã voucher đã tồn tại.');
    }
    Object.assign(voucher, data);
    save();
    res.json(voucherRow(voucher));
}));

router.delete('/vouchers/:id', requirePermission('vouchers.manage'), handle((req, res) => {
    const voucher = byId('vouchers', req.params.id) || fail(404, 'Không tìm thấy voucher.');
    if ((voucher.claimedCount || 0) > 0) fail(409, 'Voucher đã có người nhận nên không thể xóa. Hãy tắt voucher để ngừng áp dụng.');
    db.vouchers.splice(db.vouchers.indexOf(voucher), 1);
    save();
    res.status(204).end();
}));

// ===== Nhật ký nhập/xuất kho =====
router.get('/stock-logs', requirePermission('inventory.view'), handle((req, res) => {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.stockLogs.filter((entry) => !productId || entry.productId === productId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
        .map((entry) => ({ ...entry, productName: byId('products', entry.productId)?.name || 'Sản phẩm đã xóa' }));
    res.json(rows);
}));

export default router;
