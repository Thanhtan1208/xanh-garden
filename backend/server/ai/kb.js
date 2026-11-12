import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../core/store.js';
import { newestProducts, presentProduct } from '../services/inventory.js';
import { currentEvent } from '../services/site.js';
import { describeVoucher, isLive } from '../services/vouchers.js';
import { EMBED_MODEL, aiConfigured, embed } from './openai.js';

// Cơ sở tri thức (Knowledge Base) cho chatbot theo mô hình RAG:
//   1. Tài liệu viết tay trong server/ai/kb/*.md (cửa hàng, chính sách, chăm sóc cây, tư vấn chọn cây, FAQ).
//   2. Dữ liệu SỐNG dựng từ db mỗi lần hỏi: sản phẩm, danh mục, khuyến mãi đang chạy (không bao giờ lỗi thời).
// Truy xuất: ưu tiên so khớp ngữ nghĩa bằng embedding; không có khóa/API lỗi thì dùng so khớp từ khóa (có bỏ dấu tiếng Việt).

const HERE = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(HERE, 'kb');
const CACHE_DIR = join(HERE, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'embeddings.json');

const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;
// Khóa cache gồm cả tên model embedding để đổi model thì tự tính lại, không lẫn vector của model cũ.
const sha = (text) =>
    createHash('sha1')
        .update(
            `${EMBED_MODEL()}
${text}`
        )
        .digest('hex');

// Tài liệu tĩnh: tách theo tiêu đề "## "
function loadDocChunks() {
    if (!existsSync(KB_DIR)) return [];
    const chunks = [];
    readdirSync(KB_DIR)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .forEach((file) => {
            const raw = readFileSync(join(KB_DIR, file), 'utf8');
            const docTitle = /^#\s+(.+)$/m.exec(raw)?.[1] || file;
            raw.split(/^##\s+/m)
                .slice(1)
                .forEach((section, index) => {
                    const [title, ...rest] = section.split('\n');
                    const body = rest.join('\n').trim();
                    if (!body) return;
                    const embedText = `${docTitle} — ${title.trim()}\n${body}`;
                    chunks.push({
                        id: `${file}#${index}`,
                        source: 'kb',
                        title: `${docTitle} — ${title.trim()}`,
                        embedText,
                        text: () => embedText
                    });
                });
        });
    return chunks;
}
const DOC_CHUNKS = loadDocChunks();

// Dữ liệu sống từ cửa hàng
const categoryName = (id) => db.categories.find((category) => Number(category.id) === Number(id))?.name || 'Khác';

function productChunks() {
    return db.products.map((product) => {
        const specs = (db.categories.find((category) => Number(category.id) === Number(product.categoryId))?.specFields || [])
            .map(({ key, label }) => (product.specs?.[key] ? `${label}: ${product.specs[key]}` : null))
            .filter(Boolean);
        // embedText chỉ chứa thông tin ít thay đổi để không phải tính lại embedding mỗi lần có đơn hàng; giá/tồn kho thêm vào lúc trả lời.
        const embedText = [
            `Sản phẩm: ${product.name} (mã ${product.id}). Danh mục: ${categoryName(product.categoryId)}.`,
            product.description,
            specs.length ? `Thông số — ${specs.join('; ')}.` : '',
            product.care?.length ? `Chăm sóc — ${product.care.join('; ')}.` : ''
        ]
            .filter(Boolean)
            .join('\n');
        return {
            id: `product:${product.id}`,
            source: 'product',
            productId: String(product.id),
            title: product.name,
            embedText,
            text: () => {
                const live = presentProduct(product);
                const status = product.stock <= 0 ? 'HẾT HÀNG' : `còn ${product.stock} sản phẩm`;
                const badge = live.isNew ? ' (sản phẩm mới)' : live.restocked ? ' (mới về)' : '';
                return `${embedText}\nGiá: ${money(product.price)}; ${status}${badge}. Xem tại ./product-detail.html?id=${product.id}`;
            }
        };
    });
}

function liveChunks() {
    const chunks = [];
    const byCategory = db.categories.map((category) => {
        const names = db.products.filter((product) => Number(product.categoryId) === Number(category.id)).map((product) => product.name);
        return `${category.name}: ${names.join(', ') || '(chưa có sản phẩm)'}`;
    });
    chunks.push({
        id: 'live:categories',
        source: 'live',
        title: 'Danh mục và sản phẩm hiện có',
        embedText: `Cửa hàng hiện có các danh mục và sản phẩm sau.\n${byCategory.join('\n')}`,
        text() {
            return this.embedText;
        }
    });

    const newest = newestProducts(4).map(
        (product) =>
            `${product.name}: ${money(product.price)}, ${product.stock > 0 ? 'còn hàng' : 'hết hàng'}, xem tại ./product-detail.html?id=${product.id}`
    );
    chunks.push({
        id: 'live:newest',
        source: 'live',
        title: 'Sản phẩm mới nhất',
        embedText: `Sản phẩm mới, hàng mới nhất của cửa hàng.\n${newest.join('\n')}`,
        text() {
            return this.embedText;
        }
    });

    const vouchers = db.vouchers.filter((voucher) => voucher.claimable && isLive(voucher));
    const event = currentEvent();
    const lines = [
        event
            ? `Sự kiện đang diễn ra: ${event.name} (đến ${new Date(event.endAt).toLocaleDateString('vi-VN')}).`
            : 'Hiện không có sự kiện đặc biệt.',
        ...vouchers.map(
            (voucher) =>
                `Voucher ${voucher.name} (mã ${voucher.code}): ${describeVoucher(voucher)}, hạn đến ${new Date(voucher.endAt).toLocaleDateString('vi-VN')}.`
        )
    ];
    if (!vouchers.length) lines.push('Hiện chưa có voucher nào trong Kho voucher.');
    chunks.push({
        id: 'live:promotions',
        source: 'live',
        title: 'Khuyến mãi và voucher đang có',
        embedText: `Khuyến mãi, voucher và sự kiện đang diễn ra.\n${lines.join('\n')}`,
        text() {
            return this.embedText;
        }
    });
    return chunks;
}

export const allChunks = () => [...DOC_CHUNKS, ...productChunks(), ...liveChunks()];

// Embedding có cache trên đĩa (khóa là mã băm nội dung)
let vectorCache = null;
function cache() {
    if (vectorCache) return vectorCache;
    try {
        vectorCache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
    } catch {
        vectorCache = {};
    }
    return vectorCache;
}

function persistCache(keep) {
    const store = cache();
    Object.keys(store).forEach((key) => {
        if (!keep.has(key)) delete store[key];
    }); // bỏ vector của nội dung không còn dùng
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(store));
}

let pending = null;
// Đảm bảo mọi chunk đều có vector; chỉ gọi API cho chunk mới/đã đổi nội dung.
async function ensureVectors(chunks) {
    const store = cache();
    const missing = chunks.filter((chunk) => !store[sha(chunk.embedText)]);
    if (!missing.length) return;
    if (pending) return pending;
    pending = (async () => {
        for (let start = 0; start < missing.length; start += 64) {
            const batch = missing.slice(start, start + 64);
            const vectors = await embed(batch.map((chunk) => chunk.embedText.slice(0, 6000)));
            batch.forEach((chunk, index) => {
                store[sha(chunk.embedText)] = vectors[index];
            });
        }
        persistCache(new Set(chunks.map((chunk) => sha(chunk.embedText))));
    })().finally(() => {
        pending = null;
    });
    return pending;
}

export function warmUp() {
    if (!aiConfigured()) return;
    ensureVectors(allChunks())
        .then(() => console.log('[ai] Đã nạp xong cơ sở tri thức (embedding).'))
        .catch((error) => console.error('[ai] Chưa nạp được embedding:', error.message));
}

const cosine = (a, b) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

// So khớp từ khóa (dự phòng khi không có embedding)
const STOP = new Set(
    'la va cua co khong cho toi ban minh the nao gi nay nhung cac mot duoc de voi o trong tren khi thi se da dang rat hay nhu neu ma thanh sao bao nhieu muon can nen cung ra vao len xuong em anh chi shop ad oi a nhe nha ha san pham cay cua hang tat ca loai nao gi toi minh mua'.split(
        ' '
    )
); // từ quá phổ biến, không giúp phân biệt đoạn tri thức
export function normalize(text) {
    return String(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const tokens = (text) =>
    normalize(text)
        .split(' ')
        .filter((word) => word.length > 1 && !STOP.has(word));

function keywordRank(query, chunks) {
    const queryTokens = [...new Set(tokens(query))];
    if (!queryTokens.length) return [];
    const docs = chunks.map((chunk) => ({ chunk, words: tokens(`${chunk.title} ${chunk.embedText}`), title: normalize(chunk.title) }));
    const df = new Map();
    docs.forEach(({ words }) => new Set(words).forEach((word) => df.set(word, (df.get(word) || 0) + 1)));
    const normalizedQuery = normalize(query);
    return docs
        .map(({ chunk, words, title }) => {
            const tf = new Map();
            words.forEach((word) => tf.set(word, (tf.get(word) || 0) + 1));
            let score = 0;
            queryTokens.forEach((word) => {
                if (!tf.has(word)) return;
                score += (1 + Math.log(tf.get(word))) * Math.log(1 + chunks.length / (df.get(word) || 1));
                if (title.includes(word)) score += 1.5;
            });
            // Tên sản phẩm/cụm từ xuất hiện nguyên vẹn trong câu hỏi là tín hiệu mạnh.
            if (chunk.source === 'product' && normalizedQuery.includes(normalize(chunk.title))) score += 8;
            return { chunk, score };
        })
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score);
}

// Trả về k chunk liên quan nhất (đã dựng text mới nhất). mode cho biết đã dùng cách nào.
export async function retrieve(query, k = 6) {
    const chunks = allChunks();
    let ranked = null;
    let mode = 'keyword';
    if (aiConfigured()) {
        try {
            await ensureVectors(chunks);
            const [queryVector] = await embed([query.slice(0, 1000)]);
            const store = cache();
            ranked = chunks
                .map((chunk) => ({ chunk, score: cosine(queryVector, store[sha(chunk.embedText)] || []) }))
                .sort((a, b) => b.score - a.score);
            // Kết hợp thêm điểm từ khóa để câu hỏi chứa đúng tên sản phẩm luôn được ưu tiên.
            const keyword = new Map(keywordRank(query, chunks).map((row) => [row.chunk.id, row.score]));
            ranked.forEach((row) => {
                row.score += Math.min(0.25, (keyword.get(row.chunk.id) || 0) / 40);
            });
            ranked.sort((a, b) => b.score - a.score);
            mode = 'semantic';
        } catch (error) {
            console.error('[ai] Truy xuất embedding thất bại, dùng từ khóa:', error.message);
        }
    }
    if (!ranked) ranked = keywordRank(query, chunks);
    return {
        mode,
        hits: ranked
            .slice(0, k)
            .map(({ chunk, score }) => ({ id: chunk.id, source: chunk.source, title: chunk.title, text: chunk.text(), score }))
    };
}
