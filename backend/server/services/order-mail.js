import { sendMail } from '../core/mailer.js';
import { getShop } from './settings.js';

const money = (value) => `${Number(value).toLocaleString('vi-VN')} ₫`;
const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CELL = 'padding:8px;border:1px solid #e1e5df;';

// Hóa đơn gửi qua email
// Dựng hoàn toàn từ dữ liệu đơn trên server (khách hay nhân viên đều không gửi được nội dung tùy ý).
const PAYMENT_TEXT = { cod: 'Thanh toán khi nhận hàng (COD)', sepay: 'Chuyển khoản QR (SePay)' };
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

    const text = [
        `HÓA ĐƠN ${order.code}`,
        shop.name,
        `${shop.address} · Hotline ${shop.hotline}`,
        '',
        ...(note ? [note, ''] : []),
        `Ngày đặt: ${date}`,
        `Khách hàng: ${customer.fullName} - ${customer.phone}`,
        `Địa chỉ: ${customer.address}`,
        `Thanh toán: ${payment}`,
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
<tr><td style="padding:20px 24px 8px;"><p style="margin:0 0 6px;font-size:20px;font-weight:bold;">Hóa đơn ${esc(order.code)}</p><p style="margin:0;font-size:13px;color:#666666;">Ngày đặt: ${esc(date)}</p>${note ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#444444;">${esc(note)}</p>` : ''}</td></tr>
<tr><td style="padding:8px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border-collapse:collapse;">
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;width:110px;">Khách hàng</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(customer.fullName)} - ${esc(customer.phone)}</td></tr>
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Địa chỉ</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(customer.address)}</td></tr>
<tr><td style="padding:6px 8px;border:1px solid #e1e5df;background:#f3f5f2;">Thanh toán</td><td style="padding:6px 8px;border:1px solid #e1e5df;">${esc(payment)}</td></tr>
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
