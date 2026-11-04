import { Router } from 'express';
import { byId, db, newId, save } from '../core/store.js';
import { fail, handle, hashPassword, requirePermission, requireRole } from '../core/http.js';
import { randomInt } from 'node:crypto';
import { clearLoginFailures } from './auth.js';
import { hasPermission, ROLE_LABEL, ROLES } from '../core/permissions.js';
import { LOW_STOCK_AT, MAX_PRODUCT_STOCK, parseProduct, parseSettings, parseShop, passwordProblem } from '../core/rules.js';
import { sweepExpired } from '../services/orders.js';
import { buildDemand } from '../services/demand.js';
import { logStock } from '../services/inventory.js';
import { getSettings, getShop } from '../services/settings.js';
import { buildCustomerAnalytics } from '../services/customer-analytics.js';

const router = Router();

// Giờ Việt Nam (UTC+7) để chia tháng/quý đúng với cửa hàng, không phụ thuộc múi giờ máy chủ.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const vnDate = (iso) => new Date(Date.parse(iso) + VN_OFFSET_MS);

// Doanh thu tính từ chi tiết đơn (items) của đơn đã giao, không dùng số liệu sinh sẵn.
const goodsOf = (order) => order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
// Doanh thu = tiền khách thực trả: hàng - giảm giá + phí ship - giảm phí ship (đơn cũ không có voucher thì như trước).
const revenueOf = (order) => goodsOf(order) - (order.discount || 0) + (order.shippingFee || 0) - (order.shippingDiscount || 0);
const unitsOf = (order) => order.items.reduce((sum, item) => sum + item.qty, 0);

function deliveredAt(order) {
    const entry = [...order.history].reverse().find((item) => item.status === 'delivered');
    return entry?.at || order.updatedAt || order.createdAt;
}

const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round1 = (value) => Math.round(value * 10) / 10;

router.get('/users', requireRole('admin'), handle((_req, res) => {
    const rows = db.user.filter((user) => user.verified !== false).map((user) => ({
        id: user.id, name: user.name, email: user.email, role: user.role,
        roleLabel: ROLE_LABEL[user.role] || ROLE_LABEL.user,
        roleUpdatedAt: user.roleUpdatedAt || null,
        roleUpdatedBy: user.roleUpdatedBy || null,
        createdAt: user.createdAt || null,
        orderCount: db.orders.filter((order) => String(order.userId) === String(user.id)).length,
        passwordResetAt: user.passwordResetAt || null
    })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    res.json(rows);
}));

router.patch('/users/:id/role', requireRole('admin'), handle((req, res) => {
    const user = byId('user', req.params.id) || fail(404, 'Không tìm thấy tài khoản.');
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role) || role === 'admin') fail(400, 'Role mới phải là owner, staff hoặc user.');
    if (user.role === 'admin') fail(409, 'Không thể đổi role của tài khoản admin.');
    if (user.id === req.user.id) fail(409, 'Không thể tự đổi role tài khoản đang đăng nhập.');
    if (user.verified === false) fail(409, 'Tài khoản cần xác minh email trước khi được phân role.');
    user.role = role;
    user.roleUpdatedAt = new Date().toISOString();
    user.roleUpdatedBy = req.user.id;
    save();
    res.json({ id: user.id, role, roleLabel: ROLE_LABEL[role], roleUpdatedAt: user.roleUpdatedAt });
}));

// Mật khẩu tạm 12 ký tự, đủ chữ thường, chữ hoa, số, ký tự đặc biệt và qua đúng chính sách mật khẩu.
function temporaryPassword(user) {
    const pick = (chars) => chars[randomInt(chars.length)];
    const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@#$%'];
    for (;;) {
        const chars = sets.map(pick);
        while (chars.length < 12) chars.push(pick(sets.join('')));
        const password = chars.sort(() => randomInt(3) - 1).join('');
        if (!passwordProblem(password, user.name, user.email.split('@')[0])) return password;
    }
}

// Admin đặt lại mật khẩu cho tài khoản khác: tự sinh mật khẩu tạm (trả về đúng một lần) hoặc dùng mật khẩu admin nhập.
router.post('/users/:id/reset-password', requireRole('admin'), handle((req, res) => {
    const user = byId('user', req.params.id) || fail(404, 'Không tìm thấy tài khoản.');
    if (user.id === req.user.id) fail(409, 'Mật khẩu của chính bạn hãy đổi ở mục "Đổi mật khẩu của tôi".');
    if (user.verified === false) fail(409, 'Tài khoản chưa xác minh email.');
    const custom = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (custom) {
        const weak = passwordProblem(custom, user.name, user.email.split('@')[0]);
        if (weak) fail(400, weak);
    }
    const password = custom || temporaryPassword(user);
    user.passwordHash = hashPassword(password);
    user.passwordResetAt = new Date().toISOString();
    user.passwordResetBy = req.user.id;
    delete user.reset;
    clearLoginFailures(user);
    save();
    res.json({ id: user.id, password, generated: !custom, passwordResetAt: user.passwordResetAt });
}));

// ===== Xóa tài khoản =====
const FINISHED = ['delivered', 'cancelled'];

// Kiểm tra trước khi xóa: `blockers` là việc phải xử lý xong (chặn xóa), `notes` là dữ liệu sẽ giữ lại hoặc mất đi.
function deletionReport(user) {
    const mine = db.orders.filter((order) => String(order.userId) === String(user.id));
    const open = mine.filter((order) => !FINISHED.includes(order.status));
    const refunds = mine.filter((order) => order.paymentStatus === 'refund_pending');
    const openFeedbacks = db.feedbacks.filter((item) => item.userId === user.id && item.status === 'open');
    const handled = db.orders.filter((order) => order.history?.some((step) => step.by === user.name && step.by !== 'system'));
    const handledOpen = handled.filter((order) => !FINISHED.includes(order.status));
    const stockLogs = db.stockLogs.filter((log) => log.by === user.name).length;
    const wallet = db.userVouchers.filter((entry) => entry.userId === user.id).length;
    const cartItems = db.carts.find((cart) => cart.userId === user.id)?.items.length || 0;
    const reviews = db.reviews.filter((review) => review.userId === user.id).length;

    const blockers = [];
    if (open.length) blockers.push(`Có ${open.length} đơn hàng chưa hoàn thành: ${open.map((order) => order.code).join(', ')}. Hãy giao xong hoặc hủy các đơn này trước.`);
    if (refunds.length) blockers.push(`Có ${refunds.length} đơn đang chờ hoàn tiền: ${refunds.map((order) => order.code).join(', ')}.`);
    if (openFeedbacks.length) blockers.push(`Có ${openFeedbacks.length} góp ý/khiếu nại chưa được xử lý.`);
    if (user.role !== 'user' && handledOpen.length) blockers.push(`Đang phụ trách ${handledOpen.length} đơn chưa hoàn thành: ${handledOpen.map((order) => order.code).join(', ')}.`);

    const notes = [];
    if (mine.length) notes.push(`${mine.length} đơn hàng đã hoàn thành/hủy được giữ lại để đối soát doanh thu.`);
    if (reviews) notes.push(`${reviews} đánh giá sản phẩm được giữ lại.`);
    if (wallet) notes.push(`${wallet} voucher trong ví sẽ mất.`);
    if (cartItems) notes.push(`Giỏ hàng (${cartItems} sản phẩm), địa chỉ, yêu thích và lịch sử chat sẽ bị xóa.`);
    if (user.role !== 'user' && (handled.length || stockLogs)) notes.push(`Lịch sử đã xử lý ${handled.length} đơn và ${stockLogs} lần nhập/điều chỉnh kho vẫn được giữ, hiển thị theo tên "${user.name}".`);
    return { blockers, notes };
}

function deletable(req) {
    const user = byId('user', req.params.id) || fail(404, 'Không tìm thấy tài khoản.');
    if (user.id === req.user.id) fail(409, 'Không thể tự xóa tài khoản đang đăng nhập.');
    if (user.role === 'admin') fail(409, 'Không thể xóa tài khoản admin.');
    return user;
}

router.get('/users/:id/delete-check', requireRole('admin'), handle((req, res) => {
    res.json(deletionReport(deletable(req)));
}));

router.delete('/users/:id', requireRole('admin'), handle((req, res) => {
    const user = deletable(req);
    const { blockers } = deletionReport(user);
    if (blockers.length) fail(409, 'Chưa thể xóa tài khoản này.', { blockers });
    db.user = db.user.filter((item) => item.id !== user.id);
    db.carts = db.carts.filter((cart) => cart.userId !== user.id);
    db.userVouchers = db.userVouchers.filter((entry) => entry.userId !== user.id);
    db.chats = db.chats.filter((chat) => chat.userId !== user.id);
    db.uploads = db.uploads.filter((upload) => upload.userId !== user.id || upload.used);
    save();
    res.status(204).end();
}));

router.get('/stats', requirePermission('dashboard.sales'), handle((req, res) => {
    sweepExpired();
    const nowVn = vnDate(new Date().toISOString());
    const year = Number.isInteger(Number(req.query.year)) && Number(req.query.year) > 2000 ? Number(req.query.year) : nowVn.getUTCFullYear();
    const period = ['year', 'quarter', 'month'].includes(req.query.period) ? req.query.period : 'year';
    const quarter = Math.min(4, Math.max(1, Number(req.query.quarter) || Math.floor(nowVn.getUTCMonth() / 3) + 1));
    const month = Math.min(12, Math.max(1, Number(req.query.month) || nowVn.getUTCMonth() + 1));

    const delivered = db.orders.filter((order) => order.status === 'delivered').map((order) => {
        const at = vnDate(deliveredAt(order));
        return { order, year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
    });

    const years = [...new Set([...delivered.map((entry) => entry.year), nowVn.getUTCFullYear()])].sort((a, b) => b - a);
    const inYear = delivered.filter((entry) => entry.year === year);

    const quarters = [1, 2, 3, 4].map((q) => {
        const rows = inYear.filter((entry) => Math.ceil(entry.month / 3) === q);
        return { quarter: q, revenue: rows.reduce((s, e) => s + revenueOf(e.order), 0), orders: rows.length, units: rows.reduce((s, e) => s + unitsOf(e.order), 0) };
    });
    const months = Array.from({ length: 12 }, (_, index) => {
        const rows = inYear.filter((entry) => entry.month === index + 1);
        return { month: index + 1, revenue: rows.reduce((s, e) => s + revenueOf(e.order), 0), orders: rows.length };
    });

    // Kỳ liền trước (năm trước / quý trước / tháng trước) để so sánh tăng giảm.
    const prev = period === 'year' ? { year: year - 1, label: `Năm ${year - 1}` }
        : period === 'quarter' ? (quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 })
            : (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
    if (period === 'quarter') prev.label = `Quý ${prev.quarter}/${prev.year}`;
    if (period === 'month') prev.label = `Tháng ${prev.month}/${prev.year}`;
    const prevOrders = delivered.filter((entry) => entry.year === prev.year &&
        (period === 'year' || (period === 'quarter' ? Math.ceil(entry.month / 3) === prev.quarter : entry.month === prev.month)))
        .map((entry) => entry.order);
    const previousRevenue = prevOrders.reduce((sum, order) => sum + revenueOf(order), 0);
    // Doanh thu từng tháng của năm trước để so sánh cùng kỳ trên biểu đồ.
    const prevMonths = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        revenue: delivered.filter((entry) => entry.year === year - 1 && entry.month === index + 1).reduce((s, e) => s + revenueOf(e.order), 0)
    }));

    const selected = inYear.filter((entry) =>
        period === 'year' || (period === 'quarter' ? Math.ceil(entry.month / 3) === quarter : entry.month === month));
    const selectedOrders = selected.map((entry) => entry.order);
    const revenue = selectedOrders.reduce((s, o) => s + revenueOf(o), 0);

    const sold = new Map();
    selectedOrders.forEach((order) => order.items.forEach((item) => {
        const row = sold.get(item.id) || { id: item.id, name: item.name, qty: 0, revenue: 0 };
        row.qty += item.qty;
        row.revenue += item.price * item.qty;
        sold.set(item.id, row);
    }));

    // Doanh thu hàng theo danh mục (theo chi tiết đơn) và doanh thu theo hình thức thanh toán.
    const categoryRevenue = new Map();
    selectedOrders.forEach((order) => order.items.forEach((item) => {
        const categoryId = byId('products', item.id)?.categoryId;
        const name = db.categories.find((category) => Number(category.id) === Number(categoryId))?.name || 'Khác';
        categoryRevenue.set(name, (categoryRevenue.get(name) || 0) + item.price * item.qty);
    }));
    const byCategory = [...categoryRevenue].map(([name, value]) => ({ name, revenue: value })).sort((a, b) => b.revenue - a.revenue);
    const byPayment = { cod: { revenue: 0, orders: 0 }, sepay: { revenue: 0, orders: 0 } };
    selectedOrders.forEach((order) => {
        const slot = byPayment[order.paymentMethod] || byPayment.cod;
        slot.revenue += revenueOf(order);
        slot.orders += 1;
    });

    const inPeriodAll = db.orders.filter((order) => {
        const at = vnDate(order.createdAt);
        return at.getUTCFullYear() === year && (period === 'year' ||
            (period === 'quarter' ? Math.floor(at.getUTCMonth() / 3) + 1 === quarter : at.getUTCMonth() + 1 === month));
    });
    const cancelled = inPeriodAll.filter((order) => order.status === 'cancelled').length;

    // Đánh giá
    const ratingValues = db.reviews.map((review) => review.rating);
    const distribution = [1, 2, 3, 4, 5].map((star) => ({ star, count: db.reviews.filter((review) => review.rating === star).length }));
    const nameOf = (id) => byId('products', id)?.name || 'Sản phẩm đã xóa';
    const recentBadReviews = db.reviews.filter((review) => review.rating <= 2)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
        .map((review) => ({ ...review, productName: nameOf(review.productId) }));

    // Những điểm cần cải thiện
    const improvements = [];
    db.products.forEach((product) => {
        const reviews = db.reviews.filter((review) => String(review.productId) === String(product.id));
        const avg = average(reviews.map((review) => review.rating));
        if (reviews.length && avg < 3.5) improvements.push({ type: 'rating', productId: product.id, name: product.name, detail: `Điểm trung bình ${round1(avg)}/5 từ ${reviews.length} đánh giá` });
        if (product.stock <= 0) improvements.push({ type: 'stock', productId: product.id, name: product.name, detail: 'Đã hết hàng' });
        else if (product.stock <= LOW_STOCK_AT) improvements.push({ type: 'stock', productId: product.id, name: product.name, detail: `Sắp hết hàng (còn ${product.stock})` });
        else if (!sold.has(String(product.id)) && selected.length) improvements.push({ type: 'sales', productId: product.id, name: product.name, detail: 'Không bán được cái nào trong kỳ đã chọn' });
    });
    const openFeedbacks = db.feedbacks.filter((feedback) => !feedback.reply).length;
    const openComplaints = db.feedbacks.filter((feedback) => !feedback.reply && feedback.type === 'complaint').length;
    if (openComplaints) improvements.push({ type: 'feedback', name: 'Phản ánh khách hàng', detail: `${openComplaints} khiếu nại chưa được trả lời` });
    const needsRefund = db.orders.filter((order) => order.paymentStatus === 'refund_pending').length;
    if (needsRefund) improvements.push({ type: 'payment', name: 'Hoàn tiền', detail: `${needsRefund} đơn đã hủy cần hoàn tiền cho khách` });
    const badPayments = db.payments.filter((payment) => payment.result !== 'paid' && !payment.handled).length;
    const integrity = integrityIssues().length;
    if (integrity) improvements.push({ type: 'payment', name: 'Đối soát dữ liệu', detail: `${integrity} điểm bất thường trong kho/đơn hàng (xem tab Kho & vận hành)` });
    if (badPayments) improvements.push({ type: 'payment', name: 'Giao dịch SePay bất thường', detail: `${badPayments} giao dịch không khớp/thiếu tiền/trùng cần kiểm tra` });

    res.json({
        filter: { year, period, quarter, month },
        years,
        previous: {
            label: prev.label, revenue: previousRevenue, orders: prevOrders.length,
            units: prevOrders.reduce((s, o) => s + unitsOf(o), 0),
            average: prevOrders.length ? Math.round(previousRevenue / prevOrders.length) : 0
        },
        prevMonths,
        byCategory,
        byPayment,
        yearRevenue: quarters.reduce((s, q) => s + q.revenue, 0),
        quarters,
        months,
        summary: {
            revenue,
            goods: selectedOrders.reduce((s, o) => s + goodsOf(o), 0),
            shipping: selectedOrders.reduce((s, o) => s + (o.shippingFee || 0), 0),
            discount: selectedOrders.reduce((s, o) => s + (o.discount || 0) + (o.shippingDiscount || 0), 0),
            deliveredOrders: selectedOrders.length,
            units: selectedOrders.reduce((s, o) => s + unitsOf(o), 0),
            averageOrder: selectedOrders.length ? Math.round(revenue / selectedOrders.length) : 0,
            allOrders: inPeriodAll.length,
            cancelledOrders: cancelled,
            cancelRate: inPeriodAll.length ? Math.round((cancelled / inPeriodAll.length) * 100) : 0,
            waiting: db.orders.filter((order) => order.status === 'pending').length,
            openFeedbacks
        },
        topProducts: [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
        ratings: { average: round1(average(ratingValues)), count: ratingValues.length, distribution },
        recentBadReviews,
        improvements
    });
}));

// Đối soát: những điều không bao giờ được xảy ra nếu nghiệp vụ đúng. Có mục nào là dữ liệu đã bị sửa tay/lỗi.
function integrityIssues() {
    const issues = [];
    db.products.forEach((product) => {
        if (!Number.isInteger(product.stock) || product.stock < 0) issues.push(`Sản phẩm “${product.name}” có tồn kho không hợp lệ (${product.stock}).`);
    });
    db.orders.forEach((order) => {
        const goods = goodsOf(order);
        if (goods !== order.subtotal || revenueOf(order) !== order.total) {
            issues.push(`Đơn ${order.code}: tổng tiền (${order.total.toLocaleString('vi-VN')} ₫) không khớp chi tiết đơn.`);
        }
        if (order.status === 'delivered' && order.paymentStatus !== 'paid') issues.push(`Đơn ${order.code} đã giao nhưng chưa ghi nhận thanh toán.`);
        if (order.items.some((item) => !byId('products', item.id))) issues.push(`Đơn ${order.code} có sản phẩm không còn trong danh mục.`);
    });
    return issues;
}

// Tổng quan kho và các việc quản lý cần xử lý. Số đã bán lấy từ chi tiết đơn đã giao.
router.get('/inventory', requirePermission('dashboard.operations'), handle((req, res) => {
    sweepExpired();
    const sold = new Map();
    const inFlight = new Map(); // đã trừ kho nhưng đơn chưa giao xong (chờ xác nhận/giao)
    db.orders.forEach((order) => order.items.forEach((item) => {
        const target = order.status === 'delivered' ? sold : ['unconfirmed', 'pending', 'confirmed', 'shipping'].includes(order.status) ? inFlight : null;
        if (target) target.set(String(item.id), (target.get(String(item.id)) || 0) + item.qty);
    }));

    const categoryName = (id) => db.categories.find((category) => Number(category.id) === Number(id))?.name || '—';
    const products = db.products.map((product) => {
        const id = String(product.id);
        return {
            id, name: product.name, image: product.image, category: categoryName(product.categoryId), price: product.price,
            stock: product.stock, value: product.price * product.stock, sold: sold.get(id) || 0, inFlight: inFlight.get(id) || 0,
            arrivedAt: product.lastImportedAt || product.createdAt || null,
            status: product.stock <= 0 ? 'out' : product.stock <= LOW_STOCK_AT ? 'low' : 'ok'
        };
    });

    const count = (status) => db.orders.filter((order) => order.status === status).length;
    const complaints = db.feedbacks.filter((feedback) => !feedback.reply && feedback.type === 'complaint').length;
    res.json({
        lowStockAt: LOW_STOCK_AT,
        totals: {
            products: products.length,
            units: products.reduce((s, p) => s + p.stock, 0),
            value: products.reduce((s, p) => s + p.value, 0),
            low: products.filter((p) => p.status === 'low').length,
            out: products.filter((p) => p.status === 'out').length
        },
        todo: [
            { key: 'pending', label: 'Đơn chờ xác nhận', count: count('pending'), href: './admin-orders.html' },
            { key: 'confirmed', label: 'Đơn cần giao', count: count('confirmed'), href: './admin-orders.html' },
            { key: 'shipping', label: 'Đơn đang giao', count: count('shipping'), href: './admin-orders.html' },
            { key: 'unconfirmed', label: 'Đơn trên 1 triệu chờ khách chuyển khoản', count: count('unconfirmed'), href: './admin-orders.html' },
            { key: 'unpaid', label: 'Đơn SePay chưa nhận tiền', count: db.orders.filter((o) => o.paymentMethod === 'sepay' && o.paymentStatus === 'unpaid' && o.status === 'pending').length, href: './admin-orders.html' },
            { key: 'refund', label: 'Cần hoàn tiền', count: db.orders.filter((o) => o.paymentStatus === 'refund_pending').length, href: './admin-orders.html', urgent: true },
            { key: 'complaint', label: 'Khiếu nại chưa trả lời', count: complaints, href: './feedback.html', urgent: true },
            { key: 'payments', label: 'Giao dịch SePay bất thường', count: db.payments.filter((p) => p.result !== 'paid' && !p.handled).length, href: '#payments', urgent: true },
            { key: 'integrity', label: 'Dữ liệu kho/đơn bất thường', count: integrityIssues().length, href: '#integrity', urgent: true }
        ],
        integrity: integrityIssues(),
        payments: hasPermission(req.user, 'payments.manage')
            ? db.payments.filter((payment) => payment.result !== 'paid' && !payment.handled)
                .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 20)
            : [],
        products
    });
}));

// Nhập thêm hàng: cộng vào tồn kho hiện tại (an toàn hơn ghi đè khi có khách đang đặt hàng).
router.patch('/products/:id/stock', requirePermission('inventory.manage'), handle((req, res) => {
    const product = byId('products', req.params.id) || fail(404, 'Không tìm thấy sản phẩm.');
    const add = Number(req.body?.add);
    if (!Number.isInteger(add) || add < 1 || add > MAX_PRODUCT_STOCK) fail(400, `Số lượng nhập thêm phải là số nguyên từ 1 đến ${MAX_PRODUCT_STOCK}.`);
    if (product.stock + add > MAX_PRODUCT_STOCK) fail(400, `Tồn kho tối đa ${MAX_PRODUCT_STOCK}. Hiện còn ${product.stock}.`);
    product.stock += add;
    logStock(product, 'import', add, { note: String(req.body?.note || '').slice(0, 200), by: req.user.name });
    save();
    res.json({ id: String(product.id), stock: product.stock, lastImportedAt: product.lastImportedAt });
}));

router.patch('/payments/:id/handled', requirePermission('payments.manage'), handle((req, res) => {
    const payment = byId('payments', req.params.id) || fail(404, 'Không tìm thấy giao dịch.');
    payment.handled = true;
    payment.handledAt = new Date().toISOString();
    save();
    res.json(payment);
}));

// Báo cáo nhu cầu khách hàng từ hành vi truy cập (xem demand.js).
router.get('/demand', requirePermission('customers.analytics'), handle((req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    res.json(buildDemand(days));
}));

router.get('/customer-analytics', requirePermission('customers.analytics'), handle((req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    res.json(buildCustomerAnalytics(days));
}));

router.get('/payments', requirePermission('payments.manage'), handle((_req, res) => {
    res.json([...db.payments].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 50));
}));

// ===== Quản lý sản phẩm =====
// Cài đặt sản phẩm mới (số ngày hiện nhãn, khuyến mãi tự động cho sản phẩm mới): xem được cùng quyền xem sản phẩm, sửa cần quyền quản lý sản phẩm.
router.get('/settings', requirePermission('products.view'), handle((_req, res) => res.json(getSettings())));

router.put('/settings', requirePermission('products.manage'), handle((req, res) => {
    db.settings = { ...db.settings, ...parseSettings(req.body) };
    save();
    res.json(getSettings());
}));

// Thông tin cửa hàng hiển thị trên website (tên, hotline, địa chỉ...): chủ cửa hàng và admin sửa.
router.get('/shop', requirePermission('content.manage'), handle((_req, res) => res.json(getShop())));

router.put('/shop', requirePermission('content.manage'), handle((req, res) => {
    db.settings = { ...db.settings, shop: parseShop(req.body) };
    save();
    res.json(getShop());
}));

router.post('/products', requirePermission('products.manage'), handle((req, res) => {
    const data = parseProduct(req.body, db.categories);
    if (!db.categories.some((category) => Number(category.id) === data.categoryId)) fail(400, 'Danh mục không tồn tại.');
    if (db.products.some((product) => product.name.toLowerCase() === data.name.toLowerCase())) fail(409, 'Tên sản phẩm đã tồn tại.');
    const product = { id: newId(), ...data, care: [], createdAt: new Date().toISOString() };
    db.products.push(product);
    logStock(product, 'import', product.stock, { note: 'Nhập lần đầu khi tạo sản phẩm', by: req.user.name });
    save();
    res.status(201).json(product);
}));

router.put('/products/:id', requirePermission('products.manage'), handle((req, res) => {
    const product = byId('products', req.params.id) || fail(404, 'Không tìm thấy sản phẩm.');
    const data = parseProduct(req.body, db.categories);
    if (!db.categories.some((category) => Number(category.id) === data.categoryId)) fail(400, 'Danh mục không tồn tại.');
    if (db.products.some((other) => other !== product && other.name.toLowerCase() === data.name.toLowerCase())) fail(409, 'Tên sản phẩm đã tồn tại.');
    const before = product.stock;
    Object.assign(product, data);
    // Sửa tồn kho trực tiếp trong form là điều chỉnh (kiểm kê), khác với nhập hàng mới ở tab Kho.
    logStock(product, 'adjust', product.stock - before, { note: 'Điều chỉnh tồn kho khi sửa sản phẩm', by: req.user.name });
    save();
    res.json(product);
}));

router.delete('/products/:id', requirePermission('products.manage'), handle((req, res) => {
    const product = byId('products', req.params.id) || fail(404, 'Không tìm thấy sản phẩm.');
    if (db.orders.some((order) => order.items.some((item) => String(item.id) === String(product.id)))) {
        fail(409, 'Sản phẩm đã có trong đơn hàng nên không thể xóa. Hãy đặt tồn kho về 0 để ngừng bán.');
    }
    db.products.splice(db.products.indexOf(product), 1);
    save();
    res.status(204).end();
}));

export default router;
