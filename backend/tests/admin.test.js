// Nghiệp vụ quản trị: sản phẩm, nhập kho + nhật ký, thống kê doanh thu, kho & vận hành, sự kiện/banner (âm lịch),
// giao dịch bất thường; và cách lưu trữ dữ liệu (thư mục data riêng, sao lưu hằng ngày).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addAddress, call, login, newCustomer, PASSWORD, placeOrder, startServer, webhook } from './helpers.js';

let ctx;
let admin;
before(async () => {
    ctx = await startServer();
    admin = await login(ctx, 'admin');
});
after(() => ctx.stop());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const product = (patch = {}) => ({
    name: 'Cây trầu bà Nam Mỹ',
    categoryId: 3,
    price: 210000,
    stock: 10,
    image: 'p2.png',
    description: 'Lá xẻ to, hợp phòng khách',
    specs: { color: 'Xanh đậm', size: 'Cao 60 cm', bogus: 'bị bỏ' },
    ...patch
});

describe('Quản lý sản phẩm', () => {
    test('thêm sản phẩm: kiểm tra dữ liệu, nhãn Mới, thông số chỉ nhận trường của danh mục, ghi nhật ký nhập lần đầu', async () => {
        assert.equal((await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ price: 500 }) })).status, 400);
        assert.equal((await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ categoryId: 99 }) })).status, 400);
        assert.equal(
            (await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ name: 'lưỡi hổ' }) })).status,
            409,
            'trùng tên'
        );
        const created = await call(ctx, 'POST', '/admin/products', { token: admin, body: product() });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.deepEqual(created.body.specs, { color: 'Xanh đậm', size: 'Cao 60 cm' });
        const shown = (await call(ctx, 'GET', `/products/${created.body.id}`)).body;
        assert.equal(shown.isNew, true);
        const logs = (await call(ctx, 'GET', `/admin/stock-logs?productId=${created.body.id}`, { token: admin })).body;
        assert.deepEqual(
            logs.map((log) => [log.type, log.qty]),
            [['import', 10]]
        );
    });

    test('ảnh sản phẩm: tải ảnh thật lên rồi gắn vào sản phẩm', async () => {
        const upload = await call(ctx, 'POST', '/admin/uploads/product', {
            token: admin,
            raw: PNG,
            headers: { 'Content-Type': 'image/png' }
        });
        assert.equal(upload.status, 201, JSON.stringify(upload.body));
        assert.match(upload.body.url, /^\/uploads\/products\/[\w.-]+\.png$/);
        const created = await call(ctx, 'POST', '/admin/products', {
            token: admin,
            body: product({ name: 'Cây có ảnh thật', image: upload.body.url })
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.image, upload.body.url);
        const file = await fetch(`${ctx.base.replace('/api', '')}${upload.body.url}`);
        assert.equal(file.status, 200);
        const user = await newCustomer(ctx);
        assert.equal(
            (await call(ctx, 'POST', '/admin/uploads/product', { token: user.token, raw: PNG, headers: { 'Content-Type': 'image/png' } }))
                .status,
            403
        );
    });

    test('giá gốc (giá trước giảm) chỉ để hiển thị, phải lớn hơn giá bán; khách vẫn trả giá bán', async () => {
        assert.equal(
            (await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ name: 'Giá gốc sai', oldPrice: 100000 }) })).status,
            400
        );
        const sale = await call(ctx, 'POST', '/admin/products', {
            token: admin,
            body: product({ name: 'Cây đang giảm giá', price: 180000, oldPrice: 240000 })
        });
        assert.equal(sale.status, 201, JSON.stringify(sale.body));
        assert.equal(sale.body.oldPrice, 240000);
        const { token } = await newCustomer(ctx);
        const quote = await call(ctx, 'POST', '/orders/quote', {
            token,
            body: { items: [{ id: sale.body.id, qty: 1 }], shippingMethod: 'standard' }
        });
        assert.equal(quote.body.goods, 180000);
        const cleared = await call(ctx, 'PUT', `/admin/products/${sale.body.id}`, { token: admin, body: { ...sale.body, oldPrice: '' } });
        assert.equal(cleared.body.oldPrice, null, 'để trống = bỏ giảm giá');
    });

    test('sửa tồn kho trong form là điều chỉnh (kiểm kê), có nhật ký', async () => {
        const target = ctx.db.products.find((item) => item.id === '10');
        const saved = await call(ctx, 'PUT', '/admin/products/10', { token: admin, body: { ...target, stock: 25 } });
        assert.equal(saved.status, 200);
        const logs = (await call(ctx, 'GET', '/admin/stock-logs?productId=10', { token: admin })).body;
        assert.deepEqual([logs[0].type, logs[0].qty, logs[0].balanceAfter], ['adjust', -5, 25]);
    });

    test('nhập hàng cộng dồn tồn kho, đánh dấu Mới về; số lượng không hợp lệ bị từ chối', async () => {
        assert.equal((await call(ctx, 'PATCH', '/admin/products/13/stock', { token: admin, body: { add: 0 } })).status, 400);
        assert.equal((await call(ctx, 'PATCH', '/admin/products/13/stock', { token: admin, body: { add: 2.5 } })).status, 400);
        const result = await call(ctx, 'PATCH', '/admin/products/13/stock', { token: admin, body: { add: 30, note: 'NCC Đà Lạt' } });
        assert.equal(result.body.stock, 30);
        assert.equal((await call(ctx, 'GET', '/products/13')).body.restocked, true);
    });

    test('sản phẩm đã có trong đơn thì không xóa được; sản phẩm chưa bán thì xóa được', async () => {
        const { token } = await newCustomer(ctx);
        await placeOrder(ctx, token, await addAddress(ctx, token), [['8', 1]]);
        assert.equal((await call(ctx, 'DELETE', '/admin/products/8', { token: admin })).status, 409);
        const temp = await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ name: 'Sản phẩm tạm' }) });
        assert.equal((await call(ctx, 'DELETE', `/admin/products/${temp.body.id}`, { token: admin })).status, 204);
    });
});

describe('Thống kê và vận hành', () => {
    test('mặc định xem tháng hiện tại, doanh thu từng ngày cộng lại bằng doanh thu tháng', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 1]])).body;
        for (const status of ['confirmed', 'shipping', 'delivered'])
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        const now = new Date(Date.now() + 7 * 3600000);
        const stats = (await call(ctx, 'GET', '/admin/stats', { token: admin })).body;
        assert.equal(stats.filter.period, 'month');
        assert.equal(stats.filter.month, now.getUTCMonth() + 1);
        assert.equal(stats.days.length, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate());
        assert.equal(stats.prevDays.length, stats.days.length);
        assert.equal(
            stats.days.reduce((sum, row) => sum + row.revenue, 0),
            stats.summary.revenue
        );
        assert.ok(stats.days[now.getUTCDate() - 1].revenue >= order.total);
        assert.deepEqual((await call(ctx, 'GET', '/admin/stats?period=year', { token: admin })).body.days, []);
    });

    test('doanh thu = tiền khách thực trả của đơn đã giao trong kỳ', async () => {
        const before = (await call(ctx, 'GET', '/admin/stats?period=year', { token: admin })).body.summary;
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['3', 1]])).body;
        for (const status of ['confirmed', 'shipping', 'delivered'])
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        const stats = (await call(ctx, 'GET', '/admin/stats?period=year', { token: admin })).body;
        assert.equal(stats.summary.revenue - before.revenue, order.total);
        assert.equal(stats.summary.deliveredOrders - before.deliveredOrders, 1);
        const month = new Date(Date.now() + 7 * 3600000).getUTCMonth();
        assert.ok(stats.months[month].revenue >= order.total);
    });

    test('kho & vận hành: việc cần làm, đối soát dữ liệu, giao dịch bất thường đánh dấu đã xử lý', async () => {
        await webhook(ctx, { id: 777, transferAmount: 12345, content: 'khong ro' });
        const inventory = (await call(ctx, 'GET', '/admin/inventory', { token: admin })).body;
        assert.ok(inventory.todo.find((item) => item.key === 'pending').count >= 1);
        assert.deepEqual(inventory.integrity, [], 'dữ liệu nhất quán');
        const payment = inventory.payments.find((item) => item.txId === '777');
        assert.ok(payment);
        await call(ctx, 'PATCH', `/admin/payments/${payment.id}/handled`, { token: admin });
        const after = (await call(ctx, 'GET', '/admin/inventory', { token: admin })).body;
        assert.ok(!after.payments.some((item) => item.txId === '777'));
        const demand = await call(ctx, 'GET', '/admin/demand?days=30', { token: admin });
        assert.equal(demand.status, 200);
    });
});

describe('Sự kiện và banner', () => {
    test('đổi ngày âm lịch sang dương lịch đúng (Tết, Trung thu)', async () => {
        const { lunarToSolar } = await import('../server/services/lunar.js');
        assert.deepEqual(lunarToSolar(1, 1, 2026), { day: 17, month: 2, year: 2026 });
        assert.deepEqual(lunarToSolar(15, 8, 2026), { day: 25, month: 9, year: 2026 });
        assert.deepEqual(lunarToSolar(1, 1, 2027), { day: 6, month: 2, year: 2027 });
    });

    test('sự kiện hằng năm tự lặp lại; trùng thời gian thì ưu tiên cao hơn thắng', async () => {
        const { currentEvent, eventWindow } = await import('../server/services/site.js');
        const tet = ctx.db.events.find((event) => event.name === 'Tết Nguyên Đán');
        const window = eventWindow(tet, Date.parse('2027-01-20T00:00:00Z'));
        assert.equal(window.holiday, '2027-02-05T17:00:00.000Z', 'mùng 1 Tết 2027 (giờ VN)');
        assert.equal(currentEvent(Date.parse('2026-12-24T05:00:00Z')).name, 'Giáng sinh');
        assert.equal(currentEvent(Date.parse('2026-12-30T05:00:00Z')).name, 'Tết Dương lịch', 'Noel kết thúc hết 26/12');
        // 10/2/2026 nằm trong cả Valentine (7–14/2) lẫn Tết Nguyên Đán (27/1–23/2): Tết ưu tiên 50 thắng Valentine 30.
        assert.equal(currentEvent(Date.parse('2026-02-10T05:00:00Z')).name, 'Tết Nguyên Đán');
        assert.equal(currentEvent(Date.parse('2026-06-15T05:00:00Z')), null, 'không có dịp lễ nào');
    });

    test('kiểm tra dữ liệu sự kiện/banner; sự kiện còn banner thì không xóa được', async () => {
        const bad = await call(ctx, 'POST', '/admin/events', {
            token: admin,
            body: { name: 'Sai ngày', recurrence: 'once', startAt: '2026-12-10T00:00:00Z', endAt: '2026-12-01T00:00:00Z' }
        });
        assert.equal(bad.status, 400);
        assert.equal(
            (
                await call(ctx, 'POST', '/admin/events', {
                    token: admin,
                    body: { name: 'Âm lịch 30', recurrence: 'lunar', month: 1, day: 30 }
                })
            ).status,
            400
        );
        const event = await call(ctx, 'POST', '/admin/events', {
            token: admin,
            body: {
                name: 'Khai trương',
                recurrence: 'once',
                startAt: new Date(Date.now() - 1000).toISOString(),
                endAt: new Date(Date.now() + 86400000).toISOString(),
                priority: 100,
                theme: { primary: '#225522', accent: '#cc5500', slogan: 'Mừng khai trương' }
            }
        });
        assert.equal(event.status, 201, JSON.stringify(event.body));
        const external = await call(ctx, 'POST', '/admin/banners', {
            token: admin,
            body: { name: 'Banner lừa', image: 'p1.png', link: 'https://evil.example/login', eventId: event.body.id }
        });
        assert.equal(external.status, 400, 'liên kết ra ngoài bị chặn');
        const banner = await call(ctx, 'POST', '/admin/banners', {
            token: admin,
            body: { name: 'Banner khai trương', image: 'p1.png', link: './products.html?category=2', eventId: event.body.id }
        });
        assert.equal(banner.status, 201);
        const site = (await call(ctx, 'GET', '/site')).body;
        assert.equal(site.event.name, 'Khai trương');
        assert.equal(site.banners[0].name, 'Banner khai trương');
        assert.equal((await call(ctx, 'DELETE', `/admin/events/${event.body.id}`, { token: admin })).status, 409);
        await call(ctx, 'DELETE', `/admin/banners/${banner.body.id}`, { token: admin });
        assert.equal((await call(ctx, 'DELETE', `/admin/events/${event.body.id}`, { token: admin })).status, 204);
    });
});

describe('Lưu trữ dữ liệu', () => {
    test('dữ liệu ghi vào thư mục data riêng, có sao lưu hằng ngày, ghi nguyên tử (không còn file tạm)', async () => {
        const saved = JSON.parse(readFileSync(join(ctx.dir, 'db.json'), 'utf8'));
        assert.ok(saved.orders.length > 0);
        assert.ok(existsSync(join(ctx.dir, 'uploads', 'products')));
        assert.ok(readdirSync(join(ctx.dir, 'backups')).some((name) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name)));
        assert.ok(!existsSync(join(ctx.dir, 'db.json.tmp')));
    });

    test('không lưu mật khẩu/mã xác minh dạng rõ', async () => {
        const raw = readFileSync(join(ctx.dir, 'db.json'), 'utf8');
        assert.ok(!raw.includes('Cay@Canh2026'));
        assert.ok(!/"password"\s*:/.test(raw));
    });
});

describe('Admin quản lý tài khoản', () => {
    test('đặt lại mật khẩu: chỉ admin, không áp cho admin, mật khẩu cũ và phiên cũ mất hiệu lực, mật khẩu mới dùng được', async () => {
        const customer = await newCustomer(ctx, 'datlaimk');
        const url = `/admin/users/${customer.user.id}/reset-password`;
        assert.equal((await call(ctx, 'POST', url, { token: customer.token })).status, 403, 'khách không được');
        assert.equal((await call(ctx, 'POST', '/admin/users/admin1/reset-password', { token: admin })).status, 409, 'không đặt lại admin');
        assert.equal((await call(ctx, 'POST', url, { token: admin, body: { newPassword: 'yeu' } })).status, 400, 'mật khẩu yếu bị từ chối');

        const reset = await call(ctx, 'POST', url, { token: admin });
        assert.equal(reset.status, 200, JSON.stringify(reset.body));
        assert.equal(reset.body.generated, true);
        assert.equal((await call(ctx, 'GET', '/auth/me', { token: customer.token })).status, 401, 'phiên cũ bị đăng xuất');
        assert.equal(
            (await call(ctx, 'POST', '/auth/login', { body: { username: customer.name, password: PASSWORD } })).status,
            401,
            'mật khẩu cũ hết hiệu lực'
        );
        const fresh = await call(ctx, 'POST', '/auth/login', { body: { username: customer.name, password: reset.body.password } });
        assert.equal(fresh.status, 200, JSON.stringify(fresh.body));

        const listed = (await call(ctx, 'GET', '/admin/users', { token: admin })).body.find((row) => row.id === customer.user.id);
        assert.ok(listed.passwordResetAt && listed.createdAt && listed.orderCount === 0);
    });

    test('xóa tài khoản: chặn khi còn đơn chưa xong, không xóa admin/chính mình, xóa được khi sạch và dọn dữ liệu riêng', async () => {
        const busy = await newCustomer(ctx, 'xoachanduoc');
        const addressId = await addAddress(ctx, busy.token);
        const order = await placeOrder(ctx, busy.token, addressId, [['1', 1]]);
        assert.equal(order.status, 201, JSON.stringify(order.body));

        const customer = await newCustomer(ctx, 'xoaduoc');
        assert.equal(
            (await call(ctx, 'DELETE', `/admin/users/${customer.user.id}`, { token: customer.token })).status,
            403,
            'khách không được xóa'
        );
        assert.equal((await call(ctx, 'DELETE', '/admin/users/admin1', { token: admin })).status, 409, 'không tự xóa mình / admin');

        const check = await call(ctx, 'GET', `/admin/users/${busy.user.id}/delete-check`, { token: admin });
        assert.equal(check.status, 200);
        assert.equal(check.body.blockers.length, 1);
        assert.match(check.body.blockers[0], /chưa hoàn thành/);
        assert.equal((await call(ctx, 'DELETE', `/admin/users/${busy.user.id}`, { token: admin })).status, 409);

        assert.deepEqual((await call(ctx, 'GET', `/admin/users/${customer.user.id}/delete-check`, { token: admin })).body.blockers, []);
        assert.equal((await call(ctx, 'DELETE', `/admin/users/${customer.user.id}`, { token: admin })).status, 204);
        assert.equal(
            (await call(ctx, 'GET', '/auth/me', { token: customer.token })).status,
            401,
            'phiên của tài khoản đã xóa mất hiệu lực'
        );
        assert.equal((await call(ctx, 'POST', '/auth/login', { body: { username: customer.name, password: PASSWORD } })).status, 401);
        assert.equal((await call(ctx, 'DELETE', `/admin/users/${customer.user.id}`, { token: admin })).status, 404);

        const cancelled = await call(ctx, 'PATCH', `/orders/${order.body.id}/status`, {
            token: busy.token,
            body: { status: 'cancelled', reasonId: 'change_mind' }
        });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.deepEqual(
            (await call(ctx, 'GET', `/admin/users/${busy.user.id}/delete-check`, { token: admin })).body.blockers,
            [],
            'hủy đơn xong thì xóa được'
        );
    });
});
describe('Sản phẩm mới và khuyến mãi sản phẩm mới', () => {
    const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

    test('cài đặt: chỉ quản lý được sửa, dữ liệu sai bị từ chối, lưu rồi đọc lại đúng', async () => {
        const customer = await newCustomer(ctx, 'caidatmoi');
        assert.equal((await call(ctx, 'PUT', '/admin/settings', { token: customer.token, body: {} })).status, 403);
        const good = {
            newProductDays: 30,
            restockDays: 5,
            newPromo: { enabled: false, percent: 10, maxDiscount: 50000, minOrder: 0, days: 7 }
        };
        assert.equal(
            (await call(ctx, 'PUT', '/admin/settings', { token: admin, body: { ...good, newProductDays: 0 } })).status,
            400,
            'số ngày tối thiểu 1'
        );
        assert.equal(
            (
                await call(ctx, 'PUT', '/admin/settings', {
                    token: admin,
                    body: { ...good, newPromo: { ...good.newPromo, enabled: true, days: 30 } }
                })
            ).status,
            400,
            'giảm giá phải ngắn hơn nhãn Mới'
        );
        assert.equal(
            (await call(ctx, 'PUT', '/admin/settings', { token: admin, body: { ...good, newPromo: { ...good.newPromo, days: 0 } } }))
                .status,
            400,
            'số ngày giảm tối thiểu 1'
        );
        const saved = await call(ctx, 'PUT', '/admin/settings', { token: admin, body: good });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        const read = (await call(ctx, 'GET', '/admin/settings', { token: admin })).body;
        assert.equal(read.newProductDays, 30);
        assert.equal(read.newPromo.days, 7);
    });

    test('hạn nhãn Mới đặt riêng cho từng sản phẩm; số ngày chung đổi được', async () => {
        const created = await call(ctx, 'POST', '/admin/products', { token: admin, body: product({ name: 'Cây thử nhãn mới' }) });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const id = created.body.id;
        const isNew = async () => (await call(ctx, 'GET', `/products/${id}`)).body.isNew;
        assert.equal(await isNew(), true, 'vừa tạo là mới');

        const expired = await call(ctx, 'PUT', `/admin/products/${id}`, {
            token: admin,
            body: product({ name: 'Cây thử nhãn mới', newUntil: hoursFromNow(-1) })
        });
        assert.equal(expired.status, 200, JSON.stringify(expired.body));
        assert.equal(await isNew(), false, 'hạn riêng đã qua thì hết nhãn Mới dù mới tạo');

        await call(ctx, 'PUT', `/admin/products/${id}`, {
            token: admin,
            body: product({ name: 'Cây thử nhãn mới', newUntil: hoursFromNow(24) })
        });
        assert.equal(await isNew(), true, 'còn hạn riêng thì là Mới');
        await call(ctx, 'PUT', `/admin/products/${id}`, { token: admin, body: product({ name: 'Cây thử nhãn mới', newUntil: '' }) });
        assert.equal(await isNew(), true, 'bỏ hạn riêng thì theo số ngày chung');
    });

    test('khuyến mãi sản phẩm mới: chỉ giảm phần tiền sản phẩm mới, đúng thời gian, có trần, ghi vào đơn', async () => {
        const fresh = await call(ctx, 'POST', '/admin/products', {
            token: admin,
            body: product({ name: 'Cây mới có ưu đãi', price: 200000, stock: 20 })
        });
        assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
        const old = await call(ctx, 'POST', '/admin/products', {
            token: admin,
            body: product({ name: 'Cây cũ không ưu đãi', price: 100000, stock: 20, newUntil: hoursFromNow(-5) })
        });
        assert.equal(old.status, 201, JSON.stringify(old.body));
        const customer = await newCustomer(ctx, 'uudaimoi');
        const addressId = await addAddress(ctx, customer.token);
        const quote = (items) =>
            call(ctx, 'POST', '/orders/quote', {
                token: customer.token,
                body: { items: items.map(([id, qty]) => ({ id, qty })), addressId, shippingMethod: 'standard' }
            });
        const settings = (promo) =>
            call(ctx, 'PUT', '/admin/settings', { token: admin, body: { newProductDays: 14, restockDays: 7, newPromo: promo } });

        assert.equal((await quote([[fresh.body.id, 2]])).body.promo, null, 'chưa bật thì không giảm');

        const promo = { enabled: true, percent: 10, maxDiscount: 30000, minOrder: 0, days: 7 };
        assert.equal((await settings(promo)).status, 200);
        const withNew = (
            await quote([
                [fresh.body.id, 2],
                [old.body.id, 1]
            ])
        ).body;
        assert.equal(withNew.promo.amount, 30000, 'giảm 10% của 400.000 = 40.000 nhưng trần 30.000');
        assert.equal(withNew.total, withNew.goods - 30000 + withNew.shippingFee - withNew.shippingDiscount);
        assert.equal((await quote([[old.body.id, 1]])).body.promo, null, 'sản phẩm không còn là mới thì không giảm');

        // Quá số ngày giảm chung: vẫn còn nhãn Mới nhưng hết giảm giá
        const row = ctx.db.products.find((item) => item.id === fresh.body.id);
        const createdAt = row.createdAt;
        row.createdAt = hoursFromNow(-8 * 24);
        const shown = async () => (await call(ctx, 'GET', `/products/${fresh.body.id}`)).body;
        assert.equal((await shown()).isNew, true);
        assert.equal((await shown()).newPromoPercent, 0);
        assert.equal((await quote([[fresh.body.id, 1]])).body.promo, null, 'quá số ngày giảm thì không giảm');
        row.createdAt = createdAt;
        assert.equal((await shown()).newPromoPercent, 10);

        // Hạn giảm riêng của từng sản phẩm: đã qua thì hết giảm, không được dài hơn hạn nhãn Mới
        const edit = (patch) =>
            call(ctx, 'PUT', `/admin/products/${fresh.body.id}`, {
                token: admin,
                body: product({ name: 'Cây mới có ưu đãi', price: 200000, stock: 20, ...patch })
            });
        assert.equal((await edit({ promoUntil: hoursFromNow(-1) })).status, 200);
        assert.equal((await quote([[fresh.body.id, 1]])).body.promo, null, 'quá hạn giảm riêng thì không giảm');
        assert.equal((await shown()).isNew, true);
        assert.equal((await edit({ promoUntil: hoursFromNow(15 * 24) })).status, 400, 'hạn giảm không được dài hơn số ngày nhãn Mới (14)');
        assert.equal(
            (await edit({ newUntil: hoursFromNow(24), promoUntil: hoursFromNow(48) })).status,
            400,
            'hạn giảm không được dài hơn hạn nhãn Mới riêng'
        );
        assert.equal((await edit({ promoUntil: '' })).status, 200);

        const placed = await placeOrder(ctx, customer.token, addressId, [[fresh.body.id, 1]]);
        assert.equal(placed.status, 201, JSON.stringify(placed.body));
        assert.equal(placed.body.discount, 20000);
        assert.ok(placed.body.vouchers.some((row) => row.code === 'SPMOI' && row.amount === 20000));
        assert.equal(placed.body.total, 200000 - 20000 + placed.body.shippingFee);
        await settings({ enabled: false, percent: 10, maxDiscount: 50000, minOrder: 0 });
    });
});

describe('Nhập sản phẩm từ Excel', () => {
    const row = (patch = {}) => ({
        name: 'Cây nhập từ file',
        category: 'Cây để bàn',
        price: 150000,
        oldPrice: '',
        stock: 5,
        image: 'p1.png',
        description: 'Mô tả sản phẩm nhập từ file',
        ...patch
    });
    const send = (rows, token = admin) => call(ctx, 'POST', '/admin/products/import', { token, body: { rows } });

    test('không có ID thì tạo mới và ghi nhật ký; có ID thì cập nhật nhưng không đổi tồn kho', async () => {
        const first = await send([row()]);
        assert.deepEqual(first.body, { created: 1, updated: 0 });
        const created = ctx.db.products.find((item) => item.name === 'Cây nhập từ file');
        assert.equal(created.stock, 5);
        assert.equal(String(created.categoryId), '1');
        const logs = () => ctx.db.stockLogs.filter((log) => log.productId === created.id);
        assert.equal(logs().length, 1);

        const second = await send([row({ id: created.id, price: 170000, stock: 999 })]);
        assert.deepEqual(second.body, { created: 0, updated: 1 });
        assert.equal(created.price, 170000);
        assert.equal(created.stock, 5, 'nhập file không đổi tồn kho của sản phẩm đã có');
        assert.equal(logs().length, 1);
    });

    test('có dòng sai thì không lưu dòng nào và báo đúng số dòng trong file', async () => {
        const total = ctx.db.products.length;
        const bad = await send([
            row({ name: 'Dòng đúng' }),
            row({ name: 'Sai giá', price: 5 }),
            row({ name: 'Sai danh mục', category: 'Không có' }),
            row({ id: 'khong-co-id-nay', name: 'Sai ID' }),
            row({ name: 'lưỡi hổ' }),
            row({ name: 'Trùng trong file' }),
            row({ name: 'trùng trong file' }),
            null
        ]);
        assert.equal(bad.status, 400, JSON.stringify(bad.body));
        assert.deepEqual(
            bad.body.errors.map((item) => item.line),
            [3, 4, 5, 6, 8, 9]
        );
        assert.equal(ctx.db.products.length, total);
        assert.equal(
            ctx.db.products.some((item) => item.name === 'Dòng đúng'),
            false
        );
    });

    test('chỉ người quản lý sản phẩm được nhập, giới hạn số dòng, file lớn hơn 50 KB vẫn gửi được', async () => {
        const customer = await newCustomer(ctx);
        assert.equal((await send([row()], customer.token)).status, 403);
        assert.equal((await send([row()], null)).status, 401);
        assert.equal((await send([])).status, 400);
        assert.equal((await send(Array.from({ length: 501 }, () => row()))).status, 400);
        const big = await send(
            Array.from({ length: 300 }, (_, index) => row({ name: `Dòng ${index}`, price: 5, description: 'x'.repeat(300) }))
        );
        assert.equal(big.status, 400);
        assert.equal(big.body.errors.length, 300, 'vào tới bước kiểm tra, không bị chặn vì quá dung lượng');
    });
});

describe('Doanh thu từng sản phẩm', () => {
    test('trả về mọi sản phẩm với 12 tháng gần nhất; khách thường không xem được', async () => {
        const res = await call(ctx, 'GET', '/admin/product-sales', { token: admin });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const products = (await call(ctx, 'GET', '/products')).body;
        assert.equal(res.body.length, products.length);
        const row = res.body[0];
        assert.equal(row.months.length, 12);
        for (const key of ['delivered', 'revenue', 'inFlight', 'cancelled', 'average']) assert.equal(typeof row[key], 'number');
        const user = await newCustomer(ctx);
        assert.equal((await call(ctx, 'GET', '/admin/product-sales', { token: user.token })).status, 403);
    });
});

describe('Thống kê theo ngày và tuần', () => {
    test('xem theo ngày có 24 giờ, theo tuần có 7 ngày bắt đầu từ thứ Hai; ngày sai thì dùng hôm nay', async () => {
        const day = await call(ctx, 'GET', '/admin/stats?period=day&date=2026-11-12', { token: admin });
        assert.equal(day.status, 200, JSON.stringify(day.body));
        assert.equal(day.body.days.length, 24);
        assert.equal(day.body.prevDays.length, 24);
        assert.equal(day.body.filter.date, '2026-11-12');
        assert.equal(day.body.previous.label, 'Ngày 11/11');

        const week = (await call(ctx, 'GET', '/admin/stats?period=week&date=2026-11-12', { token: admin })).body;
        assert.equal(week.days.length, 7);
        assert.equal(week.filter.from, '2026-11-09', 'thứ Hai');
        assert.equal(week.filter.to, '2026-11-15', 'Chủ nhật');
        assert.match(week.days[0].label, /^T2 09\/11$/);
        assert.equal(week.previous.label, 'Tuần 02/11 – 08/11');

        const sunday = (await call(ctx, 'GET', '/admin/stats?period=week&date=2026-11-15', { token: admin })).body;
        assert.equal(sunday.filter.from, '2026-11-09', 'Chủ nhật vẫn thuộc tuần bắt đầu thứ Hai');

        const bad = (await call(ctx, 'GET', '/admin/stats?period=day&date=khong-hop-le', { token: admin })).body;
        assert.equal(bad.days.length, 24);
        assert.match(bad.filter.date, /^\d{4}-\d{2}-\d{2}$/);
    });

    test('đơn đã giao được tính đúng vào ngày và tuần chứa nó', async () => {
        const customer = await newCustomer(ctx);
        const address = await addAddress(ctx, customer.token);
        const order = (await placeOrder(ctx, customer.token, address, [['1', 1]])).body;
        for (const status of ['confirmed', 'shipping', 'delivered']) {
            const step = await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
            assert.equal(step.status, 200, `${status}: ${JSON.stringify(step.body)}`);
        }
        const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        const stats = (await call(ctx, 'GET', `/admin/stats?period=day&date=${today}`, { token: admin })).body;
        assert.ok(stats.summary.deliveredOrders >= 1, 'đơn vừa giao nằm trong hôm nay');
        assert.ok(stats.days.reduce((sum, row) => sum + row.orders, 0) >= 1, 'và nằm trong một giờ nào đó');
        const week = (await call(ctx, 'GET', `/admin/stats?period=week&date=${today}`, { token: admin })).body;
        assert.ok(week.summary.deliveredOrders >= stats.summary.deliveredOrders);
        const yesterday = new Date(Date.now() + 7 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
        const other = (await call(ctx, 'GET', `/admin/stats?period=day&date=${yesterday}`, { token: admin })).body;
        assert.equal(other.summary.deliveredOrders, 0, 'hôm qua chưa có đơn giao');
    });
});
