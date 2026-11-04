import { Router } from 'express';
import { byId, db, newId, save } from '../core/store.js';
import { createToken, fail, handle, hashPassword, publicUser, requireRole, verifyPassword } from '../core/http.js';
import { parseRegistration, passwordProblem } from '../core/rules.js';
import { CODE_TTL_MS, assertCanResend, checkCode, issueCode } from '../core/codes.js';
import { sendMail } from '../core/mailer.js';
import { syncAutoVouchers } from '../services/vouchers.js';

const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60 * 1000;
const failures = new Map();

function assertNotLocked(key) {
    const entry = failures.get(key);
    if (entry && entry.count >= MAX_FAILURES && Date.now() - entry.last < LOCK_MS) {
        fail(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.');
    }
}

// Admin đặt lại mật khẩu thì mở khóa luôn tài khoản đang bị khóa do đăng nhập sai.
export function clearLoginFailures(user) {
    failures.delete(user.name.toLowerCase());
    failures.delete(user.email.toLowerCase());
    failures.delete(`change:${user.id}`);
}

function recordFailure(key) {
    const entry = failures.get(key);
    const fresh = !entry || Date.now() - entry.last >= LOCK_MS;
    failures.set(key, { count: fresh ? 1 : entry.count + 1, last: Date.now() });
}

const router = Router();

const VERIFY_SCOPE = (user) => `verify:${user.id}`;

async function sendVerificationMail(user) {
    const { code, record } = issueCode(VERIFY_SCOPE(user));
    user.verification = record;
    save();
    await sendMail({
        to: user.email,
        subject: 'Mã xác minh tài khoản Xanh Garden',
        text: `Xin chào ${user.name},

Mã xác minh tài khoản của bạn là: ${code}
Mã có hiệu lực ${CODE_TTL_MS / 60000} phút. Không chia sẻ mã này cho bất kỳ ai.`
    });
}

const findPending = (email) => db.user.find((user) => user.email.toLowerCase() === String(email || '').trim().toLowerCase());

router.post('/register', handle(async (req, res) => {
    const { name, email, password, birthday } = parseRegistration(req.body);
    // Tài khoản đăng ký dở (chưa xác minh) không được giữ chỗ tên/email: người đăng ký lại sẽ thay thế nó.
    db.user = db.user.filter((user) => user.verified !== false ||
        (user.name.toLowerCase() !== name.toLowerCase() && user.email.toLowerCase() !== email));
    if (db.user.some((user) => user.name.toLowerCase() === name.toLowerCase())) fail(409, 'Tên đăng nhập đã tồn tại.');
    if (db.user.some((user) => user.email.toLowerCase() === email)) fail(409, 'Email đã được sử dụng.');

    const user = { id: newId(), name, email, passwordHash: hashPassword(password), role: 'user', verified: false, addresses: [], createdAt: new Date().toISOString() };
    if (birthday) { user.birthday = birthday; user.birthdaySetAt = user.createdAt; }
    db.user.push(user);
    try {
        await sendVerificationMail(user);
    } catch (error) {
        console.error('[mail]', error.message);
        fail(502, 'Không gửi được email xác minh. Hãy kiểm tra email rồi bấm "Gửi lại mã".', { needVerify: true, email });
    }
    res.status(201).json({ needVerify: true, email });
}));

router.post('/verify-email', handle((req, res) => {
    const user = findPending(req.body?.email);
    if (!user || user.verified !== false) fail(400, 'Tài khoản không cần xác minh hoặc không tồn tại.');
    if (!checkCode(user.verification, req.body?.code, VERIFY_SCOPE(user))) {
        save();
        fail(400, 'Mã xác minh không đúng.');
    }
    user.verified = true;
    delete user.verification;
    syncAutoVouchers(user); // tặng voucher người dùng mới (và sinh nhật nếu trùng hôm nay)
    save();
    res.json({ token: createToken(user), user: publicUser(user) });
}));

router.post('/resend-code', handle(async (req, res) => {
    const user = findPending(req.body?.email);
    if (!user || user.verified !== false) fail(400, 'Tài khoản không cần xác minh hoặc không tồn tại.');
    assertCanResend(user.verification);
    try {
        await sendVerificationMail(user);
    } catch (error) {
        console.error('[mail]', error.message);
        fail(502, 'Không gửi được email. Vui lòng thử lại sau.');
    }
    res.json({ ok: true });
}));

const RESET_SCOPE = (user) => `reset:${user.id}`;

// Luôn trả ok dù email có tồn tại hay không, để không lộ email nào đã đăng ký.
router.post('/forgot-password', handle(async (req, res) => {
    const user = findPending(req.body?.email);
    if (user && user.verified !== false && (!user.reset || Date.now() - user.reset.sentAt >= 60000)) {
        const { code, record } = issueCode(RESET_SCOPE(user));
        user.reset = record;
        save();
        try {
            await sendMail({
                to: user.email,
                subject: 'Mã đặt lại mật khẩu Xanh Garden',
                text: `Xin chào ${user.name},

Mã đặt lại mật khẩu của bạn là: ${code}
Mã có hiệu lực ${CODE_TTL_MS / 60000} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.`
            });
        } catch (error) {
            console.error('[mail]', error.message);
        }
    }
    res.json({ ok: true });
}));

router.post('/reset-password', handle((req, res) => {
    const user = findPending(req.body?.email);
    const password = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const weak = passwordProblem(password, user?.name, user?.email.split('@')[0]);
    if (weak) fail(400, weak);
    if (!user || !user.reset) fail(400, 'Mã không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.');
    if (!checkCode(user.reset, req.body?.code, RESET_SCOPE(user))) {
        save();
        fail(400, 'Mã xác nhận không đúng.');
    }
    user.passwordHash = hashPassword(password);
    delete user.reset;
    failures.delete(user.name.toLowerCase());
    failures.delete(user.email.toLowerCase());
    save();
    res.json({ ok: true });
}));

router.post('/login', handle((req, res) => {
    const account = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!account || !password) fail(400, 'Vui lòng nhập tên đăng nhập và mật khẩu.');
    assertNotLocked(account);

    const user = db.user.find((item) => item.name.toLowerCase() === account || item.email.toLowerCase() === account);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        recordFailure(account);
        fail(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    if (user.verified === false) {
        fail(403, 'Tài khoản chưa được xác minh email. Vui lòng nhập mã xác minh.', { needVerify: true, email: user.email });
    }
    failures.delete(account);
    res.json({ token: createToken(user), user: publicUser(user) });
}));

router.get('/me', requireRole(), handle((req, res) => {
    res.json(publicUser(byId('user', req.user.id)));
}));

// Đổi mật khẩu khi đang đăng nhập gồm 2 bước, giống quên mật khẩu nhưng có thêm mật khẩu hiện tại:
//  1) /change-password/code: nhập đúng mật khẩu hiện tại thì gửi mã OTP 6 số tới email của tài khoản;
//  2) /change-password: gửi mật khẩu hiện tại + mật khẩu mới + mã OTP.
const CHANGE_SCOPE = (user) => `change-password:${user.id}`;
const maskEmail = (email) => { const [name, domain] = email.split('@'); return `${name.slice(0, 2)}***@${domain}`; };

function checkCurrentPassword(user, current) {
    const key = `change:${user.id}`;
    assertNotLocked(key);
    if (!verifyPassword(current, user.passwordHash)) {
        recordFailure(key);
        fail(400, 'Mật khẩu hiện tại không đúng.');
    }
    return key;
}

router.post('/change-password/code', requireRole(), handle(async (req, res) => {
    const user = byId('user', req.user.id);
    checkCurrentPassword(user, typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '');
    assertCanResend(user.changeCode);
    const { code, record } = issueCode(CHANGE_SCOPE(user));
    user.changeCode = record;
    save();
    try {
        await sendMail({
            to: user.email,
            subject: 'Mã xác nhận đổi mật khẩu Xanh Garden',
            text: `Xin chào ${user.name},\n\nMã xác nhận đổi mật khẩu của bạn là: ${code}\nMã có hiệu lực ${CODE_TTL_MS / 60000} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này và đổi mật khẩu ngay.\nXanh Garden`
        });
    } catch (error) {
        console.error('[mail]', error.message);
        fail(502, 'Không gửi được email xác nhận. Vui lòng thử lại sau.');
    }
    res.json({ sentTo: maskEmail(user.email), expiresInMinutes: CODE_TTL_MS / 60000 });
}));

router.post('/change-password', requireRole(), handle((req, res) => {
    const user = byId('user', req.user.id);
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const password = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const key = checkCurrentPassword(user, current);
    const weak = passwordProblem(password, user.name, user.email.split('@')[0]);
    if (weak) fail(400, weak);
    if (verifyPassword(password, user.passwordHash)) fail(400, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    if (!checkCode(user.changeCode, req.body?.code, CHANGE_SCOPE(user))) {
        save();
        fail(400, 'Mã xác nhận không đúng.');
    }
    failures.delete(key);
    user.passwordHash = hashPassword(password);
    delete user.changeCode;
    save();
    res.json({ ok: true });
}));

export default router;
