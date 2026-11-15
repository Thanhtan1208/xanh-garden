// Điểm chạy của "npm run server": nạp backend/.env rồi mới chạy server.
// Giá trị trong .env được ưu tiên hơn biến môi trường cùng tên của máy, để một biến hệ thống cũ
// (VD OPENAI_API_KEY đã hết hạn) không âm thầm đè lên cấu hình của dự án.
// Không có file .env (VD khi deploy) thì dùng biến môi trường như bình thường.
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const file = new URL('../.env', import.meta.url);
if (existsSync(file)) {
    const values = parseEnv(readFileSync(file, 'utf8'));
    // Chỉ in tên biến, không in giá trị
    const replaced = Object.keys(values).filter((key) => process.env[key] !== undefined && process.env[key] !== values[key]);
    Object.assign(process.env, values);
    if (replaced.length) console.log(`[env] Dùng giá trị trong .env thay cho biến môi trường của máy: ${replaced.join(', ')}`);
}

await import('./index.js');
