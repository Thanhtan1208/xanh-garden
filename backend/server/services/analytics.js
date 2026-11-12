import { appendFile, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ANALYTICS_PATH as FILE } from '../core/paths.js';

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
            /* bỏ qua dòng hỏng */
        }
    });
    // Dọn dữ liệu quá hạn lưu trữ khi khởi động.
    if (kept.length !== lines.length)
        writeFileSync(FILE, kept.map((event) => JSON.stringify(event)).join('\n') + (kept.length ? '\n' : ''));
    return kept.slice(-MAX_EVENTS);
}

export const events = load();

let pending = [];
let timer = null;

function flush() {
    timer = null;
    if (!pending.length) return;
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
    if (pending.length) {
        try {
            writeFileSync(FILE, pending.join('\n') + '\n', { flag: 'a' });
        } catch {
            /* bỏ qua */
        }
    }
});
