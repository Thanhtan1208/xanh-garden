import { Router } from 'express';
import { byId, save } from '../core/store.js';
import { fail, handle, requireRole } from '../core/http.js';
import { presentProduct } from '../services/inventory.js';

// Sản phẩm yêu thích, lưu theo tài khoản (user.favorites = danh sách mã sản phẩm, mới nhất đứng đầu).
// Đăng nhập máy khác vẫn còn; sản phẩm đã bị xóa khỏi cửa hàng thì tự bỏ qua khi hiển thị.
const router = Router();
router.use(requireRole('user'));

const MAX_FAVORITES = 100;
const listOf = (req) => (byId('user', req.user.id).favorites ||= []);

router.get(
    '/',
    handle((req, res) => {
        const products = listOf(req)
            .map((id) => byId('products', id))
            .filter(Boolean)
            .map(presentProduct);
        res.json(products);
    })
);

router.put(
    '/:productId',
    handle((req, res) => {
        const product = byId('products', req.params.productId) || fail(404, 'Không tìm thấy sản phẩm.');
        const list = listOf(req);
        const id = String(product.id);
        if (!list.includes(id)) {
            // Danh sách đầy: bỏ những mã sản phẩm không còn bán trước khi báo đầy.
            if (list.length >= MAX_FAVORITES) list.splice(0, list.length, ...list.filter((item) => byId('products', item)));
            if (list.length >= MAX_FAVORITES) fail(409, `Danh sách yêu thích tối đa ${MAX_FAVORITES} sản phẩm.`);
            list.unshift(id);
            save();
        }
        res.json({ ids: list });
    })
);

router.delete(
    '/:productId',
    handle((req, res) => {
        const list = listOf(req);
        const index = list.indexOf(String(req.params.productId));
        if (index >= 0) {
            list.splice(index, 1);
            save();
        }
        res.json({ ids: list });
    })
);

// Chỉ danh sách mã (để tô trái tim trên thẻ sản phẩm mà không phải tải cả sản phẩm).
router.get(
    '/ids',
    handle((req, res) => res.json({ ids: listOf(req) }))
);

export default router;
