import { api } from '../services/api-service.js';
import '../components/header.js';
import { requireLogin } from '../utils/auth.js';
import { hasPermission, isManagementRole } from '../utils/permissions.js';
import { escapeHtml, formatDate } from '../utils/format.js';
import { confirmDialog, notifyError } from '../components/notify.js';

const FEEDBACK_TYPES = { suggestion: 'Góp ý', complaint: 'Phản ánh', praise: 'Khen ngợi', other: 'Khác' };
const FEEDBACK_STATUS = { open: 'Chờ xử lý', resolved: 'Đã phản hồi' };

const user = requireLogin();
const admin = isManagementRole(user);
const canReply = hasPermission('feedback.reply', user);
const canDelete = hasPermission('feedback.delete', user);
const form = document.querySelector('#feedbackForm');
const list = document.querySelector('#feedbackList');
const tabs = document.querySelector('#statusTabs');
const formMessage = document.querySelector('#formMessage');

let feedbacks = [];
let loaded = false;
let filterStatus = '';

// Chưa có dữ liệu thì vẽ tab không kèm số đếm, để thanh tab có sẵn chỗ ngay từ đầu
function renderTabs() {
    const entries = [['', 'Tất cả'], ...Object.entries(FEEDBACK_STATUS)];
    tabs.innerHTML = entries
        .map(([status, label]) => {
            const count = status ? feedbacks.filter((item) => item.status === status).length : feedbacks.length;
            return `<button class="tab${status === filterStatus ? ' active' : ''}" data-status="${status}">${label}${loaded ? ` (${count})` : ''}</button>`;
        })
        .join('');
}

function renderReply(item) {
    if (item.reply) {
        return `
            <div class="reply-box">
                <b>Phản hồi từ cửa hàng</b> <small class="muted">${formatDate(item.repliedAt)}</small>
                <p>${escapeHtml(item.reply)}</p>
            </div>`;
    }
    return admin ? '' : '<p class="muted">Cửa hàng sẽ phản hồi sớm nhất có thể.</p>';
}

function renderAdminTools(item) {
    if (!canReply) return '';
    return `
        <form class="reply-form" data-id="${item.id}">
            <textarea rows="2" minlength="2" maxlength="1000" aria-label="Nội dung phản hồi" placeholder="Nhập phản hồi cho khách hàng" required>${escapeHtml(item.reply)}</textarea>
            <div class="button-row">
                <button type="submit" class="btn btn-sm">${item.reply ? 'Cập nhật phản hồi' : 'Gửi phản hồi'}</button>
                ${canDelete ? `<button type="button" class="btn btn-sm btn-danger" data-delete="${item.id}">Xóa</button>` : ''}
            </div>
        </form>`;
}

function renderList() {
    renderTabs();
    const visible = feedbacks.filter((item) => !filterStatus || item.status === filterStatus);
    if (!visible.length) {
        list.innerHTML = `<p class="empty">${admin ? 'Chưa có phản hồi nào từ khách hàng.' : 'Bạn chưa gửi phản hồi nào.'}</p>`;
        return;
    }

    list.innerHTML = visible
        .map(
            (item) => `
        <article class="feedback-card">
            <div class="feedback-head">
                <span class="tag tag-${item.type}">${FEEDBACK_TYPES[item.type]}</span>
                <b>${escapeHtml(item.subject)}</b>
                <span class="status status-${item.status === 'resolved' ? 'delivered' : 'pending'}">${FEEDBACK_STATUS[item.status]}</span>
            </div>
            <small class="muted">
                ${admin ? `${escapeHtml(item.userName)} · ` : ''}${formatDate(item.createdAt)}${item.orderCode ? ` · Đơn ${escapeHtml(item.orderCode)}` : ''}
            </small>
            <p>${escapeHtml(item.content)}</p>
            ${renderReply(item)}
            ${renderAdminTools(item)}
        </article>`
        )
        .join('');
}

tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (!button) return;
    filterStatus = button.dataset.status;
    renderList();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formMessage.textContent = '';
    formMessage.classList.remove('ok');
    const value = (name) => form.elements.namedItem(name).value.trim();
    const submitButton = form.querySelector('button[type="submit"]');

    submitButton.disabled = true;
    try {
        const saved = await api.post('/feedbacks', {
            type: value('type'),
            orderCode: value('orderCode'),
            subject: value('subject'),
            content: value('content')
        });
        feedbacks.unshift(saved);
        form.reset();
        formMessage.textContent = 'Phản hồi đã được gửi tới cửa hàng. Cảm ơn bạn.';
        formMessage.classList.add('ok');
        renderList();
    } catch (error) {
        formMessage.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});

list.addEventListener('submit', async (event) => {
    event.preventDefault();
    const replyForm = event.target.closest('.reply-form');
    const item = feedbacks.find((entry) => entry.id === replyForm.dataset.id);
    if (!item) return;

    try {
        Object.assign(item, await api.patch(`/feedbacks/${item.id}/reply`, { reply: replyForm.querySelector('textarea').value }));
        renderList();
    } catch (error) {
        notifyError(error);
    }
});

list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (
        !button ||
        !(await confirmDialog({ title: 'Xóa phản hồi?', message: 'Phản hồi này sẽ bị xóa vĩnh viễn.', confirmText: 'Xóa', tone: 'danger' }))
    )
        return;

    try {
        await api.delete(`/feedbacks/${button.dataset.delete}`);
        feedbacks = feedbacks.filter((entry) => entry.id !== button.dataset.delete);
        renderList();
    } catch (error) {
        notifyError(error);
    }
});

async function initialize() {
    if (!user) return;

    if (admin) {
        document.querySelector('#pageTitle').textContent = 'Phản hồi từ khách hàng';
    } else {
        form.classList.remove('hidden');
        const orderCode = new URLSearchParams(window.location.search).get('order');
        if (orderCode) {
            form.elements.namedItem('orderCode').value = orderCode;
            form.elements.namedItem('type').value = 'complaint';
        }
    }

    renderTabs();
    try {
        // Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
        await api.load('/feedbacks', (data) => {
            feedbacks = data;
            loaded = true;
            renderList();
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
