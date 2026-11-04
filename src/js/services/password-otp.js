import { api } from './api-service.js';
import { toast } from '../components/notify.js';

// Nút "Gửi mã" của form đổi mật khẩu: server kiểm tra mật khẩu hiện tại rồi gửi mã OTP 6 số tới email của tài khoản.
// Sau khi gửi, nút đếm ngược 60 giây (server cũng chặn gửi dồn dập).
export function bindSendCode(form) {
    const button = form.querySelector('[data-send-code]');
    const hint = form.querySelector('[data-code-hint]');
    button.addEventListener('click', async () => {
        const current = form.elements.namedItem('currentPassword').value;
        if (!current) { hint.textContent = 'Hãy nhập mật khẩu hiện tại trước.'; return; }
        button.disabled = true;
        try {
            const result = await api.post('/auth/change-password/code', { currentPassword: current });
            hint.textContent = `Đã gửi mã tới ${result.sentTo}. Mã có hiệu lực ${result.expiresInMinutes} phút.`;
            toast('Đã gửi mã xác nhận về email của bạn.', { type: 'success' });
            let left = 60;
            const timer = setInterval(() => {
                left -= 1;
                button.textContent = left > 0 ? `Gửi lại (${left}s)` : 'Gửi lại mã';
                if (left <= 0) { clearInterval(timer); button.disabled = false; }
            }, 1000);
            button.textContent = 'Gửi lại (60s)';
        } catch (error) {
            hint.textContent = error.message;
            button.disabled = false;
        }
    });
}
