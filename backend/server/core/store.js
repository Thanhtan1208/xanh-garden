import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BACKUP_DIR, DB_PATH, SAMPLE_DB_PATH, UPLOAD_ROOT } from './paths.js';
import { USE_PG } from './pg.js';

const COLLECTIONS = [
    'categories',
    'products',
    'user',
    'orders',
    'reviews',
    'feedbacks',
    'payments',
    'uploads',
    'stockLogs',
    'events',
    'banners',
    'vouchers',
    'userVouchers',
    'carts',
    'chats'
];
const KEEP_BACKUPS = 7;

// Chưa có db.json thì đọc dữ liệu mẫu; db.json được tạo ở lần ghi đầu tiên (lúc khởi động).
function loadJson() {
    const source = [DB_PATH, SAMPLE_DB_PATH].find((path) => existsSync(path));
    if (source === SAMPLE_DB_PATH) console.log('[data] Chưa có db.json: khởi động bằng dữ liệu mẫu db.sample.json.');
    const data = source ? JSON.parse(readFileSync(source, 'utf8')) : {};
    delete data.$schema;
    COLLECTIONS.forEach((name) => {
        data[name] ||= [];
    });
    data.settings ||= {}; // cài đặt cửa hàng admin chỉnh trên giao diện (sản phẩm mới, khuyến mãi sản phẩm mới)
    return data;
}

// Có DATABASE_URL: đọc từ PostgreSQL. CSDL còn trống (lần đầu) thì nhập dữ liệu từ db.json (hoặc dữ liệu mẫu) vào.
async function loadPg() {
    const pgStore = await import('./pg-store.js');
    await pgStore.ensureSchema();
    const { data, empty } = await pgStore.loadAll();
    if (!empty) {
        COLLECTIONS.forEach((name) => {
            data[name] ||= [];
        });
        data.settings ||= {};
        pgStore.rememberAll(data);
        return { data, pgStore };
    }
    const source = loadJson();
    const work = pgStore.diff(source);
    await pgStore.persist(work);
    console.log(`[db] CSDL PostgreSQL trống: đã nhập dữ liệu từ ${existsSync(DB_PATH) ? 'db.json' : 'dữ liệu mẫu'}.`);
    return { data: source, pgStore };
}

const loaded = USE_PG ? await loadPg() : { data: loadJson(), pgStore: null };
export const db = loaded.data;
const pgStore = loaded.pgStore;

// Tăng mỗi lần ghi: số liệu tính sẵn (đã bán, điểm đánh giá...) biết khi nào cần tính lại.
export let version = 0;

// Ghi file qua file tạm rồi đổi tên để db.json không bị hỏng nếu tiến trình dừng giữa chừng.
// Chế độ PostgreSQL: gom các lần save() liền nhau rồi ghi một lần, chỉ các dòng đã đổi.
export function save() {
    version += 1;
    if (pgStore) return schedulePersist();
    const tempPath = `${DB_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(db, null, 2));
    renameSync(tempPath, DB_PATH);
}

let writing = null; // lần ghi đang chạy
let again = false; // có thay đổi mới trong lúc đang ghi
let retryTimer = null;
export const storeStatus = { mode: USE_PG ? 'postgres' : 'file', lastError: null };

function schedulePersist() {
    if (writing) {
        again = true;
        return writing;
    }
    writing = new Promise((resolve) => setImmediate(resolve)).then(runPersist);
    return writing;
}

async function runPersist() {
    try {
        do {
            again = false;
            const work = pgStore.diff(db);
            if (!work.empty) await pgStore.persist(work);
        } while (again);
        storeStatus.lastError = null;
    } catch (error) {
        // Mất kết nối CSDL: dữ liệu vẫn còn trong bộ nhớ, thử ghi lại sau 5 giây
        storeStatus.lastError = error.message;
        console.error('[db] Ghi PostgreSQL lỗi, thử lại sau 5 giây:', error.message);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(schedulePersist, 5000);
        retryTimer.unref?.();
    } finally {
        writing = null;
    }
}

// Chờ ghi xong mọi thay đổi (tắt server, bộ test)
export async function flushStore() {
    if (!pgStore) return;
    while (writing) await writing;
    const work = pgStore.diff(db);
    if (!work.empty) await pgStore.persist(work);
}

// Sao lưu mỗi ngày một bản (data/backups/db-YYYY-MM-DD.json), giữ 7 bản gần nhất.
// Lỡ sửa tay hỏng db.json hoặc xóa nhầm dữ liệu thì chép bản sao lưu đè lại.
export function backupDaily() {
    if (!pgStore && !existsSync(DB_PATH)) return;
    try {
        mkdirSync(BACKUP_DIR, { recursive: true });
        const file = join(BACKUP_DIR, `db-${new Date().toISOString().slice(0, 10)}.json`);
        // chế độ PostgreSQL: chụp dữ liệu đang có trong bộ nhớ
        if (!existsSync(file)) {
            if (pgStore) writeFileSync(file, JSON.stringify(db));
            else copyFileSync(DB_PATH, file);
        }
        readdirSync(BACKUP_DIR)
            .filter((name) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name))
            .sort()
            .slice(0, -KEEP_BACKUPS)
            .forEach((name) => unlinkSync(join(BACKUP_DIR, name)));
        copyOffsite(file);
    } catch (error) {
        console.error('[backup]', error.message);
    }
}

// BACKUP_COPY_DIR: thư mục ngoài máy chủ (ổ khác, thư mục Google Drive/OneDrive đang đồng bộ) nhận thêm một bản mỗi ngày,
// kèm ảnh khách và admin tải lên (chỉ chép tệp mới). Máy hỏng ổ cứng vẫn còn dữ liệu.
function copyOffsite(file, target = process.env.BACKUP_COPY_DIR) {
    if (!target) return;
    mkdirSync(target, { recursive: true });
    const copy = join(target, basename(file));
    if (!existsSync(copy)) copyFileSync(file, copy);
    if (existsSync(UPLOAD_ROOT)) cpSync(UPLOAD_ROOT, join(target, 'uploads'), { recursive: true, force: false });
}

export function newId() {
    return randomBytes(6).toString('base64url');
}

// Sản phẩm bị ẩn (hidden: true): khách và chatbot không thấy; đơn cũ và trang quản trị vẫn dùng bình thường.
export const isVisible = (product) => Boolean(product) && !product.hidden;
export const visibleProducts = () => db.products.filter(isVisible);
export const visibleProduct = (id) => {
    const product = db.products.find((item) => String(item.id) === String(id));
    return isVisible(product) ? product : undefined;
};

export const byId = (collection, id) => db[collection].find((item) => String(item.id) === String(id));
