import { api } from '../services/api-service.js';
import { isManagementRole, setSession } from '../utils/auth.js';
import '../components/header.js';
import '../utils/password-toggle.js';

const form = document.querySelector('#loginForm');
const message = document.querySelector('#message');
const submitButton = form.querySelector('button[type="submit"]');

if (new URLSearchParams(window.location.search).has('registered')) {
    message.textContent = 'Đăng ký thành công. Vui lòng đăng nhập.';
    message.classList.add('ok');
}
if (new URLSearchParams(window.location.search).has('reset')) {
    message.textContent = 'Đã đổi mật khẩu. Vui lòng đăng nhập.';
    message.classList.add('ok');
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    message.classList.remove('ok');

    submitButton.disabled = true;
    submitButton.textContent = 'Đang đăng nhập...';
    try {
        const session = await api.post('/auth/login', {
            username: form.elements.namedItem('username').value,
            password: form.elements.namedItem('password').value
        });
        setSession(session);

        const redirect = sessionStorage.getItem('redirectAfterLogin');
        sessionStorage.removeItem('redirectAfterLogin');
        window.location.assign(isManagementRole(session.user) ? './admin-dashboard.html' : `./${redirect || 'index.html'}`);
    } catch (error) {
        if (error.data?.needVerify) {
            window.location.assign(`./verify-email.html?email=${encodeURIComponent(error.data.email)}`);
            return;
        }
        message.textContent = error.message;
        submitButton.disabled = false;
        submitButton.textContent = 'Đăng nhập';
    }
});
