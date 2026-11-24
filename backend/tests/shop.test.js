// Nghiệp vụ phía khách: xem sản phẩm, giỏ hàng theo tài khoản, sổ địa chỉ, đánh giá (chỉ người đã nhận hàng, kèm ảnh),
// góp ý/khiếu nại, chatbot tư vấn (chế độ không có AI), ghi nhận hành vi.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

    test('sản phẩm mới: lấy 4 sản phẩm tạo gần nhất, không có sản phẩm trong tháng thì vẫn giữ của tháng trước', async () => {
        const DAY = 24 * 60 * 60 * 1000;
        const ids = [];
        for (let i = 1; i <= 5; i += 1) {
            const created = await call(ctx, 'POST', '/admin/products', {
                token: admin,
                body: {
                    name: `Cây mới số ${i}`,
                    categoryId: 1,
                    price: 100000,
                    costPrice: 60000,
                    stock: 5,
                    image: 'p1.png',
                    description: 'Mô tả cây mới'
                }
            });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            ids.push(created.body.id);
            // cây số 5 mới nhất nhưng đã 40 ngày, nghĩa là tháng này không có sản phẩm mới nào
            ctx.db.products.find((item) => item.id === created.body.id).createdAt = new Date(
                Date.now() - ((6 - i) * 10 + 30) * DAY
            ).toISOString();
        }
        const fresh = (await call(ctx, 'GET', '/products/new?limit=4')).body;
        assert.deepEqual(
            fresh.map((item) => item.id),
            [ids[4], ids[3], ids[2], ids[1]]
        );
        assert.equal(fresh[0].isNew, false, 'quá hạn thì không còn nhãn Mới');
    });

    test('bán chạy tháng: không đề xuất hàng hết; nhập thêm hàng cũ là Mới về nhưng không phải sản phẩm mới', async () => {
        const featured = await call(ctx, 'GET', '/products/featured?limit=24');
        assert.ok(featured.body.length > 0);
        assert.ok(
            featured.body.every((product) => product.stock > 0),
            'không có sản phẩm hết hàng'
        );
        await call(ctx, 'PATCH', '/admin/products/11/stock', { token: admin, body: { add: 5, note: 'Lô mới' } });
        const fresh = await call(ctx, 'GET', '/products/new?limit=4');
        assert.equal(
            fresh.body.some((item) => item.id === '11'),
            false
        );
        assert.equal((await call(ctx, 'GET', '/products/11')).body.restocked, true);
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
        assert.deepEqual(
            list.body.map((product) => product.name),
            ['Sen đá nhỏ', 'Kim tiền']
        );
        const removed = await call(ctx, 'DELETE', '/favorites/7', { token });
        assert.deepEqual(removed.body.ids, ['3']);
        assert.equal((await call(ctx, 'GET', '/favorites', { token: admin })).status, 403);
    });
});

describe('Trang thông tin (chính sách, cẩm nang)', () => {
    test('lấy nội dung từ cơ sở tri thức, ẩn phần chỉ dành cho chatbot', async () => {
        const list = await call(ctx, 'GET', '/pages');
        assert.deepEqual(
            list.body.map((page) => page.slug),
            ['mua-hang', 'doi-tra', 'cham-soc', 'chon-cay', 'hoi-dap', 'bao-mat', 'dieu-khoan']
        );
        const faq = await call(ctx, 'GET', '/pages/hoi-dap');
        assert.ok(faq.body.sections.length > 5);
        assert.ok(faq.body.sections.every((section) => !/chatbot/i.test(section.title)));
        const policy = await call(ctx, 'GET', '/pages/mua-hang');
        assert.ok(policy.body.sections.some((section) => section.body.includes('1.000.000')));
        for (const slug of ['bao-mat', 'dieu-khoan'])
            assert.ok((await call(ctx, 'GET', `/pages/${slug}`)).body.sections.length >= 4, `có trang ${slug}`);
        assert.equal((await call(ctx, 'GET', '/pages/khong-co')).status, 404);
        assert.equal((await call(ctx, 'GET', '/pages/__proto__')).status, 404);
    });
});

describe('Giỏ hàng theo tài khoản', () => {
    test('ghi đè, gộp dòng trùng, giới hạn theo tồn kho và 20/dòng, loại hàng hết/không còn', async () => {
        const { token } = await newCustomer(ctx);
        const result = await call(ctx, 'PUT', '/cart', {
            token,
            body: {
                items: [
                    { id: '1', qty: 2 },
                    { id: '1', qty: 3 },
                    { id: '8', qty: 10 },
                    { id: '7', qty: 50 },
                    { id: '13', qty: 1 },
                    { id: 'xoa', qty: 1 },
                    { id: '2', qty: -1 }
                ]
            }
        });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.items, [
            { id: '1', qty: 5 },
            { id: '8', qty: 3 },
            { id: '7', qty: 20 }
        ]);
        assert.deepEqual(result.body.removed.map((item) => item.reason).sort(), ['removed', 'soldout']);
        const again = await call(ctx, 'GET', '/cart', { token });
        assert.deepEqual(again.body.items, result.body.items, 'giỏ được lưu trên server');
    });

    test('gộp giỏ lúc chưa đăng nhập vào giỏ tài khoản; xóa giỏ', async () => {
        const { token } = await newCustomer(ctx);
        await call(ctx, 'PUT', '/cart', { token, body: { items: [{ id: '1', qty: 1 }] } });
        const merged = await call(ctx, 'POST', '/cart/merge', {
            token,
            body: {
                items: [
                    { id: '1', qty: 2 },
                    { id: '9', qty: 1 }
                ]
            }
        });
        assert.deepEqual(merged.body.items, [
            { id: '1', qty: 3 },
            { id: '9', qty: 1 }
        ]);
        assert.equal((await call(ctx, 'DELETE', '/cart', { token })).status, 204);
        assert.deepEqual((await call(ctx, 'GET', '/cart', { token })).body.items, []);
        assert.equal((await call(ctx, 'PUT', '/cart', { token, body: { items: 'abc' } })).status, 400);
    });
});

describe('Sổ địa chỉ', () => {
    test('thêm, sửa, đặt mặc định, xóa địa chỉ mặc định thì địa chỉ khác thành mặc định', async () => {
        const { token } = await newCustomer(ctx);
        const bad = await call(ctx, 'POST', '/addresses', { token, body: { fullName: 'A', phone: '123', street: 'x' } });
        assert.equal(bad.status, 400);
        await addAddress(ctx, token);
        let book = (
            await call(ctx, 'POST', '/addresses', {
                token,
                body: {
                    fullName: 'Trần Thị B',
                    phone: '0912 345 678',
                    street: '45 Trần Phú',
                    ward: 'Phường Hải Châu',
                    province: 'Thành phố Đà Nẵng'
                }
            })
        ).body;
        assert.equal(book.length, 2);
        assert.equal(book[0].isDefault, true, 'địa chỉ đầu tiên là mặc định');
        assert.equal(book[1].phone, '0912345678', 'số điện thoại được chuẩn hóa');
        book = (await call(ctx, 'PUT', `/addresses/${book[1].id}`, { token, body: { ...book[1], isDefault: true } })).body;
        assert.deepEqual(
            book.map((item) => item.isDefault),
            [false, true]
        );
        book = (await call(ctx, 'DELETE', `/addresses/${book[1].id}`, { token })).body;
        assert.equal(book.length, 1);
        assert.equal(book[0].isDefault, true);
    });

    test('tối đa 10 địa chỉ', async () => {
        const { token } = await newCustomer(ctx);
        for (let i = 0; i < 10; i += 1) await addAddress(ctx, token);
        const eleventh = await call(ctx, 'POST', '/addresses', {
            token,
            body: {
                fullName: 'Nguyễn Văn A',
                phone: '0901234567',
                street: '12 Lê Lợi',
                province: 'Thành phố Hồ Chí Minh',
                ward: 'Phường Tân Định'
            }
        });
        assert.equal(eleventh.status, 409);
    });
});

describe('Đánh giá sản phẩm', () => {
    test('chỉ khách đã nhận hàng mới được đánh giá, mỗi sản phẩm một lần, kèm ảnh', async () => {
        const { token } = await newCustomer(ctx);
        const status = await call(ctx, 'GET', '/products/2/review-status', { token });
        assert.deepEqual(status.body, { canReview: false, reason: 'not_purchased' });
        assert.equal(
            (await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 5, comment: 'Cây đẹp lắm' } })).status,
            403
        );

        const order = (await placeOrder(ctx, token, await addAddress(ctx, token), [['2', 1]])).body;
        for (const status of ['confirmed', 'shipping', 'delivered']) {
            await call(ctx, 'PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } });
        }
        assert.equal((await call(ctx, 'GET', '/products/2/review-status', { token })).body.canReview, true);

        const fake = await call(ctx, 'POST', '/uploads/reviews', {
            token,
            raw: Buffer.from('<script>alert(1)</script> not an image'),
            headers: { 'Content-Type': 'image/png' }
        });
        assert.equal(fake.status, 400, 'tệp giả mạo đuôi ảnh bị từ chối');
        const upload = await call(ctx, 'POST', '/uploads/reviews', { token, raw: PNG, headers: { 'Content-Type': 'image/png' } });
        assert.equal(upload.status, 201, JSON.stringify(upload.body));
        const image = await fetch(`${ctx.base.replace('/api', '')}${upload.body.url}`);
        assert.equal(image.status, 200, 'ảnh tải lên xem được');

        assert.equal(
            (await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 6, comment: 'Cây đẹp lắm' } })).status,
            400
        );
        const review = await call(ctx, 'POST', '/reviews', {
            token,
            body: { productId: '2', rating: 5, comment: 'Cây đẹp, đóng gói kỹ', media: [upload.body.id] }
        });
        assert.equal(review.status, 201, JSON.stringify(review.body));
        assert.equal(review.body.media.length, 1);
        assert.equal(
            (await call(ctx, 'POST', '/reviews', { token, body: { productId: '2', rating: 4, comment: 'Đánh giá lần hai' } })).status,
            403
        );
        const list = await call(ctx, 'GET', '/products/2/reviews');
        assert.equal(list.body.length, 1);
        const latest = await call(ctx, 'GET', '/reviews/latest');
        assert.equal(latest.body[0].productName, 'Trầu bà đế vương');
        assert.equal(latest.body[0].photo, upload.body.url);
        const product = (await call(ctx, 'GET', '/products/2')).body;
        assert.deepEqual([product.ratingCount, product.rating, product.sold], [1, 5, 1], 'thẻ sản phẩm có điểm đánh giá và số đã bán thật');

        // Khách không tự xóa được đánh giá (kể cả của chính mình); chỉ đóng để ẩn trên màn hình mình
        const other = await newCustomer(ctx);
        assert.equal((await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token: other.token })).status, 403);
        assert.equal((await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token })).status, 403, 'tác giả cũng không xóa được');
        assert.equal(
            (await call(ctx, 'POST', `/reviews/${review.body.id}/close`, { token: other.token })).status,
            403,
            'không đóng hộ người khác'
        );
        assert.equal((await call(ctx, 'POST', `/reviews/${review.body.id}/close`, { token })).status, 204);
        const mine = (await call(ctx, 'GET', '/products/2/reviews', { token })).body;
        assert.equal(mine[0].closedByMe, true, 'màn hình tác giả đánh dấu đã đóng');
        assert.equal(mine[0].authorClosed, undefined);
        assert.equal(
            (await call(ctx, 'GET', '/products/2/reviews', { token: other.token })).body[0].closedByMe,
            undefined,
            'người khác vẫn thấy bình thường'
        );
        assert.equal((await call(ctx, 'GET', '/products/2')).body.ratingCount, 1, 'đánh giá đã đóng vẫn tính điểm');

        // Phân quyền quản lý đánh giá: nhân viên xem và phản hồi, chỉ admin/chủ mới xóa
        const staff = await newCustomer(ctx);
        const owner = await newCustomer(ctx);
        assert.equal(
            (await call(ctx, 'PATCH', `/admin/users/${staff.user.id}/role`, { token: admin, body: { role: 'staff' } })).status,
            200
        );
        assert.equal(
            (await call(ctx, 'PATCH', `/admin/users/${owner.user.id}/role`, { token: admin, body: { role: 'owner' } })).status,
            200
        );
        assert.equal((await call(ctx, 'GET', '/admin/reviews', { token })).status, 403, 'khách không vào trang quản lý đánh giá');
        const managed = await call(ctx, 'GET', '/admin/reviews', { token: staff.token });
        assert.equal(managed.status, 200);
        assert.equal(managed.body[0].authorClosed, true, 'cửa hàng vẫn thấy đánh giá khách đã đóng');
        assert.equal(managed.body[0].productName, 'Trầu bà đế vương');

        assert.equal(
            (await call(ctx, 'PATCH', `/reviews/${review.body.id}/reply`, { token, body: { reply: 'Tự trả lời' } })).status,
            403,
            'khách không phản hồi'
        );
        assert.equal(
            (await call(ctx, 'PATCH', `/reviews/${review.body.id}/reply`, { token: staff.token, body: { reply: 'x' } })).status,
            400,
            'phản hồi quá ngắn'
        );
        const reply = await call(ctx, 'PATCH', `/reviews/${review.body.id}/reply`, {
            token: staff.token,
            body: { reply: 'Cảm ơn bạn đã ủng hộ shop' }
        });
        assert.equal(reply.status, 200);
        assert.equal(reply.body.reply.by, staff.name);
        assert.equal(
            (await call(ctx, 'GET', '/products/2/reviews', { token: other.token })).body[0].reply.text,
            'Cảm ơn bạn đã ủng hộ shop',
            'khách khác thấy phản hồi công khai'
        );

        assert.equal((await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token: staff.token })).status, 403, 'nhân viên không xóa');
        assert.equal(
            (await call(ctx, 'DELETE', `/reviews/${review.body.id}`, { token: owner.token })).status,
            204,
            'chủ cửa hàng được xóa'
        );
        assert.equal((await call(ctx, 'GET', '/admin/reviews', { token: admin })).body.length, 0);
    });
});

describe('Góp ý / khiếu nại', () => {
    test('khách gửi, chỉ thấy của mình; mã đơn phải thuộc tài khoản; admin trả lời', async () => {
        const a = await newCustomer(ctx);
        const b = await newCustomer(ctx);
        const badOrder = await call(ctx, 'POST', '/feedbacks', {
            token: a.token,
            body: { type: 'complaint', subject: 'Giao sai hàng', content: 'Tôi nhận sai loại cây', orderCode: 'XG000000-AAAAA' }
        });
        assert.equal(badOrder.status, 400);
        const sent = await call(ctx, 'POST', '/feedbacks', {
            token: a.token,
            body: { type: 'complaint', subject: 'Giao sai hàng', content: 'Tôi nhận sai loại cây' }
        });
        assert.equal(sent.status, 201);
        assert.equal((await call(ctx, 'GET', '/feedbacks', { token: b.token })).body.length, 0);
        assert.equal(
            (await call(ctx, 'PATCH', `/feedbacks/${sent.body.id}/reply`, { token: a.token, body: { reply: 'tự trả lời' } })).status,
            403
        );
        const reply = await call(ctx, 'PATCH', `/feedbacks/${sent.body.id}/reply`, {
            token: admin,
            body: { reply: 'Shop xin lỗi, sẽ đổi cây mới cho bạn.' }
        });
        assert.equal(reply.body.status, 'resolved');
    });

    test('tối đa 5 phản hồi đang chờ xử lý', async () => {
        const { token } = await newCustomer(ctx);
        for (let i = 0; i < 5; i += 1) {
            assert.equal(
                (
                    await call(ctx, 'POST', '/feedbacks', {
                        token,
                        body: { type: 'suggestion', subject: `Góp ý số ${i}`, content: 'Nội dung góp ý dài hơn mười ký tự' }
                    })
                ).status,
                201
            );
        }
        assert.equal(
            (
                await call(ctx, 'POST', '/feedbacks', {
                    token,
                    body: { type: 'suggestion', subject: 'Góp ý số 6', content: 'Nội dung góp ý dài hơn mười ký tự' }
                })
            ).status,
            429
        );
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
        for (let i = 0; i < 8; i += 1)
            assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: `phí ship bao nhiêu ${i}` } })).status, 200);
        assert.equal((await call(ctx, 'POST', '/chat', { token, body: { message: 'phí ship bao nhiêu' } })).status, 429);
    });

    test('hỏi sản phẩm mới: trả đúng 4 sản phẩm tạo gần nhất', async () => {
        const { token } = await newCustomer(ctx);
        const reply = await call(ctx, 'POST', '/chat', { token, body: { message: 'Sản phẩm mới nhất của shop là gì?' } });
        const newest = (await call(ctx, 'GET', '/products/new?limit=4')).body;
        assert.equal(newest.length, 4);
        newest.forEach((product) => assert.ok(reply.body.reply.includes(product.name), product.name));
    });

    test('hỏi cây ít nắng: không gợi ý cây cần nắng (kể cả "nắng nhẹ")', async () => {
        const sunny = {
            id: 'nang1',
            name: 'Cây Bạc Hà Thử',
            price: 30000,
            categoryId: '1',
            stock: 9,
            care: ['Ánh sáng: Nắng nhẹ hoặc sáng nhiều']
        };
        const shady = { id: 'bong1', name: 'Cây Ngọc Ngân Thử', price: 140000, categoryId: '1', stock: 9, care: ['Ánh sáng: Chịu bóng'] };
        ctx.db.products.push({ ...sunny, createdAt: new Date().toISOString() }, { ...shady, createdAt: new Date().toISOString() });
        try {
            const { token } = await newCustomer(ctx);
            const message = 'Mình muốn cây để bàn làm việc, ít nắng, dưới 200 nghìn';
            const reply = (await call(ctx, 'POST', '/chat', { token, body: { message } })).body.reply;
            assert.match(reply, /Ngọc Ngân Thử/);
            assert.doesNotMatch(reply, /Bạc Hà Thử/);
        } finally {
            ctx.db.products = ctx.db.products.filter((item) => !['nang1', 'bong1'].includes(item.id));
        }
    });

    test('câu ngoài phạm vi không bị trả lời bằng đoạn tài liệu chỉ trùng vài từ', async () => {
        const { token } = await newCustomer(ctx);
        const reply = (await call(ctx, 'POST', '/chat', { token, body: { message: 'Viết giúp mình bài văn về mùa thu' } })).body.reply;
        assert.match(reply, /chỉ hỗ trợ về cây cảnh/);
    });

    test('hỏi cách làm: trả đúng mục hướng dẫn và thông tin liên hệ', async () => {
        const { token } = await newCustomer(ctx);
        const ask = async (message) => (await call(ctx, 'POST', '/chat', { token, body: { message } })).body;
        const order = await ask('làm sao để đặt hàng?');
        assert.equal(order.mode, 'offline', 'câu hỏi cách làm không bị chặn');
        assert.match(order.reply, /Mua ngay/);
        assert.match((await ask('cách hủy đơn')).reply, /Yêu cầu hủy đơn/);
        assert.match((await ask('đơn đã xác nhận rồi có hủy được không')).reply, /48 giờ/);
        assert.match((await ask('số điện thoại cửa hàng là gì')).reply, /0901 234 567/);
        assert.match((await ask('bao lâu thì đơn tự xác nhận đã nhận hàng')).reply, /7 ngày/);
    });

    test('hỏi tiếp ngắn hiểu cây đang nói tới; hỏi về trợ lý, hỏi món không bán đều trả lời đúng', async () => {
        const ask = async (message, history = []) =>
            (await call(ctx, 'POST', '/chat', { body: { message, history, visitor: 'followup2026' } })).body;
        const history = [
            { role: 'user', content: 'có bán lưỡi hổ không' },
            { role: 'assistant', content: '[Lưỡi hổ](./product-detail.html?id=1) – 120.000 ₫, còn 30 sản phẩm.' }
        ];
        assert.match((await ask('giá bao nhiêu', history)).reply, /Lưỡi hổ.*120\.000/);
        assert.match((await ask('giá bao nhiêu')).reply, /cây nào/, 'không rõ cây thì hỏi lại, không trả lời lạc đề');
        const bot = await ask('bạn đang dùng model AI nào');
        assert.equal(bot.mode, 'rule');
        assert.match(bot.reply, /trợ lý tự động/);
        assert.match((await ask('có mô hình tiểu cảnh không')).reply, /chưa có sản phẩm này/);
    });

    test('lệnh thao tác (đặt hàng, tra số dư) bị từ chối kèm hướng dẫn, không gọi AI', async () => {
        // Giả lập OpenAI để đếm số lần bị gọi
        let aiCalls = 0;
        const fake = http.createServer((req, res) => {
            aiCalls += 1;
            req.resume();
            res.statusCode = 500;
            res.end('{}');
        });
        await new Promise((resolve) => fake.listen(0, resolve));
        process.env.OPENAI_BASE_URL = `http://localhost:${fake.address().port}`;
        process.env.OPENAI_API_KEY = 'khoa-gia';
        try {
            const { token } = await newCustomer(ctx);
            const ask = async (message) => (await call(ctx, 'POST', '/chat', { token, body: { message } })).body;
            const order = await ask('đặt hàng 30 cây lưỡi hổ cho tôi');
            assert.equal(order.mode, 'rule');
            assert.match(order.reply, /không thể tự đặt hàng/);
            assert.match(order.reply, /product-detail\.html\?id=1\)/, 'kèm link sản phẩm');
            assert.match(order.reply, /tối đa 20 cái/, 'nêu giới hạn mỗi đơn');
            const balance = await ask('tra số dư giúp mình');
            assert.equal(balance.mode, 'rule');
            assert.match(balance.reply, /không có ví tiền/);
            assert.equal((await ask('hủy đơn giúp mình')).mode, 'rule');
            assert.equal(aiCalls, 0, 'câu đã chặn không tốn lượt gọi AI');
        } finally {
            delete process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_BASE_URL;
            fake.close();
        }
    });

    test('có AI: link sai mã được sửa theo tên, không có sản phẩm thì chỉ giữ chữ', async () => {
        const product = ctx.db.products[0];
        // Giả lập OpenAI: không có embedding, câu trả lời có 2 link sai mã
        const fake = http.createServer((req, res) => {
            req.resume();
            res.setHeader('Content-Type', 'application/json');
            if (req.url.endsWith('/embeddings')) {
                res.statusCode = 500;
                return res.end('{}');
            }
            res.end(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: `[${product.name}](./product-detail.html?id=sai) và [Cây bịa](./product-detail.html?id=khong-co)`
                            }
                        }
                    ]
                })
            );
        });
        await new Promise((resolve) => fake.listen(0, resolve));
        process.env.OPENAI_BASE_URL = `http://localhost:${fake.address().port}`;
        process.env.OPENAI_API_KEY = 'khoa-gia';
        try {
            const { token } = await newCustomer(ctx);
            const reply = await call(ctx, 'POST', '/chat', { token, body: { message: 'Gợi ý cây giúp mình' } });
            assert.equal(reply.status, 200);
            assert.equal(reply.body.reply, `[${product.name}](./product-detail.html?id=${product.id}) và Cây bịa`);
        } finally {
            delete process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_BASE_URL;
            fake.close();
        }
    });
});

describe('Ghi nhận hành vi', () => {
    test('chỉ nhận sự kiện hợp lệ, bỏ qua dữ liệu lạ', async () => {
        const before = ctx.db.orders.length;
        const result = await call(ctx, 'POST', '/track', {
            body: {
                events: [
                    { type: 'pv', v: 'abcdef12', s: 'abcdef34', page: 'index' },
                    { type: 'hack', v: 'x' }
                ]
            }
        });
        assert.equal(result.status, 204);
        assert.equal(ctx.db.orders.length, before);
    });
});

describe('Quy tắc số điện thoại và địa chỉ', () => {
    const place = { ward: 'Phường Tân Định', province: 'Thành phố Hồ Chí Minh' };
    const send = (token, phone, extra = {}) =>
        call(ctx, 'POST', '/addresses', { token, body: { fullName: 'Nguyễn Văn A', phone, street: '12 Lê Lợi', ...place, ...extra } });

    test('số điện thoại phải là số di động Việt Nam; +84 được đổi về 0', async () => {
        const { token } = await newCustomer(ctx);
        for (const phone of ['0123456789', '0201234567', '090123456', '09012345678', 'abcdefghij', '1901234567'])
            assert.equal((await send(token, phone)).status, 400, phone);
        const ok = await send(token, '+84 901 234 567');
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        assert.equal(ok.body[0].phone, '0901234567');
    });

    test('bắt buộc đủ tỉnh/thành, phường/xã (có thật, phường thuộc tỉnh) và số nhà; số nhà, đường gõ gì cũng được', async () => {
        const { token } = await newCustomer(ctx);
        const phone = '0901234567';
        const cases = [
            [{ street: '' }, /số nhà/],
            [{ street: '   ' }, /số nhà/],
            [{ ward: '' }, /Phường\/Xã/],
            [{ province: '' }, /Tỉnh/],
            [{ province: 'Tỉnh Không Có' }, /Tỉnh/],
            [{ ward: 'Phường Hải Châu' }, /không thuộc/], // phường của Đà Nẵng
            [{ ward: 'Phường Ba Đình' }, /không thuộc/] // phường của Hà Nội
        ];
        for (const [extra, message] of cases) {
            const res = await send(token, phone, extra);
            assert.equal(res.status, 400, JSON.stringify(extra));
            assert.match(res.body.message, message, JSON.stringify(extra));
        }
        for (const street of ['12', 'Lê Lợi', 'ngõ 5 hẻm 7/2A khu tập thể', '5/7A Nguyễn Huệ'])
            assert.equal((await send(token, phone, { street })).status, 201, street);
    });

    test('dòng địa chỉ in trên đơn được ghép theo thứ tự số nhà, phường/xã, tỉnh/thành', async () => {
        const { token } = await newCustomer(ctx);
        const book = (await send(token, '0901234567')).body;
        assert.equal(book[0].address, '12 Lê Lợi, Phường Tân Định, Thành phố Hồ Chí Minh');
        assert.equal(book[0].district, undefined, 'không còn cấp quận/huyện');
    });

    test('địa chỉ cũ (chưa chọn phường/tỉnh) bị chặn khi đặt hàng, sửa lại thì đặt được', async () => {
        const { token, user } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        const stored = ctx.db.user.find((item) => item.id === user.id).addresses[0];
        Object.assign(stored, { address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh', district: 'Quận 1' });
        delete stored.ward;
        delete stored.province;
        const blocked = await placeOrder(ctx, token, addressId, [['2', 1]]);
        assert.equal(blocked.status, 400);
        assert.match(blocked.body.message, /Sổ địa chỉ/);
        const fixed = await call(ctx, 'PUT', `/addresses/${addressId}`, { token, body: { ...stored, street: '12 Lê Lợi', ...place } });
        assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
        assert.equal(fixed.body[0].district, undefined);
        assert.equal((await placeOrder(ctx, token, addressId, [['2', 1]])).status, 201);
    });

    test('địa chỉ đã lưu mà thiếu số nhà cũng bị chặn khi đặt hàng', async () => {
        const { token, user } = await newCustomer(ctx);
        const addressId = await addAddress(ctx, token);
        ctx.db.user.find((item) => item.id === user.id).addresses[0].street = '';
        const blocked = await placeOrder(ctx, token, addressId, [['2', 1]]);
        assert.equal(blocked.status, 400);
        assert.match(blocked.body.message, /số nhà/);
    });

    test('danh sách 34 tỉnh/thành và phường/xã hiện hành có sẵn cho giao diện', async () => {
        const res = await call(ctx, 'GET', '/divisions');
        assert.equal(res.status, 200);
        assert.equal(res.body.length, 34);
        assert.ok(res.body.reduce((sum, [, wards]) => sum + wards.length, 0) > 3000);
        assert.ok(res.body.every(([name, wards]) => name && wards.length));
    });
});
