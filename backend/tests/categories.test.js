// Danh mục sản phẩm: admin thêm, xóa. Xóa danh mục thì sản phẩm của nó chuyển sang "chưa có danh mục", không bị xóa.
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

const categories = async () => (await call(ctx, 'GET', '/categories')).body;
const productList = async () => (await call(ctx, 'GET', '/products')).body;
const add = (name, token = admin) => call(ctx, 'POST', '/admin/categories', { token, body: { name } });
const remove = (id, token = admin) => call(ctx, 'DELETE', `/admin/categories/${id}`, { token });
const product = (patch = {}) => ({
    name: 'Cây thử danh mục',
    categoryId: 1,
    price: 120000,
    costPrice: 70000,
    stock: 5,
    image: 'p1.png',
    description: 'Cây dùng để thử danh mục',
    ...patch
});
const voucher = (code, scopeIds) => ({
    code,
    name: `Voucher ${code}`,
    kind: 'order',
    type: 'percent',
    value: 10,
    maxDiscount: 50000,
    minOrder: 0,
    scope: 'category',
    scopeIds,
    startAt: new Date(Date.now() - 1000).toISOString(),
    endAt: new Date(Date.now() + 86400000).toISOString()
});

describe('Thêm danh mục', () => {
    test('tên 2–40 ký tự, không trùng (không phân biệt hoa thường) và thấy ngay ở danh sách công khai', async () => {
        assert.equal((await add('a')).status, 400, 'quá ngắn');
        assert.equal((await add('   ')).status, 400, 'để trống');
        assert.equal((await add('x'.repeat(41))).status, 400, 'quá dài');
        assert.equal((await add('cây để BÀN')).status, 409, 'trùng tên có sẵn');

        const created = await add('  Cây thủy sinh ');
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.name, 'Cây thủy sinh');
        assert.equal(created.body.id, '6', 'mã tiếp theo sau danh mục cuối');
        assert.deepEqual(created.body.specFields, []);
        assert.ok((await categories()).some((item) => item.id === '6' && item.name === 'Cây thủy sinh'));
        assert.equal((await add('CÂY THỦY SINH')).status, 409, 'trùng với danh mục vừa thêm');
    });

    test('đặt sản phẩm vào danh mục mới được', async () => {
        const created = await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ categoryId: 6 }) });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.categoryId, 6);
    });

    test('giới hạn số danh mục', async () => {
        for (let i = ctx.db.categories.length; i < 30; i += 1) assert.equal((await add(`Danh mục số ${i}`)).status, 201);
        assert.equal((await add('Danh mục thứ 31')).status, 409);
        for (const item of (await categories()).filter((entry) => entry.name.startsWith('Danh mục số'))) await remove(item.id);
    });
});

describe('Xóa danh mục', () => {
    test('sản phẩm của danh mục chuyển sang chưa có danh mục, không mất sản phẩm nào, danh mục khác giữ nguyên', async () => {
        const before = await productList();
        const inCategory = before.filter((item) => String(item.categoryId) === '4');
        assert.ok(inCategory.length >= 3, 'dữ liệu mẫu có sản phẩm trong danh mục 4');

        const removed = await remove(4);
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        assert.equal(removed.body.moved, inCategory.length);

        const after = await productList();
        assert.equal(after.length, before.length, 'không mất sản phẩm nào');
        for (const item of inCategory) assert.equal(after.find((entry) => entry.id === item.id).categoryId, null, item.name);
        for (const item of before.filter((entry) => String(entry.categoryId) !== '4'))
            assert.equal(after.find((entry) => entry.id === item.id).categoryId, item.categoryId, 'sản phẩm danh mục khác không đổi');
        assert.ok(!(await categories()).some((item) => item.id === '4'));
        assert.equal((await categories()).length, 5, '5 danh mục ban đầu + 1 mới thêm - 1 vừa xóa');
        assert.equal((await call(ctx, 'GET', `/products/${inCategory[0].id}`)).status, 200, 'trang chi tiết vẫn mở được');
    });

    test('danh mục không có thật thì 404; xóa hai lần thì lần hai 404', async () => {
        assert.equal((await remove('khong-co')).status, 404);
        assert.equal((await remove(4)).status, 404);
    });

    test('mã danh mục đã xóa không được dùng lại cho danh mục mới', async () => {
        const created = await add('Danh mục thay thế');
        assert.equal(created.status, 201);
        assert.ok(Number(created.body.id) > 6, `mã ${created.body.id}`);
        assert.ok(!(await productList()).some((item) => String(item.categoryId) === created.body.id), 'không có sản phẩm nào bị gán nhầm');
    });
});

describe('Sản phẩm chưa có danh mục', () => {
    test('tạo mới, sửa giữ nguyên chưa có danh mục, rồi gán lại danh mục có thật', async () => {
        const created = await call(ctx, 'POST', '/admin/products', {
            token: admin,
            body: product({ name: 'Cây chưa phân loại', categoryId: null })
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.categoryId, null);
        const id = created.body.id;

        const edit = (categoryId) =>
            call(ctx, 'PUT', `/admin/products/${id}`, { token: admin, body: product({ name: 'Cây chưa phân loại', categoryId }) });
        assert.equal((await edit(null)).body.categoryId, null);
        assert.equal((await edit(4)).status, 400, 'không gán vào danh mục đã xóa');
        assert.equal((await edit(2)).body.categoryId, 2);
    });

    test('nhập Excel: để trống hoặc ghi "Chưa có danh mục" thì không thuộc danh mục nào, tên danh mục sai vẫn báo lỗi', async () => {
        const row = (patch) => ({
            name: 'Cây từ file',
            category: '',
            price: 150000,
            costPrice: 90000,
            oldPrice: '',
            stock: 5,
            image: 'p1.png',
            description: 'Mô tả cây nhập từ file',
            ...patch
        });
        const send = (rows) => call(ctx, 'POST', '/admin/products/import', { token: admin, body: { rows } });
        const ok = await send([row({ name: 'Cây file trống' }), row({ name: 'Cây file ghi rõ', category: 'Chưa có danh mục' })]);
        assert.deepEqual(ok.body, { created: 2, updated: 0 }, JSON.stringify(ok.body));
        for (const name of ['Cây file trống', 'Cây file ghi rõ'])
            assert.equal(ctx.db.products.find((item) => item.name === name).categoryId, null, name);
        assert.equal((await send([row({ name: 'Cây sai danh mục', category: 'Không có danh mục này' })])).status, 400);
    });

    test('thống kê, kho, nhu cầu và chatbot vẫn chạy khi có sản phẩm chưa có danh mục', async () => {
        for (const path of ['/admin/stats', '/admin/inventory', '/admin/demand', '/admin/product-sales'])
            assert.equal((await call(ctx, 'GET', path, { token: admin })).status, 200, path);
        const chat = await call(ctx, 'POST', '/chat', { body: { message: 'Cửa hàng có những loại cây nào?', visitor: 'abcdefgh12345' } });
        assert.equal(chat.status, 200, JSON.stringify(chat.body));
    });
});

describe('Voucher theo danh mục khi xóa danh mục', () => {
    test('bỏ danh mục đã xóa khỏi phạm vi; hết danh mục nào thì tắt voucher', async () => {
        const [first, second] = await Promise.all(['Cây thử voucher A', 'Cây thử voucher B'].map((name) => add(name)));
        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        const both = await call(ctx, 'POST', '/admin/vouchers', {
            token: admin,
            body: voucher('HAIDANHMUC', [first.body.id, second.body.id])
        });
        const only = await call(ctx, 'POST', '/admin/vouchers', { token: admin, body: voucher('MOTDANHMUC', [first.body.id]) });
        assert.equal(both.status, 201, JSON.stringify(both.body));
        assert.equal(only.status, 201, JSON.stringify(only.body));

        const removed = await remove(first.body.id);
        assert.equal(removed.status, 200);
        assert.equal(removed.body.vouchersUpdated, 2);
        assert.equal(removed.body.vouchersDisabled, 1);

        const find = (code) => ctx.db.vouchers.find((item) => item.code === code);
        assert.deepEqual(find('HAIDANHMUC').scopeIds, [second.body.id]);
        assert.equal(find('HAIDANHMUC').active, true, 'còn danh mục khác thì voucher vẫn chạy');
        assert.deepEqual(find('MOTDANHMUC').scopeIds, []);
        assert.equal(find('MOTDANHMUC').active, false, 'hết danh mục thì tắt, không áp dụng nhầm cho cả đơn');
    });
});

describe('Xóa danh mục kèm ẩn sản phẩm đã chọn', () => {
    let categoryId;
    let pick; // sản phẩm bị ẩn, có người đã mua
    let alsoHide; // sản phẩm bị ẩn, chưa ai mua
    let keep; // sản phẩm không chọn: chuyển sang chưa có danh mục, vẫn bán
    let buyer;
    before(async () => {
        categoryId = (await add('Danh mục thử ẩn')).body.id;
        const create = async (name) =>
            (await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ name, categoryId: Number(categoryId) }) })).body;
        [pick, alsoHide, keep] = [await create('Cây ẩn số một'), await create('Cây ẩn số hai'), await create('Cây giữ lại')];
        buyer = await newCustomer(ctx);
        const order = await placeOrder(ctx, buyer.token, await addAddress(ctx, buyer.token), [[pick.id, 1]]);
        assert.equal(order.status, 201, JSON.stringify(order.body));
    });

    test('chọn sản phẩm nào thì ẩn sản phẩm đó, phần còn lại chuyển sang chưa có danh mục và vẫn bán', async () => {
        const removed = await call(ctx, 'DELETE', `/admin/categories/${categoryId}`, {
            token: admin,
            body: { hideProductIds: [pick.id, alsoHide.id] }
        });
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        assert.equal(removed.body.hidden, 2);
        assert.equal(removed.body.moved, 3);

        const guest = (await productList()).map((item) => item.id);
        assert.ok(!guest.includes(pick.id) && !guest.includes(alsoHide.id), 'khách không thấy sản phẩm đã ẩn');
        assert.ok(guest.includes(keep.id), 'sản phẩm không chọn vẫn hiện');
        assert.equal((await call(ctx, 'GET', `/products/${keep.id}`)).body.categoryId, null);
        assert.ok(
            ctx.db.products.some((item) => item.id === pick.id && item.hidden === true),
            'dữ liệu vẫn còn, chỉ đánh dấu ẩn'
        );
    });

    test('sản phẩm ẩn: khách mở trang và mua đều bị từ chối, trang chủ không còn; admin vẫn thấy, người đã mua vẫn xem lại được', async () => {
        assert.equal((await call(ctx, 'GET', `/products/${alsoHide.id}`)).status, 404);
        assert.equal((await call(ctx, 'GET', `/products/${alsoHide.id}/reviews`)).status, 404);
        const other = await newCustomer(ctx);
        assert.equal((await call(ctx, 'GET', `/products/${pick.id}`, { token: other.token })).status, 404, 'khách chưa mua');
        assert.equal((await call(ctx, 'GET', `/products/${pick.id}`, { token: buyer.token })).status, 200, 'khách đã mua xem lại đơn');
        assert.equal((await call(ctx, 'GET', `/products/${alsoHide.id}`, { token: admin })).status, 200, 'admin');

        const all = await call(ctx, 'GET', '/products?all=1', { token: admin });
        assert.equal(all.body.find((item) => item.id === alsoHide.id)?.hidden, true, 'admin thấy cả sản phẩm ẩn');
        assert.ok(
            !(await call(ctx, 'GET', '/products?all=1')).body.some((item) => item.id === alsoHide.id),
            'khách thêm ?all=1 cũng không thấy'
        );
        assert.ok(
            !(await call(ctx, 'GET', '/products/new?limit=50')).body.some((item) => item.id === alsoHide.id),
            'không có ở sản phẩm mới'
        );

        const address = await addAddress(ctx, other.token);
        assert.equal((await placeOrder(ctx, other.token, address, [[alsoHide.id, 1]])).status, 400, 'không đặt mua được');
        const cart = await call(ctx, 'PUT', '/cart', { token: other.token, body: { items: [{ id: alsoHide.id, qty: 1 }] } });
        assert.deepEqual(cart.body.items ?? [], [], 'giỏ hàng tự bỏ sản phẩm ẩn');
        assert.equal((await call(ctx, 'PUT', `/favorites/${alsoHide.id}`, { token: other.token })).status, 404);
    });

    test('chatbot không nhắc tới sản phẩm ẩn', async () => {
        const chat = await call(ctx, 'POST', '/chat', { body: { message: 'Cây ẩn số hai giá bao nhiêu?', visitor: 'abcdefgh12345' } });
        assert.equal(chat.status, 200);
        assert.ok(!JSON.stringify(chat.body).includes(alsoHide.id), 'không có đường dẫn tới sản phẩm ẩn');
    });

    test('ẩn hoặc hiện lại từng sản phẩm; chỉ chủ và admin; đơn cũ không bị ảnh hưởng', async () => {
        const toggle = (hidden, token = admin, id = alsoHide.id) =>
            call(ctx, 'PATCH', `/admin/products/${id}/visibility`, { token, body: { hidden } });
        assert.equal((await toggle(false, null)).status, 401);
        assert.equal((await toggle(false, buyer.token)).status, 403);
        assert.equal((await toggle('có', admin)).status, 400);
        assert.equal((await toggle(false, admin, 'khong-co')).status, 404);

        assert.deepEqual((await toggle(false)).body, { id: alsoHide.id, hidden: false });
        assert.ok(
            (await productList()).some((item) => item.id === alsoHide.id),
            'hiện lại thì khách thấy'
        );
        assert.equal((await toggle(true)).body.hidden, true);
        assert.ok(!(await productList()).some((item) => item.id === alsoHide.id));
        assert.ok(
            (await call(ctx, 'GET', '/orders', { token: buyer.token })).body.some((order) =>
                order.items.some((item) => item.id === pick.id)
            ),
            'đơn cũ vẫn còn'
        );
    });

    test('hideProductIds chứa sản phẩm không thuộc danh mục thì từ chối và không đổi gì', async () => {
        const other = (await add('Danh mục thử ẩn hai')).body.id;
        const stranger = (
            await call(ctx, 'POST', '/admin/products', {
                token: admin,
                body: product({ name: 'Cây ở nơi khác', categoryId: Number(other) })
            })
        ).body;
        const bad = await call(ctx, 'DELETE', `/admin/categories/${other}`, { token: admin, body: { hideProductIds: [keep.id] } });
        assert.equal(bad.status, 400);
        assert.ok(
            (await categories()).some((item) => item.id === other),
            'danh mục vẫn còn'
        );
        assert.ok(
            (await productList()).some((item) => item.id === stranger.id),
            'sản phẩm vẫn hiện'
        );
    });
});
