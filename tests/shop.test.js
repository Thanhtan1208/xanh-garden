// Nghiệp vụ phía khách: xem sản phẩm, giỏ hàng theo tài khoản, sổ địa chỉ, đánh giá (chỉ người đã nhận hàng, kèm ảnh),
// góp ý/khiếu nại, chatbot tư vấn (chế độ không có AI), ghi nhận hành vi.
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

// Ảnh PNG 1x1 hợp lệ.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Sản phẩm', () => {
    test('danh mục có thông số theo loại; sản phẩm có cờ Mới/Mới về', async () => {
        const categories = await call(ctx, 'GET', '/categories');
        assert.equal(categories.body.length, 5);
        assert.ok(categories.body[0].specFields.length > 0, 'thông số theo loại được nạp');
        const products = await call(ctx, 'GET', '/products');
        assert.equal(products.body.length, 13);
        assert.ok(products.body.every((product) => product.isNew === false));
        const one = await call(ctx, 'GET', '/products/1');
        assert.equal(one.body.name, 'Lưỡi hổ');
        assert.equal((await call(ctx, 'GET', '/products/khong-co')).status, 404);
    });

    test('bán chạy tháng: không đề xuất hàng hết; hàng mới về sắp theo ngày nhập', async () => {
        const featured = await call(ctx, 'GET', '/products/featured?limit=24');
        assert.ok(featured.body.length > 0);
        assert.ok(featured.body.every((product) => product.stock > 0), 'không có sản phẩm hết hàng');
        await call(ctx, 'PATCH', '/admin/products/11/stock', { token: admin, body: { add: 5, note: 'Lô mới' } });
        const fresh = await call(ctx, 'GET', '/products/new?limit=4');
        assert.equal(fresh.body[0].id, '11');
        assert.equal(fresh.body[0].restocked, true);
        const newest = await call(ctx, 'GET', '/products?sort=newest');
        assert.equal(newest.body[0].id, '11');
    });

    test('đơn đã được chốt mới tính vào bán chạy tháng', async () => {
        const { token } = await newCustomer(ctx);
        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['12', 5]])).body;
        let featured = (await call(ctx, 'GET', '/products/featured')).body;
        assert.notEqual(featured[0].id, '12', 'đơn chờ xác nhận chưa tính');
        await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'confirmed' } });
        featured = (await call(ctx, 'GET', '/products/featured')).body;
        assert.equal(featured[0].id, '12');
        assert.equal(featured[0].soldMonth, 5);
    });
});

describe('Sản phẩm yêu thích', () => {
    test('thêm/bỏ yêu thích theo tài khoản, mới nhất đứng đầu, không trùng', async () => {
        const { token } = await newCustomer(ctx);
        assert.equal((await call(ctx, 'PUT', '/favorites/3')).status, 401);
        assert.equal((await call(ctx, 'PUT', '/favorites/khong-co', { token })).status, 404);
        await call(ctx, 'PUT', '/favorites/3', { token });
        await call(ctx, 'PUT', '/favorites/7', { token });
        const again = await call(ctx, 'PUT', '/favorites/3', { token });
        assert.deepEqual(again.body.ids, ['7', '3']);
        const list = await call(ctx, 'GET', '/favorites', { token });
        assert.deepEqual(list.body.map((product) => product.name), ['Sen đá nhỏ', 'Kim tiền']);
        const removed = await call(ctx, 'DELETE', '/favorites/7', { token });
        assert.deepEqual(removed.body.ids, ['3']);
        assert.equal((await call(ctx, 'GET', '/favorites', { token: admin })).status, 403);
    });
});

describe('Trang thông tin (chính sách, cẩm nang)', () => {
    test('lấy nội dung từ cơ sở tri thức, ẩn phần chỉ dành cho chatbot', async () => {
        const list = await call(ctx, 'GET', '/pages');
        assert.deepEqual(list.body.map((page) => page.slug), ['mua-hang', 'doi-tra', 'cham-soc', 'chon-cay', 'hoi-dap']);
        const faq = await call(ctx, 'GET', '/pages/hoi-dap');
        assert.ok(faq.body.sections.length > 5);
        assert.ok(faq.body.sections.every((section) => !/chatbot/i.test(section.title)));
        const policy = await call(ctx, 'GET', '/pages/mua-hang');
        assert.ok(policy.body.sections.some((section) => section.body.includes('1.000.000')));
        assert.equal((await call(ctx, 'GET', '/pages/khong-co')).status, 404);
        assert.equal((await call(ctx, 'GET', '/pages/__proto__')).status, 404);
    });
});

describe('Giỏ hàng theo tài khoản', () => {
    test('ghi đè, gộp dòng trùng, giới hạn theo tồn kho và 20/dòng, loại hàng hết/không còn', async () => {
        const { token } = await newCustomer(ctx);
        const result = await call(ctx, 'PUT', '/cart', {
            token,
            body: { items: [{ id: '1', qty: 2 }, { id: '1', qty: 3 }, { id: '8', qty: 10 }, { id: '7', qty: 50 }, { id: '13', qty: 1 }, { id: 'xoa', qty: 1 }, { id: '2', qty: -1 }] }
        });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.items, [{ id: '1', qty: 5 }, { id: '8', qty: 3 }, { id: '7', qty: 20 }]);
        assert.deepEqual(result.body.removed.map((item) => item.reason).sort(), ['removed', 'soldout']);
        const again = await call(ctx, 'GET', '/cart', { token });
        assert.deepEqual(again.body.items, result.body.items, 'giỏ được lưu trên server');
    });

    test('gộp giỏ lúc chưa đăng nhập vào giỏ tài khoản; xóa giỏ', async () => {
        const { token } = await newCustomer(ctx);
        await call(ctx, 'PUT', '/cart', { token, body: { items: [{ id: '1', qty: 1 }] } });
        const merged = await call(ctx, 'POST', '/cart/merge', { token, body: { items: [{ id: '1', qty: 2 }, { id: '9', qty: 1 }] } });
        assert.deepEqual(merged.body.items, [{ id: '1', qty: 3 }, { id: '9', qty: 1 }]);
        assert.equal((await call(ctx, 'DELETE', '/cart', { token })).status, 204);
        assert.deepEqual((await call(ctx, 'GET', '/cart', { token })).body.items, []);
        assert.equal((await call(ctx, 'PUT', '/cart', { token, body: { items: 'abc' } })).status, 400);
    });
});

describe('Sổ địa chỉ', () => {
    test('thêm, sửa, đặt mặc định, xóa địa chỉ mặc định thì địa chỉ khác thành mặc định', async () => {
        const { token } = await newCustomer(ctx);
        const bad = await call(ctx, 'POST', '/addresses', { token, body: { fullName: 'A', phone: '123', address: 'ngắn' } });
        assert.equal(bad.status, 400);
        await addAddress(ctx, token);
        let book = (await call(ctx, 'POST', '/addresses', { token, body: { fullName: 'Trần Thị B', phone: '0912 345 678', address: '45 Trần Phú, Hải Châu, Đà Nẵng' } })).body;
        assert.equal(book.length, 2);
        assert.equal(book[0].isDefault, true, 'địa chỉ đầu tiên là mặc định');
        assert.equal(book[1].phone, '0912345678', 'số điện thoại được chuẩn hóa');
        book = (await call(ctx, 'PUT', `/addresses/${book[1].id}`, { token, body: { ...book[1], isDefault: true } })).body;
        assert.deepEqual(book.map((item) => item.isDefault), [false, true]);
        book = (await call(ctx, 'DELETE', `/addresses/${book[1].id}`, { token })).body;
        assert.equal(book.length, 1);
        assert.equal(book[0].isDefault, true);
    });

    test('tối đa 10 địa chỉ', async () => {
        const { token } = await newCustomer(ctx);
        for (let i = 0; i < 10; i += 1) await addAddress(ctx, token);
        const eleventh = await call(ctx, 'POST', '/addresses', { token, body: { fullName: 'Nguyễn Văn A', phone: '0901234567', address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh' } });
        assert.equal(eleventh.status, 409);
    });
});

describe('Đánh giá sản phẩm', () => {
    test('chỉ khách đã nhận hàng mới được đánh giá, mỗi sản phẩm một lần, kèm ảnh', async () => {
        const { token } = await newCustomer(ctx);
        const status = await call(ctx, 'GET', '/products/2/review-status', { token });
        assert.deepEqual(status.body, { canReview: false, reason: 'not_purchased' });
        assert.equal((await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 5, comment: 'Cây đẹp lắm' } })).status, 403);

        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['2', 1]])).body;
        for (const status of ['confirmed', 'shipping', 'delivered']) {
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        }
        assert.equal((await call(ctx, 'GET', '/products/2/review-status', { token })).body.canReview, true);

        const fake = await call(ctx, 'POST', '/uploads/reviews', { token, raw: Buffer.from('<script>alert(1)</script> not an image'), headers: { 'Content-Type': 'image/png' } });
        assert.equal(fake.status, 400, 'tệp giả mạo đuôi ảnh bị từ chối');
        const upload = await call(ctx, 'POST', '/uploads/reviews', { token, raw: PNG, headers: { 'Content-Type': 'image/png' } });
        assert.equal(upload.status, 201, JSON.stringify(upload.body));
        const image = await fetch(`${ctx.base.replace('/api', '')}${upload.body.url}`);
        assert.equal(image.status, 200, 'ảnh tải lên xem được');

        assert.equal((await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 6, comment: 'Cây đẹp lắm' } })).status, 400);
        const review = await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 5, comment: 'Cây đẹp, đóng gói kỹ', media: [upload.body.id] } });
        assert.equal(review.status, 201, JSON.stringify(review.body));
        assert.equal(review.body.media.length, 1);
        assert.equal((await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 4, comment: 'Đánh giá lần hai' } })).status, 403);
        const list = await call(ctx, 'GET', '/products/2/reviews');
        assert.equal(list.body.length, 1);
        const latest = await call(ctx, 'GET', '/reviews/latest');
        assert.equal(latest.body[0].productName, 'Trầu bà đế vương');
        assert.equal(latest.body[0].photo, upload.body.url);
        const product = (await call(ctx, 'GET', '/products/2')).body;
        assert.deepEqual([product.ratingCount, product.rating, product.sold], [1, 5, 1], 'thẻ sản phẩm có điểm đánh giá và số đã bán thật');

        const other = await newCustomer(ctx);
        assert.equal((await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token: other.token })).status, 403);
        assert.equal((await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token: admin })).status, 204);
    });
});

describe('Góp ý / khiếu nại', () => {
    test('khách gửi, chỉ thấy của mình; mã đơn phải thuộc tài khoản; admin trả lời', async () => {
        const a = await newCustomer(ctx);
        const b = await newCustomer(ctx);
        const badOrder = await call(ctx, 'POST', '/feedbacks', { token: a.token, body: { type: 'complaint', subject: 'Giao sai hàng', content: 'Tôi nhận sai loại cây', orderCode: 'XG000000-AAAAA' } });
        assert.equal(badOrder.status, 400);
        const sent = await call(ctx, 'POST', '/feedbacks', { token: a.token, body: { type: 'complaint', subject: 'Giao sai hàng', content: 'Tôi nhận sai loại cây' } });
        assert.equal(sent.status, 201);
        assert.equal((await call(ctx, 'GET', '/feedbacks', { token: b.token })).body.length, 0);
        assert.equal((await call(ctx, 'PATCH', `/feedbacks/${sent.body.id}/reply`, { token: a.token, body: { reply: 'tự trả lời' } })).status, 403);
        const reply = await call(ctx, 'PATCH', `/feedbacks/${sent.body.id}/reply`, { token: admin, body: { reply: 'Shop xin lỗi, sẽ đổi cây mới cho bạn.' } });
        assert.equal(reply.body.status, 'resolved');
    });

    test('tối đa 5 phản hồi đang chờ xử lý', async () => {
        const { token } = await newCustomer(ctx);
        for (let i = 0; i < 5; i += 1) {
            assert.equal((await call(ctx, 'POST', '/feedbacks', { token, body: { type: 'suggestion', subject: `Góp ý số ${i}`, content: 'Nội dung góp ý dài hơn mười ký tự' } })).status, 201);
        }
        assert.equal((await call(ctx, 'POST', '/feedbacks', { token, body: { type: 'suggestion', subject: 'Góp ý số 6', content: 'Nội dung góp ý dài hơn mười ký tự' } })).status, 429);
    });
});

describe('Chatbot tư vấn (không có khóa OpenAI)', () => {
    test('trả lời bằng dữ liệu thật, lưu lịch sử cho khách đăng nhập', async () => {
        const { token } = await newCustomer(ctx);
        const reply = await call(ctx, 'POST', '/chat', { token, body: { message: 'Cây lưỡi hổ giá bao nhiêu?' } });
        assert.equal(reply.status, 200);
        assert.equal(reply.body.mode, 'offline');
        assert.match(reply.body.reply, /120\.000/);
        const history = await call(ctx, 'GET', '/chat/history', { token });
        assert.equal(history.body.messages.length, 2, 'lưu cả câu hỏi và câu trả lời');
        const payment = await call(ctx, 'POST', '/chat', { token, body: { message: 'Thanh toán bằng cách nào?' } });
        assert.match(payment.body.reply, /1\.000\.000/, 'nêu đúng ngưỡng bắt buộc chuyển khoản');
        assert.doesNotMatch(payment.body.reply, /5\.000\.000/);
        assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: '' } })).status, 400);
        assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: 'a'.repeat(501) } })).status, 400);
    });

    test('giới hạn 8 tin/phút', async () => {
        const { token } = await newCustomer(ctx);
        for (let i = 0; i < 8; i += 1) assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: `phí ship bao nhiêu ${i}` } })).status, 200);
        assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: 'phí ship bao nhiêu' } })).status, 429);
    });
});

describe('Ghi nhận hành vi', () => {
    test('chỉ nhận sự kiện hợp lệ, bỏ qua dữ liệu lạ', async () => {
        const before = ctx.db.orders.length;
        const result = await call(ctx, 'POST', '/track', { body: { events: [{ type: 'pv', v: 'abcdef12', s: 'abcdef34', page: 'index' }, { type: 'hack', v: 'x' }] } });
        assert.equal(result.status, 204);
        assert.equal(ctx.db.orders.length, before);
    });
});
