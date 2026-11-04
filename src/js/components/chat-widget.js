import { api } from '../services/api-service.js';
import { getCurrentUser } from '../utils/auth.js';
import { escapeHtml } from '../utils/format.js';
import { icon, iconButton } from '../utils/icons.js';

// Chatbot tư vấn nổi góc phải. Khách đã đăng nhập: lịch sử lưu trên server theo tài khoản.
// Khách chưa đăng nhập: lịch sử chỉ lưu trong tab (sessionStorage) và gửi kèm mỗi lần hỏi.
const GUEST_KEY = 'chatHistory';
const MAX_LENGTH = 500;
const SUGGESTIONS = [
    'Cây nào dễ chăm cho người mới?',
    'Cây nào hợp đặt bàn làm việc?',
    'Phí vận chuyển tính thế nào?',
    'Hiện có voucher nào không?'
];

const user = getCurrentUser();
let messages = [];
let busy = false;

const root = document.createElement('div');
root.className = 'chat-root';
root.innerHTML = `
    <button type="button" class="chat-fab" id="chatFab" aria-label="Mở trợ lý tư vấn" title="Hỏi trợ lý tư vấn">${icon('chat', { size: 26 })}</button>
    <section class="chat-panel hidden" id="chatPanel" role="dialog" aria-label="Trợ lý Xanh Garden">
        <header class="chat-head">
            <div><b>Trợ lý Xanh Garden</b><small>Tư vấn chọn cây, chăm sóc, chính sách</small></div>
            <div class="chat-head-actions">
                ${iconButton('trash', 'Xóa cuộc trò chuyện', { attrs: { id: 'chatClear' } })}
                ${iconButton('close', 'Đóng', { attrs: { id: 'chatClose' } })}
            </div>
        </header>
        <div class="chat-log" id="chatLog" aria-live="polite"></div>
        <form class="chat-form" id="chatForm" autocomplete="off">
            <input type="text" id="chatInput" maxlength="${MAX_LENGTH}" placeholder="Nhập câu hỏi của bạn..." aria-label="Câu hỏi">
            <button type="submit" class="icon-btn icon-btn-primary" id="chatSend" aria-label="Gửi" title="Gửi">${icon('send')}</button>
        </form>
    </section>`;
document.body.append(root);

const panel = root.querySelector('#chatPanel');
const log = root.querySelector('#chatLog');
const input = root.querySelector('#chatInput');
const sendButton = root.querySelector('#chatSend');

// Chỉ cho phép định dạng an toàn: **đậm**, danh sách gạch đầu dòng và liên kết nội bộ tới trang sản phẩm/website.
function format(text) {
    const html = escapeHtml(text)
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]\n]+)\]\((\.\/[a-z0-9-]+\.html(?:\?[\w=&%.-]*)?)\)/gi, '<a href="$2">$1</a>');
    return html.split('\n').map((line) => {
        const item = /^\s*[-•*]\s+(.*)$/.exec(line);
        return item ? `<span class="chat-li">${item[1]}</span>` : `<span class="chat-line">${line}</span>`;
    }).join('');
}

function render() {
    if (!messages.length) {
        log.innerHTML = `
            <div class="chat-msg bot"><p>Xin chào${user ? ` ${escapeHtml(user.name)}` : ''}! Mình là trợ lý của Xanh Garden. Bạn cần mình tư vấn chọn cây, cách chăm sóc hay chính sách cửa hàng?</p></div>
            <div class="chat-suggest">${SUGGESTIONS.map((text) => `<button type="button" class="chat-chip">${escapeHtml(text)}</button>`).join('')}</div>`;
        return;
    }
    log.innerHTML = messages.map((message) => `<div class="chat-msg ${message.role === 'user' ? 'me' : 'bot'}"><p>${format(message.content)}</p></div>`).join('') +
        (busy ? '<div class="chat-msg bot"><p class="chat-typing"><i></i><i></i><i></i></p></div>' : '');
    log.scrollTop = log.scrollHeight;
}

function persistGuest() {
    if (user) return;
    try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(messages.slice(-20))); } catch { /* bỏ qua nếu bị chặn */ }
}

async function ask(text) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    messages.push({ role: 'user', content: message });
    busy = true;
    input.value = '';
    sendButton.disabled = true;
    render();
    try {
        let visitor;
        try { visitor = localStorage.getItem('xg_vid') || undefined; } catch { /* bị chặn lưu trữ */ }
        const result = await api.post('/chat', { message, history: user ? undefined : history, visitor: user ? undefined : visitor }, { timeout: 60000 });
        messages.push({ role: 'assistant', content: result.reply });
    } catch (error) {
        messages.push({ role: 'assistant', content: error.message });
    } finally {
        busy = false;
        sendButton.disabled = false;
        persistGuest();
        render();
        input.focus();
    }
}

async function open() {
    panel.classList.remove('hidden');
    root.classList.add('open');
    input.focus();
    render();
}

root.querySelector('#chatFab').addEventListener('click', () => (panel.classList.contains('hidden') ? open() : close()));
function close() { panel.classList.add('hidden'); root.classList.remove('open'); }
root.querySelector('#chatClose').addEventListener('click', close);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.classList.contains('hidden')) close(); });

root.querySelector('#chatClear').addEventListener('click', async () => {
    messages = [];
    persistGuest();
    if (user) await api.delete('/chat').catch(() => {});
    render();
});

root.querySelector('#chatForm').addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
log.addEventListener('click', (event) => {
    const chip = event.target.closest('.chat-chip');
    if (chip) ask(chip.textContent);
});

// Nạp lịch sử cũ (không chặn việc hiển thị).
(async function load() {
    try {
        if (user) messages = (await api.get('/chat/history')).messages.map(({ role, content }) => ({ role, content }));
        else messages = JSON.parse(sessionStorage.getItem(GUEST_KEY) || '[]');
    } catch {
        messages = [];
    }
    if (!panel.classList.contains('hidden')) render();
})();
