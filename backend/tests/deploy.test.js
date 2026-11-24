// Chạy thật (deploy): server phục vụ luôn bản build frontend, header bảo mật, IP thật sau proxy,
// kiểm tra cấu hình production (dừng khi thiếu khóa, tự thay mật khẩu admin mẫu) và dữ liệu mẫu cho lần chạy đầu.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, startServer } from './helpers.js';

const INDEX = fileURLToPath(new URL('../server/index.js', import.meta.url));
const SECRET = 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(16);
const NEW_ADMIN_PASSWORD = 'Xanh#Garden2026';

// Thư mục build giả của frontend
function fakeDist() {
    const dir = mkdtempSync(join(tmpdir(), 'xanhgarden-dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<h1>trang-chu</h1>');
    writeFileSync(join(dir, 'products.html'), '<h1>san-pham</h1>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1);');
    return dir;
}

// Biến môi trường sạch cho tiến trình con: không mang theo khóa thật hay cấu hình của bộ test
function childEnv(extra) {
    const env = { ...process.env };
    ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'AUTH_SECRET', 'SEPAY_API_KEY']
        .concat([
            'ADMIN_PASSWORD',
            'PAYMENT_DEMO',
            'TRUST_PROXY',
            'FRONTEND_DIST',
            'DATA_DIR',
            'PORT',
            'DATABASE_URL',
            'DB_SCHEMA',
            'RENDER',
            'BREVO_API_KEY'
        ])
        .forEach((name) => delete env[name]);
    return { ...env, NODE_ENV: 'production', PORT: '0', ...extra };
}

let ctx;
let root;
let dist;
let config;
let http;
before(async () => {
    dist = fakeDist();
    process.env.FRONTEND_DIST = dist;
    ctx = await startServer();
    root = ctx.base.replace(/\/api$/, '');
    // Nạp sau startServer để dùng thư mục dữ liệu tạm của bộ test
    config = await import('../server/core/config.js');
    http = await import('../server/core/http.js');
});
after(() => {
    ctx.stop();
    rmSync(dist, { recursive: true, force: true });
});

describe('Phục vụ giao diện đã build', () => {
    test('trang chủ và trang HTML không đuôi .html, HTML luôn hỏi lại bản mới', async () => {
        const home = await fetch(`${root}/`);
        assert.equal(home.status, 200);
        assert.match(await home.text(), /trang-chu/);
        assert.equal(home.headers.get('cache-control'), 'no-cache');
        const products = await fetch(`${root}/products`);
        assert.match(await products.text(), /san-pham/);
    });

    test('tệp trong assets/ được cache lâu dài', async () => {
        const asset = await fetch(`${root}/assets/app-abc123.js`);
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('cache-control'), /immutable/);
    });

    test('/api/health báo server còn chạy, kèm header bảo mật và không lộ Express', async () => {
        const response = await fetch(`${ctx.base}/health`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
        assert.equal(response.headers.get('x-powered-by'), null);
    });
});

describe('Đứng sau proxy', () => {
    test('giới hạn tần suất tính theo IP thật của khách (X-Forwarded-For), không gộp mọi khách thành một', async () => {
        const send = (ip) =>
            fetch(`${ctx.base}/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
                body: JSON.stringify({ events: [] })
            });
        let last;
        for (let i = 0; i < 241; i += 1) last = await send('203.0.113.7');
        assert.equal(last.status, 429, 'khách gửi quá 240 lần/phút bị chặn');
        assert.equal((await send('203.0.113.8')).status, 204, 'khách khác vẫn gửi được');
    });
});

describe('Kiểm tra cấu hình production', () => {
    const goodEnv = { AUTH_SECRET: SECRET, SEPAY_API_KEY: 'khoa-sepay-rieng', SMTP_HOST: 'smtp.example.com' };
    const demoAdmin = () => ({ name: 'admin', role: 'admin', passwordHash: http.hashPassword(config.DEMO_PASSWORD) });

    test('thiếu AUTH_SECRET, SEPAY_API_KEY hoặc dùng khóa thử thì báo lỗi', () => {
        const empty = config.checkConfig({ env: {}, users: [], dist });
        assert.equal(empty.errors.length, 2);
        assert.match(empty.errors.join(' '), /AUTH_SECRET/);
        assert.match(empty.errors.join(' '), /SEPAY_API_KEY/);
        const weak = config.checkConfig({ env: { AUTH_SECRET: http.DEV_SECRET, SEPAY_API_KEY: 'dev-sepay-key' }, users: [], dist });
        assert.equal(weak.errors.length, 2);
        assert.equal(config.checkConfig({ env: { ...goodEnv, AUTH_SECRET: 'ngan-qua' }, users: [], dist }).errors.length, 1);
    });

    test('tài khoản quản lý còn mật khẩu mẫu là lỗi; khách dùng trùng mật khẩu đó thì không', () => {
        const result = config.checkConfig({ env: goodEnv, users: [demoAdmin()], dist });
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /admin/);
        const customer = { name: 'khach', role: 'user', passwordHash: http.hashPassword(config.DEMO_PASSWORD) };
        assert.deepEqual(config.checkConfig({ env: goodEnv, users: [customer], dist }).errors, []);
    });

    test('thông tin cửa hàng còn là mẫu hoặc thiếu MST thì cảnh báo (không chặn khởi động)', () => {
        const sample = config.checkConfig({ env: goodEnv, users: [], dist, shop: {} });
        assert.deepEqual(sample.errors, []);
        assert.match(sample.warnings.join(' '), /hotline, email, zalo/);
        assert.match(sample.warnings.join(' '), /mã số thuế/);
        const real = { hotline: '0987 654 321', email: 'shop@gmail.com', zalo: 'https://zalo.me/0987654321', taxCode: '0312345678' };
        assert.ok(!/mẫu|mã số thuế/.test(config.checkConfig({ env: goodEnv, users: [], dist, shop: real }).warnings.join(' ')));
    });

    test('chạy trên Render: thiếu DATABASE_URL (ổ đĩa bị xóa) hoặc gửi mail qua SMTP (bị chặn cổng) là lỗi', () => {
        const render = config.checkConfig({ env: { ...goodEnv, RENDER: 'true' }, users: [], dist });
        assert.match(render.errors.join(' '), /DATABASE_URL/);
        assert.match(render.errors.join(' '), /BREVO_API_KEY/);
        const ready = { ...goodEnv, RENDER: 'true', DATABASE_URL: 'postgres://x', BREVO_API_KEY: 'k' };
        assert.deepEqual(config.checkConfig({ env: ready, users: [], dist }).errors, []);
    });

    test('ADMIN_PASSWORD thay mật khẩu mẫu đúng một lần, mật khẩu yếu hoặc trùng mẫu thì báo lỗi', () => {
        const admin = demoAdmin();
        assert.match(config.applyAdminPassword('abc', [admin]), /ADMIN_PASSWORD/);
        assert.match(config.applyAdminPassword(config.DEMO_PASSWORD, [admin]), /mẫu/);
        assert.ok(http.verifyPassword(config.DEMO_PASSWORD, admin.passwordHash), 'chưa đổi khi mật khẩu mới không đạt');

        assert.equal(config.applyAdminPassword(NEW_ADMIN_PASSWORD, [admin]), null);
        assert.ok(http.verifyPassword(NEW_ADMIN_PASSWORD, admin.passwordHash));
        assert.ok(admin.passwordResetAt, 'token cấp bằng mật khẩu mẫu hết hiệu lực');
        const hash = admin.passwordHash;
        assert.equal(config.applyAdminPassword('Khac#Hoan2026', [admin]), null);
        assert.equal(admin.passwordHash, hash, 'lần khởi động sau không đổi nữa');
    });
});

describe('Khởi động ở chế độ production (tiến trình riêng)', () => {
    test('thiếu cấu hình bắt buộc thì dừng ngay và nói rõ thiếu gì', () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'xanhgarden-prod-'));
        try {
            const result = spawnSync(process.execPath, [INDEX], { env: childEnv({ DATA_DIR: dataDir }), encoding: 'utf8', timeout: 30000 });
            assert.equal(result.status, 1, result.stdout + result.stderr);
            assert.match(result.stderr, /AUTH_SECRET/);
            assert.match(result.stderr, /SEPAY_API_KEY/);
            assert.match(result.stderr, /admin/);
        } finally {
            rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
        }
    });

    test('server mới: dùng dữ liệu mẫu, thay mật khẩu admin mẫu bằng ADMIN_PASSWORD rồi chạy', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'xanhgarden-prod-'));
        const env = childEnv({ DATA_DIR: dataDir, FRONTEND_DIST: dist, AUTH_SECRET: SECRET, SEPAY_API_KEY: 'khoa-sepay-rieng' });
        const child = spawn(process.execPath, [INDEX], { env: { ...env, ADMIN_PASSWORD: NEW_ADMIN_PASSWORD } });
        try {
            let output = '';
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`Server không chạy được:\n${output}`)), 30000);
                const read = (chunk) => {
                    output += chunk;
                    const match = /http:\/\/localhost:(\d+)\/api/.exec(output);
                    if (match) {
                        clearTimeout(timer);
                        resolve(`http://127.0.0.1:${match[1]}/api`);
                    }
                };
                child.stdout.on('data', read);
                child.stderr.on('data', read);
                child.on('exit', (code) => reject(new Error(`Server dừng (mã ${code}):\n${output}`)));
            });
            assert.match(output, /dữ liệu mẫu/);
            assert.match(output, /Đã thay mật khẩu mẫu của: admin/);

            const loginWith = (password) =>
                fetch(`${base}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: 'admin', password })
                });
            assert.equal((await loginWith(config.DEMO_PASSWORD)).status, 401, 'mật khẩu mẫu không còn đăng nhập được');
            assert.equal((await loginWith(NEW_ADMIN_PASSWORD)).status, 200);
            const products = await (await fetch(`${base}/products`)).json();
            assert.ok(products.length > 0, 'có sản phẩm mẫu');
        } finally {
            if (child.exitCode === null) {
                child.kill();
                await once(child, 'exit');
            }
            rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
        }
    });
});
