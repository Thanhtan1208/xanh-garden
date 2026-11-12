import { Router } from 'express';
import { byId, db, save } from '../core/store.js';
import { fail, handle, requireRole } from '../core/http.js';
import { MAX_LINE_QUANTITY } from '../core/rules.js';

// Giỏ hàng lưu theo tài khoản (collection carts: { userId, items: [{ id, qty }], updatedAt }),
// nên đổi máy/đăng nhập lại vẫn còn. Admin không mua hàng nên không có giỏ.
const router = Router();
router.use(requireRole('user'));

const MAX_LINES = 50;

// Chuẩn hóa giỏ: gộp dòng trùng, bỏ sản phẩm không còn, giới hạn theo tồn kho và MAX_LINE_QUANTITY.
// Sản phẩm hết hàng bị loại để giỏ luôn thanh toán được.
function clean(rawItems) {
    if (!Array.isArray(rawItems)) fail(400, 'Giỏ hàng không hợp lệ.');
    if (rawItems.length > MAX_LINES * 4) fail(400, 'Giỏ hàng có quá nhiều dòng.');
    const quantities = new Map();
    rawItems.forEach((entry) => {
        const qty = Math.floor(Number(entry?.qty));
        const id = String(entry?.id ?? '').trim();
        if (!id || !Number.isFinite(qty) || qty < 1) return;
        quantities.set(id, (quantities.get(id) || 0) + qty);
    });
    const items = [];
    const removed = [];
    quantities.forEach((qty, id) => {
        const product = byId('products', id);
        if (!product) {
            removed.push({ id, reason: 'removed' });
            return;
        }
        if (product.stock <= 0) {
            removed.push({ id, name: product.name, reason: 'soldout' });
            return;
        }
        const limit = Math.min(product.stock, MAX_LINE_QUANTITY);
        items.push({ id: String(product.id), qty: Math.min(qty, limit) });
    });
    return { items: items.slice(0, MAX_LINES), removed };
}

const cartOf = (userId) => {
    let cart = db.carts.find((item) => item.userId === userId);
    if (!cart) {
        cart = { userId, items: [], updatedAt: new Date().toISOString() };
        db.carts.push(cart);
    }
    return cart;
};

router.get(
    '/',
    handle((req, res) => {
        const cart = cartOf(req.user.id);
        const { items, removed } = clean(cart.items);
        cart.items = items;
        res.json({ items, removed });
    })
);

// Ghi đè giỏ bằng bản của trình duyệt (mỗi lần khách thêm/bớt/xóa).
router.put(
    '/',
    handle((req, res) => {
        const cart = cartOf(req.user.id);
        const { items, removed } = clean(req.body?.items);
        cart.items = items;
        cart.updatedAt = new Date().toISOString();
        save();
        res.json({ items, removed });
    })
);

// Gộp giỏ lúc chưa đăng nhập vào giỏ của tài khoản: cộng số lượng theo sản phẩm rồi giới hạn lại.
router.post(
    '/merge',
    handle((req, res) => {
        const cart = cartOf(req.user.id);
        const extra = Array.isArray(req.body?.items) ? req.body.items : [];
        const { items, removed } = clean([...cart.items, ...extra]);
        cart.items = items;
        cart.updatedAt = new Date().toISOString();
        save();
        res.json({ items, removed });
    })
);

router.delete(
    '/',
    handle((req, res) => {
        const cart = cartOf(req.user.id);
        cart.items = [];
        cart.updatedAt = new Date().toISOString();
        save();
        res.status(204).end();
    })
);

export default router;
