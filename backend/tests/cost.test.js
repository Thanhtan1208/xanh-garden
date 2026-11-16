// Giá vốn: nhập khi tạo sản phẩm, bình quân khi nhập hàng, chụp vào đơn lúc đặt, không lộ cho khách,
// doanh thu = tiền bán - giá vốn.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addAddress, call, login, newCustomer, placeOrder, startServer } from './helpers.js';

let ctx;
let admin;
before(async () => {
    ctx = await startServer();
    admin = await login(ctx, 'admin');
});
after(() => ctx.stop());

const product = (patch = {}) => ({
    name: 'Cây thử giá vốn',
    categoryId: 1,
    price: 200000,
    costPrice: 120000,
    stock: 10,
    image: 'p1.png',
    description: 'Cây dùng để thử giá vốn',
    ...patch
});
const create = (patch) => call(ctx, 'POST', '/admin/products', { token: admin, body: product(patch) });
const deliver = async (order) => {
    for (const status of ['confirmed', 'shipping', 'delivered'])
        assert.equal((await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } })).status, 200);
};
// Tài khoản nhân viên: khách mới được admin đổi vai trò
async function staffAccount() {
    const account = await newCustomer(ctx);
    const changed = await call(ctx, 'PATCH', `/admin/users/${account.user.id}/role`, { token: admin, body: { role: 'staff' } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    return { token: await login(ctx, account.name) };
}
const summary = async () => (await call(ctx, 'GET', '/admin/stats?period=year', { token: admin })).body.summary;

describe('Giá vốn của sản phẩm', () => {
    test('bắt buộc khi tạo sản phẩm: số nguyên từ 1.000 ₫ và không cao hơn giá bán', async () => {
        const { costPrice, ...withoutCost } = product({ name: 'Thiếu giá vốn' });
        assert.equal((await call(ctx, 'POST', '/admin/products', { token: admin, body: withoutCost })).status, 400, 'thiếu');
        assert.equal((await create({ name: 'Vốn cao hơn bán', costPrice: 200001 })).status, 400);
        assert.equal((await create({ name: 'Vốn quá nhỏ', costPrice: 500 })).status, 400);
        assert.equal((await create({ name: 'Vốn lẻ', costPrice: 1000.5 })).status, 400);
        assert.equal((await create({ name: 'Vốn bằng giá bán', costPrice: 200000 })).status, 201, 'bằng giá bán thì được');
        const ok = await create({ name: 'Vốn hợp lệ' });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        assert.equal(ctx.db.products.find((item) => item.id === ok.body.id).costPrice, 120000);
    });

    test('sửa sản phẩm cũng kiểm tra giá vốn; đổi giá bán xuống dưới giá vốn thì từ chối', async () => {
        const made = (await create({ name: 'Sửa giá vốn' })).body;
        const edit = (patch) =>
            call(ctx, 'PUT', `/admin/products/${made.id}`, { token: admin, body: product({ name: 'Sửa giá vốn', ...patch }) });
        assert.equal((await edit({ price: 100000 })).status, 400, 'giá bán thấp hơn giá vốn 120.000');
        assert.equal((await edit({ costPrice: 150000 })).status, 200);
        assert.equal(ctx.db.products.find((item) => item.id === made.id).costPrice, 150000);
    });

    test('giá vốn là số nội bộ: khách không thấy ở danh sách, trang sản phẩm, đơn hàng; người quản lý thấy khi xem ?all=1', async () => {
        const made = (await create({ name: 'Giá vốn kín' })).body;
        assert.equal(made.costPrice, 120000, 'người tạo (admin) nhận lại giá vốn');
        const guestList = (await call(ctx, 'GET', '/products')).body;
        assert.ok(
            guestList.every((item) => !('costPrice' in item) && !('costEstimated' in item)),
            'danh sách công khai'
        );
        assert.ok(!('costPrice' in (await call(ctx, 'GET', `/products/${made.id}`)).body), 'trang chi tiết');
        assert.ok(
            !('costPrice' in (await call(ctx, 'GET', '/products?all=1')).body.find((item) => item.id === made.id)),
            'khách thêm ?all=1'
        );
        const staff = (await call(ctx, 'GET', '/products?all=1', { token: admin })).body.find((item) => item.id === made.id);
        assert.equal(staff.costPrice, 120000);
        // nhân viên (chỉ xem sản phẩm) thấy sản phẩm ẩn nhưng không thấy giá vốn
        const { token: staffToken } = await staffAccount();
        const seen = (await call(ctx, 'GET', '/products?all=1', { token: staffToken })).body.find((item) => item.id === made.id);
        assert.ok(seen && !('costPrice' in seen), 'nhân viên không thấy giá vốn');

        const { token } = await newCustomer(ctx);
        const order = await placeOrder(ctx, token, await addAddress(ctx, token), [[made.id, 1]]);
        assert.equal(order.status, 201);
        assert.ok(
            order.body.items.every((item) => !('cost' in item)),
            'đơn trả về cho khách'
        );
        const mine = (await call(ctx, 'GET', '/orders', { token })).body;
        assert.ok(
            mine.every((entry) => entry.items.every((item) => !('cost' in item))),
            'danh sách đơn'
        );
        assert.equal(ctx.db.orders.find((entry) => entry.id === order.body.id).items[0].cost, 120000, 'nhưng được lưu trong dữ liệu');
    });

    test('sản phẩm cũ chưa có giá vốn được gán giá ước tính (70% giá bán) và đánh dấu; lưu lại thì hết đánh dấu', async () => {
        const old = ctx.db.products.find((item) => item.id === '2'); // dữ liệu mẫu của bộ test không có giá vốn
        assert.equal(old.costPrice, 126000, '70% của 180.000');
        assert.equal(old.costEstimated, true);
        const edit = await call(ctx, 'PUT', `/admin/products/${old.id}`, {
            token: admin,
            body: product({ name: old.name, price: old.price, costPrice: 100000, stock: old.stock, categoryId: old.categoryId })
        });
        assert.equal(edit.status, 200, JSON.stringify(edit.body));
        assert.equal(old.costPrice, 100000);
        assert.equal('costEstimated' in old, false);
    });
});

describe('Nhập hàng: giá nhập của lô và giá vốn bình quân', () => {
    test('giá vốn mới = bình quân gia quyền của hàng đang tồn và lô mới; không nhập giá thì giữ nguyên', async () => {
        const made = (await create({ name: 'Cây nhập hàng', stock: 10, costPrice: 100000 })).body;
        const stock = (body) => call(ctx, 'PATCH', `/admin/products/${made.id}/stock`, { token: admin, body });
        const cost = () => ctx.db.products.find((item) => item.id === made.id).costPrice;

        assert.equal((await stock({ add: 5 })).status, 200);
        assert.equal(cost(), 100000, 'không ghi giá nhập thì giá vốn không đổi');

        const second = await stock({ add: 15, unitCost: 140000 });
        assert.equal(second.status, 200, JSON.stringify(second.body));
        // tồn 15 × 100.000 + lô 15 × 140.000 = 3.600.000 / 30 = 120.000
        assert.equal(cost(), 120000);
        assert.equal(second.body.costPrice, 120000);
        const log = ctx.db.stockLogs.filter((entry) => entry.productId === made.id).at(-1);
        assert.equal(log.unitCost, 140000, 'nhật ký kho ghi giá nhập của lô');

        assert.equal((await stock({ add: 1, unitCost: 500 })).status, 400, 'giá nhập quá nhỏ');
        assert.equal((await stock({ add: 1, unitCost: 'abc' })).status, 400, 'không phải số');
        assert.equal(cost(), 120000, 'lô bị từ chối không đổi giá vốn');
    });

    test('hết hàng rồi nhập lại thì giá vốn bằng đúng giá nhập của lô mới', async () => {
        const made = (await create({ name: 'Cây hết hàng', stock: 0, costPrice: 100000 })).body;
        const result = await call(ctx, 'PATCH', `/admin/products/${made.id}/stock`, { token: admin, body: { add: 8, unitCost: 90000 } });
        assert.equal(result.status, 200);
        assert.equal(ctx.db.products.find((item) => item.id === made.id).costPrice, 90000);
    });
});

describe('Doanh thu = tiền bán - giá vốn', () => {
    test('đơn đã giao: doanh thu trừ giá vốn, không tính phí ship; hủy đơn hoặc đơn chưa giao thì không tính', async () => {
        const made = (await create({ name: 'Cây tính doanh thu', price: 200000, costPrice: 120000, stock: 20 })).body;
        const before = await summary();
        const { token } = await newCustomer(ctx);
        const address = await addAddress(ctx, token);

        const open = (await placeOrder(ctx, token, address, [[made.id, 2]])).body;
        assert.equal((await summary()).revenue, before.revenue, 'đơn chưa giao chưa tính');

        await deliver(open);
        const after = await summary();
        // 2 × 200.000 bán, 2 × 120.000 vốn, phí ship (nếu có) không tính
        assert.equal(after.sales - before.sales, 400000 - open.discount);
        assert.equal(after.cost - before.cost, 240000);
        assert.equal(after.revenue - before.revenue, 400000 - open.discount - 240000);
        assert.ok(open.shippingFee > 0 || open.total === open.subtotal - open.discount, 'đơn có phí ship hoặc được miễn');
    });

    test('giá vốn chụp lúc đặt: sau đó đổi giá vốn thì đơn cũ vẫn tính theo giá vốn lúc đặt', async () => {
        const made = (await create({ name: 'Cây đổi giá vốn', price: 200000, costPrice: 100000, stock: 20 })).body;
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [[made.id, 1]])).body;
        // admin nhập lô mới giá cao hơn làm giá vốn tăng, trước khi đơn được giao
        await call(ctx, 'PATCH', `/admin/products/${made.id}/stock`, { token: admin, body: { add: 10, unitCost: 190000 } });
        assert.ok(ctx.db.products.find((item) => item.id === made.id).costPrice > 100000);

        const before = await summary();
        await deliver(order);
        const after = await summary();
        assert.equal(after.cost - before.cost, 100000, 'giá vốn lúc khách đặt');
    });

    test('đơn cũ chưa có giá vốn trong dòng hàng thì lấy giá vốn hiện tại của sản phẩm', async () => {
        const made = (await create({ name: 'Cây đơn cũ', price: 200000, costPrice: 110000, stock: 20 })).body;
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [[made.id, 1]])).body;
        delete ctx.db.orders.find((entry) => entry.id === order.id).items[0].cost;
        const before = await summary();
        await deliver(order);
        assert.equal((await summary()).cost - before.cost, 110000);
    });

    test('doanh thu từng sản phẩm, theo danh mục và sản phẩm bán chạy đều tính theo tiền bán - giá vốn', async () => {
        const made = (await create({ name: 'Cây xếp hạng', price: 200000, costPrice: 150000, stock: 20 })).body;
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [[made.id, 3]])).body;
        await deliver(order);

        const row = (await call(ctx, 'GET', '/admin/product-sales', { token: admin })).body.find((item) => item.id === made.id);
        assert.deepEqual([row.delivered, row.sales, row.cost, row.revenue], [3, 600000, 450000, 150000]);
        assert.equal(row.months.at(-1).revenue, 150000, 'cột tháng cũng là tiền bán - giá vốn');
        assert.equal(row.average, 50000, 'trung bình mỗi sản phẩm');

        const stats = (await call(ctx, 'GET', '/admin/stats?period=year', { token: admin })).body;
        const top = stats.topProducts.find((item) => item.id === made.id);
        assert.deepEqual([top.qty, top.sales, top.revenue], [3, 600000, 150000]);
    });

    test('đối soát dữ liệu vẫn so tổng tiền đơn với tiền khách trả (có phí ship), không bị lệch vì giá vốn', async () => {
        const inventory = (await call(ctx, 'GET', '/admin/inventory', { token: admin })).body;
        assert.ok(
            !JSON.stringify(inventory.issues ?? inventory).includes('không khớp chi tiết đơn'),
            JSON.stringify(inventory.issues ?? [])
        );
    });
});

describe('Nhập Excel có cột Giá vốn', () => {
    const row = (patch = {}) => ({
        name: 'Cây từ file giá vốn',
        category: 'Cây để bàn',
        price: 150000,
        costPrice: 90000,
        oldPrice: '',
        stock: 5,
        image: 'p1.png',
        description: 'Mô tả cây nhập từ file',
        ...patch
    });
    const send = (rows) => call(ctx, 'POST', '/admin/products/import', { token: admin, body: { rows } });

    test('dòng mới phải có giá vốn hợp lệ; dòng có ID mà không ghi giá vốn thì giữ giá vốn đang có', async () => {
        const bad = await send([row({ name: 'Thiếu vốn', costPrice: '' }), row({ name: 'Vốn quá cao', costPrice: 999999 })]);
        assert.equal(bad.status, 400);
        assert.deepEqual(
            bad.body.errors.map((entry) => entry.line),
            [2, 3]
        );

        assert.deepEqual((await send([row()])).body, { created: 1, updated: 0 });
        const made = ctx.db.products.find((item) => item.name === 'Cây từ file giá vốn');
        assert.equal(made.costPrice, 90000);

        const keep = await send([row({ id: made.id, price: 160000, costPrice: '' })]);
        assert.deepEqual(keep.body, { created: 0, updated: 1 }, JSON.stringify(keep.body));
        assert.equal(made.costPrice, 90000, 'để trống thì giữ nguyên');
        assert.equal((await send([row({ id: made.id, costPrice: 95000 })])).status, 200);
        assert.equal(made.costPrice, 95000);
    });
});
