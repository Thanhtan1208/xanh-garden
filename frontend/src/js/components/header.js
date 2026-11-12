import { api, clearApiCache } from '../services/api-service.js';
import { cartCount, cartReady, flushCart, forgetAccountCart } from '../services/cart-service.js';
import { cachedCategories, getCategories } from '../services/catalog-service.js';
import { favoritesReady, paintFavorites } from '../services/favorite-service.js';
import { clearSession, getCurrentUser, getToken, setSession } from '../utils/auth.js';
import { hasPermission, isManagementRole, ROLE_LABELS } from '../utils/permissions.js';
import { escapeHtml } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { SHOP, onShopChange, telLink } from '../config/shop.js';
import '../services/tracker.js';
import '../services/site-service.js'; // áp màu giao diện theo sự kiện đang chạy lên mọi trang

const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const params = new URLSearchParams(window.location.search);
const user = getCurrentUser();
const admin = isManagementRole(user);

const navLink = (href, label, active = currentPage === href.split('?')[0] && !href.includes('?')) =>
    `<a href="./${href}"${active ? ' class="active"' : ''}>${label}</a>`;

function categoryLinks(categories) {
    const selected = currentPage === 'products.html' ? params.get('category') : null;
    return (categories || [])
        .map(
            (category) =>
                `<a href="./products.html?category=${encodeURIComponent(category.id)}"${String(category.id) === selected ? ' class="active"' : ''}>${escapeHtml(category.name)}</a>`
        )
        .join('');
}

// Header cửa hàng
function storeHeader() {
    const account = user
        ? `<details class="account-menu">
                <summary class="header-action" aria-label="Mở menu tài khoản" title="Mở menu tài khoản">${user.avatar ? `<img class="header-avatar" src="${escapeHtml(user.avatar)}" alt="">` : icon('user', { size: 22 })}<span><small>Xin chào</small><b>${escapeHtml(user.name)}</b></span></summary>
                <div class="account-dropdown">
                    <a href="./account.html">${icon('user', { size: 16 })} Tài khoản của tôi</a>
                    <a href="./my-orders.html">${icon('box', { size: 16 })} Đơn hàng của tôi</a>
                    <a href="./account.html?tab=favorites">${icon('heart', { size: 16 })} Sản phẩm yêu thích</a>
                    <a href="./vouchers.html">${icon('ticket', { size: 16 })} Ví voucher</a>
                    <a href="./feedback.html">${icon('chat', { size: 16 })} Góp ý & khiếu nại</a>
                    <button type="button" data-logout>${icon('logout', { size: 16 })} Đăng xuất</button>
                </div>
            </details>`
        : `<a class="header-action" href="./login.html" aria-label="Đăng nhập" title="Đăng nhập">${icon('user', { size: 22 })}<span><small>Đăng nhập</small><b>Tài khoản</b></span></a>`;

    // Header gọn 1 khối: logo, ô tìm kiếm, tài khoản/yêu thích/giỏ hàng; hotline và chính sách để ở chân trang
    return `
        <div class="header-main">
            <div class="container header-main-inner">
                <button type="button" class="nav-toggle" aria-label="Mở menu" aria-expanded="false" aria-controls="mainNav">${icon('menu', { size: 24 })}</button>
                <a href="./index.html" class="logo" aria-label="${escapeHtml(SHOP.name)} - Trang chủ">
                    <span class="logo-mark">${icon('sprout', { size: 26 })}</span>
                    <span class="logo-text"><b>${escapeHtml(SHOP.name)}</b><small>${escapeHtml(SHOP.tagline)}</small></span>
                </a>
                <form class="header-search" action="./products.html" role="search">
                    <input type="search" name="q" value="${currentPage === 'products.html' ? escapeHtml(params.get('q') || '') : ''}" placeholder="Bạn tìm cây gì? VD: kim tiền, sen đá, cây để bàn..." aria-label="Tìm sản phẩm" autocomplete="off">
                    <button type="submit" aria-label="Tìm kiếm">${icon('search', { size: 20 })}</button>
                </form>
                <div class="header-actions">
                    <button type="button" class="header-action search-toggle" aria-label="Tìm kiếm">${icon('search', { size: 22 })}</button>
                    ${account}
                    <a class="header-action header-icon-only header-favorites" href="${user ? './account.html?tab=favorites' : './login.html'}" aria-label="Sản phẩm yêu thích" title="Sản phẩm yêu thích">${icon('heart', { size: 22 })}<span class="count" id="favCount" hidden>0</span></a>
                    <a class="header-action header-cart" href="./cart.html" aria-label="Giỏ hàng">${icon('cart', { size: 24 })}<span class="count" id="cartCount"${cartCount() ? '' : ' hidden'}>${cartCount()}</span></a>
                </div>
            </div>
        </div>
        <nav class="main-nav" id="mainNav" aria-label="Danh mục">
            <div class="container main-nav-inner">
                <div class="drawer-head"><b>Danh mục</b><button type="button" class="drawer-close" aria-label="Đóng menu">${icon('close', { size: 22 })}</button></div>
                ${navLink('index.html', `${icon('home', { size: 17 })} Trang chủ`)}
                ${navLink('products.html', `${icon('leaf', { size: 17 })} Sản phẩm`, currentPage === 'products.html' && !params.get('category'))}
                <details class="category-menu"${currentPage === 'products.html' && params.get('category') ? ' data-active="true"' : ''}>
                    <summary>${icon('grid', { size: 17 })} Danh mục ${icon('chevronDown', { size: 15, cls: 'category-chevron' })}</summary>
                    <div class="nav-categories" id="navCategories">${categoryLinks(cachedCategories())}</div>
                </details>
                ${navLink('vouchers.html', `${icon('gift', { size: 17 })} Khuyến mãi`)}
                ${navLink('info.html?page=cham-soc', `${icon('book', { size: 17 })} Cẩm nang`, currentPage === 'info.html')}
                <span class="drawer-extra">
                    ${user ? navLink('account.html', 'Tài khoản của tôi') + navLink('my-orders.html', 'Đơn hàng của tôi') : navLink('login.html', 'Đăng nhập') + navLink('dangky.html', 'Đăng ký')}
                    <a href="${telLink()}">${icon('phone', { size: 16 })} ${escapeHtml(SHOP.hotline)}</a>
                </span>
            </div>
        </nav>`;
}

// Header trang quản trị
// Thanh trên gọn (logo, về cửa hàng, tài khoản) + thanh bên chia nhóm theo công việc; mục nào không có quyền thì không hiện.
const ADMIN_MENU = [
    {
        title: 'Tổng quan',
        items: [{ href: 'admin-dashboard.html', label: 'Thống kê', icon: 'grid', can: ['dashboard.sales', 'dashboard.operations'] }]
    },
    {
        title: 'Bán hàng',
        items: [
            { href: 'admin-orders.html', label: 'Đơn hàng', icon: 'box', can: ['orders.view'] },
            { href: 'admin-products.html', label: 'Sản phẩm & kho', icon: 'leaf', can: ['products.view'] }
        ]
    },
    {
        title: 'Khuyến mãi',
        items: [
            { href: 'admin-banners.html', label: 'Banner & sự kiện', icon: 'image', can: ['content.manage'] },
            { href: 'admin-vouchers.html', label: 'Voucher', icon: 'ticket', can: ['vouchers.manage'] }
        ]
    },
    {
        title: 'Khách hàng',
        items: [
            { href: 'admin-reviews.html', label: 'Đánh giá', icon: 'star', can: ['feedback.viewAll'] },
            { href: 'feedback.html', label: 'Phản hồi', icon: 'chat', can: ['feedback.viewAll'] }
        ]
    },
    {
        title: 'Hệ thống',
        items: [
            { href: 'admin-settings.html', label: 'Thông tin cửa hàng', icon: 'home', can: ['content.manage'] },
            { href: 'admin-team.html', label: 'Tài khoản', icon: 'user', can: ['team.manage'] }
        ]
    }
];

function adminHeader() {
    const groups = ADMIN_MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.can.some((permission) => hasPermission(permission, user)))
    })).filter((group) => group.items.length);
    const sidebar = groups
        .map(
            (group) => `
        <div class="side-group">
            <p class="side-title">${group.title}</p>
            ${group.items.map((item) => `<a href="./${item.href}"${currentPage === item.href ? ' class="active" aria-current="page"' : ''}>${icon(item.icon, { size: 18 })} ${item.label}</a>`).join('')}
        </div>`
        )
        .join('');
    return `
        <div class="admin-bar">
            <button type="button" class="nav-toggle" aria-label="Mở menu quản lý" aria-expanded="false" aria-controls="adminSide">${icon('menu', { size: 22 })}</button>
            <a href="./admin-dashboard.html" class="logo"><span class="logo-mark">${icon('sprout', { size: 20 })}</span><span class="logo-text"><b>${escapeHtml(SHOP.name)}</b><small>Khu vực quản lý</small></span></a>
            <span class="admin-user">
                <a class="admin-store-link" href="./index.html" title="Xem cửa hàng">${icon('home', { size: 16 })} <span>Xem cửa hàng</span></a>
                <span class="admin-who"><b>${escapeHtml(user.name)}</b><span class="role-tag role-tag-${user.role}">${ROLE_LABELS[user.role]}</span></span>
                <button type="button" data-logout aria-label="Đăng xuất" title="Đăng xuất">${icon('logout', { size: 18 })}</button>
            </span>
        </div>
        <nav class="admin-side" id="adminSide" aria-label="Menu quản lý">${sidebar}</nav>
        <div class="admin-scrim"></div>`;
}

// Chân trang
function footer(categories) {
    return `
        <div class="footer-main">
            <div class="container footer-grid">
                <div class="footer-about">
                    <a href="./index.html" class="logo logo-light"><span class="logo-mark">${icon('sprout', { size: 24 })}</span><span class="logo-text"><b>${escapeHtml(SHOP.name)}</b><small>${escapeHtml(SHOP.tagline)}</small></span></a>
                    <p>Cây để bàn, cây phong thủy, cây lọc không khí, sen đá – xương rồng và chậu cảnh. Giao hàng toàn quốc, bảo hành cây ${SHOP.warrantyDays} ngày nếu hư do vận chuyển.</p>
                    <ul class="footer-contact">
                        <li>${icon('mapPin', { size: 16 })} ${escapeHtml(SHOP.address)}</li>
                        <li>${icon('phone', { size: 16 })} <a href="${telLink()}">${escapeHtml(SHOP.hotline)}</a></li>
                        <li>${icon('mail', { size: 16 })} <a href="mailto:${escapeHtml(SHOP.email)}">${escapeHtml(SHOP.email)}</a></li>
                        <li>${icon('clock', { size: 16 })} ${escapeHtml(SHOP.hours)}</li>
                    </ul>
                </div>
                <div>
                    <h4>Chính sách</h4>
                    <nav class="footer-links">
                        <a href="./info.html?page=mua-hang">Vận chuyển & thanh toán</a>
                        <a href="./info.html?page=doi-tra">Bảo hành & đổi trả</a>
                        <a href="./info.html?page=hoi-dap">Câu hỏi thường gặp</a>
                        <a href="./vouchers.html">Chương trình khuyến mãi</a>
                    </nav>
                </div>
                <div>
                    <h4>Hỗ trợ khách hàng</h4>
                    <nav class="footer-links">
                        <a href="./my-orders.html">Tra cứu đơn hàng</a>
                        <a href="./info.html?page=cham-soc">Cẩm nang chăm cây</a>
                        <a href="./info.html?page=chon-cay">Chọn cây theo nhu cầu</a>
                        <a href="./feedback.html">Góp ý & khiếu nại</a>
                    </nav>
                    <p class="footer-social">
                        <a href="${escapeHtml(SHOP.facebook)}" target="_blank" rel="noopener">Facebook</a>
                        <a href="${escapeHtml(SHOP.zalo)}" target="_blank" rel="noopener">Zalo</a>
                    </p>
                </div>
            </div>
        </div>
        <div class="footer-bottom">
            <div class="container">
                <span>© ${new Date().getFullYear()} ${escapeHtml(SHOP.name)}. Cây xanh giao tận nơi.</span>
            </div>
        </div>`;
}

export function renderHeader() {
    const element = document.querySelector('#siteHeader');
    if (!element) return;
    element.classList.toggle('header-admin', admin);
    element.innerHTML = admin ? adminHeader() : storeHeader();
    document.body.classList.add(admin ? 'is-admin' : 'is-store', `role-${user?.role || 'guest'}`);

    // Menu trượt trên điện thoại.
    const toggle = element.querySelector('.nav-toggle');
    const setOpen = (open) => {
        document.body.classList.toggle('nav-open', open);
        toggle?.setAttribute('aria-expanded', String(open));
    };
    toggle?.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
    element.querySelector('.drawer-close')?.addEventListener('click', () => setOpen(false));
    document.addEventListener('click', (event) => {
        if (document.body.classList.contains('nav-open') && !event.target.closest('.main-nav, .admin-side, .nav-toggle')) setOpen(false);
        const menu = element.querySelector('.account-menu[open]');
        if (menu && !event.target.closest('.account-menu')) menu.open = false;
        const categoryMenu = element.querySelector('.category-menu[open]');
        if (categoryMenu && !event.target.closest('.category-menu')) categoryMenu.open = false;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        setOpen(false);
        const accountMenu = element.querySelector('.account-menu[open]');
        const categoryMenu = element.querySelector('.category-menu[open]');
        if (accountMenu) accountMenu.open = false;
        if (categoryMenu) categoryMenu.open = false;
    });
    element.querySelector('.search-toggle')?.addEventListener('click', () => {
        element.classList.toggle('search-open');
        if (element.classList.contains('search-open')) element.querySelector('.header-search input').focus();
    });

    // Mọi nút [data-logout] trên trang (menu tài khoản ở header, menu bên trang Tài khoản...).
    document.addEventListener('click', async (event) => {
        if (!event.target.closest('[data-logout]')) return;
        await flushCart(); // gửi nốt thay đổi giỏ chưa kịp lên server (cần token nên làm trước khi xóa phiên)
        forgetAccountCart(user); // không để giỏ của tài khoản lại trên máy dùng chung
        clearApiCache(); // xóa dữ liệu đã nhớ của tài khoản (đơn hàng, voucher...)
        clearSession();
        window.location.assign('./index.html');
    });
}

export function updateCartBadge() {
    const badge = document.querySelector('#cartCount');
    if (!badge) return;
    // giỏ trống thì ẩn số đếm
    badge.textContent = cartCount();
    badge.hidden = !cartCount();
}

function renderFooter() {
    if (admin || document.querySelector('.site-footer')) return;
    const element = document.createElement('footer');
    element.className = 'site-footer';
    element.innerHTML = footer(cachedCategories());
    document.body.append(element);
}

// Admin có thể vừa đổi vai trò của tài khoản này: hỏi server mỗi lần tải trang, khác thì cập nhật phiên rồi tải lại để menu đúng quyền
if (user) {
    api.get('/auth/me')
        .then((me) => {
            if (me.role === user.role && me.name === user.name && me.avatar === user.avatar) return;
            setSession({ token: getToken(), user: me });
            window.location.reload();
        })
        .catch(() => {});
}

renderHeader();
renderFooter();

// Admin vừa đổi thông tin cửa hàng: cập nhật tên, khẩu hiệu và chân trang ngay, không cần tải lại trang
onShopChange(() => {
    document.querySelectorAll('.logo-text b').forEach((element) => {
        element.textContent = SHOP.name;
    });
    if (!admin)
        document.querySelectorAll('.logo-text small').forEach((element) => {
            element.textContent = SHOP.tagline;
        });
    const footerElement = document.querySelector('.site-footer');
    if (footerElement) footerElement.innerHTML = footer(cachedCategories());
});
cartReady.then(updateCartBadge); // giỏ trên server về tới nơi thì cập nhật số trên biểu tượng giỏ hàng
favoritesReady.then(() => paintFavorites());

// Danh mục mới nhất từ server cho menu.
if (!admin) {
    getCategories()
        .then((categories) => {
            // Chỉ vẽ lại khi danh mục thật sự thay đổi, tránh menu chớp
            const html = categoryLinks(categories);
            const nav = document.querySelector('#navCategories');
            if (nav && nav.innerHTML !== html) nav.innerHTML = html;
        })
        .catch(() => {});
}

// Chatbot tư vấn nổi ở góc phải mọi trang (trừ trang quản trị).
if (!admin) import('./chat-widget.js');
