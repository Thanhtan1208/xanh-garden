import { escapeHtml } from '../utils/format.js';
import { icon } from '../utils/icons.js';

// Thành phần giao diện thống kê theo phong cách app ngân hàng:
//  - heroCard: một thẻ tổng quan lớn (số chính thật to + vài chỉ số phụ nằm cùng hàng, ngăn bằng vạch mảnh)
//  - txRow:    một dòng kiểu "lịch sử giao dịch" (icon tròn, tiêu đề + mô tả, số tiền canh phải)

// Viên thay đổi so với kỳ trước: ▲ 12% (xanh) / ▼ 5% (đỏ).
export function deltaPill(current, previous, label = '') {
    if (!previous) return `<span class="delta flat">Chưa có số liệu${label ? ` ${escapeHtml(label)}` : ''}</span>`;
    const pct = Math.round(((current - previous) / previous) * 100);
    const kind = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
    return `<span class="delta ${kind}">${arrow} ${Math.abs(pct)}%</span>${label ? `<span class="delta-vs">so với ${escapeHtml(label)}</span>` : ''}`;
}

// stats: [{ label, value, note }] (note là HTML đã an toàn, ví dụ deltaPill).
export function heroCard({ label, value, sub = '', stats = [], tone = '' }) {
    return `
        <div class="bank-hero-main${tone ? ` ${tone}` : ''}">
            <small>${escapeHtml(label)}</small>
            <b class="bank-amount">${value}</b>
            ${sub ? `<p>${sub}</p>` : ''}
        </div>
        ${stats.length ? `<div class="bank-hero-stats">${stats.map((stat) => `
            <div class="${stat.warn ? 'warn' : ''}"><small>${escapeHtml(stat.label)}</small><b>${stat.value}</b>${stat.note ? `<span>${stat.note}</span>` : ''}</div>`).join('')}
        </div>` : ''}`;
}

// tone: green | orange | red | blue | gray (màu nền vòng tròn icon). title/sub/amount/note là HTML đã an toàn.
export function txRow({ iconName = '', letter = '', tone = 'green', title, sub = '', amount = '', note = '', href = '', attrs = '', bar = null }) {
    const lead = `<span class="tx-icon tone-${tone}">${iconName ? icon(iconName, { size: 18 }) : escapeHtml(letter)}</span>`;
    const body = `
        ${lead}
        <span class="tx-body"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}${bar === null ? '' : `<span class="tx-bar"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></span>`}</span>
        <span class="tx-amount">${amount ? `<b>${amount}</b>` : ''}${note ? `<small>${note}</small>` : ''}</span>`;
    if (href) return `<a class="tx-row" href="${href}" ${attrs}>${body}</a>`;
    if (attrs.includes('data-')) return `<button type="button" class="tx-row" ${attrs}>${body}</button>`;
    return `<div class="tx-row">${body}</div>`;
}

export const emptyRow = (text) => `<p class="tx-empty">${escapeHtml(text)}</p>`;
