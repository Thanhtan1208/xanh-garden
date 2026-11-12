import { Router } from 'express';
import { byId, db, newId, save } from '../core/store.js';
import { fail, handle, requirePermission, requireRole } from '../core/http.js';
import { hasPermission } from '../core/permissions.js';
import { parseReply, parseReview } from '../core/rules.js';
import { MAX_IMAGES, MAX_VIDEOS, removeUploadsByUrl } from '../services/uploads.js';
import { arrivalTime, presentProduct } from '../services/inventory.js';

const router = Router();

const hasPurchased = (userId, productId) =>
    db.orders.some(
        (order) =>
            String(order.userId) === String(userId) &&
            order.status === 'delivered' &&
            order.items.some((item) => String(item.id) === String(productId))
    );

const hasReviewed = (userId, productId) =>
    db.reviews.some((review) => String(review.userId) === String(userId) && String(review.productId) === String(productId));

function reviewStatus(user, productId) {
    if (!user) return { canReview: false, reason: 'login' };
    if (!hasPermission(user, 'customer.purchase')) return { canReview: false, reason: 'admin' };
    if (hasReviewed(user.id, productId)) return { canReview: false, reason: 'reviewed' };
    if (!hasPurchased(user.id, productId)) return { canReview: false, reason: 'not_purchased' };
    return { canReview: true };
}

router.get('/categories', (_req, res) => res.json(db.categories));
// ?sort=newest: sắp theo thời điểm hàng về gần nhất (sản phẩm cũ chưa có ngày xếp cuối).
router.get(
    '/products',
    handle((req, res) => {
        const list = req.query.sort === 'newest' ? [...db.products].sort((a, b) => arrivalTime(b) - arrivalTime(a)) : db.products;
        res.json(list.map(presentProduct));
    })
);

// Đánh giá tốt gần đây của khách đã mua (trang chủ "Khách hàng nói gì"); chỉ lấy dữ liệu thật trong db.
router.get(
    '/reviews/latest',
    handle((req, res) => {
        const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 6));
        const rows = db.reviews
            .filter((review) => review.rating >= 4 && byId('products', review.productId))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((review) => {
                const product = byId('products', review.productId);
                return {
                    id: review.id,
                    userName: review.userName,
                    rating: review.rating,
                    comment: review.comment,
                    createdAt: review.createdAt,
                    productId: String(product.id),
                    productName: product.name,
                    productImage: product.image,
                    photo: (review.media || []).find((item) => item.type === 'image')?.url || null
                };
            });
        res.json(rows);
    })
);

router.get(
    '/products/:id',
    handle((req, res) => {
        const product = byId('products', req.params.id) || fail(404, 'Không tìm thấy sản phẩm.');
        res.json(presentProduct(product));
    })
);

// Khách "đóng" đánh giá của mình thì chỉ ẩn trên màn hình của họ (closedByMe), người khác vẫn thấy.
router.get(
    '/products/:id/reviews',
    handle((req, res) => {
        const reviews = db.reviews
            .filter((review) => String(review.productId) === req.params.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(({ authorClosed, ...review }) =>
                authorClosed && req.user?.id === review.userId ? { ...review, closedByMe: true } : review
            );
        res.json(reviews);
    })
);

router.get(
    '/products/:id/review-status',
    handle((req, res) => {
        byId('products', req.params.id) || fail(404, 'Không tìm thấy sản phẩm.');
        res.json(reviewStatus(req.user, req.params.id));
    })
);

// Lấy các tệp đã tải lên của chính người này và chưa gắn vào đánh giá nào; giới hạn 5 ảnh + 1 video.
function takeMedia(user, ids) {
    if (ids === undefined || ids === null) return [];
    if (!Array.isArray(ids) || ids.length > MAX_IMAGES + MAX_VIDEOS)
        fail(400, `Mỗi đánh giá tối đa ${MAX_IMAGES} ảnh và ${MAX_VIDEOS} video.`);
    const items = [...new Set(ids.map(String))].map(
        (id) =>
            db.uploads.find((upload) => upload.id === id && upload.userId === user.id && !upload.used) ||
            fail(400, 'Tệp đính kèm không hợp lệ hoặc đã hết hạn. Vui lòng tải lại.')
    );
    if (items.filter((item) => item.type === 'image').length > MAX_IMAGES) fail(400, `Tối đa ${MAX_IMAGES} ảnh.`);
    if (items.filter((item) => item.type === 'video').length > MAX_VIDEOS) fail(400, `Tối đa ${MAX_VIDEOS} video.`);
    return items;
}

// Chỉ người đã nhận hàng (đơn "delivered") mới được đánh giá, mỗi sản phẩm một lần.
router.post(
    '/reviews',
    requireRole('user'),
    handle((req, res) => {
        const product = byId('products', req.body?.productId) || fail(404, 'Không tìm thấy sản phẩm.');
        const status = reviewStatus(req.user, product.id);
        if (!status.canReview) {
            fail(
                403,
                status.reason === 'reviewed' ? 'Bạn đã đánh giá sản phẩm này.' : 'Chỉ khách đã nhận hàng mới được đánh giá sản phẩm.'
            );
        }

        const content = parseReview(req.body);
        const media = takeMedia(req.user, req.body?.media);
        const review = {
            id: newId(),
            productId: String(product.id),
            userId: req.user.id,
            userName: req.user.name,
            ...content,
            media: media.map((item) => ({ type: item.type, url: `/uploads/reviews/${item.file}` })),
            createdAt: new Date().toISOString()
        };
        media.forEach((item) => {
            item.used = true;
        });
        db.reviews.push(review);
        save();
        res.status(201).json(review);
    })
);

// Chỉ admin và chủ cửa hàng được xóa đánh giá (quyền feedback.delete); khách chỉ đóng được đánh giá của mình.
router.delete(
    '/reviews/:id',
    requirePermission('feedback.delete'),
    handle((req, res) => {
        const review = byId('reviews', req.params.id) || fail(404, 'Không tìm thấy đánh giá.');
        db.reviews.splice(db.reviews.indexOf(review), 1);
        removeUploadsByUrl((review.media || []).map((item) => item.url));
        save();
        res.status(204).end();
    })
);

router.post(
    '/reviews/:id/close',
    requireRole('user'),
    handle((req, res) => {
        const review = byId('reviews', req.params.id) || fail(404, 'Không tìm thấy đánh giá.');
        if (review.userId !== req.user.id) fail(403, 'Bạn chỉ đóng được đánh giá của chính mình.');
        review.authorClosed = true;
        save();
        res.status(204).end();
    })
);

// Cửa hàng phản hồi công khai dưới đánh giá (nhân viên, chủ, admin); gửi lại thì thay nội dung cũ.
router.patch(
    '/reviews/:id/reply',
    requirePermission('feedback.reply'),
    handle((req, res) => {
        const review = byId('reviews', req.params.id) || fail(404, 'Không tìm thấy đánh giá.');
        review.reply = { text: parseReply(req.body), by: req.user.name, at: new Date().toISOString() };
        save();
        res.json(review);
    })
);

export default router;
