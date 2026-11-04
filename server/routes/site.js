import { Router } from 'express';
import { db } from '../core/store.js';
import { handle } from '../core/http.js';
import { arrivalTime, presentProduct } from '../services/inventory.js';
import { bestSellers } from '../services/sales.js';
import { activeBanners, currentEvent } from '../services/site.js';
import { getShop, publicRules } from '../services/settings.js';

// API công khai phục vụ trang chủ: giao diện theo sự kiện, banner, sản phẩm bán chạy theo tháng, hàng mới về.
const router = Router();

router.get('/site', handle((_req, res) => {
    const time = Date.now();
    const event = currentEvent(time);
    res.json({
        event: event ? { id: event.id, name: event.name, endAt: event.endAt, theme: event.theme } : null,
        banners: activeBanners(event, time)
    });
}));

// Thông tin cửa hàng và các con số nghiệp vụ (phí ship, ngưỡng chuyển khoản...) để giao diện hiển thị, không viết cứng trong code giao diện.
router.get('/shop', handle((_req, res) => res.json({ shop: getShop(), rules: publicRules() })));

router.get('/products/featured', handle((req, res) => {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 8));
    res.json(bestSellers(limit).map(({ product, rank, source, soldMonth }) => ({ ...presentProduct(product), rank, source, soldMonth })));
}));

// Hàng mới về: sắp theo thời điểm nhập gần nhất.
router.get('/products/new', handle((req, res) => {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 8));
    res.json([...db.products].filter((product) => arrivalTime(product) > 0)
        .sort((a, b) => arrivalTime(b) - arrivalTime(a)).slice(0, limit).map(presentProduct));
}));

export default router;
