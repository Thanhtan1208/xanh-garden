import { api } from '../services/api-service.js';
import { validateRegistration } from '../utils/validate.js';
import { bindPasswordHints } from '../utils/password.js';
import '../components/header.js';
import '../utils/password-toggle.js';

const form = document.querySelector('#registerForm');
const message = document.querySelector('#message');
const submitButton = form.querySelector('button[type="submit"]');
const field = (name) => form.elements.namedItem(name);

field('birthday').max = new Date().toISOString().slice(0, 10);

bindPasswordHints(field('password'), document.querySelector('#pwRules'), () => [field('name').value.trim(), field('email').value.trim().split('@')[0]]);

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const values = {
        name: field('name').value.trim(),
        email: field('email').value.trim(),
        password: field('password').value,
        confirmPassword: field('confirmPassword').value
    };
    const problem = validateRegistration(values);
    if (problem) {
        message.textContent = problem.message;
        field(problem.field).focus();
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Đang đăng ký...';
    try {
        await api.post('/auth/register', { name: values.name, email: values.email, password: values.password, birthday: field('birthday').value || undefined });
        window.location.assign(`./verify-email.html?email=${encodeURIComponent(values.email)}&sent=1`);
    } catch (error) {
        if (error.data?.needVerify) {
            window.location.assign(`./verify-email.html?email=${encodeURIComponent(values.email)}`);
            return;
        }
        message.textContent = error.message;
        submitButton.disabled = false;
        submitButton.textContent = 'Đăng ký';
    }
});
