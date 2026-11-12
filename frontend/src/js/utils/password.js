// Chính sách mật khẩu; giữ khớp với passwordProblem trong server/rules.js (server mới là nơi quyết định cuối).
const hasPersonal = (password, personal) =>
    personal.some((item) => item && item.length >= 3 && password.toLowerCase().includes(item.toLowerCase()));

export function passwordChecks(password, ...personal) {
    return [
        ['Ít nhất 8 ký tự', password.length >= 8 && password.length <= 64],
        ['Có chữ thường (a-z)', /[a-z]/.test(password)],
        ['Có chữ in hoa (A-Z)', /[A-Z]/.test(password)],
        ['Có chữ số (0-9)', /\d/.test(password)],
        ['Có ký tự đặc biệt (! @ # $ %...)', /[^A-Za-z0-9]/.test(password) && !/\s/.test(password)],
        ['Không có 3 ký tự giống nhau liên tiếp (aaa, 111)', !/(.)\1\1/.test(password)],
        ['Không chứa tên đăng nhập / email', !hasPersonal(password, personal)]
    ];
}

export function passwordProblem(password, ...personal) {
    if (password.length < 8) return 'Mật khẩu quá ngắn: cần ít nhất 8 ký tự.';
    if (password.length > 64) return 'Mật khẩu không được vượt quá 64 ký tự.';
    if (/\s/.test(password)) return 'Mật khẩu không được chứa khoảng trắng.';
    if (!/[a-z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ thường.';
    if (!/[A-Z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ in hoa.';
    if (!/\d/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ số.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Mật khẩu cần ít nhất 1 ký tự đặc biệt (ví dụ ! @ # $ %).';
    if (/(.)\1\1/.test(password)) return 'Mật khẩu không được có 3 ký tự giống nhau liên tiếp (ví dụ aaa, 111).';
    if (hasPersonal(password, personal)) return 'Mật khẩu không được chứa tên đăng nhập hoặc email của bạn.';
    return null;
}

// Chỉ hiện các điều kiện đang vi phạm, và chỉ sau khi người dùng bắt đầu gõ; đạt hết thì ẩn.
export function bindPasswordHints(input, list, getPersonal = () => []) {
    const update = () => {
        const value = input.value;
        const failed = value ? passwordChecks(value, ...getPersonal()).filter(([, ok]) => !ok) : [];
        list.innerHTML = failed.map(([label]) => `<li class="bad">✗ ${label}</li>`).join('');
        list.hidden = !failed.length;
    };
    input.addEventListener('input', update);
    update();
}
