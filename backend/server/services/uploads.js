import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { UPLOAD_ROOT } from '../core/paths.js';
import { db, save } from '../core/store.js';

// Tệp tải lên nằm ở data/uploads/ (ảnh/video đánh giá, ảnh banner, ảnh sản phẩm), db.json chỉ lưu đường dẫn.
export { UPLOAD_ROOT };
export const REVIEW_DIR = join(UPLOAD_ROOT, 'reviews');
export const BANNER_DIR = join(UPLOAD_ROOT, 'banners');
export const PRODUCT_DIR = join(UPLOAD_ROOT, 'products');
export const AVATAR_DIR = join(UPLOAD_ROOT, 'avatars');
mkdirSync(REVIEW_DIR, { recursive: true });
mkdirSync(BANNER_DIR, { recursive: true });
mkdirSync(PRODUCT_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });

export const MAX_IMAGES = 5;
export const MAX_VIDEOS = 1;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const ORPHAN_TTL_MS = 60 * 60 * 1000; // tệp tải lên mà không gắn vào đánh giá nào sau 1 giờ sẽ bị xóa

const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte);

// Xác định loại tệp bằng "chữ ký" ở đầu tệp, không tin vào đuôi hay Content-Type do client gửi.
export function sniff(buffer) {
    if (buffer.length < 16) return null;
    if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { type: 'image', ext: 'jpg' };
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image', ext: 'png' };
    if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return { type: 'image', ext: 'gif' };
    if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8))
        return { type: 'image', ext: 'webp' };
    if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) return { type: 'video', ext: 'mp4' };
    if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { type: 'video', ext: 'webm' };
    return null;
}

export async function removeFile(file) {
    try {
        await unlink(join(REVIEW_DIR, file));
    } catch {
        /* tệp đã mất thì bỏ qua */
    }
}

// Xóa ảnh banner đã tải lên khi không còn banner nào dùng.
export async function removeBannerFile(url) {
    const file = String(url).split('/').pop();
    if (!String(url).startsWith('/uploads/banners/') || !/^[\w.-]+$/.test(file)) return;
    try {
        await unlink(join(BANNER_DIR, file));
    } catch {
        /* tệp đã mất thì bỏ qua */
    }
}

// Xóa ảnh đại diện cũ khi khách đổi ảnh hoặc tài khoản bị xóa.
export async function removeAvatarFile(url) {
    const file = String(url).split('/').pop();
    if (!String(url).startsWith('/uploads/avatars/') || !/^[\w.-]+$/.test(file)) return;
    try {
        await unlink(join(AVATAR_DIR, file));
    } catch {
        /* tệp đã mất thì bỏ qua */
    }
}

// Xóa tệp (và bản ghi) của một đánh giá bị xóa.
export function removeUploadsByUrl(urls) {
    urls.forEach((url) => {
        const file = String(url).split('/').pop();
        const index = db.uploads.findIndex((upload) => upload.file === file);
        if (index >= 0) db.uploads.splice(index, 1);
        removeFile(file);
    });
}

// Ảnh banner/ảnh sản phẩm admin đã tải lên nhưng không gắn vào đâu (bấm Hủy, hoặc đã thay ảnh khác): xóa sau 1 giờ.
// Ảnh sản phẩm còn nằm trong chi tiết đơn hàng cũ thì giữ lại để đơn vẫn hiện đúng ảnh lúc mua.
function sweepAdminImages(cutoff) {
    const used = new Set([
        ...db.banners.map((banner) => banner.image),
        ...db.products.map((product) => product.image),
        ...db.orders.flatMap((order) => order.items.map((item) => item.image))
    ]);
    [
        [BANNER_DIR, '/uploads/banners/'],
        [PRODUCT_DIR, '/uploads/products/']
    ].forEach(([dir, prefix]) => {
        readdirSync(dir).forEach((file) => {
            if (used.has(prefix + file)) return;
            try {
                if (statSync(join(dir, file)).mtimeMs < cutoff) unlinkSync(join(dir, file));
            } catch {
                /* tệp vừa bị xóa: bỏ qua */
            }
        });
    });
}

// Dọn tệp mồ côi: tải lên nhưng khách không gửi đánh giá / admin không dùng.
export function sweepUploads() {
    const cutoff = Date.now() - ORPHAN_TTL_MS;
    sweepAdminImages(cutoff);
    const stale = db.uploads.filter((upload) => !upload.used && Date.parse(upload.createdAt) < cutoff);
    if (!stale.length) return;
    stale.forEach((upload) => removeFile(upload.file));
    db.uploads = db.uploads.filter((upload) => !stale.includes(upload));
    save();
}
