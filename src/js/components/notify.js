// Thông báo kiểu ứng dụng: "đảo" thông báo giữa phía trên (giống Dynamic Island của iPhone) và hộp thoại xác nhận,
// thay cho alert/confirm của trình duyệt. Chữ được gắn bằng textContent nên không có nguy cơ chèn HTML
// (icon là SVG cố định trong mã nguồn).
import { icon } from '../utils/icons.js';

const ICONS = { success: 'check', error: 'stop', warning: 'clock', info: 'chat' };
const TITLES = { success: 'Thành công', error: 'Có lỗi xảy ra', warning: 'Lưu ý', info: 'Thông báo' };

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// Chỉ có MỘT đảo thông báo: thông báo mới biến hình thay cho cái đang hiện, không xếp chồng.
let island = null;
let current = null;   // { key, count }
let timer = null;
let hideTimer = null;

function getIsland() {
    if (island) return island;
    island = node('div', 'island');
    island.setAttribute('role', 'status');
    island.setAttribute('aria-live', 'polite');
    island.addEventListener('mouseenter', () => clearTimeout(timer));
    island.addEventListener('mouseleave', () => current && schedule(current.duration));
    // Bấm vào đảo để đóng (trừ khi bấm vào liên kết hành động).
    island.addEventListener('click', (event) => { if (!event.target.closest('a')) hide(); });
    document.body.append(island);
    return island;
}

function hide() {
    clearTimeout(timer);
    if (!island) return;
    island.classList.remove('show', 'pulse');
    island.classList.add('leaving');
    current = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => island?.classList.remove('leaving'), 260);
}

function schedule(duration) {
    clearTimeout(timer);
    timer = setTimeout(hide, duration);
}

/**
 * Hiện thông báo. options: { type, title, duration, action: { label, href } }
 * Lỗi/lưu ý giữ 6 giây, còn lại 3,2 giây; rê chuột vào thì tạm dừng. Cùng một nội dung lặp lại thì hiện số đếm ×2, ×3...
 */
export function toast(message, options = {}) {
    const { type = 'info', title = TITLES[type], action } = options;
    const duration = options.duration ?? (type === 'error' || type === 'warning' ? 6000 : 3200);
    const element = getIsland();
    const key = `${type}|${title}|${message}`;
    const repeat = current?.key === key && element.classList.contains('show');
    current = { key, count: repeat ? current.count + 1 : 1, duration };

    const body = node('span', 'island-body');
    body.append(node('b', 'island-title', title), node('span', 'island-text', message));
    const lead = node('span', `island-icon island-${type}`);
    lead.innerHTML = icon(ICONS[type] || 'chat', { size: 16 });
    const parts = [lead, body];
    if (current.count > 1) parts.push(node('span', 'island-count', `×${current.count}`));
    if (action) {
        const link = node('a', 'island-action', action.label.replace(/\s*→\s*$/, ''));
        link.href = action.href;
        parts.push(link);
    }
    element.replaceChildren(...parts);
    element.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    clearTimeout(hideTimer);
    element.classList.remove('leaving');
    if (element.classList.contains('show')) {
        // Đang hiện: nảy nhẹ để báo có thông báo mới.
        element.classList.remove('pulse');
        void element.offsetWidth; // khởi động lại hiệu ứng
        element.classList.add('pulse');
    } else {
        element.classList.add('show');
    }
    schedule(duration);
}

export const notifyError = (error) => toast(error?.message || String(error), { type: 'error' });

/**
 * Hộp thoại xác nhận, trả về Promise<boolean>.
 * options: { title, message, rows: [[nhãn, giá trị]], confirmText, cancelText (null = chỉ có nút đóng), tone: 'primary'|'danger' }
 */
export function confirmDialog({ title, message, rows = [], confirmText = 'Xác nhận', cancelText = 'Hủy', tone = 'primary' }) {
    return new Promise((resolve) => {
        const previous = document.activeElement;
        const overlay = node('div', 'modal-overlay');
        const dialog = node('div', `modal modal-${tone}`);
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        dialog.append(node('h2', 'modal-title', title));
        if (message) dialog.append(node('p', 'modal-message', message));
        if (rows.length) {
            const list = node('dl', 'modal-rows');
            rows.forEach(([label, value, strong]) => {
                const row = node('div');
                row.append(node('dt', '', label), node('dd', strong ? 'strong' : '', value));
                list.append(row);
            });
            dialog.append(list);
        }

        const actions = node('div', 'modal-actions');
        const ok = node('button', `btn ${tone === 'danger' ? 'btn-danger-solid' : ''}`, confirmText);
        ok.type = 'button';
        if (cancelText) {
            const cancel = node('button', 'btn btn-outline', cancelText);
            cancel.type = 'button';
            cancel.addEventListener('click', () => finish(false));
            actions.append(cancel);
        }
        actions.append(ok);
        dialog.append(actions);
        overlay.append(dialog);
        document.body.append(overlay);
        document.body.classList.add('modal-open');
        ok.focus();

        function finish(result) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            document.body.classList.remove('modal-open');
            previous?.focus?.();
            resolve(result);
        }
        function onKey(event) {
            if (event.key === 'Escape') finish(false);
        }
        ok.addEventListener('click', () => finish(true));
        overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) finish(false); });
        document.addEventListener('keydown', onKey);
    });
}

/**
 * Hộp thoại chọn lý do (hủy đơn...). Trả về Promise<{ reasonId, note } | null>.
 * options: { title, message, choices: { id: nhãn } (bỏ trống = chỉ ô ghi chú), noteLabel, noteRequiredFor: id, confirmText, cancelText, tone }
 */
export function choiceDialog({ title, message, choices = null, noteLabel = 'Ghi chú', noteRequiredFor = 'other', noteOptional = false, confirmText = 'Xác nhận', cancelText = 'Quay lại', tone = 'primary' }) {
    return new Promise((resolve) => {
        const previous = document.activeElement;
        const overlay = node('div', 'modal-overlay');
        const dialog = node('div', `modal modal-${tone}`);
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.append(node('h2', 'modal-title', title));
        if (message) dialog.append(node('p', 'modal-message', message));

        const form = node('div', 'modal-form');
        const radios = [];
        if (choices) {
            Object.entries(choices).forEach(([id, label], index) => {
                const row = node('label', 'check-inline');
                const radio = node('input');
                radio.type = 'radio';
                radio.name = 'choice';
                radio.value = id;
                radio.checked = index === 0;
                radios.push(radio);
                row.append(radio, node('span', '', label));
                form.append(row);
            });
        }
        const noteBox = node('textarea');
        noteBox.rows = 2;
        noteBox.maxLength = 200;
        noteBox.placeholder = noteLabel;
        form.append(noteBox);
        const error = node('p', 'error-message');
        form.append(error);
        dialog.append(form);

        const syncNote = () => {
            const chosen = radios.find((radio) => radio.checked)?.value;
            noteBox.hidden = Boolean(choices) && chosen !== noteRequiredFor;
        };
        radios.forEach((radio) => radio.addEventListener('change', syncNote));
        syncNote();

        const actions = node('div', 'modal-actions');
        const cancel = node('button', 'btn btn-outline', cancelText);
        cancel.type = 'button';
        const ok = node('button', `btn ${tone === 'danger' ? 'btn-danger-solid' : ''}`, confirmText);
        ok.type = 'button';
        actions.append(cancel, ok);
        dialog.append(actions);
        overlay.append(dialog);
        document.body.append(overlay);
        document.body.classList.add('modal-open');
        (radios[0] || noteBox).focus();

        function finish(result) {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            document.body.classList.remove('modal-open');
            previous?.focus?.();
            resolve(result);
        }
        function onKey(event) {
            if (event.key === 'Escape') finish(null);
        }
        cancel.addEventListener('click', () => finish(null));
        ok.addEventListener('click', () => {
            const reasonId = radios.find((radio) => radio.checked)?.value || '';
            const note = noteBox.value.trim();
            if (choices && reasonId === noteRequiredFor && note.length < 3) { error.textContent = 'Vui lòng ghi rõ lý do.'; noteBox.focus(); return; }
            if (!choices && !noteOptional && note.length < 3) { error.textContent = 'Vui lòng nhập nội dung.'; noteBox.focus(); return; }
            finish({ reasonId, note });
        });
        overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) finish(null); });
        document.addEventListener('keydown', onKey);
    });
}

// Hộp thoại chỉ có một nút "Đã hiểu" (thay cho alert).
export const infoDialog = (title, message) =>
    confirmDialog({ title, message, confirmText: 'Đã hiểu', cancelText: null });
