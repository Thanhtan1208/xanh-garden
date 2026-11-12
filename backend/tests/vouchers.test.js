// Nghiệp vụ voucher: kho voucher, nhận voucher, điều kiện áp dụng, 1 voucher giảm giá + 1 voucher ship mỗi đơn,
// voucher người dùng mới / sinh nhật tự cấp, trả voucher khi hủy đơn, quy tắc quản trị voucher.
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

const voucherByCode = (code) => ctx.db.vouchers.find((voucher) => voucher.code === code);
async function claim(token, code) {
    const result = await call(ctx, 'POST', '/vouchers/claim', { token, body: { code } });
    assert.equal(result.status, 201, `nhận ${code}: ${JSON.stringify(result.body)}`);
    return result.body.id;
}
const quote = (token, items, voucherIds, shippingMethod = 'standard') =>
    call(ctx, 'POST', '/orders/quote', { token, body: { items: items.map(([id, qty]) => ({ id, qty })), shippingMethod, voucherIds } });

describe('Kho voucher và nhận voucher', () => {
    test('kho chỉ có voucher công khai đang chạy (không có voucher người dùng mới/sinh nhật)', async () => {
        const list = await call(ctx, 'GET', '/vouchers');
        const codes = list.body.map((voucher) => voucher.code).sort();
        assert.deepEqual(codes, ['FREESHIP30', 'SALE10', 'SALE15', 'SALE25', 'SALE35']);
        assert.equal(list.body[0].claimedCount, undefined, 'không lộ số liệu nội bộ');
    });

    test('nhận bằng mã; nhận lần 2 bị chặn; voucher tự tặng không nhận bằng mã được', async () => {
        const { token } = await newCustomer(ctx);
        await claim(token, 'sale10');
        assert.equal((await call(ctx, 'POST', '/vouchers/claim', { token, body: { code: 'SALE10' } })).status, 409);
        assert.equal((await call(ctx, 'POST', '/vouchers/claim', { token, body: { code: 'SINHNHAT25' } })).status, 403);
        assert.equal((await call(ctx, 'POST', '/vouchers/claim', { token, body: { code: 'KHONGCO' } })).status, 404);
        assert.equal((await call(ctx, 'POST', '/vouchers/claim', { body: { code: 'SALE10' } })).status, 401);
        const list = await call(ctx, 'GET', '/vouchers', { token });
        assert.equal(list.body.find((voucher) => voucher.code === 'SALE10').claimed, true);
    });

    test('hết số lượng thì không nhận được và biến khỏi kho', async () => {
        const created = await call(ctx, 'POST', '/admin/vouchers', {
            token: admin,
            body: {
                code: 'CHI1SUAT',
                name: 'Chỉ 1 suất',
                kind: 'order',
                type: 'fixed',
                value: 10000,
                minOrder: 0,
                startAt: new Date(Date.now() - 1000).toISOString(),
                endAt: new Date(Date.now() + 86400000).toISOString(),
                totalQuantity: 1
            }
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const a = await newCustomer(ctx);
        const b = await newCustomer(ctx);
        await claim(a.token, 'CHI1SUAT');
        assert.equal((await call(ctx, 'POST', '/vouchers/claim', { token: b.token, body: { code: 'CHI1SUAT' } })).status, 409);
        assert.ok(!(await call(ctx, 'GET', '/vouchers')).body.some((voucher) => voucher.code === 'CHI1SUAT'));
    });
});

describe('Áp dụng voucher khi thanh toán', () => {
    test('giảm theo %, có mức tối đa; chưa đủ đơn tối thiểu thì nêu lý do', async () => {
        const { token } = await newCustomer(ctx);
        const sale10 = await claim(token, 'SALE10'); // 10%, tối đa 30k, đơn từ 150k
        const ok = await quote(token, [['1', 2]], [sale10]);
        assert.equal(ok.body.discount, 24000);
        assert.equal(ok.body.total, 240000 - 24000 + 30000);
        const capped = await quote(token, [['5', 2]], [sale10]);
        assert.equal(capped.body.discount, 30000, 'không vượt mức giảm tối đa');
        const tooSmall = await quote(token, [['7', 1]], [sale10]);
        assert.equal(tooSmall.body.discount, 0);
        assert.match(tooSmall.body.problems[0].reason, /150\.000/);
    });

    test('mỗi đơn 1 voucher giảm giá + 1 voucher ship; voucher ship không dùng khi đã freeship', async () => {
        const { token } = await newCustomer(ctx);
        const sale10 = await claim(token, 'SALE10');
        const sale15 = await claim(token, 'SALE15');
        const ship = await claim(token, 'FREESHIP30');
        const both = await quote(token, [['3', 1]], [sale10, ship]);
        assert.equal(both.body.applied.length, 2);
        assert.equal(both.body.shippingDiscount, 30000);
        assert.equal(both.body.total, 250000 - 25000 + 30000 - 30000);
        const twoOrderVouchers = await quote(token, [['3', 2]], [sale10, sale15]);
        assert.equal(twoOrderVouchers.body.applied.length, 1);
        assert.match(twoOrderVouchers.body.problems[0].reason, /1 voucher giảm giá/);
        const freeShip = await quote(token, [['3', 2]], [ship]);
        assert.match(freeShip.body.problems[0].reason, /miễn phí vận chuyển/);
        assert.ok(
            freeShip.body.wallet.some((row) => row.id === ship && !row.usable),
            'ví báo không dùng được và lý do'
        );
    });

    test('không dùng được voucher của người khác', async () => {
        const a = await newCustomer(ctx);
        const b = await newCustomer(ctx);
        const entry = await claim(a.token, 'SALE15');
        const result = await quote(b.token, [['5', 1]], [entry]);
        assert.equal(result.body.discount, 0);
        assert.equal(result.body.problems.length, 1);
        const order = await placeOrder(ctx, b.token, await addAddress(ctx, b.token), [['5', 1]], { voucherIds: [entry] });
        assert.equal(order.status, 409, 'đặt hàng với voucher không hợp lệ bị từ chối');
    });

    test('đặt hàng đánh dấu voucher đã dùng; hủy đơn thì voucher trở lại ví', async () => {
        const { token } = await newCustomer(ctx);
        const entry = await claim(token, 'SALE25'); // 25%, tối đa 80k, đơn từ 500k
        const usedBefore = voucherByCode('SALE25').usedCount;
        const order = await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 2]], { voucherIds: [entry] });
        assert.equal(order.status, 201, JSON.stringify(order.body));
        assert.equal(order.body.discount, 80000);
        assert.equal(order.body.vouchers[0].code, 'SALE25');
        assert.equal(voucherByCode('SALE25').usedCount, usedBefore + 1);
        let wallet = (await call(ctx, 'GET', '/vouchers/mine', { token })).body.vouchers;
        assert.equal(wallet.find((row) => row.id === entry).status, 'used');
        const reuse = await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 3]], { voucherIds: [entry] });
        assert.equal(reuse.status, 409, 'voucher đã dùng không dùng lại được');

        await call(ctx, 'PATCH', `/orders/${order.body.id}/status`, { token, body: { status: 'cancelled', reasonId: 'change_mind' } });
        wallet = (await call(ctx, 'GET', '/vouchers/mine', { token })).body.vouchers;
        assert.equal(wallet.find((row) => row.id === entry).status, 'available');
        assert.equal(voucherByCode('SALE25').usedCount, usedBefore);
    });

    test('voucher theo danh mục: chỉ tính phần hàng thuộc danh mục', async () => {
        const created = await call(ctx, 'POST', '/admin/vouchers', {
            token: admin,
            body: {
                code: 'SENDA20',
                name: 'Sen đá giảm 20%',
                kind: 'order',
                type: 'percent',
                value: 20,
                maxDiscount: 100000,
                minOrder: 50000,
                scope: 'category',
                scopeIds: ['4'],
                startAt: new Date(Date.now() - 1000).toISOString(),
                endAt: new Date(Date.now() + 86400000).toISOString()
            }
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const { token } = await newCustomer(ctx);
        const entry = await claim(token, 'SENDA20');
        const mixed = await quote(
            token,
            [
                ['9', 1],
                ['5', 1]
            ],
            [entry]
        ); // 60k sen đá + 450k phong thủy
        assert.equal(mixed.body.discount, 12000);
        const none = await quote(token, [['5', 1]], [entry]);
        assert.match(none.body.problems[0].reason, /Không có sản phẩm/);
    });

    test('admin tắt voucher thì voucher trong ví không dùng được nữa', async () => {
        const { token } = await newCustomer(ctx);
        const entry = await claim(token, 'SALE35');
        const voucher = voucherByCode('SALE35');
        await call(ctx, 'PUT', `/admin/vouchers/${voucher.id}`, { token: admin, body: { active: false } });
        const result = await quote(token, [['5', 2]], [entry]);
        assert.match(result.body.problems[0].reason, /ngừng áp dụng/);
        await call(ctx, 'PUT', `/admin/vouchers/${voucher.id}`, { token: admin, body: { active: true } });
    });
});

describe('Voucher tự tặng', () => {
    test('người dùng mới: chỉ dùng cho đơn đầu tiên; đã từng đặt đơn (kể cả đơn đã hủy) thì không dùng được nữa', async () => {
        const { token } = await newCustomer(ctx);
        const wallet = (await call(ctx, 'GET', '/vouchers/mine', { token })).body.vouchers;
        const welcome = wallet.find((row) => row.voucher.code === 'WELCOME15');
        assert.equal(welcome.source, 'newUser');
        assert.ok(Date.parse(welcome.expiresAt) - Date.now() <= 30 * 86400000 + 1000, 'hạn dùng 30 ngày kể từ lúc tặng');

        const addressId = await addAddress(ctx, token);
        const first = await placeOrder(ctx, token, addressId, [['1', 1]]); // không dùng voucher
        const second = await quote(token, [['3', 1]], [welcome.id]);
        assert.match(second.body.problems[0].reason, /đơn hàng đầu tiên/);
        // Quy tắc hiện tại (NHAT_KY_DU_AN.md): "chưa từng đặt đơn" là không có đơn nào, kể cả đơn đã hủy
        const cancel = await call(ctx, 'PATCH', `/orders/${first.body.id}/status`, {
            token,
            body: { status: 'cancelled', reasonId: 'change_mind' }
        });
        assert.equal(cancel.status, 200, 'khách tự hủy được đơn chưa xác nhận');
        const again = await quote(token, [['3', 1]], [welcome.id]);
        assert.match(again.body.problems[0].reason, /đơn hàng đầu tiên/);
    });

    test('khai ngày sinh trùng hôm nay thì nhận quà ngay; chỉ khai được một lần', async () => {
        const { token } = await newCustomer(ctx);
        const vn = new Date(Date.now() + 7 * 3600000);
        const birthday = `${vn.getUTCFullYear() - 25}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
        const set = await call(ctx, 'PUT', '/vouchers/birthday', { token, body: { birthday } });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        const wallet = (await call(ctx, 'GET', '/vouchers/mine', { token })).body;
        assert.equal(wallet.birthday, birthday);
        assert.ok(wallet.vouchers.some((row) => row.voucher.code === 'SINHNHAT25' && row.source === 'birthday'));
        assert.equal((await call(ctx, 'PUT', '/vouchers/birthday', { token, body: { birthday: '2000-01-01' } })).status, 409);
        await call(ctx, 'GET', '/vouchers/mine', { token });
        const count = ctx.db.userVouchers.filter(
            (entry) => entry.code === 'SINHNHAT25' && entry.userId === ctx.db.user.find((user) => user.birthday === birthday).id
        ).length;
        assert.equal(count, 1, 'mỗi năm chỉ tặng 1 lần');
    });
});

describe('Quản trị voucher', () => {
    const base = () => ({
        code: 'TESTQT',
        name: 'Thử quản trị',
        kind: 'order',
        type: 'percent',
        value: 10,
        maxDiscount: 20000,
        startAt: new Date(Date.now() - 1000).toISOString(),
        endAt: new Date(Date.now() + 86400000).toISOString()
    });

    test('kiểm tra dữ liệu khi tạo', async () => {
        const create = (patch) => call(ctx, 'POST', '/admin/vouchers', { token: admin, body: { ...base(), ...patch } });
        assert.equal((await create({ maxDiscount: undefined })).status, 400, 'giảm % phải có mức tối đa');
        assert.equal((await create({ value: 80 })).status, 400, 'tối đa 70%');
        assert.equal((await create({ code: 'ab' })).status, 400, 'mã 4-20 ký tự');
        assert.equal((await create({ endAt: new Date(Date.now() - 5000).toISOString() })).status, 400, 'kết thúc sau bắt đầu');
        assert.equal((await create({ kind: 'shipping', scope: 'category', scopeIds: ['1'] })).status, 400, 'voucher ship áp dụng cả đơn');
        assert.equal((await create({ scope: 'product', scopeIds: ['999'] })).status, 400, 'phạm vi không tồn tại');
        assert.equal((await create({ code: 'SALE10' })).status, 409, 'trùng mã');
        assert.equal((await create({})).status, 201);
    });

    test('voucher đã có người nhận: không đổi điều kiện, không xóa; vẫn đổi tên/hạn/bật tắt được', async () => {
        const voucher = voucherByCode('SALE10');
        assert.ok(voucher.claimedCount > 0);
        assert.equal((await call(ctx, 'PUT', `/admin/vouchers/${voucher.id}`, { token: admin, body: { value: 50 } })).status, 409);
        assert.equal(
            (await call(ctx, 'PUT', `/admin/vouchers/${voucher.id}`, { token: admin, body: { totalQuantity: 1 } })).status,
            409,
            'không thấp hơn số đã nhận'
        );
        const renamed = await call(ctx, 'PUT', `/admin/vouchers/${voucher.id}`, { token: admin, body: { name: 'Giảm 10% (đổi tên)' } });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.body.value, 10);
        assert.equal((await call(ctx, 'DELETE', `/admin/vouchers/${voucher.id}`, { token: admin })).status, 409);
        const fresh = voucherByCode('TESTQT');
        assert.equal((await call(ctx, 'DELETE', `/admin/vouchers/${fresh.id}`, { token: admin })).status, 204);
    });
});
