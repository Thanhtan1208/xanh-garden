import { api } from '../services/api-service.js';
import { requirePermission } from '../utils/auth.js';
import { hasPermission } from '../utils/permissions.js';
import { escapeHtml, formatDate } from '../utils/format.js';
import { productImage } from '../utils/images.js';
import { confirmDialog, notifyError, toast } from '../components/notify.js';
import '../components/header.js';

const PAGE_SIZE = 15;
const $ = (selector) => document.querySelector(selector);
const stars = (count) => '★'.repeat(count) + '☆'.repeat(5 - count);

let reviews = [];
let star = 0;
let shown = PAGE_SIZE;
let canDelete = false;

const replied = (review) => Boolean(review.reply);

function filtered() {
    const keyword = $('#searchBox').value.trim().toLowerCase();
    return reviews.filter(
        (review) =>
            (!star || review.rating === star) &&
            (!$('#onlyMedia').checked || review.media?.length) &&
            (!$('#onlyUnreplied').checked || !replied(review)) &&
            (!keyword || `${review.productName} ${review.userName} ${review.comment}`.toLowerCase().includes(keyword))
    );
}

function renderStats() {
    const total = reviews.length;
    const average = total ? reviews.reduce((sum, review) => sum + review.rating, 0) / total : 0;
    const waiting = reviews.filter((review) => !replied(review)).length;
    $('#reviewStats').innerHTML = `
        <div class="rv-stat"><b>${average.toFixed(1)}</b><span class="rv-stars">${stars(Math.round(average))}</span><small>${total} đánh giá</small></div>
        <div class="rv-stat"><b>${waiting}</b><small>Chưa phản hồi</small></div>
        <div class="rv-stat"><b>${reviews.filter((review) => review.rating <= 2).length}</b><small>Đánh giá 1–2 sao</small></div>
        <div class="rv-stat"><b>${reviews.filter((review) => review.media?.length).length}</b><small>Có ảnh/video</small></div>`;
    $('#starChips').innerHTML = [0, 5, 4, 3, 2, 1]
        .map((value) => {
            const count = value ? reviews.filter((review) => review.rating === value).length : total;
            return `<button type="button" class="rv-chip${value === star ? ' active' : ''}" data-star="${value}">${value ? `${value} sao` : 'Tất cả'} (${count})</button>`;
        })
        .join('');
}

function card(review) {
    const media = (review.media || [])
        .map((item) =>
            item.type === 'video'
                ? `<video controls preload="metadata" src="${escapeHtml(item.url)}"></video>`
                : `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.url)}" alt="Ảnh đánh giá" loading="lazy"></a>`
        )
        .join('');
    return `
        <article class="rv-card" data-id="${review.id}">
            <a class="rv-product" href="./product-detail.html?id=${encodeURIComponent(review.productId)}">
                <img src="${productImage(review.productImage)}" alt="">
                <span>${escapeHtml(review.productName)}</span>
            </a>
            <div class="rv-body">
                <div class="review-head">
                    <b>${escapeHtml(review.userName)}</b>
                    <span class="rv-stars">${stars(review.rating)}</span>
                    <small class="muted">${formatDate(review.createdAt)}</small>
                    ${review.authorClosed ? '<small class="rv-tag">Khách đã đóng</small>' : ''}
                    ${canDelete ? `<button type="button" class="btn btn-sm btn-danger" data-delete="${review.id}">Xóa</button>` : ''}
                </div>
                <p>${escapeHtml(review.comment)}</p>
                ${media ? `<div class="review-media">${media}</div>` : ''}
                ${review.reply ? `<div class="review-reply"><b>Phản hồi của ${escapeHtml(review.reply.by)}</b><p>${escapeHtml(review.reply.text)}</p><small class="muted">${formatDate(review.reply.at)}</small></div>` : ''}
                <form class="rv-reply" data-reply="${review.id}">
                    <textarea rows="2" minlength="2" maxlength="1000" placeholder="Viết phản hồi công khai cho khách..." required>${review.reply ? escapeHtml(review.reply.text) : ''}</textarea>
                    <button type="submit" class="btn btn-sm">${review.reply ? 'Sửa phản hồi' : 'Gửi phản hồi'}</button>
                </form>
            </div>
        </article>`;
}

function render() {
    renderStats();
    const rows = filtered();
    $('#reviewList').innerHTML = rows.length
        ? rows.slice(0, shown).map(card).join('')
        : '<p class="empty">Không có đánh giá nào phù hợp.</p>';
    $('#moreBtn').classList.toggle('hidden', rows.length <= shown);
}

function resetAndRender() {
    shown = PAGE_SIZE;
    render();
}

$('#starChips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-star]');
    if (!chip) return;
    star = Number(chip.dataset.star);
    resetAndRender();
});
['#onlyMedia', '#onlyUnreplied'].forEach((selector) => $(selector).addEventListener('change', resetAndRender));
$('#searchBox').addEventListener('input', resetAndRender);
$('#moreBtn').addEventListener('click', () => {
    shown += PAGE_SIZE;
    render();
});

$('#reviewList').addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-reply]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const saved = await api.patch(`/reviews/${form.dataset.reply}/reply`, { reply: form.querySelector('textarea').value });
        reviews = reviews.map((review) => (review.id === saved.id ? { ...review, reply: saved.reply } : review));
        toast('Đã gửi phản hồi.', { type: 'success' });
        render();
    } catch (error) {
        notifyError(error);
        button.disabled = false;
    }
});

$('#reviewList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (
        !button ||
        !(await confirmDialog({
            title: 'Xóa đánh giá?',
            message: 'Đánh giá này sẽ bị xóa vĩnh viễn, khách không xem lại được.',
            confirmText: 'Xóa',
            tone: 'danger'
        }))
    )
        return;
    try {
        await api.delete(`/reviews/${button.dataset.delete}`);
        reviews = reviews.filter((review) => review.id !== button.dataset.delete);
        toast('Đã xóa đánh giá.', { type: 'success' });
        render();
    } catch (error) {
        notifyError(error);
    }
});

async function initialize() {
    const user = requirePermission('feedback.viewAll');
    if (!user) return;
    canDelete = hasPermission('feedback.delete', user);
    try {
        await api.load('/admin/reviews', (list) => {
            reviews = list;
            $('#loading').classList.add('hidden');
            render();
        });
    } catch (error) {
        $('#loading').classList.add('hidden');
        $('#error').textContent = error.message;
        $('#error').classList.remove('hidden');
    }
}

initialize();
