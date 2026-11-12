import { api } from './api-service.js';
import { toast } from '../components/notify.js';
import { getCurrentUser } from '../utils/auth.js';

// Nút dán mã từ bộ nhớ tạm, đặt sau phần tử anchor (trình duyệt không cho đọc thì vẫn dán tay được)
export function addPasteButton(input, anchor) {
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'btn btn-sm btn-outline';
    paste.textContent = 'Dán mã';
    anchor.after(paste);
    paste.addEventListener('click', async () => {
        try {
            const digits = (await navigator.clipboard.readText()).replace(/\D/g, '').slice(0, 6);
            if (digits.length === 6) input.value = digits;
            else toast('Trong bộ nhớ tạm chưa có mã 6 số.', { type: 'error' });
        } catch {
            toast('Trình duyệt không cho đọc bộ nhớ tạm. Hãy dán thủ công (Ctrl+V).', { type: 'error' });
        }
    });
}

// Nút "Gửi mã" của form đổi mật khẩu: server kiểm tra mật khẩu hiện tại rồi gửi mã OTP 6 số tới email của tài khoản.
// Sau khi gửi, nút đếm ngược 60 giây (server cũng chặn gửi dồn dập) và có đồng hồ đếm ngược hạn của mã.
export function bindSendCode(form) {
    const button = form.querySelector('[data-send-code]');
    const hint = form.querySelector('[data-code-hint]');
    const codeInput = form.elements.namedItem('code');
    const email = form.querySelector('[data-code-email]');
    if (email) email.textContent = getCurrentUser()?.email || '';

    addPasteButton(codeInput, button);

    let expiryTimer = null;
    const showExpiry = (sentTo, minutes) => {
        clearInterval(expiryTimer);
        const end = Date.now() + minutes * 60000;
        const paint = () => {
            const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
            if (!left) {
                clearInterval(expiryTimer);
                hint.textContent = 'Mã đã hết hạn. Bấm "Gửi lại mã" để nhận mã mới.';
                return;
            }
            hint.textContent = `Đã gửi mã tới ${sentTo}. Mã còn hiệu lực ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`;
        };
        paint();
        expiryTimer = setInterval(paint, 1000);
    };

    button.addEventListener('click', async () => {
        const current = form.elements.namedItem('currentPassword').value;
        if (!current) {
            hint.textContent = 'Hãy nhập mật khẩu hiện tại trước.';
            return;
        }
        button.disabled = true;
        try {
            const result = await api.post('/auth/change-password/code', { currentPassword: current });
            showExpiry(email?.textContent || result.sentTo, result.expiresInMinutes);
            toast('Đã gửi mã xác nhận về email của bạn.', { type: 'success' });
            let left = 60;
            const timer = setInterval(() => {
                left -= 1;
                button.textContent = left > 0 ? `Gửi lại (${left}s)` : 'Gửi lại mã';
                if (left <= 0) {
                    clearInterval(timer);
                    button.disabled = false;
                }
            }, 1000);
            button.textContent = 'Gửi lại (60s)';
        } catch (error) {
            hint.textContent = error.message;
            button.disabled = false;
        }
    });
}
