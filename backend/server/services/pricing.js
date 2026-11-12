import { byId, db } from '../core/store.js';
import { fail } from '../core/http.js';
import { entryStatus, hasOrdered, isLive } from './vouchers.js';
import { isNewProduct, newPromoOf } from './inventory.js';
import { shippingFee } from '../core/rules.js';
import { getSettings } from './settings.js';

// Phần của đơn mà voucher được áp dụng (theo phạm vi của voucher).
function eligibleLines(voucher, lines) {
    return lines.filter(({ product }) => {
        if (voucher.scope === 'all') return true;
        if (voucher.scope === 'category') return voucher.scopeIds.includes(String(product.categoryId));
        if (voucher.scope === 'product') return voucher.scopeIds.includes(String(product.id));
        if (voucher.scope === 'newProduct') return isNewProduct(product);
        return false;
    });
}

// Kiểm tra một voucher trong ví có áp dụng được cho đơn này không và giảm bao nhiêu.
// Trả về { ok, reason, amount }. Mọi quy tắc nằm ở đây để giỏ hàng, thanh toán và tạo đơn dùng chung.
export function evaluate(user, entry, voucher, { lines, goods, fee }) {
    const bad = (reason) => ({ ok: false, reason, amount: 0 });
    if (!voucher || !voucher.active) return bad('Voucher đã ngừng áp dụng.');
    if (entry.userId !== user.id) return bad('Voucher không thuộc tài khoản của bạn.');
    const status = entryStatus(entry);
    if (status === 'used') return bad('Voucher đã được sử dụng.');
    if (status === 'expired') return bad('Voucher đã hết hạn.');
    if (!isLive(voucher)) return bad('Voucher chưa đến hoặc đã quá thời gian chương trình.');
    if (voucher.audience === 'newUser' && hasOrdered(user.id)) return bad('Voucher chỉ dành cho đơn hàng đầu tiên của người dùng mới.');

    if (voucher.kind === 'shipping') {
        if (!fee) return bad('Đơn đã được miễn phí vận chuyển.');
        if (goods < voucher.minOrder) return bad(`Cần đơn từ ${voucher.minOrder.toLocaleString('vi-VN')} ₫ để dùng voucher này.`);
        const raw = voucher.type === 'percent' ? Math.floor((fee * voucher.value) / 100) : voucher.value;
        return { ok: true, reason: '', amount: Math.min(raw, voucher.maxDiscount, fee) };
    }

    const eligible = eligibleLines(voucher, lines).reduce((sum, { product, qty }) => sum + product.price * qty, 0);
    if (!eligible) return bad('Không có sản phẩm nào trong giỏ phù hợp với voucher này.');
    if (eligible < voucher.minOrder)
        return bad(`Cần mua từ ${voucher.minOrder.toLocaleString('vi-VN')} ₫ sản phẩm áp dụng để dùng voucher này.`);
    const raw = voucher.type === 'percent' ? Math.floor((eligible * voucher.value) / 100) : voucher.value;
    return { ok: true, reason: '', amount: Math.min(raw, voucher.maxDiscount, eligible) };
}

// Khuyến mãi tự động cho sản phẩm mới (admin bật ở trang Sản phẩm): giảm % trên phần tiền của các sản phẩm đang là "Mới",
// có mức giảm tối đa và đơn tối thiểu; cộng với voucher nhưng tổng giảm không vượt quá tiền hàng.
function newProductPromo(lines, room) {
    const rule = getSettings().newPromo;
    if (!rule.enabled) return null;
    const eligible = lines.filter(({ product }) => newPromoOf(product)).reduce((sum, { product, qty }) => sum + product.price * qty, 0);
    if (!eligible || eligible < rule.minOrder) return null;
    const amount = Math.min(Math.floor((eligible * rule.percent) / 100), rule.maxDiscount, eligible, Math.max(0, room));
    return amount > 0
        ? { code: 'SPMOI', name: `Ưu đãi sản phẩm mới -${rule.percent}%`, kind: 'order', percent: rule.percent, amount }
        : null;
}

// Tính tiền đơn hàng: tạm tính, voucher, phí ship và tổng. Server luôn tự tính, không tin số tiền từ client.
//  - strict = true  (tạo đơn): voucher không hợp lệ thì từ chối cả đơn.
//  - strict = false (xem trước): voucher không hợp lệ bị bỏ qua và trả về trong `problems`.
export function quote({ user, lines, shippingMethod, entryIds = [], strict = false }) {
    const goods = lines.reduce((sum, { product, qty }) => sum + product.price * qty, 0);
    const baseFee = shippingFee(shippingMethod, goods); // xét freeship theo giá trị hàng trước giảm giá
    const ids = [...new Set((Array.isArray(entryIds) ? entryIds : []).map(String))];

    const problems = [];
    const applied = [];
    const usedKinds = new Set();
    ids.forEach((id) => {
        const entry = db.userVouchers.find((item) => item.id === id);
        const voucher = entry && byId('vouchers', entry.voucherId);
        const result = entry
            ? evaluate(user, entry, voucher, { lines, goods, fee: baseFee })
            : { ok: false, reason: 'Không tìm thấy voucher trong ví của bạn.' };
        const kind = voucher?.kind;
        if (result.ok && usedKinds.has(kind)) {
            result.ok = false;
            result.reason = kind === 'shipping' ? 'Mỗi đơn chỉ dùng 1 voucher vận chuyển.' : 'Mỗi đơn chỉ dùng 1 voucher giảm giá.';
        }
        if (!result.ok) {
            if (strict) fail(409, result.reason, { voucherId: id });
            problems.push({ id, reason: result.reason });
            return;
        }
        usedKinds.add(kind);
        applied.push({ entry, voucher, amount: result.amount });
    });

    const discount = applied.filter(({ voucher }) => voucher.kind === 'order').reduce((sum, item) => sum + item.amount, 0);
    const shippingDiscount = applied.filter(({ voucher }) => voucher.kind === 'shipping').reduce((sum, item) => sum + item.amount, 0);
    const promo = newProductPromo(lines, goods - discount);
    const total = goods - discount - (promo?.amount || 0) + baseFee - shippingDiscount;
    return { goods, discount, promo, shippingFee: baseFee, shippingDiscount, total, applied, problems };
}

// Danh sách voucher trong ví kèm kết quả "dùng được cho đơn này không" (để màn hình thanh toán gợi ý).
export function walletFor(user, context) {
    return db.userVouchers
        .filter((entry) => entry.userId === user.id)
        .map((entry) => {
            const voucher = byId('vouchers', entry.voucherId);
            const status = entryStatus(entry);
            const check = context && status === 'available' ? evaluate(user, entry, voucher, context) : null;
            return { entry, voucher, status, check };
        });
}
