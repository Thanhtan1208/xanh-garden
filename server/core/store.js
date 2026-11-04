import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_DIR, DB_PATH } from './paths.js';

const COLLECTIONS = [
    'categories', 'products', 'user', 'orders', 'reviews', 'feedbacks', 'payments', 'uploads',
    'stockLogs', 'events', 'banners', 'vouchers', 'userVouchers', 'carts', 'chats'
];
const KEEP_BACKUPS = 7;

function load() {
    const data = existsSync(DB_PATH) ? JSON.parse(readFileSync(DB_PATH, 'utf8')) : {};
    delete data.$schema;
    COLLECTIONS.forEach((name) => { data[name] ||= []; });
    data.settings ||= {};   // cài đặt cửa hàng admin chỉnh trên giao diện (sản phẩm mới, khuyến mãi sản phẩm mới)
    return data;
}

export const db = load();

// Tăng mỗi lần ghi: số liệu tính sẵn (đã bán, điểm đánh giá...) biết khi nào cần tính lại.
export let version = 0;

// Ghi file qua file tạm rồi đổi tên để db.json không bị hỏng nếu tiến trình dừng giữa chừng.
export function save() {
    version += 1;
    const tempPath = `${DB_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(db, null, 2));
    renameSync(tempPath, DB_PATH);
}

// Sao lưu mỗi ngày một bản (data/backups/db-YYYY-MM-DD.json), giữ 7 bản gần nhất.
// Lỡ sửa tay hỏng db.json hoặc xóa nhầm dữ liệu thì chép bản sao lưu đè lại.
export function backupDaily() {
    if (!existsSync(DB_PATH)) return;
    try {
        mkdirSync(BACKUP_DIR, { recursive: true });
        const file = join(BACKUP_DIR, `db-${new Date().toISOString().slice(0, 10)}.json`);
        if (!existsSync(file)) copyFileSync(DB_PATH, file);
        readdirSync(BACKUP_DIR).filter((name) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
            .slice(0, -KEEP_BACKUPS).forEach((name) => unlinkSync(join(BACKUP_DIR, name)));
    } catch (error) {
        console.error('[backup]', error.message);
    }
}

export function newId() {
    return randomBytes(6).toString('base64url');
}

export const byId = (collection, id) =>
    db[collection].find((item) => String(item.id) === String(id));
