// Tệp tải lên (ảnh/video đánh giá, ảnh sản phẩm, banner, avatar). Luôn ghi vào data/uploads/;
// chế độ PostgreSQL thì lưu thêm vào bảng files vì máy chủ miễn phí (Render) xóa ổ đĩa mỗi lần khởi động lại.
// Tệp không còn trên đĩa thì lấy từ CSDL rồi ghi lại vào đĩa làm bộ nhớ đệm.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { UPLOAD_ROOT } from './paths.js';
import { USE_PG, query } from './pg.js';

// Danh sách tệp trong CSDL (đường dẫn -> thời điểm tạo) để dọn tệp mồ côi mà không phải đọc cả nội dung
const index = new Map();

const toKey = (path) => relative(UPLOAD_ROOT, path).split(sep).join('/');
const safeKey = (key) => /^[a-z]+\/[\w.-]+$/.test(key);

export async function loadFileIndex() {
    if (!USE_PG) return;
    const result = await query('SELECT path, created_at FROM files');
    result.rows.forEach((row) => index.set(row.path, row.created_at.getTime()));
    // Lần đầu dùng PostgreSQL: chép các tệp đang có trên đĩa vào CSDL
    if (!result.rows.length && existsSync(UPLOAD_ROOT)) {
        let count = 0;
        for (const folder of readdirSync(UPLOAD_ROOT)) {
            const dir = join(UPLOAD_ROOT, folder);
            if (!statSync(dir).isDirectory()) continue;
            for (const name of readdirSync(dir)) {
                const key = `${folder}/${name}`;
                if (!safeKey(key)) continue;
                const data = readFileSync(join(dir, name));
                await query('INSERT INTO files (path, data, size) VALUES ($1, $2, $3) ON CONFLICT (path) DO NOTHING', [
                    key,
                    data,
                    data.length
                ]);
                index.set(key, statSync(join(dir, name)).mtimeMs);
                count += 1;
            }
        }
        if (count) console.log(`[db] Đã chép ${count} tệp tải lên vào PostgreSQL.`);
    }
}

// Ghi tệp mới (tên tệp do server tạo, không trùng)
export async function saveUpload(path, buffer) {
    await writeFile(path, buffer, { flag: 'wx' });
    if (!USE_PG) return;
    const key = toKey(path);
    await query('INSERT INTO files (path, data, size) VALUES ($1, $2, $3)', [key, buffer, buffer.length]);
    index.set(key, Date.now());
}

export async function deleteUpload(path) {
    try {
        await unlink(path);
    } catch {
        // tệp đã mất thì bỏ qua
    }
    if (!USE_PG) return;
    const key = toKey(path);
    index.delete(key);
    await query('DELETE FROM files WHERE path = $1', [key]).catch((error) => console.error('[db]', error.message));
}

// Tệp trong một thư mục kèm thời điểm tạo (dọn ảnh không còn dùng)
export function listUploads(dir) {
    const folder = toKey(dir);
    const found = new Map();
    if (existsSync(dir))
        readdirSync(dir).forEach((name) => {
            try {
                found.set(name, statSync(join(dir, name)).mtimeMs);
            } catch {
                // tệp vừa bị xóa
            }
        });
    index.forEach((time, key) => {
        if (key.startsWith(`${folder}/`)) found.set(key.slice(folder.length + 1), time);
    });
    return [...found].map(([name, time]) => ({ name, time }));
}

const TYPES = {
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
};

// Đặt trước express.static('/uploads'): tệp không có trên đĩa thì lấy từ CSDL
export function restoreFromDb() {
    return async (req, _res, next) => {
        if (!USE_PG || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        const key = decodeURIComponent(req.path.slice(1));
        if (!safeKey(key) || !TYPES[extname(key)] || !index.has(key)) return next();
        const path = join(UPLOAD_ROOT, ...key.split('/'));
        if (existsSync(path)) return next();
        try {
            const result = await query('SELECT data FROM files WHERE path = $1', [key]);
            if (result.rows.length) {
                mkdirSync(dirname(path), { recursive: true });
                writeFileSync(path, result.rows[0].data);
            }
        } catch (error) {
            console.error('[db]', error.message);
        }
        next();
    };
}
