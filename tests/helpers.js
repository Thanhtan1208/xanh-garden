// Hạ tầng cho bộ test nghiệp vụ: chạy server THẬT (Express + toàn bộ route) ngay trong tiến trình test,
// trên một thư mục dữ liệu tạm với dữ liệu mẫu riêng. Không gửi email thật (mã xác minh được bắt từ console),
// không gọi OpenAI, không đụng tới data/db.json của cửa hàng.
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

export const PASSWORD = 'Cay@Canh2026';
export const SEPAY_KEY = 'test-sepay-key';
const DAY = 24 * 60 * 60 * 1000;

const hash = (password) => {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
};

const old = new Date(Date.now() - 90 * DAY).toISOString();

const PRODUCTS = [
    ['1', 'Lưỡi hổ', 120000, 3, 30], ['2', 'Trầu bà đế vương', 180000, 3, 8], ['3', 'Kim tiền', 250000, 2, 20],
    ['4', 'Kim ngân', 320000, 2, 20], ['5', 'Phát tài', 450000, 2, 18], ['6', 'Lan ý', 150000, 3, 6],
    ['7', 'Sen đá nhỏ', 35000, 4, 40], ['8', 'Xương rồng tai thỏ', 45000, 4, 3], ['9', 'Sen đá kim cương', 60000, 4, 28],
    ['10', 'Cỏ may mắn mini', 55000, 1, 30], ['11', 'Chậu sứ trắng', 90000, 5, 11], ['12', 'Chậu xi măng vân đá', 75000, 5, 12],
    ['13', 'Đất trồng hữu cơ 2kg', 40000, 5, 0]
];

export function fixture() {
    return {
        categories: [['1', 'Cây để bàn'], ['2', 'Cây phong thủy'], ['3', 'Cây lọc không khí'], ['4', 'Sen đá & xương rồng'], ['5', 'Chậu & phụ kiện']]
            .map(([id, name]) => ({ id, name })),
        products: PRODUCTS.map(([id, name, price, categoryId, stock]) => ({
            id, name, price, categoryId, stock, image: `p${id}.png`, description: `Mô tả ${name}`,
            care: ['Ánh sáng: Tán xạ', 'Tưới nước: 2 lần/tuần'], createdAt: old
        })),
        user: [
            { id: 'admin1', name: 'admin', email: 'admin@xanhgarden.test', role: 'admin', verified: true, passwordHash: hash(PASSWORD), addresses: [], createdAt: old },
            { id: 'cust1', name: 'khachcu', email: 'khachcu@xanhgarden.test', role: 'user', verified: true, passwordHash: hash(PASSWORD), addresses: [], createdAt: old }
        ]
    };
}

/** Khởi động server trên dữ liệu mẫu. Gọi một lần ở đầu mỗi file test. */
export async function startServer({ data = fixture() } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'xanhgarden-test-'));
    writeFileSync(join(dir, 'db.json'), JSON.stringify(data));
    Object.assign(process.env, { DATA_DIR: dir, PORT: '0', SEPAY_API_KEY: SEPAY_KEY, AUTH_SECRET: 'test-secret' });
    ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'OPENAI_API_KEY'].forEach((name) => delete process.env[name]);

    // Email ở chế độ chạy thử được in ra console: bắt lại để đọc mã xác minh / mã đặt lại mật khẩu.
    const mails = [];
    const logs = [];
    console.log = (...args) => {
        const text = args.join(' ');
        const mail = /\[MAIL -> (.+?)\] (.+?)\n([\s\S]*)/.exec(text);
        if (mail) mails.push({ to: mail[1], subject: mail[2], text: mail[3] });
        else logs.push(text);
    };
    console.warn = (...args) => logs.push(args.join(' '));

    const { server } = await import('../server/index.js');
    if (!server.listening) await once(server, 'listening');
    const { db, save } = await import('../server/core/store.js');
    const base = `http://127.0.0.1:${server.address().port}/api`;

    return {
        dir, db, save, mails, logs, base,
        stop: () => { server.close(); rmSync(dir, { recursive: true, force: true }); },
        /** Mã 6 số trong email gần nhất gửi tới `to`. */
        lastCode(to) {
            const mail = [...mails].reverse().find((item) => item.to === to);
            return /là: (\d{6})/.exec(mail?.text || '')?.[1] || null;
        }
    };
}

/** Gọi API. Trả về { status, body }. */
export async function call(ctx, method, path, { token, body, headers = {}, raw } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (raw !== undefined) {
        init.body = raw;
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(`${ctx.base}${path}`, init);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
}

export async function login(ctx, username, password = PASSWORD) {
    const result = await call(ctx, 'POST', '/auth/login', { body: { username, password } });
    if (result.status !== 200) throw new Error(`Đăng nhập ${username} thất bại: ${JSON.stringify(result.body)}`);
    return result.body.token;
}

let counter = 0;
/** Đăng ký + xác minh email một khách mới, trả về { token, user, email }. */
export async function newCustomer(ctx, extra = {}) {
    counter += 1;
    const name = `khach${Date.now().toString(36).slice(-4)}${counter}`;
    const email = `${name}@xanhgarden.test`;
    const register = await call(ctx, 'POST', '/auth/register', { body: { name, email, password: PASSWORD, ...extra } });
    if (register.status !== 201) throw new Error(`Đăng ký thất bại: ${JSON.stringify(register.body)}`);
    const verify = await call(ctx, 'POST', '/auth/verify-email', { body: { email, code: ctx.lastCode(email) } });
    if (verify.status !== 200) throw new Error(`Xác minh thất bại: ${JSON.stringify(verify.body)}`);
    return { token: verify.body.token, user: verify.body.user, email, name };
}

/** Thêm một địa chỉ cho khách, trả về id địa chỉ. */
export async function addAddress(ctx, token) {
    const result = await call(ctx, 'POST', '/addresses', { token, body: { fullName: 'Nguyễn Văn A', phone: '0901234567', address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh' } });
    if (result.status !== 201) throw new Error(`Thêm địa chỉ thất bại: ${JSON.stringify(result.body)}`);
    return result.body.at(-1).id;
}

/** Đặt đơn; items dạng [[productId, qty], ...]. */
export function placeOrder(ctx, token, addressId, items, extra = {}) {
    return call(ctx, 'POST', '/orders', {
        token,
        body: { items: items.map(([id, qty]) => ({ id, qty })), addressId, shippingMethod: 'standard', paymentMethod: 'cod', ...extra }
    });
}

export const webhook = (ctx, payload, key = SEPAY_KEY) =>
    call(ctx, 'POST', '/payments/sepay/webhook', { headers: { Authorization: `Apikey ${key}` }, body: { transferType: 'in', ...payload } });

export const stockOf = (ctx, id) => ctx.db.products.find((product) => product.id === String(id)).stock;
