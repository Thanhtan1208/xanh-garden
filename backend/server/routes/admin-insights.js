import { Router } from 'express';
import { version } from '../core/store.js';
import { fail, handle, requirePermission } from '../core/http.js';
import { aiConfigured } from '../ai/openai.js';
import { aiNarrative, buildInsights } from '../services/insights.js';

// Phân tích và gợi ý kinh doanh: chỉ chủ cửa hàng và admin (quyền xem doanh thu).
const router = Router();

const PERIODS = [7, 30, 90];
const daysOf = (value) => (PERIODS.includes(Number(value)) ? Number(value) : 30);

// Gợi ý theo quy tắc: tính ngay từ dữ liệu, không cần AI
router.get(
    '/insights',
    requirePermission('dashboard.sales'),
    handle((req, res) => {
        res.json({ ...buildInsights({ days: daysOf(req.query.days) }), ai: { available: aiConfigured() } });
    })
);

// Bản phân tích do AI viết lại từ cùng số liệu. Tốn phí nên: nhớ kết quả 30 phút (đến khi dữ liệu đổi), tối đa 10 lần mỗi giờ.
const CACHE_MS = 30 * 60 * 1000;
const AI_PER_HOUR = 10;
const cache = new Map();
const calls = new Map();

router.post(
    '/insights/ai',
    requirePermission('dashboard.sales'),
    handle(async (req, res) => {
        if (!aiConfigured())
            fail(
                503,
                'Chưa cấu hình khóa OpenAI (OPENAI_API_KEY) nên chưa dùng được phân tích bằng AI. Các gợi ý theo quy tắc vẫn dùng bình thường.'
            );
        const days = daysOf(req.body?.days);
        const now = Date.now();
        const hit = cache.get(days);
        if (hit && hit.version === version && now - hit.at < CACHE_MS) return res.json({ ...hit.result, cached: true });

        const recent = (calls.get(req.user.id) || []).filter((time) => now - time < 60 * 60 * 1000);
        if (recent.length >= AI_PER_HOUR) fail(429, `Bạn đã dùng phân tích AI ${AI_PER_HOUR} lần trong một giờ qua. Vui lòng thử lại sau.`);

        const { text, model } = await aiNarrative(buildInsights({ days }));
        if (!text) fail(502, 'AI không trả về nội dung. Vui lòng thử lại.');
        calls.set(req.user.id, [...recent, now]);
        const result = { text, model, days, generatedAt: new Date().toISOString() };
        cache.set(days, { version, at: now, result });
        res.json({ ...result, cached: false });
    })
);

export default router;
