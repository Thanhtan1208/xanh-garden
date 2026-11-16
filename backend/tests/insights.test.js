// Thống kê doanh thu được đối chiếu độc lập (tự tính từ đơn hàng gốc, không dùng hàm của server),
// và phần phân tích gợi ý (quy tắc + AI) chỉ dành cho chủ cửa hàng và admin.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { addAddress, call, login, newCustomer, placeOrder, startServer } from './helpers.js';

let ctx;
let admin;
let owner;
let staff;
let customer;
before(async () => {
    ctx = await startServer();
    admin = await login(ctx, 'admin');
    for (const role of ['owner', 'staff']) {
        const account = await newCustomer(ctx);
        await call(ctx, 'PATCH', `/admin/users/${account.user.id}/role`, { token: admin, body: { role } });
        const token = await login(ctx, account.name);
        if (role === 'owner') owner = token;
        else staff = token;
    }
    customer = (await newCustomer(ctx)).token;
});
after(() => ctx.stop());

const product = (patch) => ({
    name: 'Cây thử',
    categoryId: 1,
    price: 200000,
    costPrice: 120000,
    stock: 50,
    image: 'p1.png',
    description: 'Cây dùng để thử thống kê',
    ...patch
});
const create = async (patch) => {
    const made = await call(ctx, 'POST', '/admin/products', { token: admin, body: product(patch) });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return made.body;
};
const deliver = async (order) => {
    for (const status of ['confirmed', 'shipping', 'delivered'])
        assert.equal((await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } })).status, 200);
};
const stats = async (query = 'period=year') => (await call(ctx, 'GET', `/admin/stats?${query}`, { token: admin })).body;
const insights = async (token = admin, days = 30) => call(ctx, 'GET', `/admin/insights?days=${days}`, { token });

// Tính độc lập: chỉ dùng số liệu thô trong đơn hàng (giá, giá vốn, số lượng, giảm giá), không gọi hàm nào của server.
const expected = (orders) => {
    let sales = 0;
    let cost = 0;
    let units = 0;
    for (const order of orders) {
        for (const item of order.items) {
            sales += item.price * item.qty;
            cost += (item.cost ?? 0) * item.qty;
            units += item.qty;
        }
        sales -= order.discount || 0;
    }
    return { sales, cost, revenue: sales - cost, units };
};

describe('Đối chiếu độc lập doanh thu của thống kê', () => {
    let a;
    let b;
    let o1;
    let o2;
    let cancelled;
    let open;
    before(async () => {
        a = await create({ name: 'Cây A đối chiếu', price: 200000, costPrice: 120000, categoryId: 1 });
        b = await create({ name: 'Cây B đối chiếu', price: 100000, costPrice: 70000, categoryId: 2 });
        const buyer = await newCustomer(ctx);
        const address = await addAddress(ctx, buyer.token);
        // đơn 1: COD, 2 cây A, không voucher
        o1 = (await placeOrder(ctx, buyer.token, address, [[a.id, 2]])).body;
        // đơn 2: COD, 1 cây A + 3 cây B, có voucher giảm 10% (dưới mức tối đa của voucher)
        const claimed = await call(ctx, 'POST', '/vouchers/claim', { token: buyer.token, body: { code: 'SALE10' } });
        const entry = claimed.body.id ?? claimed.body.entryId ?? claimed.body.userVoucherId;
        o2 = (
            await call(ctx, 'POST', '/orders', {
                token: buyer.token,
                body: {
                    items: [
                        { id: a.id, qty: 1 },
                        { id: b.id, qty: 3 }
                    ],
                    addressId: address,
                    shippingMethod: 'standard',
                    paymentMethod: 'cod',
                    voucherIds: [entry]
                }
            })
        ).body;
        // đơn 3: bị hủy, đơn 4: đang chờ xử lý: hai đơn này không được tính vào doanh thu
        cancelled = (await placeOrder(ctx, buyer.token, address, [[b.id, 5]])).body;
        await call(ctx, 'PATCH', `/orders/${cancelled.id}/status`, { token: admin, body: { status: 'cancelled' } });
        open = (await placeOrder(ctx, buyer.token, address, [[a.id, 4]])).body;
        await deliver(o1);
        await deliver(o2);
    });

    test('đơn có voucher giảm giá được tạo đúng (điều kiện để các phép kiểm tra bên dưới có ý nghĩa)', () => {
        assert.equal(o2.status, 'pending');
        assert.ok(o2.discount > 0, `đơn 2 phải có giảm giá: ${JSON.stringify(o2.vouchers)}`);
        assert.equal(o1.discount, 0);
    });

    test('doanh thu năm = tiền bán - giá vốn của đúng 2 đơn đã giao; hủy và chưa giao không tính; phí ship không tính', async () => {
        const delivered = ctx.db.orders.filter((order) => [o1.id, o2.id].includes(order.id));
        const want = expected(delivered);
        // tính tay: o1 = 2×200k - 2×120k = 160k; o2 = (200k + 300k) - discount - (120k + 210k)
        assert.equal(want.sales - want.revenue, want.cost);
        const before = (await stats()).summary;
        // không thể biết trước các đơn khác trong fixture, nên so theo chênh lệch so với trạng thái trước khi giao đơn mới
        const allDelivered = ctx.db.orders.filter((order) => order.status === 'delivered');
        const all = expected(allDelivered);
        const now = await stats();
        assert.equal(now.summary.sales, all.sales, 'tiền bán');
        assert.equal(now.summary.cost, all.cost, 'giá vốn');
        assert.equal(now.summary.revenue, all.revenue, 'doanh thu');
        assert.equal(now.summary.units, all.units, 'số sản phẩm');
        assert.equal(now.summary.deliveredOrders, allDelivered.length);
        assert.equal(before.revenue, now.summary.revenue);
        for (const order of [cancelled, open]) assert.ok(!allDelivered.some((entry) => entry.id === order.id));
    });

    test('quý, tháng, danh mục, thanh toán, sản phẩm bán chạy đều cộng lại đúng bằng doanh thu', async () => {
        const data = await stats();
        const total = data.summary.revenue;
        assert.equal(
            data.quarters.reduce((sum, row) => sum + row.revenue, 0),
            total,
            'tổng 4 quý'
        );
        assert.equal(
            data.months.reduce((sum, row) => sum + row.revenue, 0),
            total,
            'tổng 12 tháng'
        );
        assert.equal(data.byPayment.cod.revenue + data.byPayment.sepay.revenue, total, 'COD + QR');
        assert.equal(data.yearRevenue, total);

        // theo danh mục và theo sản phẩm tính trên từng dòng hàng (chưa chia giảm giá đơn), nên so với cách tính độc lập đó
        const lines = ctx.db.orders.filter((order) => order.status === 'delivered').flatMap((order) => order.items);
        const lineRevenue = lines.reduce((sum, item) => sum + (item.price - (item.cost ?? 0)) * item.qty, 0);
        assert.equal(
            data.byCategory.reduce((sum, row) => sum + row.revenue, 0),
            lineRevenue,
            'tổng theo danh mục'
        );
        const perProduct = Object.fromEntries(
            [a, b].map((entry) => [
                entry.id,
                lines.filter((item) => item.id === entry.id).reduce((sum, item) => sum + (item.price - item.cost) * item.qty, 0)
            ])
        );
        const sales = (await call(ctx, 'GET', '/admin/product-sales', { token: admin })).body;
        for (const entry of [a, b]) assert.equal(sales.find((row) => row.id === entry.id).revenue, perProduct[entry.id], entry.name);
        assert.equal(sales.find((row) => row.id === a.id).delivered, 3, 'cây A giao 2 + 1 cái');
        assert.equal(sales.find((row) => row.id === b.id).delivered, 3, 'cây B giao 3 cái (5 cái của đơn hủy không tính)');
        assert.equal(sales.find((row) => row.id === a.id).inFlight, 4, 'đơn đang chờ không tính vào doanh thu mà vào "đang xử lý"');
    });

    test('xem theo ngày và theo tuần của hôm nay cho cùng doanh thu với đơn đã giao hôm nay', async () => {
        const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
        const day = await stats(`period=day&date=${today}`);
        const week = await stats(`period=week&date=${today}`);
        const todays = ctx.db.orders.filter((order) => {
            if (order.status !== 'delivered') return false;
            const at = order.history.filter((entry) => entry.status === 'delivered').at(-1).at;
            return new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 10) === today;
        });
        assert.equal(day.summary.revenue, expected(todays).revenue, 'ngày');
        assert.equal(
            day.days.reduce((sum, row) => sum + row.revenue, 0),
            day.summary.revenue,
            '24 giờ cộng lại'
        );
        assert.ok(week.summary.revenue >= day.summary.revenue, 'tuần chứa hôm nay');
        assert.equal(
            week.days.reduce((sum, row) => sum + row.revenue, 0),
            week.summary.revenue,
            '7 ngày cộng lại'
        );
    });

    test('phân tích gợi ý dùng đúng cùng một con số doanh thu với trang thống kê', async () => {
        const result = await insights(owner, 90);
        assert.equal(result.status, 200);
        const delivered = ctx.db.orders.filter((order) => order.status === 'delivered');
        const want = expected(delivered);
        assert.equal(result.body.kpi.sales, want.sales);
        assert.equal(result.body.kpi.cost, want.cost);
        assert.equal(result.body.kpi.revenue, want.revenue);
        assert.equal(result.body.kpi.revenue, (await stats()).summary.revenue);
    });
});

describe('Phân tích gợi ý theo quy tắc', () => {
    test('chỉ chủ và admin xem được; nhân viên, khách, người chưa đăng nhập bị từ chối', async () => {
        assert.equal((await insights(admin)).status, 200);
        assert.equal((await insights(owner)).status, 200);
        assert.equal((await insights(staff)).status, 403);
        assert.equal((await insights(customer)).status, 403);
        assert.equal((await insights(null)).status, 401);
        for (const token of [staff, customer, null])
            assert.ok([401, 403].includes((await call(ctx, 'POST', '/admin/insights/ai', { token, body: {} })).status));
    });

    test('phát hiện bán lỗ, lãi mỏng, sắp hết hàng, tồn lâu không bán, giá vốn ước tính và việc nên làm', async () => {
        const loss = await create({ name: 'Cây bán lỗ', price: 100000, costPrice: 100000, stock: 30 });
        const thin = await create({ name: 'Cây lãi mỏng', price: 100000, costPrice: 92000, stock: 30 });
        const low = await create({ name: 'Cây sắp hết', price: 300000, costPrice: 150000, stock: 4 });
        const stale = await create({ name: 'Cây tồn lâu', price: 100000, costPrice: 60000, stock: 25 });
        ctx.db.products.find((item) => item.id === stale.id).createdAt = new Date(Date.now() - 90 * 86400000).toISOString();
        const buyer = await newCustomer(ctx);
        const address = await addAddress(ctx, buyer.token);
        const claimed = await call(ctx, 'POST', '/vouchers/claim', { token: buyer.token, body: { code: 'SALE10' } });
        // bán lỗ thật sự: giá bán = giá vốn nhưng đơn có voucher giảm giá
        const lossOrder = (
            await call(ctx, 'POST', '/orders', {
                token: buyer.token,
                body: {
                    items: [
                        { id: loss.id, qty: 3 },
                        { id: thin.id, qty: 3 }
                    ],
                    addressId: address,
                    shippingMethod: 'standard',
                    paymentMethod: 'cod',
                    voucherIds: [claimed.body.id ?? claimed.body.entryId]
                }
            })
        ).body;
        assert.equal(lossOrder.status, 'pending', 'đơn bán lỗ tạo được: ' + JSON.stringify(lossOrder));
        const lowOrder = (await placeOrder(ctx, buyer.token, address, [[low.id, 3]])).body;
        await deliver(lossOrder);
        await deliver(lowOrder);

        const result = (await insights(admin, 30)).body;
        const ids = result.findings.map((finding) => finding.id);
        assert.ok(ids.includes('restock'), 'sắp hết mà bán tốt: ' + ids.join());
        assert.ok(ids.includes('dead-stock'), 'tồn lâu');
        assert.ok(ids.includes('cost-estimated'), 'còn sản phẩm dùng giá vốn ước tính');
        assert.ok(ids.includes('thin-margin') || ids.includes('loss-making'), 'lãi mỏng hoặc lỗ');
        const restock = result.restock.find((row) => row.id === low.id);
        assert.equal(restock.stock, 1);
        assert.equal(restock.coverDays, 10, 'còn 1 cái, bán 3 cái/30 ngày = 0,1 cái/ngày nên đủ 10 ngày; vẫn báo vì tồn kho thấp');
        const deadRow = result.dead.find((row) => row.id === stale.id);
        assert.equal(deadRow.capital, 25 * 60000, 'vốn nằm trong kho = tồn × giá vốn');
        // mỗi phát hiện có tiêu đề, chi tiết và việc nên làm; sắp từ nghiêm trọng đến nhẹ
        for (const finding of result.findings) assert.ok(finding.title && finding.detail && finding.action, finding.id);
        const order = { danger: 0, warning: 1, info: 2, good: 3 };
        const levels = result.findings.map((finding) => order[finding.level]);
        assert.deepEqual(
            levels,
            [...levels].sort((x, y) => x - y)
        );
    });

    test('sản phẩm đã hết hàng chỉ nằm ở mục "đã bán nhưng hết hàng", không lặp ở mục "sắp hết"', async () => {
        const gone = await create({ name: 'Cây vừa hết sạch', price: 100000, costPrice: 60000, stock: 2 });
        const buyer = await newCustomer(ctx);
        const order = (await placeOrder(ctx, buyer.token, await addAddress(ctx, buyer.token), [[gone.id, 2]])).body;
        await deliver(order);
        const result = (await insights(admin, 30)).body;
        assert.ok(!result.restock.some((row) => row.id === gone.id), 'không nằm trong danh sách nhập thêm gấp');
        assert.ok(result.findings.find((finding) => finding.id === 'sold-out')?.detail.includes('Cây vừa hết sạch'), 'nằm ở mục hết hàng');
    });
});

describe('Phân tích bằng AI', () => {
    let fake;
    let received;
    before(async () => {
        received = [];
        fake = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                received.push(JSON.parse(body));
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ choices: [{ message: { content: '**Tóm tắt**\nDoanh thu ổn định.' } }] }));
            });
        });
        await new Promise((resolve) => fake.listen(0, resolve));
        process.env.OPENAI_BASE_URL = `http://localhost:${fake.address().port}`;
        process.env.OPENAI_API_KEY = 'khoa-gia';
    });
    after(() => {
        fake.close();
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_BASE_URL;
    });

    test('gửi cho AI số liệu tổng hợp (không có thông tin khách hàng), trả về bản phân tích; gọi lại thì dùng bản đã nhớ', async () => {
        const first = await call(ctx, 'POST', '/admin/insights/ai', { token: owner, body: { days: 90 } });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.match(first.body.text, /Tóm tắt/);
        assert.equal(first.body.cached, false);
        assert.equal(received.length, 1);

        const sent = JSON.stringify(received[0]);
        assert.match(sent, /DOANH THU trong dữ liệu = tiền bán trừ giá vốn/, 'AI được dặn công thức');
        const digest = JSON.parse(received[0].messages[1].content.split(String.fromCharCode(10))[1]);
        const delivered = ctx.db.orders.filter((order) => order.status === 'delivered');
        assert.equal(digest.kpi.revenue, expected(delivered).revenue, 'AI nhận đúng số doanh thu');
        assert.ok(Array.isArray(digest.findings) && digest.findings.length, 'kèm các phát hiện theo quy tắc');
        assert.ok(!/@xanhgarden\.test|passwordHash|Bearer/.test(sent), 'không gửi email, mật khẩu, token');

        const second = await call(ctx, 'POST', '/admin/insights/ai', { token: owner, body: { days: 90 } });
        assert.equal(second.body.cached, true);
        assert.equal(received.length, 1, 'dữ liệu chưa đổi nên không gọi AI lần nữa');
    });

    test('nhân viên không dùng được; thiếu khóa OpenAI thì báo rõ, các gợi ý quy tắc vẫn dùng được', async () => {
        assert.equal((await call(ctx, 'POST', '/admin/insights/ai', { token: staff, body: {} })).status, 403);
        const key = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
            const missing = await call(ctx, 'POST', '/admin/insights/ai', { token: admin, body: { days: 7 } });
            assert.equal(missing.status, 503);
            assert.match(missing.body.message, /OPENAI_API_KEY/);
            const rules = await insights(admin, 7);
            assert.equal(rules.status, 200);
            assert.equal(rules.body.ai.available, false);
        } finally {
            process.env.OPENAI_API_KEY = key;
        }
    });
});
