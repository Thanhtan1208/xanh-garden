// Lưu trữ PostgreSQL: chỉ chạy khi đặt TEST_DATABASE_URL (VD postgres://postgres:mk@127.0.0.1:5432/xanhgarden)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { ON_PG, addAddress, call, login, newCustomer, placeOrder, startServer } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('PostgreSQL', { skip: ON_PG ? false : 'chưa đặt TEST_DATABASE_URL' }, () => {
    let ctx;
    let admin;
    let flushStore;
    let query;
    before(async () => {
        ctx = await startServer();
        admin = await login(ctx, 'admin');
        ({ flushStore } = await import('../server/core/store.js'));
        ({ query } = await import('../server/core/pg.js'));
    });
    after(() => ctx?.stop());

    test('đọc lại từ CSDL khớp hoàn toàn dữ liệu trong bộ nhớ sau khi đặt đơn, đổi trạng thái, thêm địa chỉ', async () => {
        const customer = await newCustomer(ctx);
        const address = await addAddress(ctx, customer.token);
        const made = await placeOrder(ctx, customer.token, address, [['2', 2]]);
        assert.equal(made.status, 201, JSON.stringify(made.body));
        await call(ctx, 'PATCH', `/orders/${made.body.id}/status`, { token: admin, body: { status: 'confirmed' } });
        await flushStore();

        const { loadAll } = await import('../server/core/pg-store.js');
        const { data } = await loadAll();
        for (const name of ['user', 'orders', 'products', 'stockLogs', 'userVouchers', 'carts']) {
            assert.deepStrictEqual(data[name], JSON.parse(JSON.stringify(ctx.db[name])), name);
        }
        assert.deepStrictEqual(data.settings, ctx.db.settings);

        // dữ liệu nằm ở cột thật, không chỉ trong extra
        const row = (await query('SELECT status, total, user_id FROM orders WHERE id = $1', [made.body.id])).rows[0];
        assert.deepEqual(row, { status: 'confirmed', total: made.body.total, user_id: customer.user.id });
        const items = (await query('SELECT product_id, qty FROM order_items WHERE order_id = $1 ORDER BY pos', [made.body.id])).rows;
        assert.deepEqual(items, [{ product_id: '2', qty: 2 }]);
    });

    test('ảnh tải lên lưu trong CSDL: mất tệp trên đĩa (máy chủ khởi động lại) vẫn tải được', async () => {
        const upload = await call(ctx, 'POST', '/admin/uploads/product', {
            token: admin,
            raw: PNG,
            headers: { 'Content-Type': 'image/png' }
        });
        assert.equal(upload.status, 201);
        const name = upload.body.url.split('/').pop();
        rmSync(join(ctx.dir, 'uploads', 'products', name));
        const response = await fetch(ctx.base.replace(/\/api$/, '') + upload.body.url);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    });

    test('xóa tài khoản thì địa chỉ của tài khoản bị xóa theo (khóa ngoại ON DELETE CASCADE)', async () => {
        const customer = await newCustomer(ctx);
        await addAddress(ctx, customer.token);
        await flushStore();
        const count = async () =>
            (await query('SELECT count(*)::int AS n FROM user_addresses WHERE user_id = $1', [customer.user.id])).rows[0].n;
        assert.equal(await count(), 1);
        assert.equal((await call(ctx, 'DELETE', `/admin/users/${customer.user.id}`, { token: admin })).status, 204);
        await flushStore();
        assert.equal(await count(), 0);
    });
});
