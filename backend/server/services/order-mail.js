import { sendMail } from '../core/mailer.js';
import { getShop } from './settings.js';

const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;
const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CELL = 'padding:8px;border:1px solid #e1e5df;';

// Hóa đơn gửi qua email
// Dựng hoàn toàn từ dữ liệu đơn trên server (khách hay nhân viên đều không gửi được nội dung tùy ý).
const PAYMENT_TEXT = { cod: 'Thanh toán khi nhận hàng (COD)', sepay: 'Chuyển khoản QR (SePay)' };
const SHIPPING_TEXT = { standard: 'Giao tiêu chuẩn', express: 'Giao nhanh' };
// dd/MM theo giờ Việt Nam
const shortDate = (iso) => {
    const at = new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);
    return `${String(at.getUTCDate()).padStart(2, '0')}/${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
};
// Vận chuyển: cách giao, dự kiến nhận hàng và (khi đã giao cho vận chuyển) mã vận đơn
function shippingText(order) {
    const parts = [SHIPPING_TEXT[order.shippingMethod] || ''];
    if (order.delivery) parts.push(`dự kiến nhận hàng ${shortDate(order.delivery.from)} – ${shortDate(order.delivery.to)}`);
    return {
        line: parts.filter(Boolean).join(' · '),
        tracking: order.trackingCode ? `${order.carrier || ''} · ${order.trackingCode}`.replace(/^ · /, '') : ''
    };
}
const PAY_STATUS_TEXT = { unpaid: 'Chưa thanh toán', paid: 'Đã thanh toán', refund_pending: 'Cần hoàn tiền', refunded: 'Đã hoàn tiền' };

function invoiceMail(order, shop, note = '') {
    const { customer } = order;
    const date = new Date(order.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const goods = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const lines = [
        ['Tạm tính', money(goods)],
        order.discount
            ? [
                  `Giảm giá${
                      (order.vouchers || []).filter((row) => row.kind === 'order').length
                          ? ` (${order.vouchers
                                .filter((row) => row.kind === 'order')
                                .map((row) => row.code)
                                .join(', ')})`
                          : ''
                  }`,
                  `- ${money(order.discount)}`
              ]
            : null,
        ['Phí vận chuyển', order.shippingFee ? money(order.shippingFee) : 'Miễn phí'],
        order.shippingDiscount ? ['Giảm phí vận chuyển', `- ${money(order.shippingDiscount)}`] : null
    ].filter(Boolean);
    const payment = `${PAYMENT_TEXT[order.paymentMethod] || ''} · ${PAY_STATUS_TEXT[order.paymentStatus] || ''}`;
    const shipping = shippingText(order);

    const text = [
        `HÓA ĐƠN ${order.code}`,
        shop.name,
        `${shop.address} · Hotline ${shop.hotline}`,
        '',
        ...(note ? [note, ''] : []),
        ...(order.invoiceNo ? [`Số phiếu bán hàng: ${order.invoiceNo}`] : []),
        `Ngày đặt: ${date}`,
        `Khách hàng: ${customer.fullName} - ${customer.phone}`,
        `Địa chỉ: ${customer.address}`,
        `Thanh toán: ${payment}`,
        `Vận chuyển: ${shipping.line}`,
        ...(shipping.tracking ? [`Mã vận đơn: ${shipping.tracking}`] : []),
        '',
        ...order.items.map((item) => `- ${item.name} x ${item.qty} (${money(item.price)}): ${money(item.price * item.qty)}`),
        ...lines.map(([label, value]) => `${label}: ${value}`),
        `TỔNG THANH TOÁN: ${money(order.total)}`,
        '',
        `Cảm ơn quý khách đã mua hàng tại ${shop.name}!`
    ].join('\n');

    const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#222222;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e5df;border-radius:8px;">
<tr><td style="padding:20px 24px;border-bottom:3px solid #2e7d32;"><div style="font-size:18px;font-weight:bold;color:#2e7d32;">${esc(shop.name)}</div><div style="font-size:12px;color:#777777;margin-top:4px;">${esc(shop.address)} · Hotline ${esc(shop.hotline)} · ${esc(shop.email)}</div></td></tr>
<tr><td style="padding:20px 24px 8px;"><p style="margin:0 0 6px;font-size:20px;font-weight:bold;">Hóa đơn ${esc(order.code)}</p><p style="margin:0;font-size:13px;color:#666666;">${order.invoiceNo ? `Số phiếu: ${esc(order.invoiceNo)} · ` : ''}Ngày đặt: ${esc(date)}</p>${note ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#444444;">${esc(note)}</p>` : ''}</td></tr>
<tr><td style="padding:8px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border-collapse:collapse;">
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;width:110px;">Khách hàng</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(customer.fullName)} - ${esc(customer.phone)}</td></tr>
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Địa chỉ</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(customer.address)}</td></tr>
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Thanh toán</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(payment)}</td></tr>
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Vận chuyển</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(shipping.line)}</td></tr>${
        shipping.tracking
            ? `
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Mã vận đơn</td><td style="padding:6px 8px;border:1px solid #e1e5df;"><b>${esc(shipping.tracking)}</b></td></tr>`
            : ''
    }
</table></td></tr>
<tr><td style="padding:8px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border-collapse:collapse;">
<tr style="background:#f3f5f2;"><th align="left" style="${CELL}">Sản phẩm</th><th align="right" style="${CELL}">Đơn giá</th><th align="center" style="${CELL}width:40px;">SL</th><th align="right" style="${CELL}">Thành tiền</th></tr>
${order.items.map((item) => `<tr><td style="${CELL}">${esc(item.name)}</td><td align="right" style="${CELL}white-space:nowrap;">${esc(money(item.price))}</td><td align="center" style="${CELL}">${esc(item.qty)}</td><td align="right" style="${CELL}white-space:nowrap;">${esc(money(item.price * item.qty))}</td></tr>`).join('')}
${lines.map(([label, value]) => `<tr><td colspan="3" align="right" style="${CELL}">${esc(label)}</td><td align="right" style="${CELL}white-space:nowrap;">${esc(value)}</td></tr>`).join('')}
<tr><td colspan="3" align="right" style="${CELL}"><b>Tổng thanh toán</b></td><td align="right" style="${CELL}white-space:nowrap;"><b>${esc(money(order.total))}</b></td></tr>
</table></td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.6;color:#777777;">Cảm ơn quý khách đã mua hàng tại ${esc(shop.name)}!</td></tr>
</table>
</body></html>`;
    return { subject: `Hóa đơn ${order.code} - ${shop.name}`, text, html };
}

export function sendInvoiceMail(order, shop) {
    return sendMail({ to: order.customer.email, ...invoiceMail(order, shop) });
}

// Lời mở đầu của hóa đơn tự gửi: COD báo trả tiền khi nhận hàng, chuyển khoản báo đã nhận đủ tiền
function autoNote(order, shop, autoConfirmed) {
    if (order.paymentMethod === 'cod') return `Đơn hàng đã được đặt thành công. Quý khách thanh toán ${money(order.total)} khi nhận hàng.`;
    return autoConfirmed
        ? `${shop.name} đã nhận đủ ${money(order.total)}. Đơn hàng được xác nhận tự động và đang chờ cửa hàng chuẩn bị.`
        : `${shop.name} đã nhận đủ ${money(order.total)}. Cửa hàng sẽ sớm xác nhận và chuẩn bị hàng.`;
}

// Gửi ở nền: lỗi gửi mail chỉ ghi log, không ảnh hưởng việc đặt đơn hay ghi nhận tiền
export function sendAutoInvoice(order, { autoConfirmed = false } = {}) {
    if (!order.customer?.email) return;
    const shop = getShop();
    sendMail({ to: order.customer.email, ...invoiceMail(order, shop, autoNote(order, shop, autoConfirmed)) }).catch((error) =>
        console.error('[mail] Không gửi được hóa đơn', order.code, error.message)
    );
}

// Email cảm ơn khi đơn đã giao xong. Mỗi đơn chỉ gửi một lần (order.thanksSent).
function thanksMail(order, shop) {
    const name = order.customer.fullName;
    const items = order.items.map((item) => `- ${item.name} x ${item.qty}`);
    const text = [
        `Xin chào ${name},`,
        '',
        `Đơn hàng ${order.code} đã được giao thành công. Cảm ơn bạn đã mua hàng tại ${shop.name}!`,
        '',
        ...items,
        `Tổng thanh toán: ${money(order.total)}`,
        '',
        'Nếu cây khỏe và bạn hài lòng, mời bạn vào "Đơn hàng của tôi" để đánh giá sản phẩm, đánh giá của bạn giúp người mua sau chọn dễ hơn.',
        'Nếu có vấn đề với đơn hàng, bạn cứ gửi góp ý trên website, cửa hàng sẽ hỗ trợ.',
        '',
        `${shop.name} · Hotline ${shop.hotline}`
    ].join('\n');
    const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#222222;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e5df;border-radius:8px;">
<tr><td style="padding:20px 24px;border-bottom:3px solid #2e7d32;"><div style="font-size:18px;font-weight:bold;color:#2e7d32;">${esc(shop.name)}</div></td></tr>
<tr><td style="padding:20px 24px;font-size:14px;line-height:1.7;">
<p style="margin:0 0 10px;">Xin chào <b>${esc(name)}</b>,</p>
<p style="margin:0 0 10px;">Đơn hàng <b>${esc(order.code)}</b> đã được giao thành công. Cảm ơn bạn đã mua hàng tại ${esc(shop.name)}!</p>
<ul style="margin:0 0 10px;padding-left:20px;">${order.items.map((item) => `<li>${esc(item.name)} x ${esc(item.qty)}</li>`).join('')}</ul>
<p style="margin:0 0 10px;">Tổng thanh toán: <b>${esc(money(order.total))}</b></p>
<p style="margin:0 0 10px;">Nếu cây khỏe và bạn hài lòng, mời bạn vào "Đơn hàng của tôi" để đánh giá sản phẩm. Đánh giá của bạn giúp người mua sau chọn dễ hơn.</p>
<p style="margin:0;">Nếu có vấn đề với đơn hàng, bạn cứ gửi góp ý trên website, cửa hàng sẽ hỗ trợ.</p>
</td></tr>
<tr><td style="padding:12px 24px 20px;font-size:12px;color:#777777;">${esc(shop.name)} · Hotline ${esc(shop.hotline)}</td></tr>
</table></body></html>`;
    return { subject: `Cảm ơn bạn đã mua hàng - đơn ${order.code}`, text, html };
}

// Gửi ở nền như hóa đơn: lỗi gửi mail chỉ ghi log
export function sendThanksMail(order) {
    if (!order.customer?.email || order.thanksSent) return;
    order.thanksSent = true;
    sendMail({ to: order.customer.email, ...thanksMail(order, getShop()) }).catch((error) =>
        console.error('[mail] Không gửi được email cảm ơn', order.code, error.message)
    );
}
