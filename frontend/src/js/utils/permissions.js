export const ROLE_LABELS = Object.freeze({
    admin: 'Quản trị viên',
    owner: 'Chủ cửa hàng',
    staff: 'Nhân viên',
    user: 'Khách hàng'
});

const PERMISSIONS = Object.freeze({
    admin: [
        'dashboard.sales',
        'dashboard.operations',
        'customers.analytics',
        'orders.view',
        'orders.manage',
        'payments.manage',
        'products.view',
        'products.manage',
        'inventory.view',
        'inventory.manage',
        'content.manage',
        'vouchers.manage',
        'feedback.viewAll',
        'feedback.reply',
        'feedback.delete',
        'team.manage'
    ],
    owner: [
        'dashboard.sales',
        'dashboard.operations',
        'customers.analytics',
        'orders.view',
        'orders.manage',
        'payments.manage',
        'products.view',
        'products.manage',
        'inventory.view',
        'inventory.manage',
        'content.manage',
        'vouchers.manage',
        'feedback.viewAll',
        'feedback.reply',
        'feedback.delete'
    ],
    staff: [
        'dashboard.operations',
        'orders.view',
        'orders.manage',
        'products.view',
        'inventory.view',
        'inventory.manage',
        'feedback.viewAll',
        'feedback.reply'
    ],
    user: ['customer.purchase']
});

export const hasPermission = (permission, user) => Boolean(user && PERMISSIONS[user.role]?.includes(permission));

export const isManagementRole = (user) => ['admin', 'owner', 'staff'].includes(user?.role);
