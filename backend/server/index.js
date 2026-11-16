import { existsSync } from 'node:fs';
import express from 'express';
import { backupDaily, db, save } from './core/store.js';
import { IS_PRODUCTION, applyAdminPassword, checkConfig, trustProxy } from './core/config.js';
import { FRONTEND_DIST } from './core/paths.js';
import { ApiError, authenticate, hashPassword } from './core/http.js';
import { ROLES } from './core/permissions.js';
import authRoutes from './routes/auth.js';
import shopRoutes from './routes/shop.js';
import orderRoutes from './routes/orders.js';
import feedbackRoutes from './routes/feedbacks.js';
import addressRoutes from './routes/addresses.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payments.js';
import trackRoutes from './routes/track.js';
import uploadRoutes from './routes/uploads.js';
import siteRoutes from './routes/site.js';
import cartRoutes from './routes/cart.js';
import voucherRoutes from './routes/vouchers.js';
import adminContentRoutes from './routes/admin-content.js';
import chatRoutes from './routes/chat.js';
import favoriteRoutes from './routes/favorites.js';
import pageRoutes from './routes/pages.js';
import { sweepAutoVouchers } from './services/vouchers.js';
import { seedEvents, seedVouchers } from './data/seed.js';
import { warmUp } from './ai/kb.js';
import { UPLOAD_ROOT, sweepUploads } from './services/uploads.js';
import { sweepExpired } from './services/orders.js';
import { seedSpecs } from './data/specs-data.js';

// PORT=0: hệ điều hành tự chọn cổng trống (bộ test dùng).
const PORT = process.env.PORT === undefined || process.env.PORT === '' ? 3000 : Number(process.env.PORT);

// Ảnh sản phẩm: tên ảnh có sẵn trong src/static/IMAGES (p1.png) hoặc ảnh admin tải lên (/uploads/products/...).
const imageName = (value) => (String(value).startsWith('/uploads/') ? String(value) : String(value).split('/').pop());

// Chuyển dữ liệu cũ sang định dạng hiện tại: băm mật khẩu, chuẩn hóa đường dẫn ảnh, bỏ các trường không còn dùng.
function migrate() {
    db.user.forEach((user) => {
        if (user.password !== undefined) {
            user.passwordHash = hashPassword(String(user.password));
            delete user.password;
        }
        if (!ROLES.includes(user.role)) user.role = user.name.toLowerCase() === 'admin' ? 'admin' : 'user';
        if (user.verified === undefined) user.verified = true; // tài khoản có sẵn coi như đã xác minh
        user.addresses ||= [];
        if (user.verified) delete user.verification;
    });
    db.products.forEach((product) => {
        product.image = imageName(product.image);
        // Sản phẩm cũ chưa có giá vốn: tạm tính bằng 70% giá bán (làm tròn nghìn) và đánh dấu "ước tính" để admin nhập giá thật
        if (!Number.isInteger(product.costPrice)) {
            product.costPrice = Math.min(product.price, Math.max(1000, Math.round((product.price * 0.7) / 1000) * 1000));
            product.costEstimated = true;
        }
    });
    seedSpecs(db); // thông số theo loại cây (màu sắc, kích thước, hương thơm...), chỉ thêm khi chưa có
    db.orders.forEach((order) => {
        order.history ||= [{ status: order.status, at: order.createdAt, by: 'system' }];
        order.items.forEach((item) => {
            item.image = imageName(item.image);
        });
        if (order.paymentMethod === 'bank_transfer') order.paymentMethod = 'sepay';
        order.paymentStatus ||= order.status === 'delivered' ? 'paid' : 'unpaid';
        // Trường của luồng "xác nhận đơn bằng mã email" đã bỏ (nay xác nhận tự động khi tiền về).
        delete order.emailConfirm;
        delete order.mailStatus;
        delete order.emailChanges;
        if (order.status !== 'unconfirmed') delete order.confirmExpiresAt;
    });
    db.carts = db.carts.filter((cart) => db.user.some((user) => user.id === cart.userId));
    seedVouchers();
    seedEvents();
    save();
}

// Cấp voucher tự động (người dùng mới, sinh nhật) cho ai đủ điều kiện; chạy khi khởi động và mỗi 10 phút.
function sweepVouchers() {
    if (sweepAutoVouchers()) save();
}

migrate();

// Chạy thật: thiếu cấu hình bắt buộc thì dừng trước khi mở cổng (xem core/config.js).
if (IS_PRODUCTION) {
    const adminProblem = applyAdminPassword();
    const { errors, warnings } = checkConfig();
    if (adminProblem) errors.unshift(adminProblem);
    warnings.forEach((text) => console.warn(`[config] ${text}`));
    if (errors.length) {
        console.error(`[config] Chưa chạy được ở chế độ production:\n- ${errors.join('\n- ')}`);
        process.exit(1);
    }
}

backupDaily();
sweepExpired();
sweepVouchers();
warmUp();
setInterval(() => {
    sweepExpired();
    sweepUploads();
}, 60 * 1000).unref();
setInterval(sweepVouchers, 10 * 60 * 1000).unref();
setInterval(backupDaily, 60 * 60 * 1000).unref();

const app = express();
app.disable('x-powered-by');
// Đứng sau proxy (Caddy, Nginx, Render...): đọc IP thật của khách từ X-Forwarded-For để giới hạn tần suất đúng người
app.set('trust proxy', trustProxy());
// Header bảo mật cơ bản: không cho site khác nhúng trang vào iframe, trình duyệt không đoán sai loại tệp
app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    next();
});
// Kiểm tra server còn sống (PM2, Render, UptimeRobot gọi định kỳ)
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));
// Nhập sản phẩm từ Excel gửi nhiều dòng nên cho phép lớn hơn các API khác
app.use('/api/admin/products/import', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '50kb' }));
app.use(authenticate);

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/feedbacks', feedbackRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminContentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api', pageRoutes);
// Ảnh/video khách đã tải lên (header nosniff đã đặt chung ở trên)
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', index: false }));
app.use('/api', siteRoutes); // phải đứng trước shopRoutes: /products/featured không bị hiểu là /products/:id
app.use('/api', shopRoutes);

app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Không tìm thấy đường dẫn API.')));

// Giao diện đã build (npm run build trong frontend/): deploy chỉ cần chạy một server này, cùng địa chỉ với /api.
// Tệp trong assets/ có mã băm trong tên nên cache lâu; trang HTML luôn hỏi lại bản mới. /products mở products.html.
if (existsSync(FRONTEND_DIST)) {
    const cacheControl = (res, path) =>
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    app.use(express.static(FRONTEND_DIST, { extensions: ['html'], setHeaders: cacheControl }));
}

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
    if (error instanceof ApiError) return res.status(error.status).json({ message: error.message, ...error.extra });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Tệp quá lớn (ảnh tối đa 5 MB, video tối đa 25 MB).' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Dữ liệu gửi lên không đúng định dạng JSON.' });
    console.error(error);
    return res.status(500).json({ message: 'Lỗi máy chủ. Vui lòng thử lại sau.' });
});

export const server = app.listen(PORT, () => console.log(`API đang chạy tại http://localhost:${server.address().port}/api`));

// Dừng êm khi PM2/Render khởi động lại hoặc bấm Ctrl+C: ngừng nhận request mới, process.exit chạy phần ghi nốt nhật ký
// hành vi đang chờ (services/analytics.js). db.json luôn ghi ngay mỗi lần đổi nên không mất dữ liệu.
['SIGTERM', 'SIGINT'].forEach((signal) =>
    process.once(signal, () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    })
);
