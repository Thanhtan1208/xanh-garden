// Tự tạo mã QR chuyển khoản theo chuẩn VietQR (NAPAS 247, EMVCo): mọi app ngân hàng Việt Nam quét được,
// không cần tải ảnh từ trang ngoài (trình chặn quảng cáo hay chặn ảnh qr.sepay.vn).
import QRCode from 'qrcode';

// Mã BIN NAPAS của ngân hàng, tra theo tên viết tắt (bỏ dấu cách, không phân biệt hoa thường)
const BINS = {
    vietinbank: '970415',
    icb: '970415',
    vietcombank: '970436',
    vcb: '970436',
    bidv: '970418',
    agribank: '970405',
    vba: '970405',
    mbbank: '970422',
    mb: '970422',
    techcombank: '970407',
    tcb: '970407',
    acb: '970416',
    vpbank: '970432',
    tpbank: '970423',
    sacombank: '970403',
    stb: '970403',
    hdbank: '970437',
    vib: '970441',
    shb: '970443',
    eximbank: '970431',
    msb: '970426',
    ocb: '970448',
    seabank: '970440',
    lpbank: '970449',
    kienlongbank: '970452',
    namabank: '970428',
    abbank: '970425',
    bacabank: '970409',
    pvcombank: '970412',
    vietabank: '970427',
    ncb: '970419',
    baovietbank: '970438',
    saigonbank: '970400'
};

export const bankBin = (bank) =>
    BINS[
        String(bank ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
    ] || null;

// Một trường EMVCo: mã 2 số + độ dài 2 số + giá trị
const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

// CRC-16/CCITT-FALSE (đa thức 0x1021, giá trị đầu 0xFFFF) theo chuẩn EMVCo
export function crc16(text) {
    let crc = 0xffff;
    for (const char of text) {
        crc ^= char.charCodeAt(0) << 8;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Chuỗi dữ liệu VietQR: tài khoản nhận, số tiền, nội dung. Chỉ nhận chữ/số ASCII trong nội dung.
export function vietQrPayload({ bin, account, amount, content }) {
    const beneficiary = field('00', bin) + field('01', String(account));
    const merchant = field('00', 'A000000727') + field('01', beneficiary) + field('02', 'QRIBFTTA');
    let payload = field('00', '01') + field('01', amount ? '12' : '11') + field('38', merchant) + field('53', '704');
    if (amount) payload += field('54', String(Math.round(amount)));
    payload += field('58', 'VN');
    if (content) payload += field('62', field('08', content));
    payload += '6304';
    return payload + crc16(payload);
}

// Ảnh SVG (data URL) của mã QR: không cần mạng, hiển thị được với CSP img-src data:
export function qrDataUrl(text) {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const margin = 4;
    const size = modules.size + margin * 2;
    let path = '';
    for (let y = 0; y < modules.size; y += 1)
        for (let x = 0; x < modules.size; x += 1) if (modules.get(y, x)) path += `M${x + margin} ${y + margin}h1v1h-1z`;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
