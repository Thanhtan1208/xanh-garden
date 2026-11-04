import { api } from '../services/api-service.js';
import { escapeHtml } from '../utils/format.js';
import { bindPasswordHints, passwordProblem } from '../utils/password.js';
import '../components/header.js';
import '../utils/password-toggle.js';

const forgotForm = document.querySelector('#forgotForm');
const resetForm = document.querySelector('#resetForm');
let email = '';

forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#message1');
    email = forgotForm.elements.namedItem('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        message.textContent = 'Email không hợp lệ.';
        return;
    }
    try {
        await api.post('/auth/forgot-password', { email });
        document.querySelector('#intro').innerHTML = `Nếu <b>${escapeHtml(email)}</b> đã đăng ký, mã 6 chữ số đã được gửi tới email này (hiệu lực 10 phút).`;
        forgotForm.classList.add('hidden');
        resetForm.classList.remove('hidden');
    } catch (error) {
        message.textContent = error.message;
    }
});

const personal = () => [email.split('@')[0]];
bindPasswordHints(resetForm.elements.namedItem('password'), document.querySelector('#pwRules'), personal);

resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.querySelector('#message2');
    const value = (name) => resetForm.elements.namedItem(name).value;
    if (!/^\d{6}$/.test(value('code').trim())) return void (message.textContent = 'Mã xác nhận gồm đúng 6 chữ số.');
    const weak = passwordProblem(value('password'), ...personal());
    if (weak) return void (message.textContent = weak);
    if (value('password') !== value('confirmPassword')) return void (message.textContent = 'Mật khẩu xác nhận không khớp.');
    try {
        await api.post('/auth/reset-password', { email, code: value('code').trim(), newPassword: value('password') });
        window.location.assign('./login.html?reset=1');
    } catch (error) {
        message.textContent = error.message;
    }
});
