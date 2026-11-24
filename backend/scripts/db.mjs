// Làm việc với PostgreSQL (đọc DATABASE_URL trong backend/.env):
//   npm run db:push           tạo bảng; CSDL còn trống thì nhập data/db.json, ảnh trong data/uploads và nhật ký hành vi
//   npm run db:export         tải toàn bộ dữ liệu về data/backups/db-pg-<thời gian>.json (sao lưu)
//   npm run db:reset -- --yes sao lưu, xóa sạch các bảng rồi nạp lại từ data/db.json, data/uploads, data/analytics.ndjson
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

const envFile = new URL('../.env', import.meta.url);
// DATABASE_URL đặt sẵn khi gọi lệnh (VD thử trên CSDL khác) được ưu tiên hơn .env
const givenUrl = process.env.DATABASE_URL;
if (existsSync(envFile)) Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')));
if (givenUrl) process.env.DATABASE_URL = givenUrl;
const command = process.argv[2];
if (!['push', 'export', 'reset'].includes(command)) {
    console.log('Dùng: npm run db:push  |  npm run db:export  |  npm run db:reset -- --yes');
    process.exit(1);
}
if (!process.env.DATABASE_URL) {
    console.error('Chưa có DATABASE_URL trong backend/.env (chuỗi kết nối PostgreSQL, VD của Supabase).');
    process.exit(1);
}
if (command === 'reset' && !process.argv.includes('--yes')) {
    console.log('Lệnh này XÓA HẾT dữ liệu trên PostgreSQL rồi nạp lại từ data/db.json. Tắt server rồi chạy: npm run db:reset -- --yes');
    process.exit(1);
}

const { closePool, query, transaction } = await import('../server/core/pg.js');
const { DATA_DIR } = await import('../server/core/paths.js');
const pgStore = await import('../server/core/pg-store.js');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(DATA_DIR, 'backups');

// Mọi bảng của shop (bảng con đứng sau bảng cha)
const ALL_TABLES = [
    ...pgStore.TABLES.flatMap((spec) => [spec.table, ...spec.childList.map((child) => child.table)]),
    'app_state',
    'files',
    'analytics_events'
];

if (command === 'reset') {
    // 1. sao lưu: dữ liệu bảng + nhật ký hành vi vào 1 file JSON, ảnh/video ra thư mục riêng
    await pgStore.ensureSchema();
    const { data } = await pgStore.loadAll();
    data.analyticsEvents = (await query('SELECT t, data FROM analytics_events ORDER BY id')).rows;
    mkdirSync(backupDir, { recursive: true });
    const file = join(backupDir, `db-pg-truoc-khi-reset-${stamp}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    const files = (await query('SELECT path, data FROM files')).rows;
    const filesDir = join(backupDir, `files-truoc-khi-reset-${stamp}`);
    files.forEach((row) => {
        const target = join(filesDir, row.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, row.data);
    });
    console.log(`[db] Đã sao lưu vào ${file}`);
    console.log(`[db] Đã sao lưu ${files.length} tệp vào ${filesDir}`);
    // 2. xóa sạch các bảng (trong 1 transaction: lỗi giữa chừng thì không mất gì)
    await transaction(async (client) => {
        for (const table of ALL_TABLES) await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    });
    console.log(`[db] Đã xóa ${ALL_TABLES.length} bảng, nạp lại từ đầu...`);
}

if (command === 'push' || command === 'reset') {
    // store.js thấy CSDL trống thì tự tạo bảng và nhập db.json
    const { flushStore } = await import('../server/core/store.js');
    const { loadFileIndex } = await import('../server/core/files.js');
    await loadFileIndex();
    await import('../server/services/analytics.js');
    await flushStore();
    for (const table of ALL_TABLES) {
        const { n } = (await query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0];
        console.log(`${table.padEnd(18)} ${n} dòng`);
    }
} else {
    const { db } = await import('../server/core/store.js');
    mkdirSync(backupDir, { recursive: true });
    const file = join(backupDir, `db-pg-${stamp}.json`);
    writeFileSync(file, JSON.stringify(db, null, 2));
    console.log(`Đã lưu ${db.orders.length} đơn, ${db.user.length} tài khoản vào ${file}`);
}
await closePool();
