// Thêm nút hiện/ẩn (icon con mắt) cho mọi ô nhập mật khẩu trong trang.
const EYE =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

document.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'password-field';
    input.replaceWith(wrapper);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'password-toggle';
    button.innerHTML = EYE;
    button.setAttribute('aria-label', 'Hiện mật khẩu');
    wrapper.append(input, button);

    button.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.innerHTML = show ? EYE_OFF : EYE;
        button.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    });
});
