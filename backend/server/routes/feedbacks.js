import { Router } from 'express';
import { byId, db, newId, save } from '../core/store.js';
import { fail, handle, requirePermission, requireRole } from '../core/http.js';
import { hasPermission } from '../core/permissions.js';
import { MAX_OPEN_FEEDBACKS, parseFeedback, parseReply } from '../core/rules.js';

const router = Router();
router.use(requireRole());

router.get(
    '/',
    handle((req, res) => {
        const items = hasPermission(req.user, 'feedback.viewAll')
            ? db.feedbacks
            : db.feedbacks.filter((item) => item.userId === req.user.id);
        res.json([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    })
);

router.post(
    '/',
    requireRole('user'),
    handle((req, res) => {
        const data = parseFeedback(req.body);

        if (data.orderCode && !db.orders.some((order) => order.code === data.orderCode && order.userId === req.user.id)) {
            fail(400, 'Mã đơn hàng không tồn tại trong tài khoản của bạn.');
        }
        const openCount = db.feedbacks.filter((item) => item.userId === req.user.id && item.status === 'open').length;
        if (openCount >= MAX_OPEN_FEEDBACKS)
            fail(429, `Bạn đang có ${MAX_OPEN_FEEDBACKS} phản hồi chưa được xử lý. Vui lòng chờ cửa hàng phản hồi.`);

        const feedback = {
            id: newId(),
            userId: req.user.id,
            userName: req.user.name,
            ...data,
            status: 'open',
            reply: '',
            createdAt: new Date().toISOString()
        };
        db.feedbacks.push(feedback);
        save();
        res.status(201).json(feedback);
    })
);

router.patch(
    '/:id/reply',
    requirePermission('feedback.reply'),
    handle((req, res) => {
        const feedback = byId('feedbacks', req.params.id) || fail(404, 'Không tìm thấy phản hồi.');
        feedback.reply = parseReply(req.body);
        feedback.status = 'resolved';
        feedback.repliedAt = new Date().toISOString();
        save();
        res.json(feedback);
    })
);

router.delete(
    '/:id',
    requirePermission('feedback.delete'),
    handle((req, res) => {
        const feedback = byId('feedbacks', req.params.id) || fail(404, 'Không tìm thấy phản hồi.');
        db.feedbacks.splice(db.feedbacks.indexOf(feedback), 1);
        save();
        res.status(204).end();
    })
);

export default router;
