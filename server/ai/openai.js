import { ApiError } from '../core/http.js';

// Gọi OpenAI bằng fetch thuần (không cần cài thêm thư viện). Khóa đọc từ .env lúc gọi, không bao giờ gửi xuống trình duyệt.
const BASE_URL = () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
export const CHAT_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const EMBED_MODEL = () => process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
// Khóa bị OpenAI từ chối (hết hạn/thu hồi) thì coi như chưa cấu hình cho tới khi khởi động lại server với khóa mới,
// để chatbot chuyển sang chế độ tra cứu thay vì báo lỗi mỗi lần khách hỏi.
let keyRejected = false;
export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY) && !keyRejected;

async function call(path, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${BASE_URL()}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            // Ghi chi tiết ra console của server, chỉ trả thông báo chung cho khách.
            console.error(`[ai] OpenAI ${response.status}: ${data?.error?.message || 'không rõ lỗi'}`);
            if (response.status === 401 && !keyRejected) {
                keyRejected = true;
                console.error('[ai] Khóa OPENAI_API_KEY không dùng được. Chatbot chuyển sang chế độ tra cứu. Hãy đặt khóa mới rồi chạy lại server (lưu ý: biến môi trường hệ thống ghi đè file .env).');
            }
            if (response.status === 429) throw new ApiError(503, 'Trợ lý đang quá tải, vui lòng thử lại sau ít phút.');
            throw new ApiError(502, 'Trợ lý tạm thời không phản hồi. Vui lòng thử lại sau.');
        }
        return data;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('[ai] Lỗi kết nối OpenAI:', error.name === 'AbortError' ? 'quá thời gian chờ' : error.message);
        throw new ApiError(504, 'Trợ lý phản hồi quá lâu hoặc mất kết nối. Vui lòng thử lại.');
    } finally {
        clearTimeout(timer);
    }
}

export async function embed(texts) {
    const data = await call('/embeddings', { model: EMBED_MODEL(), input: texts }, 30000);
    return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

export function complete(payload) {
    return call('/chat/completions', { model: CHAT_MODEL(), temperature: 0.3, max_tokens: 350, ...payload }, 40000);
}
