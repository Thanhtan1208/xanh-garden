// Tab "Gợi ý AI" của trang Thống kê (chỉ chủ cửa hàng và admin): các phát hiện theo quy tắc + bản phân tích do AI viết.
import { api } from '../services/api-service.js';
import { toast } from '../components/notify.js';
import { escapeHtml, formatDate, formatPrice } from '../utils/format.js';
import { deltaPill, heroCard, txRow } from '../components/bank-ui.js';

const el = (id) => document.querySelector(`#${id}`);
const panel = document.querySelector('[data-panel="insights"]');
// mức độ -> [icon, màu]; cùng bộ màu với tab Nhu cầu khách
const LEVEL = { danger: ['stop', 'red'], warning: ['clock', 'orange'], info: ['chat', 'blue'], good: ['check', 'green'] };

let days = 30;
let loaded = false;

function renderKpi(data) {
    const { kpi, previous, cancel, costEstimated } = data;
    el('insightsKpi').innerHTML = heroCard({
        label: `Doanh thu (tiền bán − giá vốn) · ${data.days} ngày qua`,
        value: formatPrice(kpi.revenue),
        sub: deltaPill(kpi.revenue, previous.revenue, `${data.days} ngày trước`),
        stats: [
            { label: 'Tiền bán', value: formatPrice(kpi.sales) },
            { label: 'Giá vốn', value: formatPrice(kpi.cost) },
            { label: 'Biên lợi nhuận', value: `${kpi.margin}%`, warn: kpi.orders > 0 && kpi.margin < 15 },
            { label: 'Đơn đã giao', value: kpi.orders },
            {
                label: 'Tỉ lệ hủy đơn',
                value: `${cancel.rate}%`,
                note: `${cancel.cancelled}/${cancel.created} đơn`,
                warn: cancel.rate >= 20 && cancel.created >= 5
            },
            {
                label: 'Giá vốn ước tính',
                value: `${costEstimated.products}/${costEstimated.total}`,
                note: 'sản phẩm',
                warn: costEstimated.products > 0
            }
        ]
    });
}

function renderFindings(data) {
    el('insightsList').innerHTML = data.findings.length
        ? data.findings
              .map((finding) => {
                  const [iconName, tone] = LEVEL[finding.level] || LEVEL.info;
                  return txRow({
                      iconName,
                      tone,
                      title: escapeHtml(finding.title),
                      sub: `${escapeHtml(finding.detail)}<br><b>Nên làm:</b> ${escapeHtml(finding.action)}`
                  });
              })
              .join('')
        : '<p class="muted">Chưa có gợi ý nào cho kỳ này.</p>';
}

// Markdown gọn của AI (**đậm**, gạch đầu dòng, đánh số) sang HTML; chữ luôn được thoát ký tự trước khi chèn
function markdown(text) {
    const inline = (line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null;
    const close = () => {
        if (list) out.push(`</${list}>`);
        list = null;
    };
    String(text)
        .split('\n')
        .forEach((raw) => {
            const line = raw.trim();
            const bullet = /^[-•*]\s+(.*)$/.exec(line);
            const number = /^\d+[.)]\s+(.*)$/.exec(line);
            if (bullet || number) {
                const tag = number ? 'ol' : 'ul';
                if (list !== tag) {
                    close();
                    out.push(`<${tag}>`);
                    list = tag;
                }
                out.push(`<li>${inline((bullet || number)[1])}</li>`);
            } else {
                close();
                if (line) out.push(`<p>${inline(line)}</p>`);
            }
        });
    close();
    return out.join('');
}

function setAiState(available) {
    const button = el('insightsAiBtn');
    button.disabled = !available;
    el('insightsAiNote').textContent = available
        ? 'AI viết lại các số liệu ở trên thành bản phân tích dễ đọc. Chỉ gửi số liệu tổng hợp, không gửi thông tin khách hàng. Hãy đối chiếu với số liệu trước khi quyết định.'
        : 'Chưa cấu hình khóa OpenAI (OPENAI_API_KEY) trên server nên chưa dùng được phân tích bằng AI. Các gợi ý theo quy tắc ở trên vẫn dùng bình thường.';
}

async function load() {
    el('insightsList').innerHTML = '<p class="muted">Đang phân tích số liệu...</p>';
    el('insightsAi').classList.add('hidden');
    try {
        const data = await api.get(`/admin/insights?days=${days}`);
        loaded = true;
        renderKpi(data);
        renderFindings(data);
        setAiState(data.ai.available);
    } catch (error) {
        el('insightsList').innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
    }
}

el('insightsRange').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button) return;
    days = Number(button.dataset.days);
    document.querySelectorAll('#insightsRange button').forEach((item) => item.classList.toggle('active', item === button));
    load();
});

el('insightsAiBtn').addEventListener('click', async () => {
    const button = el('insightsAiBtn');
    button.disabled = true;
    button.textContent = 'AI đang phân tích...';
    try {
        const result = await api.post('/admin/insights/ai', { days }, { timeout: 60000 });
        el('insightsAi').innerHTML = `
            <div class="bank-card-head"><h2>Phân tích của AI · ${days} ngày qua</h2><small class="muted">${result.cached ? 'Bản đã nhớ' : 'Mới tạo'} lúc ${formatDate(result.generatedAt)}</small></div>
            <div class="ai-text">${markdown(result.text)}</div>`;
        el('insightsAi').classList.remove('hidden');
    } catch (error) {
        toast(error.message, { type: 'error' });
    } finally {
        button.textContent = 'Phân tích bằng AI';
        button.disabled = false;
    }
});

// Chỉ nạp khi tab được mở lần đầu (tab chỉ hiện với người có quyền xem doanh thu)
if (panel) {
    const open = () => !panel.classList.contains('hidden');
    new MutationObserver(() => {
        if (open() && !loaded) load();
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (open()) load();
}
