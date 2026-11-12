import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, handle } from '../core/http.js';

// Trang thông tin cho khách (chính sách, cẩm nang chăm cây, hỏi đáp) lấy thẳng từ cơ sở tri thức của chatbot
// (server/ai/kb/*.md): sửa một chỗ thì cả website lẫn chatbot cùng cập nhật, không bao giờ nói hai kiểu.
const router = Router();
const KB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ai', 'kb');

const PAGES = {
    'mua-hang': { title: 'Vận chuyển & thanh toán', files: ['02-van-chuyen-thanh-toan-don-hang.md'] },
    'doi-tra': { title: 'Bảo hành & đổi trả', files: ['04-chinh-sach-bao-hanh-doi-tra.md'] },
    'cham-soc': { title: 'Cẩm nang chăm cây', files: ['05-cham-soc-cay-co-ban.md', '07-cham-soc-theo-loai-cay.md'] },
    'chon-cay': { title: 'Chọn cây theo nhu cầu', files: ['06-tu-van-chon-cay.md'] },
    'hoi-dap': { title: 'Câu hỏi thường gặp', files: ['08-cau-hoi-thuong-gap.md'] }
};
// Mục chỉ dành cho chatbot (cách hỏi lại khách, giới hạn của chatbot...) thì không hiện cho khách.
const BOT_ONLY = /chatbot|hỏi lại khách|cửa hàng thực tế/i;

function sections(file) {
    const raw = readFileSync(join(KB_DIR, file), 'utf8');
    return raw
        .split(/^##\s+/m)
        .slice(1)
        .map((part) => {
            const [title, ...rest] = part.split('\n');
            return { title: title.trim(), body: rest.join('\n').trim() };
        })
        .filter((section) => section.body && !BOT_ONLY.test(section.title));
}

router.get('/pages', (_req, res) => res.json(Object.entries(PAGES).map(([slug, page]) => ({ slug, title: page.title }))));

router.get(
    '/pages/:slug',
    handle((req, res) => {
        const page = Object.hasOwn(PAGES, req.params.slug) ? PAGES[req.params.slug] : fail(404, 'Không tìm thấy trang.');
        res.json({ slug: req.params.slug, title: page.title, sections: page.files.flatMap(sections) });
    })
);

export default router;
