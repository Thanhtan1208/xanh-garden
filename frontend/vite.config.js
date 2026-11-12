import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const pages = {
    home: 'index.html',
    products: 'products.html',
    productDetail: 'product-detail.html',
    cart: 'cart.html',
    checkout: 'checkout.html',
    orderSuccess: 'order-success.html',
    login: 'login.html',
    register: 'dangky.html',
    myOrders: 'my-orders.html',
    adminOrders: 'admin-orders.html',
    adminReviews: 'admin-reviews.html',
    feedback: 'feedback.html',
    forgotPassword: 'forgot-password.html',
    verifyEmail: 'verify-email.html',
    adminDashboard: 'admin-dashboard.html',
    adminProducts: 'admin-products.html',
    vouchers: 'vouchers.html',
    adminBanners: 'admin-banners.html',
    adminVouchers: 'admin-vouchers.html',
    adminTeam: 'admin-team.html',
    adminSettings: 'admin-settings.html',
    account: 'account.html',
    info: 'info.html'
};

// Frontend gọi /api/...; Vite chuyển tiếp sang server Express ở cổng 3000.
const proxy = { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' };

// Chuyển trang không giật: đưa script của trang lên <head> kèm blocking="render" để trình duyệt chờ JS dựng xong
// header, menu, chân trang, màu sự kiện rồi mới vẽ trang mới (thay vì vẽ khung tạm rồi nhảy). Bỏ qua script của Vite.
const renderBlocking = {
    name: 'render-blocking-page-scripts',
    transformIndexHtml: {
        order: 'post',
        handler(html) {
            const scripts = [];
            const rest = html.replace(/<script type="module"(?![^>]*@vite\/client)([^>]*)><\/script>\s*/g, (_, attrs) => {
                scripts.push(`<script type="module" blocking="render"${attrs}></script>`);
                return '';
            });
            return rest.replace('</head>', `${scripts.join('\n')}\n</head>`);
        }
    }
};

export default defineConfig({
    plugins: [renderBlocking],
    // Dữ liệu và mã server nằm ở ../backend, ngoài thư mục gốc nên Vite không phục vụ
    server: { proxy },
    preview: { proxy },
    build: {
        rollupOptions: {
            input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, resolve(root, file)]))
        }
    }
});
