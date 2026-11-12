import { api } from './api-service.js';
import { getCurrentUser } from '../utils/auth.js';
import { isManagementRole } from '../utils/permissions.js';
import { toast } from '../components/notify.js';

// Sản phẩm yêu thích (nút trái tim trên thẻ sản phẩm). Lưu theo tài khoản trên server; khách chưa đăng nhập
// bấm trái tim thì được đưa tới trang đăng nhập rồi quay lại đúng trang đang xem.
const user = getCurrentUser();
const enabled = Boolean(user) && !isManagementRole(user);
let ids = new Set();

export const isFavorite = (id) => ids.has(String(id));

// Tô lại mọi nút trái tim đang có trên trang và số trên biểu tượng ở header.
export function paintFavorites(root = document) {
    root.querySelectorAll('[data-fav]').forEach((button) => {
        const on = ids.has(button.dataset.fav);
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
        button.title = on ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích';
    });
    const badge = document.querySelector('#favCount');
    if (badge) {
        badge.textContent = ids.size;
        badge.hidden = !ids.size;
    }
}

export const favoritesReady = enabled
    ? api
          .get('/favorites/ids')
          .then((result) => {
              ids = new Set(result.ids);
              paintFavorites();
          })
          .catch(() => {})
    : Promise.resolve();

document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-fav]');
    if (!button) return;
    event.preventDefault();
    if (!user) {
        sessionStorage.setItem(
            'redirectAfterLogin',
            `${window.location.pathname.split('/').pop() || 'index.html'}${window.location.search}`
        );
        window.location.assign('./login.html');
        return;
    }
    const id = button.dataset.fav;
    const adding = !ids.has(id);
    if (adding) ids.add(id);
    else ids.delete(id);
    paintFavorites();
    try {
        const result = adding
            ? await api.put(`/favorites/${encodeURIComponent(id)}`)
            : await api.delete(`/favorites/${encodeURIComponent(id)}`);
        ids = new Set(result.ids);
        if (adding)
            toast('Đã thêm vào danh sách yêu thích.', {
                type: 'success',
                title: 'Yêu thích',
                action: { label: 'Xem danh sách', href: './account.html?tab=favorites' }
            });
    } catch (error) {
        if (adding) ids.delete(id);
        else ids.add(id);
        toast(error.message, { type: 'error' });
    }
    paintFavorites();
});
