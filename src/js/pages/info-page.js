import { api } from '../services/api-service.js';
import { escapeHtml } from '../utils/format.js';
import '../components/header.js';

// Trang chính sách / cẩm nang: nội dung lấy từ cơ sở tri thức của cửa hàng (API /pages), cùng nguồn với chatbot.
const nav = document.querySelector('#pageNav');
const content = document.querySelector('#pageContent');

// Markdown tối giản an toàn: đoạn văn, danh sách "- " / "1. ", chữ **đậm** (nội dung đã được escape trước).
function markdown(text) {
    const inline = (line) => escapeHtml(line).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const html = [];
    let list = null;
    const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
    text.split('\n').forEach((raw) => {
        const line = raw.trim();
        const bullet = /^[-*]\s+(.*)$/.exec(line);
        const numbered = /^\d+\.\s+(.*)$/.exec(line);
        if (bullet || numbered) {
            const type = bullet ? 'ul' : 'ol';
            if (list !== type) { closeList(); html.push(`<${type}>`); list = type; }
            html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
        } else if (line) {
            closeList();
            html.push(`<p>${inline(line)}</p>`);
        } else {
            closeList();
        }
    });
    closeList();
    return html.join('');
}

const slugify = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let currentSlug = new URLSearchParams(window.location.search).get('page');

function renderNav(pages) {
    nav.innerHTML = pages.map((page) => `<a href="./info.html?page=${page.slug}" data-slug="${page.slug}"${page.slug === currentSlug ? ' class="active"' : ''}>${escapeHtml(page.title)}</a>`).join('');
}

// Có bản nhớ thì vẽ ngay, dữ liệu mới từ server về thì vẽ lại tại chỗ
// (đã bấm sang mục khác thì bỏ qua dữ liệu của mục cũ)
function show(slug) {
    currentSlug = slug;
    return api.load(`/pages/${encodeURIComponent(slug)}`, (page) => {
        if (slug === currentSlug) renderPage(page, slug);
    });
}

function renderPage(page, slug) {
    document.title = `${page.title} - Xanh Garden`;
    const crumb = document.querySelector('#crumbTitle');
    if (crumb) crumb.textContent = page.title;
    nav.querySelectorAll('a').forEach((link) => link.classList.toggle('active', link.dataset.slug === slug));
    content.innerHTML = `
        <h1>${escapeHtml(page.title)}</h1>
        ${page.sections.length > 3 ? `<nav class="toc">${page.sections.map((section) => `<a href="#${slugify(section.title)}">${escapeHtml(section.title)}</a>`).join('')}</nav>` : ''}
        ${page.sections.map((section) => `
            <section id="${slugify(section.title)}">
                <h2>${escapeHtml(section.title)}</h2>
                ${markdown(section.body)}
            </section>`).join('')}
        <p class="muted">Còn thắc mắc? Hỏi trợ lý ở góc phải màn hình hoặc gửi <a href="./feedback.html">góp ý cho cửa hàng</a>.</p>`;
}

// Gắn 1 lần: menu có thể được vẽ lại khi dữ liệu mới về
nav.addEventListener('click', (event) => {
    const link = event.target.closest('[data-slug]');
    if (!link) return;
    event.preventDefault();
    window.history.replaceState(null, '', link.href);
    show(link.dataset.slug).then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
});

async function initialize() {
    try {
        const wanted = currentSlug;
        // Menu và nội dung trang đang xem tải cùng lúc (trang đã xem thì hiện ngay từ bản nhớ)
        const [[pages]] = await Promise.all([api.load('/pages', renderNav), wanted ? show(wanted).catch(() => null) : null]);
        // Không có ?page= hoặc mã trang sai: mở trang đầu tiên
        if (!pages.some((page) => page.slug === wanted)) await show(pages[0].slug);
    } catch (error) {
        content.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    }
}

initialize();
