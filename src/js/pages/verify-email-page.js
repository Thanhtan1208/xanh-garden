import { api } from '../services/api-service.js';
import { setSession } from '../utils/auth.js';
import { escapeHtml } from '../utils/format.js';
import '../components/header.js';

const form = document.querySelector('#verifyForm');
const message = document.querySelector('#message');
const resendButton = document.querySelector('#resendBtn');
const params = new URLSearchParams(window.location.search);
const email = params.get('email') || '';

if (!email) window.location.replace('./dangky.html');

document.querySelector('#intro').innerHTML =
    `${params.has('sent') ? 'Chúng tôi đã gửi' : 'Hãy nhập'} mã gồm 6 chữ số gửi tới <b>${escapeHtml(email)}</b>. Mã có hiệu lực 10 phút.`;

function say(text, ok = false) {
    message.textContent = text;
    message.classList.toggle('ok', ok);
}

// Đếm ngược 60 giây giữa hai lần gửi lại (server cũng kiểm tra).
function startCooldown(seconds = 60) {
    let left = seconds;
    resendButton.disabled = true;
    const timer = setInterval(() => {
        left -= 1;
        resendButton.textContent = left > 0 ? `Gửi lại mã (${left}s)` : 'Gửi lại mã';
        if (left <= 0) {
            clearInterval(timer);
            resendButton.disabled = false;
        }
    }, 1000);
    resendButton.textContent = `Gửi lại mã (${left}s)`;
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = form.elements.namedItem('code').value.trim();
    if (!/^\d{6}$/.test(code)) return say('Mã xác minh gồm đúng 6 chữ số.');

    try {
        const session = await api.post('/auth/verify-email', { email, code });
        setSession(session);
        window.location.assign('./index.html');
    } catch (error) {
        say(error.message);
    }
});

resendButton.addEventListener('click', async () => {
    resendButton.disabled = true;
    try {
        await api.post('/auth/resend-code', { email });
        say('Đã gửi lại mã. Vui lòng kiểm tra email.', true);
        startCooldown();
    } catch (error) {
        say(error.message);
        resendButton.disabled = false;
    }
});

if (params.has('sent')) startCooldown();
