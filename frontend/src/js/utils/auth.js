import { hasPermission, isManagementRole } from './permissions.js';

export { isManagementRole };

const SESSION_KEY = 'session';

function readSession() {
    try {
        const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        return session?.token && session?.user ? session : null;
    } catch {
        return null;
    }
}

export const getCurrentUser = () => readSession()?.user ?? null;
export const getToken = () => readSession()?.token ?? null;

export function setSession({ token, user }) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

export function requireLogin(returnUrl = window.location.pathname.split('/').pop() || 'index.html') {
    const user = getCurrentUser();
    if (user) return user;

    sessionStorage.setItem('redirectAfterLogin', returnUrl);
    window.location.assign('./login.html');
    return null;
}

export function requirePermission(permission) {
    const user = requireLogin();
    if (user && !hasPermission(permission, user)) {
        window.location.assign(isManagementRole(user) ? './admin-dashboard.html' : './index.html');
        return null;
    }
    return user;
}

// Trang dành cho khách mua hàng; các role quản trị dùng khu vực riêng.
export function requireCustomer() {
    const user = requireLogin();
    if (user && isManagementRole(user)) {
        window.location.assign('./admin-dashboard.html');
        return null;
    }
    return user;
}
