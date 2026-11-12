import express, { Router } from 'express';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, newId, save } from '../core/store.js';
import { fail, handle, requireRole } from '../core/http.js';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, ORPHAN_TTL_MS, REVIEW_DIR, sniff } from '../services/uploads.js';

const router = Router();
const MAX_PENDING = 12; // mỗi người tối đa 12 tệp đang chờ gắn vào đánh giá

// Nhận thẳng nội dung tệp (không cần thư viện multipart): client gửi file làm body với Content-Type của file.
router.post(
    '/reviews',
    requireRole('user'),
    express.raw({ type: ['image/*', 'video/*'], limit: '25mb' }),
    handle(async (req, res) => {
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || !buffer.length)
            fail(400, 'Không nhận được tệp. Chỉ chấp nhận ảnh (JPG, PNG, WebP, GIF) hoặc video (MP4, WebM).');

        const kind = sniff(buffer) || fail(400, 'Tệp không phải ảnh/video hợp lệ (JPG, PNG, WebP, GIF, MP4, WebM).');
        const limit = kind.type === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        if (buffer.length > limit) fail(413, `${kind.type === 'image' ? 'Ảnh' : 'Video'} quá lớn (tối đa ${limit / 1024 / 1024} MB).`);

        const pending = db.uploads.filter(
            (upload) => upload.userId === req.user.id && !upload.used && Date.now() - Date.parse(upload.createdAt) < ORPHAN_TTL_MS
        );
        if (pending.length >= MAX_PENDING) fail(429, 'Bạn đã tải lên quá nhiều tệp. Hãy gửi đánh giá hoặc thử lại sau.');

        const id = newId();
        const file = `${id.replace(/[^A-Za-z0-9]/g, 'x')}${Date.now().toString(36)}.${kind.ext}`;
        await writeFile(join(REVIEW_DIR, file), buffer, { flag: 'wx' });
        db.uploads.push({
            id,
            userId: req.user.id,
            file,
            type: kind.type,
            size: buffer.length,
            createdAt: new Date().toISOString(),
            used: false
        });
        save();
        res.status(201).json({ id, type: kind.type, url: `/uploads/reviews/${file}` });
    })
);

export default router;
