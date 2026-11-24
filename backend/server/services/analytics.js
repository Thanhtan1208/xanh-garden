import { appendFile, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ANALYTICS_PATH as FILE } from '../core/paths.js';
import { USE_PG, query } from '../core/pg.js';
import '../core/store.js'; // tạo bảng trước khi đọc nhật ký

// Nhật ký hành vi khách (mỗi dòng một sự kiện JSON, data/analytics.ndjson). Tách khỏi db.json để ghi thêm nhanh,
// không phải ghi lại cả cơ sở dữ liệu mỗi lần khách mở một trang.
export const RETENTION_DAYS = 90;
const MAX_EVENTS = 200000;

function load() {
    if (!existsSync(FILE)) return [];
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    const kept = [];
    lines.forEach((line) => {
        try {
            const event = JSON.parse(line);
            if (event.t >= cutoff) kept.push(event);
        } catch {
            // bỏ qua dòng hỏng
        }
    });
    // Dọn dữ liệu quá hạn lưu trữ khi khởi động.
    if (kept.length !== lines.length)
        writeFileSync(FILE, kept.map((event) => JSON.stringify(event)).join('\n') + (kept.length ? '\n' : ''));
    return kept.slice(-MAX_EVENTS);
}

// Chế độ PostgreSQL: bảng analytics_events (ổ đĩa máy chủ miễn phí không giữ được file)
async function loadPg() {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    await query('DELETE FROM analytics_events WHERE t < $1', [cutoff]);
    // Lần đầu dùng PostgreSQL: nhập nhật ký cũ trong file
    const { rows } = await query('SELECT count(*)::int AS n FROM analytics_events');
    const old = rows[0].n ? [] : load();
    for (let start = 0; start < old.length; start += 5000) {
        const chunk = old.slice(start, start + 5000);
        const values = chunk.map((_event, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ');
        await query(
            `INSERT INTO analytics_events (t, data) VALUES ${values}`,
            chunk.flatMap((event) => [event.t || 0, JSON.stringify(event)])
        );
    }
    const result = await query('SELECT data FROM (SELECT id, data FROM analytics_events ORDER BY id DESC LIMIT $1) recent ORDER BY id', [
        MAX_EVENTS
    ]);
    return result.rows.map((row) => row.data);
}

export const events = USE_PG ? await loadPg() : load();

let pending = [];
let timer = null;

function flush() {
    timer = null;
    if (!pending.length) return;
    if (USE_PG) {
        const rows = pending;
        pending = [];
        const params = rows.flatMap((text) => [JSON.parse(text).t || Date.now(), text]);
        const values = rows.map((_text, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ');
        query(`INSERT INTO analytics_events (t, data) VALUES ${values}`, params).catch((error) =>
            console.error('[analytics]', error.message)
        );
        return;
    }
    const chunk = pending.join('\n') + '\n';
    pending = [];
    appendFile(FILE, chunk, (error) => {
        if (error) console.error('[analytics]', error.message);
    });
}

// Ghi nhanh vào bộ nhớ, gom lại và ghi xuống đĩa mỗi giây một lần để ít tốn tài nguyên.
export function record(list) {
    list.forEach((event) => {
        events.push(event);
        pending.push(JSON.stringify(event));
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    if (!timer) timer = setTimeout(flush, 1000);
}

process.on('exit', () => {
    if (pending.length && !USE_PG) {
        try {
            writeFileSync(FILE, pending.join('\n') + '\n', { flag: 'a' });
        } catch {
            // bỏ qua
        }
    }
});
