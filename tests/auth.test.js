// Nghiệp vụ tài khoản: đăng ký, xác minh email, đăng nhập (khóa khi sai nhiều), quên/đặt lại mật khẩu, phân quyền.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, call, login, newCustomer, startServer } from './helpers.js';

let ctx;
before(async () => { ctx = await startServer(); });
after(() => ctx.stop());

describe('Đăng ký', () => {
    test('từ chối mật khẩu yếu, tên sai định dạng, email sai', async () => {
        const weak = await call(ctx, 'POST', '/auth/register', { body: { name: 'minh01', email: 'minh01@test.vn', password: '12345678' } });
        assert.equal(weak.status, 400);
        const badName = await call(ctx, 'POST', '/auth/register', { body: { name: 'minh 01', email: 'minh01@test.vn', password: PASSWORD } });
        assert.equal(badName.status, 400);
        const badEmail = await call(ctx, 'POST', '/auth/register', { body: { name: 'minh01', email: 'minh01@test', password: PASSWORD } });
        assert.equal(badEmail.status, 400);
        const containsName = await call(ctx, 'POST', '/auth/register', { body: { name: 'caycanh', email: 'x1@test.vn', password: 'Caycanh@2026' } });
        assert.equal(containsName.status, 400, 'mật khẩu chứa tên đăng nhập phải bị từ chối');
    });

    test('ngày sinh không hợp lệ bị từ chối (tuổi < 10, ngày không tồn tại)', async () => {
        const young = new Date().getFullYear() - 5;
        const tooYoung = await call(ctx, 'POST', '/auth/register', { body: { name: 'beti', email: 'beti@test.vn', password: PASSWORD, birthday: `${young}-01-01` } });
        assert.equal(tooYoung.status, 400);
        const invalid = await call(ctx, 'POST', '/auth/register', { body: { name: 'beti', email: 'beti@test.vn', password: PASSWORD, birthday: '2001-02-30' } });
        assert.equal(invalid.status, 400);
    });

    test('đăng ký -> gửi mã -> chưa xác minh thì không đăng nhập được', async () => {
        const result = await call(ctx, 'POST', '/auth/register', { body: { name: 'lan_anh', email: 'Lan.Anh@Test.vn', password: PASSWORD } });
        assert.equal(result.status, 201);
        assert.equal(result.body.email, 'lan.anh@test.vn', 'email được chuẩn hóa chữ thường');
        assert.match(ctx.lastCode('lan.anh@test.vn'), /^\d{6}$/);
        const stored = ctx.db.user.find((user) => user.name === 'lan_anh');
        assert.ok(!JSON.stringify(stored).includes(ctx.lastCode('lan.anh@test.vn')), 'db chỉ lưu bản băm của mã');

        const loginBefore = await call(ctx, 'POST', '/auth/login', { body: { username: 'lan_anh', password: PASSWORD } });
        assert.equal(loginBefore.status, 403);
        assert.equal(loginBefore.body.needVerify, true);
    });

    test('trùng tên/email với tài khoản đã xác minh bị từ chối, không phân biệt hoa thường', async () => {
        const sameName = await call(ctx, 'POST', '/auth/register', { body: { name: 'KhachCu', email: 'khac@test.vn', password: PASSWORD } });
        assert.equal(sameName.status, 409);
        const sameEmail = await call(ctx, 'POST', '/auth/register', { body: { name: 'khacten', email: 'KHACHCU@xanhgarden.test', password: PASSWORD } });
        assert.equal(sameEmail.status, 409);
    });

    test('đăng ký lại khi tài khoản cũ chưa xác minh thì thay thế tài khoản cũ', async () => {
        await call(ctx, 'POST', '/auth/register', { body: { name: 'dangdo', email: 'dangdo@test.vn', password: PASSWORD } });
        const again = await call(ctx, 'POST', '/auth/register', { body: { name: 'dangdo', email: 'dangdo@test.vn', password: PASSWORD } });
        assert.equal(again.status, 201);
        assert.equal(ctx.db.user.filter((user) => user.name === 'dangdo').length, 1);
    });
});

describe('Xác minh email', () => {
    test('sai mã thì báo lỗi, sai quá 5 lần thì khóa mã, gửi lại phải chờ 60 giây', async () => {
        await call(ctx, 'POST', '/auth/register', { body: { name: 'saima', email: 'saima@test.vn', password: PASSWORD } });
        const code = ctx.lastCode('saima@test.vn');
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i += 1) {
            const result = await call(ctx, 'POST', '/auth/verify-email', { body: { email: 'saima@test.vn', code: wrong } });
            assert.equal(result.status, 400);
        }
        const locked = await call(ctx, 'POST', '/auth/verify-email', { body: { email: 'saima@test.vn', code } });
        assert.equal(locked.status, 429, 'mã đúng cũng bị chặn sau 5 lần sai');
        const resend = await call(ctx, 'POST', '/auth/resend-code', { body: { email: 'saima@test.vn' } });
        assert.equal(resend.status, 429, 'chưa đủ 60 giây');
    });

    test('mã đúng -> đăng nhập luôn, nhận voucher người dùng mới', async () => {
        const { token, user } = await newCustomer(ctx);
        assert.ok(token);
        assert.equal(user.role, 'user');
        const wallet = await call(ctx, 'GET', '/vouchers/mine', { token });
        assert.ok(wallet.body.vouchers.some((row) => row.voucher.code === 'WELCOME15'), 'được tặng WELCOME15');
    });
});

describe('Đăng nhập', () => {
    test('đăng nhập bằng tên hoặc email, trả token dùng được cho /auth/me', async () => {
        const byName = await login(ctx, 'khachcu');
        const byEmail = await login(ctx, 'KHACHCU@xanhgarden.test');
        assert.ok(byName && byEmail);
        const me = await call(ctx, 'GET', '/auth/me', { token: byName });
        assert.equal(me.status, 200);
        assert.equal(me.body.name, 'khachcu');
        assert.equal(me.body.passwordHash, undefined, 'không lộ mật khẩu đã băm');
    });

    test('token sai/giả mạo bị coi như chưa đăng nhập', async () => {
        const fake = await call(ctx, 'GET', '/auth/me', { token: 'abc.def' });
        assert.equal(fake.status, 401);
        const token = await login(ctx, 'khachcu');
        const [payload, signature] = token.split('.');
        const forged = Buffer.from(JSON.stringify({ sub: 'admin1', exp: Date.now() + 1e9 })).toString('base64url');
        const attempt = await call(ctx, 'GET', '/admin/inventory', { token: `${forged}.${signature}` });
        assert.equal(attempt.status, 401, 'đổi payload thì chữ ký không khớp');
        assert.ok(payload);
    });

    test('sai mật khẩu 5 lần thì khóa 10 phút', async () => {
        const { name } = await newCustomer(ctx);
        for (let i = 0; i < 5; i += 1) {
            const wrong = await call(ctx, 'POST', '/auth/login', { body: { username: name, password: 'Sai@12345' } });
            assert.equal(wrong.status, 401);
        }
        const locked = await call(ctx, 'POST', '/auth/login', { body: { username: name, password: PASSWORD } });
        assert.equal(locked.status, 429);
    });
});

describe('Quên mật khẩu', () => {
    test('không lộ email có tồn tại hay không', async () => {
        const result = await call(ctx, 'POST', '/auth/forgot-password', { body: { email: 'khongco@test.vn' } });
        assert.equal(result.status, 200);
    });

    test('đặt lại bằng mã -> đăng nhập bằng mật khẩu mới, mật khẩu cũ hết tác dụng', async () => {
        const { name, email } = await newCustomer(ctx);
        await call(ctx, 'POST', '/auth/forgot-password', { body: { email } });
        const code = ctx.lastCode(email);
        const weak = await call(ctx, 'POST', '/auth/reset-password', { body: { email, code, newPassword: 'abc' } });
        assert.equal(weak.status, 400);
        const reset = await call(ctx, 'POST', '/auth/reset-password', { body: { email, code, newPassword: 'Moi@Pass2026' } });
        assert.equal(reset.status, 200);
        const oldLogin = await call(ctx, 'POST', '/auth/login', { body: { username: name, password: PASSWORD } });
        assert.equal(oldLogin.status, 401);
        assert.ok(await login(ctx, name, 'Moi@Pass2026'));
        const reuse = await call(ctx, 'POST', '/auth/reset-password', { body: { email, code, newPassword: 'Khac@Pass2026' } });
        assert.equal(reuse.status, 400, 'mã chỉ dùng được một lần');
    });
});

describe('Đổi mật khẩu khi đang đăng nhập (có xác nhận OTP qua email)', () => {
    test('phải đúng mật khẩu hiện tại, nhập đúng mã OTP gửi về email, mật khẩu mới đủ mạnh và khác mật khẩu cũ', async () => {
        const { token, name, email } = await newCustomer(ctx);
        const sendCode = (currentPassword) => call(ctx, 'POST', '/auth/change-password/code', { token, body: { currentPassword } });
        const change = (currentPassword, newPassword, code) => call(ctx, 'POST', '/auth/change-password', { token, body: { currentPassword, newPassword, code } });

        assert.equal((await call(ctx, 'POST', '/auth/change-password/code', { body: { currentPassword: PASSWORD } })).status, 401, 'phải đăng nhập');
        assert.equal((await sendCode('Sai@12345')).status, 400, 'sai mật khẩu hiện tại thì không gửi mã');
        assert.equal((await change(PASSWORD, 'Moi@Pass2026', '123456')).status, 400, 'chưa có mã nào được gửi');

        const sent = await sendCode(PASSWORD);
        assert.equal(sent.status, 200, JSON.stringify(sent.body));
        assert.match(sent.body.sentTo, /\*\*\*@/, 'email được che bớt');
        assert.equal((await sendCode(PASSWORD)).status, 429, 'chờ 60 giây mới gửi lại');
        const code = ctx.lastCode(email);
        assert.match(code, /^\d{6}$/);

        assert.equal((await change('Sai@12345', 'Moi@Pass2026', code)).status, 400, 'sai mật khẩu hiện tại');
        assert.equal((await change(PASSWORD, 'yeu', code)).status, 400, 'mật khẩu mới yếu');
        assert.equal((await change(PASSWORD, PASSWORD, code)).status, 400, 'trùng mật khẩu cũ');
        assert.equal((await change(PASSWORD, 'Moi@Pass2026', '000000')).status, 400, 'sai mã OTP');
        assert.equal((await change(PASSWORD, 'Moi@Pass2026', code)).status, 200, 'đúng mã OTP');
        assert.equal((await change(PASSWORD, 'Khac@Pass2026', code)).status, 400, 'mã chỉ dùng một lần');

        assert.equal((await call(ctx, 'POST', '/auth/login', { body: { username: name, password: PASSWORD } })).status, 401);
        assert.ok(await login(ctx, name, 'Moi@Pass2026'));
    });
});

describe('Phân quyền', () => {
    test('khách không vào được API quản trị; chưa đăng nhập bị chặn ở API cần đăng nhập', async () => {
        const token = await login(ctx, 'khachcu');
        for (const path of ['/admin/stats', '/admin/inventory', '/admin/vouchers', '/admin/banners', '/admin/stock-logs']) {
            const result = await call(ctx, 'GET', path, { token });
            assert.equal(result.status, 403, path);
        }
        for (const path of ['/orders', '/cart', '/addresses', '/feedbacks', '/vouchers/mine']) {
            const result = await call(ctx, 'GET', path);
            assert.equal(result.status, 401, path);
        }
    });

    test('admin không có giỏ hàng, không đặt hàng', async () => {
        const token = await login(ctx, 'admin');
        assert.equal((await call(ctx, 'GET', '/cart', { token })).status, 403);
        assert.equal((await call(ctx, 'POST', '/orders', { token, body: {} })).status, 403);
    });
});
