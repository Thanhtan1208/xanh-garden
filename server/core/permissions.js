export const ROLE_LEVEL = Object.freeze({ user: 0, staff: 1, owner: 2, admin: 3 });

export const ROLE_LABEL = Object.freeze({
    admin: 'Quản trị viên',
    owner: 'Chủ cửa hàng',
    staff: 'Nhân viên',
    user: 'Khách hàng'
});

export const PERMISSIONS = Object.freeze({
    admin: Object.freeze([
        'dashboard.sales', 'dashboard.operations', 'customers.analytics', 'orders.view', 'orders.manage',
        'payments.manage', 'products.view', 'products.manage', 'inventory.view', 'inventory.manage',
        'content.manage', 'vouchers.manage', 'feedback.viewAll', 'feedback.reply', 'feedback.delete', 'team.manage'
    ]),
    owner: Object.freeze([
        'dashboard.sales', 'dashboard.operations', 'customers.analytics', 'orders.view', 'orders.manage',
        'payments.manage', 'products.view', 'products.manage', 'inventory.view', 'inventory.manage',
        'content.manage', 'vouchers.manage', 'feedback.viewAll', 'feedback.reply', 'feedback.delete'
    ]),
    staff: Object.freeze([
        'dashboard.operations', 'orders.view', 'orders.manage', 'products.view', 'inventory.view',
        'inventory.manage', 'feedback.viewAll', 'feedback.reply'
    ]),
    user: Object.freeze(['customer.purchase'])
});

export const ROLES = Object.freeze(Object.keys(ROLE_LEVEL));

export function hasPermission(user, permission) {
    return Boolean(user && PERMISSIONS[user.role]?.includes(permission));
}

export const isManagementRole = (user) => Boolean(user && ROLE_LEVEL[user.role] >= ROLE_LEVEL.staff);

