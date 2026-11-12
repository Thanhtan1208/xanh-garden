import { api } from '../services/api-service.js';
import '../components/table-view.js';
import '../components/header.js';
import { getCurrentUser, requirePermission } from '../utils/auth.js';
import { bindPasswordHints, passwordProblem } from '../utils/password.js';
import { bindSendCode } from '../services/password-otp.js';
import '../utils/password-toggle.js';
import { confirmDialog, toast } from '../components/notify.js';
import { escapeHtml } from '../utils/format.js';

const labels = { admin: 'Admin', owner: 'Owner', staff: 'Staff', user: 'User' };
const teamBody = document.querySelector('#teamBody');
const message = document.querySelector('#message');
let users = [];
const currentUser = getCurrentUser();

function render() {
    const keyword = document.querySelector('#teamSearch').value.trim().toLowerCase();
    const role = document.querySelector('#roleFilter').value;
    const rows = users.filter((user) => (!role || user.role === role) && `${user.name} ${user.email}`.toLowerCase().includes(keyword));
    teamBody.innerHTML = rows
        .map(
            (user) => `
        <tr data-id="${escapeHtml(user.id)}">
            <td><b>${escapeHtml(user.name)}</b></td>
            <td>${escapeHtml(user.email)}</td>
            <td><span class="role-tag role-tag-${user.role}">${labels[user.role]}</span></td>
            <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : '<span class="muted">—</span>'}</td>
            <td>${user.orderCount ?? '—'}</td>
            <td>${
                user.role === 'admin'
                    ? '<span class="muted">Không thể thay đổi</span>'
                    : `
                <span class="row-actions">
                    <select data-role aria-label="Vai trò mới của ${escapeHtml(user.name)}">${['user', 'staff', 'owner'].map((value) => `<option value="${value}"${value === user.role ? ' selected' : ''}>${labels[value]}</option>`).join('')}</select>
                    <button type="button" class="btn btn-sm btn-outline" data-action="save">Lưu</button>
                </span>`
            }</td>
            <td>${
                user.id === currentUser?.id
                    ? '<span class="muted">Tài khoản của bạn</span>'
                    : `
                <span class="row-actions">
                    <button type="button" class="btn btn-sm btn-outline" data-action="reset">Đặt lại mật khẩu</button>
                    ${user.role === 'admin' ? '' : '<button type="button" class="btn btn-sm btn-danger" data-action="delete">Xóa</button>'}
                </span>
                ${user.passwordResetAt ? `<small class="muted">Đặt lại ${new Date(user.passwordResetAt).toLocaleDateString('vi-VN')}</small>` : ''}`
            }</td>
        </tr>`
        )
        .join('');
    document.querySelector('#empty').classList.toggle('hidden', rows.length > 0);
}

// Đặt lại mật khẩu: server sinh mật khẩu tạm, chỉ hiện đúng một lần để admin đưa cho chủ tài khoản
async function resetPassword(button) {
    const user = users.find((entry) => entry.id === button.closest('tr').dataset.id);
    if (!user) return;
    if (
        !(await confirmDialog({
            title: `Đặt lại mật khẩu của ${user.name}?`,
            message: 'Mật khẩu cũ mất hiệu lực và các phiên đăng nhập hiện tại của tài khoản này bị đăng xuất.',
            confirmText: 'Đặt lại',
            tone: 'danger'
        }))
    )
        return;
    button.disabled = true;
    try {
        const result = await api.post(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, {});
        user.passwordResetAt = result.passwordResetAt;
        render();
        await confirmDialog({
            title: 'Đã đặt lại mật khẩu',
            message: 'Mật khẩu này chỉ hiện một lần. Hãy gửi cho chủ tài khoản và nhắc họ đổi mật khẩu sau khi đăng nhập.',
            rows: [
                ['Tài khoản', user.name],
                ['Mật khẩu mới', result.password, true, true]
            ],
            confirmText: 'Đã ghi lại',
            cancelText: null
        });
    } catch (error) {
        toast(error.message, { type: 'error' });
    } finally {
        button.disabled = false;
    }
}

// Xóa tài khoản: server kiểm tra trước (đơn chưa xong, khiếu nại chưa xử lý, việc đang phụ trách), được phép mới hỏi xác nhận
async function deleteUser(button) {
    const user = users.find((entry) => entry.id === button.closest('tr').dataset.id);
    if (!user) return;
    button.disabled = true;
    try {
        const { blockers, notes } = await api.get(`/admin/users/${encodeURIComponent(user.id)}/delete-check`);
        if (blockers.length) {
            await confirmDialog({
                title: `Chưa thể xóa ${user.name}`,
                message: blockers.join(' '),
                confirmText: 'Đã hiểu',
                cancelText: null,
                tone: 'danger'
            });
            return;
        }
        const agreed = await confirmDialog({
            title: `Bạn có muốn xóa tài khoản ${user.name}?`,
            message: `${notes.length ? `${notes.join(' ')} ` : ''}Hành động này không hoàn tác được.`,
            rows: [
                ['Email', user.email],
                ['Vai trò', labels[user.role]]
            ],
            confirmText: 'Xóa tài khoản',
            tone: 'danger'
        });
        if (!agreed) return;
        await api.delete(`/admin/users/${encodeURIComponent(user.id)}`);
        users = users.filter((entry) => entry.id !== user.id);
        render();
        toast(`Đã xóa tài khoản ${user.name}.`, { type: 'success' });
    } catch (error) {
        toast(error.message, { type: 'error' });
    } finally {
        button.disabled = false;
    }
}

teamBody.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-action="delete"]');
    if (deleteButton) return deleteUser(deleteButton);
    const resetButton = event.target.closest('[data-action="reset"]');
    if (resetButton) return resetPassword(resetButton);
    const button = event.target.closest('[data-action="save"]');
    if (!button) return;
    const row = button.closest('tr');
    const user = users.find((entry) => entry.id === row.dataset.id);
    const role = row.querySelector('[data-role]').value;
    if (!user || role === user.role) return;
    if (
        !(await confirmDialog({
            title: `Đổi ${user.name} sang ${labels[role]}?`,
            message: 'Quyền mới có hiệu lực ngay ở lần gọi API tiếp theo.',
            confirmText: 'Cập nhật'
        }))
    )
        return;
    button.disabled = true;
    try {
        const updated = await api.patch(`/admin/users/${encodeURIComponent(user.id)}/role`, { role });
        Object.assign(user, updated);
        message.textContent = `Đã cập nhật ${user.name}: ${labels[role]}.`;
        toast(message.textContent, { type: 'success' });
        render();
    } catch (error) {
        toast(error.message, { type: 'error' });
    } finally {
        button.disabled = false;
    }
});

// Đổi mật khẩu của chính admin
const passwordForm = document.querySelector('#passwordForm');
const passwordField = (name) => passwordForm.elements.namedItem(name);
bindSendCode(passwordForm);
bindPasswordHints(passwordField('newPassword'), document.querySelector('#pwRules'), () => [
    currentUser.name,
    currentUser.email.split('@')[0]
]);
passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passwordMessage = document.querySelector('#passwordMessage');
    passwordMessage.classList.remove('ok');
    const newPassword = passwordField('newPassword').value;
    const problem = passwordProblem(newPassword, currentUser.name, currentUser.email.split('@')[0]);
    if (problem) {
        passwordMessage.textContent = problem;
        return;
    }
    if (newPassword !== passwordField('confirmPassword').value) {
        passwordMessage.textContent = 'Mật khẩu nhập lại không khớp.';
        return;
    }
    if (!/^\d{6}$/.test(passwordField('code').value.trim())) {
        passwordMessage.textContent = 'Vui lòng nhập mã xác nhận 6 số đã gửi về email.';
        return;
    }
    try {
        await api.post('/auth/change-password', {
            currentPassword: passwordField('currentPassword').value,
            newPassword,
            code: passwordField('code').value.trim()
        });
        passwordForm.reset();
        passwordMessage.textContent = 'Đã đổi mật khẩu. Lần đăng nhập sau hãy dùng mật khẩu mới.';
        passwordMessage.classList.add('ok');
    } catch (error) {
        passwordMessage.textContent = error.message;
    }
});

document.querySelector('#teamSearch').addEventListener('input', render);
document.querySelector('#roleFilter').addEventListener('change', render);

async function initialize() {
    if (!requirePermission('team.manage')) return;
    try {
        await api.load('/admin/users', (data) => {
            users = data;
            render();
            document.querySelector('#loading').classList.add('hidden');
        });
    } catch (error) {
        document.querySelector('#error').textContent = error.message;
        document.querySelector('#error').classList.remove('hidden');
    } finally {
        document.querySelector('#loading').classList.add('hidden');
    }
}

initialize();
