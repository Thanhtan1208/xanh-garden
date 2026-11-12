import { api } from '../services/api-service.js';
import '../components/header.js';
import { requirePermission } from '../utils/auth.js';
import { toast } from '../components/notify.js';
import { SHOP } from '../config/shop.js';

// Thông tin cửa hàng hiển thị trên website: admin và chủ cửa hàng sửa, lưu ở server (db.settings.shop)
const form = document.getElementById('shopForm');
const field = (name) => form.elements.namedItem(name);
const FIELDS = ['name', 'tagline', 'hotline', 'email', 'address', 'hours', 'facebook', 'zalo', 'warrantyDays'];

function fill(shop) {
    FIELDS.forEach((name) => {
        field(name).value = shop[name] ?? '';
    });
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('formMessage');
    message.textContent = '';
    const body = Object.fromEntries(FIELDS.map((name) => [name, field(name).value.trim()]));
    body.warrantyDays = Number(body.warrantyDays);
    try {
        const saved = await api.put('/admin/shop', body);
        fill(saved);
        Object.assign(SHOP, saved); // trang này hiện ngay tên mới
        localStorage.removeItem('shopInfo');
        toast('Đã lưu thông tin cửa hàng. Các trang khác sẽ cập nhật khi tải lại.', { type: 'success' });
    } catch (error) {
        message.textContent = error.message;
    }
});

async function initialize() {
    if (!requirePermission('content.manage')) return;
    try {
        fill(await api.get('/admin/shop'));
        form.classList.remove('hidden');
    } catch (error) {
        document.getElementById('error').textContent = error.message;
        document.getElementById('error').classList.remove('hidden');
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

initialize();
