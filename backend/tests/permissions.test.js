// Phân quyền: bảng quyền frontend khớp backend, và mỗi vai trò chỉ gọi được đúng các API của mình.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, login, newCustomer, startServer } from './helpers.js';
import { PERMISSIONS, ROLE_LABEL } from '../server/core/permissions.js';
import { PERMISSIONS as FRONT_PERMISSIONS, ROLE_LABELS as FRONT_LABELS } from '../../frontend/src/js/utils/permissions.js';

let ctx;
const tokens = {};
before(async () => {
    ctx = await startServer();
    tokens.admin = await login(ctx, 'admin');
    // Tạo owner và staff từ hai khách mới, đổi vai trò bằng admin
    for (const role of ['owner', 'staff']) {
        const account = await newCustomer(ctx);
        const changed = await call(ctx, 'PATCH', `/admin/users/${account.user.id}/role`, { token: tokens.admin, body: { role } });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        tokens[role] = await login(ctx, account.name);
    }
    tokens.user = (await newCustomer(ctx)).token;
});
after(() => ctx.stop());

describe('Bảng quyền', () => {
    test('frontend và backend dùng cùng một bảng quyền và cùng tên vai trò', () => {
        for (const role of Object.keys(PERMISSIONS))
            assert.deepEqual([...FRONT_PERMISSIONS[role]].sort(), [...PERMISSIONS[role]].sort(), role);
        assert.deepEqual(FRONT_LABELS, ROLE_LABEL);
    });

    test('quyền của vai trò thấp là tập con của vai trò cao (trừ quyền mua hàng của khách)', () => {
        const has = (role, list) => list.every((permission) => PERMISSIONS[role].includes(permission));
        assert.ok(has('owner', PERMISSIONS.staff), 'owner có mọi quyền của staff');
        assert.ok(has('admin', PERMISSIONS.owner), 'admin có mọi quyền của owner');
        assert.ok(PERMISSIONS.admin.includes('team.manage') && !PERMISSIONS.owner.includes('team.manage'), 'chỉ admin quản lý tài khoản');
        assert.ok(!PERMISSIONS.staff.includes('dashboard.sales'), 'staff không xem doanh thu');
    });
});

// [phương thức, đường dẫn, { vai trò: mã trả về mong đợi }]; 'ok' = không bị chặn quyền (không phải 401/403)
const MATRIX = [
    ['GET', '/admin/users', { none: 401, user: 403, staff: 403, owner: 403, admin: 'ok' }],
    ['GET', '/admin/stats', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/product-sales', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/inventory', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/demand', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/customer-analytics', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/payments', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/shop', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/settings', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/vouchers', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/banners', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/events', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/stock-logs', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }],
    ['GET', '/admin/reviews', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }],
    ['POST', '/admin/products', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['PATCH', '/admin/products/1/stock', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }],
    ['PATCH', '/orders/none/payment', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['DELETE', '/feedbacks/none', { none: 401, user: 403, staff: 403, owner: 'ok', admin: 'ok' }],
    ['PATCH', '/feedbacks/none/reply', { none: 401, user: 403, staff: 'ok', owner: 'ok', admin: 'ok' }]
];

describe('Ma trận API theo vai trò', () => {
    for (const [method, path, expected] of MATRIX) {
        test(`${method} ${path}`, async () => {
            for (const [role, want] of Object.entries(expected)) {
                const res = await call(ctx, method, path, { token: tokens[role], body: method === 'GET' ? undefined : {} });
                if (want === 'ok')
                    assert.ok(![401, 403].includes(res.status), `${role}: bị chặn ${res.status} ${JSON.stringify(res.body)}`);
                else assert.equal(res.status, want, `${role}: ${JSON.stringify(res.body)}`);
            }
        });
    }

    test('chỉ admin đổi vai trò, đặt lại mật khẩu và xóa tài khoản', async () => {
        const target = await newCustomer(ctx);
        const requests = [
            ['PATCH', `/admin/users/${target.user.id}/role`, { role: 'staff' }],
            ['POST', `/admin/users/${target.user.id}/reset-password`, {}],
            ['GET', `/admin/users/${target.user.id}/delete-check`, undefined],
            ['DELETE', `/admin/users/${target.user.id}`, undefined]
        ];
        for (const role of ['user', 'staff', 'owner'])
            for (const [method, path, body] of requests)
                assert.equal((await call(ctx, method, path, { token: tokens[role], body })).status, 403, `${role} ${method} ${path}`);
    });

    test('khách chỉ xem được đơn của mình; nhân viên và quản lý xem được mọi đơn', async () => {
        const list = (role) => call(ctx, 'GET', '/orders', { token: tokens[role] });
        assert.equal((await list('user')).status, 200);
        assert.deepEqual((await list('user')).body, [], 'khách mới chưa có đơn');
        for (const role of ['staff', 'owner', 'admin']) assert.equal((await list(role)).status, 200, role);
        assert.equal((await call(ctx, 'GET', '/orders/none')).status, 401);
    });

    test('tài khoản quản trị không đặt hàng; chỉ khách mới dùng giỏ hàng, sổ địa chỉ, ví voucher', async () => {
        for (const role of ['staff', 'owner', 'admin']) {
            for (const path of ['/cart', '/addresses', '/vouchers/mine', '/favorites'])
                assert.equal((await call(ctx, 'GET', path, { token: tokens[role] })).status, 403, `${role} ${path}`);
        }
        for (const path of ['/cart', '/addresses', '/vouchers/mine', '/favorites'])
            assert.equal((await call(ctx, 'GET', path, { token: tokens.user })).status, 200, path);
    });
});
