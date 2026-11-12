import { Router } from 'express';
import { byId, db, newId, save } from '../core/store.js';
import { fail, handle, requirePermission, requireRole } from '../core/http.js';
import { hasPermission } from '../core/permissions.js';
import { addressProblem, normalizePhone } from '../core/address.js';
import {
    CANCEL_REQUEST_TTL_MS,
    HIGH_VALUE_FROM,
    MAX_COD_TOTAL,
    MAX_LINE_QUANTITY,
    MAX_OPEN_UNPAID_ORDERS,
    MAX_ORDER_TOTAL,
    ORDER_TRANSITIONS,
    PAYMENT_TTL_MS,
    parseCancelReason,
    parseOrderOptions
} from '../core/rules.js';
import { paymentInfo } from '../services/sepay.js';
import { logStock } from '../services/inventory.js';
import { quote, walletFor } from '../services/pricing.js';
import { consumeVouchers } from '../services/vouchers.js';
import { approveCancelRequest, cancelOrder, markPaid, publicOrder, setStatus, sweepExpired } from '../services/orders.js';
import { sendAutoInvoice, sendInvoiceMail } from '../services/order-mail.js';
import { getShop } from '../services/settings.js';

const router = Router();
router.use(requireRole());
router.use((_req, _res, next) => {
    sweepExpired();
    next();
});

const isOwner = (user, order) => String(order.userId) === String(user.id);

function findOrder(idOrCode, user) {
    const order = db.orders.find((item) => item.id === idOrCode || item.code === idOrCode) || fail(404, 'Không tìm thấy đơn hàng.');
    if (!hasPermission(user, 'orders.view') && !isOwner(user, order)) fail(403, 'Bạn không có quyền xem đơn hàng này.');
    return order;
}

// Mã đơn XG + ngày đặt theo giờ Việt Nam (đặt lúc 6 giờ sáng 15/10 vẫn là ...261015, không phải ngày UTC hôm trước).
function createCode() {
    const date = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(2, 10).replace(/-/g, '');
    const code = `XG${date}-${newId().slice(0, 5).toUpperCase().replace(/[-_]/g, 'X')}`;
    return db.orders.some((order) => order.code === code) ? createCode() : code;
}

// Gộp các dòng trùng sản phẩm và kiểm tra định dạng số lượng.
function parseItems(rawItems) {
    if (!Array.isArray(rawItems) || !rawItems.length) fail(400, 'Giỏ hàng đang trống.');
    if (rawItems.length > 50) fail(400, 'Đơn hàng có quá nhiều sản phẩm.');

    const quantities = new Map();
    rawItems.forEach((entry) => {
        const qty = Number(entry?.qty);
        if (!Number.isInteger(qty) || qty < 1) fail(400, 'Số lượng sản phẩm không hợp lệ.');
        const id = String(entry.id);
        quantities.set(id, (quantities.get(id) || 0) + qty);
    });
    return quantities;
}

const isOpenUnpaid = (order) =>
    order.status === 'unconfirmed' || (order.status === 'pending' && order.paymentMethod === 'sepay' && order.paymentStatus === 'unpaid');

const signature = (order) =>
    `${order.customer.address}|${[...order.items]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((i) => `${i.id}x${i.qty}`)
        .join(',')}`;

const PAYMENT_LABEL = { cod: 'Thanh toán khi nhận hàng (COD)', sepay: 'Chuyển khoản QR (SePay)' };

// Kiểm tra từng dòng hàng (tồn tại, số lượng, tồn kho) và trả về sản phẩm thật của server.
function buildLines(quantities) {
    return [...quantities].map(([id, qty]) => {
        const product = byId('products', id) || fail(400, 'Có sản phẩm không còn tồn tại trong cửa hàng.');
        if (qty > MAX_LINE_QUANTITY) fail(400, `Mỗi sản phẩm chỉ được mua tối đa ${MAX_LINE_QUANTITY} cái mỗi đơn.`);
        if (product.stock <= 0) fail(409, `“${product.name}” đã hết hàng.`);
        if (product.stock < qty) fail(409, `“${product.name}” chỉ còn ${product.stock} sản phẩm trong kho.`);
        return { product, qty };
    });
}

// Đặt hàng xong thì bỏ các sản phẩm đã đặt khỏi giỏ lưu trên server của người đó.
function clearUserCart(userId, lines) {
    const cart = db.carts.find((item) => item.userId === userId);
    if (!cart) return;
    const ordered = new Set(lines.map(({ product }) => String(product.id)));
    cart.items = cart.items.filter((item) => !ordered.has(String(item.id)));
    cart.updatedAt = new Date().toISOString();
}

// Xem trước giá: tạm tính, voucher áp dụng, phí ship, tổng, và danh sách voucher trong ví dùng được hay không.
router.post(
    '/quote',
    handle((req, res) => {
        if (!hasPermission(req.user, 'customer.purchase')) fail(403, 'Tài khoản quản trị không đặt hàng.');
        const user = byId('user', req.user.id);
        const options = parseOrderOptions({ paymentMethod: 'cod', ...req.body });
        const lines = buildLines(parseItems(req.body?.items));
        const priced = quote({ user, lines, shippingMethod: options.shippingMethod, entryIds: req.body?.voucherIds });
        const context = { lines, goods: priced.goods, fee: priced.shippingFee };
        res.json({
            goods: priced.goods,
            discount: priced.discount,
            promo: priced.promo,
            shippingFee: priced.shippingFee,
            shippingDiscount: priced.shippingDiscount,
            total: priced.total,
            applied: priced.applied.map(({ entry, voucher, amount }) => ({
                id: entry.id,
                code: voucher.code,
                name: voucher.name,
                kind: voucher.kind,
                amount
            })),
            problems: priced.problems,
            wallet: walletFor(user, context)
                .filter((row) => row.status === 'available' && row.voucher)
                .map(({ entry, voucher, check }) => ({
                    id: entry.id,
                    code: voucher.code,
                    name: voucher.name,
                    kind: voucher.kind,
                    type: voucher.type,
                    value: voucher.value,
                    maxDiscount: voucher.maxDiscount,
                    minOrder: voucher.minOrder,
                    expiresAt: entry.expiresAt,
                    usable: check.ok,
                    reason: check.reason,
                    amount: check.amount
                }))
        });
    })
);

router.get(
    '/',
    handle((req, res) => {
        const orders = hasPermission(req.user, 'orders.view') ? db.orders : db.orders.filter((order) => isOwner(req.user, order));
        res.json([...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicOrder));
    })
);

router.get(
    '/:id',
    handle((req, res) => res.json(publicOrder(findOrder(req.params.id, req.user))))
);

router.get(
    '/:id/payment-info',
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        if (order.paymentMethod !== 'sepay') fail(400, 'Đơn hàng này không thanh toán qua SePay.');
        res.json({
            ...paymentInfo(order),
            paymentStatus: order.paymentStatus,
            status: order.status,
            expiresAt: order.payExpiresAt || null
        });
    })
);

router.post(
    '/',
    handle((req, res) => {
        if (!hasPermission(req.user, 'customer.purchase')) fail(403, 'Tài khoản quản trị không thể đặt hàng.');

        const user = byId('user', req.user.id);
        const options = parseOrderOptions(req.body);
        const quantities = parseItems(req.body.items);
        const address =
            (user.addresses || []).find((item) => item.id === req.body.addressId) || fail(400, 'Vui lòng chọn địa chỉ nhận hàng.');
        // Địa chỉ lưu từ trước khi có quy tắc mới: bắt khách sửa lại trước khi đặt
        if (!normalizePhone(address.phone) || addressProblem(address.address))
            fail(
                400,
                `Địa chỉ nhận hàng chưa đúng quy định, hãy sửa lại trong Sổ địa chỉ. ${addressProblem(address.address) || 'Số điện thoại cần là số di động Việt Nam.'}`
            );
        const customer = {
            fullName: address.fullName,
            phone: address.phone,
            address: address.address,
            email: user.email,
            note: typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) : ''
        };

        // Kiểm tra toàn bộ trước khi trừ kho để đơn hàng không bị xử lý dở dang.
        const lines = buildLines(quantities);

        // Server tự tính tiền (hàng, voucher, ship). Giá trị tối đa xét trên tiền hàng TRƯỚC giảm giá để voucher không né được giới hạn;
        // COD xét trên số tiền khách thực trả.
        const priced = quote({ user, lines, shippingMethod: options.shippingMethod, entryIds: req.body.voucherIds, strict: true });
        const { goods: subtotal, discount: voucherDiscount, promo, shippingFee: fee, shippingDiscount, total, applied } = priced;
        const discount = voucherDiscount + (promo?.amount || 0); // giảm giá của đơn = voucher + ưu đãi sản phẩm mới (doanh thu tính từ số này)
        if (!Number.isSafeInteger(subtotal) || subtotal + fee > MAX_ORDER_TOTAL) {
            fail(400, `Giá trị đơn hàng tối đa ${MAX_ORDER_TOTAL.toLocaleString('vi-VN')} ₫. Vui lòng tách thành nhiều đơn.`);
        }
        // Đơn có tiền hàng trên 1 triệu: phải chuyển khoản trước, đơn được xác nhận tự động khi webhook SePay báo đủ tiền.
        const needsPrepay = subtotal > HIGH_VALUE_FROM;
        if (needsPrepay && options.paymentMethod !== 'sepay') {
            fail(
                400,
                `Đơn có giá trị hàng trên ${HIGH_VALUE_FROM.toLocaleString('vi-VN')} ₫ cần thanh toán chuyển khoản QR. Đơn sẽ được xác nhận tự động khi hệ thống nhận đủ tiền.`
            );
        }
        if (options.paymentMethod === 'cod' && total > MAX_COD_TOTAL) {
            fail(400, `Đơn trên ${MAX_COD_TOTAL.toLocaleString('vi-VN')} ₫ không áp dụng COD. Vui lòng thanh toán qua SePay.`);
        }

        const mine = db.orders.filter((order) => isOwner(req.user, order));
        if (mine.filter(isOpenUnpaid).length >= MAX_OPEN_UNPAID_ORDERS) {
            fail(
                409,
                `Bạn đang có ${MAX_OPEN_UNPAID_ORDERS} đơn chưa xác nhận/chưa thanh toán. Hãy hoàn tất hoặc hủy bớt trước khi đặt thêm.`
            );
        }

        const now = new Date().toISOString();
        const status = needsPrepay ? 'unconfirmed' : 'pending'; // unconfirmed = chờ thanh toán để xác nhận
        const order = {
            id: newId(),
            code: createCode(),
            userId: req.user.id,
            customer,
            items: lines.map(({ product, qty }) => ({
                id: String(product.id),
                name: product.name,
                price: product.price,
                qty,
                image: product.image
            })),
            subtotal,
            discount,
            shippingFee: fee,
            shippingDiscount,
            total,
            vouchers: [
                ...applied.map(({ entry, voucher, amount }) => ({
                    id: entry.id,
                    code: voucher.code,
                    name: voucher.name,
                    kind: voucher.kind,
                    amount
                })),
                ...(promo ? [{ id: null, code: promo.code, name: promo.name, kind: promo.kind, amount: promo.amount, auto: true }] : [])
            ],
            ...options,
            paymentStatus: 'unpaid',
            status,
            history: [{ status, at: now, by: req.user.name }],
            createdAt: now
        };
        if (options.paymentMethod === 'sepay') order.payExpiresAt = Date.now() + PAYMENT_TTL_MS; // quá hạn chưa trả tiền thì tự hủy

        // Chặn bấm đặt hàng hai lần / gửi trùng trong vài giây.
        const duplicate = mine.find(
            (other) =>
                other.status !== 'cancelled' && Date.now() - Date.parse(other.createdAt) < 10000 && signature(other) === signature(order)
        );
        if (duplicate) fail(429, 'Bạn vừa đặt một đơn giống hệt. Vui lòng kiểm tra "Đơn hàng của tôi".');

        lines.forEach(({ product, qty }) => {
            product.stock -= qty;
            if (product.stock < 0) throw new Error('Tồn kho âm'); // không thể xảy ra: đã kiểm tra ở trên trong cùng một lượt đồng bộ
            logStock(product, 'sale', -qty, { note: `Đơn ${order.code}`, by: req.user.name });
        });
        consumeVouchers(order, applied);
        clearUserCart(req.user.id, lines);
        db.orders.push(order);
        save();
        // COD: lên đơn xong là gửi hóa đơn. Chuyển khoản: chờ nhận đủ tiền mới gửi
        if (order.paymentMethod === 'cod') sendAutoInvoice(order);

        res.status(201).json(publicOrder(order));
    })
);

router.patch(
    '/:id/status',
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        const next = String(req.body?.status || '');
        const transitions = ORDER_TRANSITIONS[order.status] || {};
        const allowed = Object.hasOwn(transitions, next) ? transitions[next] : null;
        if (!allowed) fail(409, 'Không thể chuyển đơn hàng sang trạng thái này.');

        // Khách đặt đơn là 'customer' (không dùng chữ 'owner' vì trùng tên vai trò chủ cửa hàng)
        const actor = hasPermission(req.user, 'orders.manage') ? req.user.role : 'customer';
        if (!allowed.includes(actor)) fail(403, 'Bạn không có quyền thực hiện thao tác này.');
        // Khách hủy trực tiếp (đơn chưa được cửa hàng xác nhận) phải chọn lý do; đã thanh toán thì đơn chuyển sang "cần hoàn tiền".
        const customerReason = next === 'cancelled' && actor === 'customer' ? parseCancelReason(req.body) : null;
        if (next === 'shipping' && order.cancelRequest?.status === 'pending') {
            fail(409, 'Khách đang yêu cầu hủy đơn này. Hãy đồng ý hoặc từ chối yêu cầu trước khi giao hàng.');
        }

        if (next === 'confirmed' && order.paymentMethod === 'sepay' && order.paymentStatus !== 'paid') {
            fail(409, 'Đơn chuyển khoản SePay chưa nhận được tiền nên chưa thể xác nhận.');
        }

        if (next === 'cancelled') {
            const failedDelivery = order.status === 'shipping';
            const shopReason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
            cancelOrder(order, req.user.name);
            if (failedDelivery) order.cancelReason = 'Giao hàng không thành công, hàng đã hoàn về kho';
            else if (customerReason) {
                order.cancelReason = customerReason.label;
                order.cancelledBy = 'customer';
            } else {
                order.cancelReason = shopReason || 'Cửa hàng hủy đơn';
                order.cancelledBy = 'shop';
            }
            if (order.cancelRequest?.status === 'pending')
                Object.assign(order.cancelRequest, { status: 'approved', decidedAt: order.updatedAt, decidedBy: req.user.name });
        } else {
            setStatus(order, next, req.user.name);
            if (next === 'delivered' && order.paymentMethod === 'cod') {
                order.paymentStatus = 'paid';
                order.paidAt = order.updatedAt;
            }
        }
        save();
        res.json(publicOrder(order));
    })
);

// Gửi hóa đơn của đơn về email đặt hàng. Nội dung dựng từ dữ liệu đơn trên server; mỗi đơn tối đa 3 lần mỗi giờ để không bị lạm dụng gửi thư.
router.post(
    '/:id/invoice-email',
    handle(async (req, res) => {
        const order = findOrder(req.params.id, req.user);
        if (order.status === 'cancelled') fail(409, 'Đơn đã hủy nên không có hóa đơn.');
        const hourAgo = Date.now() - 3600000;
        const recent = (order.invoiceEmails || []).filter((time) => time > hourAgo);
        if (recent.length >= 3) fail(429, 'Hóa đơn của đơn này đã được gửi nhiều lần trong 1 giờ qua. Vui lòng thử lại sau.');
        try {
            await sendInvoiceMail(order, getShop());
        } catch (error) {
            console.error('[mail]', error.message);
            fail(502, 'Không gửi được email. Vui lòng thử lại sau.');
        }
        order.invoiceEmails = [...recent, Date.now()];
        save();
        const [name, domain] = order.customer.email.split('@');
        res.json({ sentTo: `${name.slice(0, 2)}***@${domain}` });
    })
);

// Khách gửi yêu cầu hủy khi cửa hàng đã xác nhận nhưng chưa giao cho vận chuyển. Cửa hàng đồng ý/từ chối; quá hạn không phản hồi thì tự đồng ý.
router.post(
    '/:id/cancel-request',
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        if (!isOwner(req.user, order)) fail(403, 'Chỉ người đặt hàng mới gửi được yêu cầu hủy.');
        if (['unconfirmed', 'pending'].includes(order.status)) fail(409, 'Đơn chưa được cửa hàng xác nhận nên bạn có thể hủy trực tiếp.');
        if (order.status !== 'confirmed')
            fail(
                409,
                order.status === 'cancelled'
                    ? 'Đơn hàng đã được hủy.'
                    : 'Đơn đã giao cho đơn vị vận chuyển nên không thể hủy. Vui lòng liên hệ cửa hàng.'
            );
        if (order.cancelRequest)
            fail(
                409,
                order.cancelRequest.status === 'pending'
                    ? 'Bạn đã gửi yêu cầu hủy, vui lòng chờ cửa hàng phản hồi.'
                    : 'Yêu cầu hủy của đơn này đã được xử lý.'
            );
        const reason = parseCancelReason(req.body);
        const now = new Date().toISOString();
        order.cancelRequest = {
            status: 'pending',
            reason: reason.label,
            at: now,
            expiresAt: new Date(Date.now() + CANCEL_REQUEST_TTL_MS).toISOString()
        };
        order.updatedAt = now;
        order.history.push({ status: order.status, at: now, by: req.user.name, note: `Khách yêu cầu hủy đơn: ${reason.label}` });
        save();
        res.json(publicOrder(order));
    })
);

router.patch(
    '/:id/cancel-request',
    requirePermission('orders.manage'),
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        const request = order.cancelRequest;
        if (request?.status !== 'pending') fail(409, 'Đơn này không có yêu cầu hủy đang chờ.');
        const decision = String(req.body?.decision || '');
        if (!['approve', 'reject'].includes(decision)) fail(400, 'Quyết định không hợp lệ.');
        if (decision === 'approve') {
            approveCancelRequest(order, req.user.name);
        } else {
            const now = new Date().toISOString();
            const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
            Object.assign(request, { status: 'rejected', decidedAt: now, decidedBy: req.user.name, ...(note ? { note } : {}) });
            order.updatedAt = now;
            order.history.push({ status: order.status, at: now, by: req.user.name, note: `Từ chối yêu cầu hủy${note ? `: ${note}` : ''}` });
        }
        save();
        res.json(publicOrder(order));
    })
);

// Khách đổi phương thức thanh toán (COD <-> chuyển khoản QR) khi đơn chưa thanh toán và cửa hàng chưa xác nhận.
// Không cho đổi nếu đã có giao dịch chuyển khoản ghi nhận cho đơn (kể cả chuyển thiếu) để tránh thất lạc tiền.
router.patch(
    '/:id/payment-method',
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        if (!isOwner(req.user, order)) fail(403, 'Chỉ người đặt hàng mới đổi được phương thức thanh toán.');
        const { paymentMethod } = parseOrderOptions({ shippingMethod: order.shippingMethod, paymentMethod: req.body?.paymentMethod });
        if (!['unconfirmed', 'pending'].includes(order.status) || order.paymentStatus !== 'unpaid') {
            fail(409, 'Đơn đã được xác nhận hoặc đã thanh toán nên không thể đổi phương thức thanh toán.');
        }
        if (paymentMethod === order.paymentMethod) fail(409, 'Đơn đang dùng phương thức thanh toán này.');
        // Đổi sang chuyển khoản thì đơn thành "chưa thanh toán": vẫn phải nằm trong giới hạn số đơn chưa thanh toán
        if (
            paymentMethod === 'sepay' &&
            db.orders.filter((other) => other !== order && isOwner(req.user, other) && isOpenUnpaid(other)).length >= MAX_OPEN_UNPAID_ORDERS
        ) {
            fail(
                409,
                `Bạn đang có ${MAX_OPEN_UNPAID_ORDERS} đơn chưa thanh toán. Hãy hoàn tất hoặc hủy bớt trước khi đổi sang chuyển khoản.`
            );
        }
        if (paymentMethod === 'cod' && order.subtotal > HIGH_VALUE_FROM) {
            fail(400, `Đơn có giá trị hàng trên ${HIGH_VALUE_FROM.toLocaleString('vi-VN')} ₫ phải thanh toán chuyển khoản.`);
        }
        if (paymentMethod === 'cod' && order.total > MAX_COD_TOTAL) {
            fail(400, `Đơn trên ${MAX_COD_TOTAL.toLocaleString('vi-VN')} ₫ không áp dụng thanh toán khi nhận hàng.`);
        }
        if (db.payments.some((payment) => payment.orderCode === order.code)) {
            fail(409, 'Đã ghi nhận giao dịch chuyển khoản cho đơn này. Vui lòng liên hệ cửa hàng qua trang Góp ý.');
        }
        const now = new Date().toISOString();
        order.paymentMethod = paymentMethod;
        if (paymentMethod === 'cod') delete order.payExpiresAt;
        else order.payExpiresAt = Date.now() + PAYMENT_TTL_MS;
        order.updatedAt = now;
        order.history.push({
            status: order.status,
            at: now,
            by: req.user.name,
            note: `Đổi thanh toán sang ${PAYMENT_LABEL[paymentMethod]}`
        });
        save();
        // Đổi sang COD thì đơn chưa từng có hóa đơn, gửi như lúc mới đặt
        if (paymentMethod === 'cod') sendAutoInvoice(order);
        res.json(publicOrder(order));
    })
);

// Admin xử lý tay: ghi nhận đã nhận tiền (khi webhook không khớp, ví dụ khách ghi sai nội dung) hoặc đã hoàn tiền cho đơn bị hủy.
// Ghi nhận đã nhận tiền dùng chung markPaid với webhook nên đơn trên 1 triệu cũng được xác nhận như khi tiền về tự động.
router.patch(
    '/:id/payment',
    requirePermission('payments.manage'),
    handle((req, res) => {
        const order = findOrder(req.params.id, req.user);
        const next = String(req.body?.paymentStatus || '');
        const valid =
            (next === 'paid' && order.paymentStatus === 'unpaid' && ['unconfirmed', 'pending', 'confirmed'].includes(order.status)) ||
            (next === 'refunded' && order.paymentStatus === 'refund_pending');
        if (!valid) fail(409, 'Không thể đổi trạng thái thanh toán này.');
        if (next === 'paid') {
            const autoConfirmed = markPaid(order, { by: req.user.name, note: 'Admin ghi nhận đã thanh toán' });
            save();
            sendAutoInvoice(order, { autoConfirmed });
            return res.json(publicOrder(order));
        }
        const now = new Date().toISOString();
        order.paymentStatus = next;
        order.history.push({ status: order.status, at: now, by: req.user.name, note: 'Admin ghi nhận đã hoàn tiền' });
        save();
        res.json(publicOrder(order));
    })
);

export default router;
