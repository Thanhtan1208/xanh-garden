import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mọi dữ liệu sinh ra khi chạy (cơ sở dữ liệu, nhật ký hành vi, tệp khách tải lên, bản sao lưu) nằm chung một thư mục
// data/ ở gốc project. Thư mục này bị chặn ở Vite (vite.config.js) nên trình duyệt không tải trực tiếp được db.json.
// Đặt biến môi trường DATA_DIR để dùng thư mục khác (bộ test chạy trên một thư mục tạm, không đụng dữ liệu thật).
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'db.json');
export const ANALYTICS_PATH = join(DATA_DIR, 'analytics.ndjson');
export const UPLOAD_ROOT = join(DATA_DIR, 'uploads');
export const BACKUP_DIR = join(DATA_DIR, 'backups');

mkdirSync(DATA_DIR, { recursive: true });

// Bản cũ để db.json, analytics.ndjson và uploads/ ngay ở thư mục gốc: chuyển vào data/ một lần.
if (!process.env.DATA_DIR) {
    [
        ['db.json', DB_PATH],
        ['analytics.ndjson', ANALYTICS_PATH],
        ['uploads', UPLOAD_ROOT]
    ].forEach(([name, target]) => {
        const legacy = join(ROOT, name);
        if (!existsSync(legacy) || existsSync(target)) return;
        try {
            renameSync(legacy, target);
            console.log(`[data] Đã chuyển ${name} vào thư mục data/.`);
        } catch (error) {
            console.error(`[data] Không chuyển được ${name} vào data/: ${error.message}`);
        }
    });
}
