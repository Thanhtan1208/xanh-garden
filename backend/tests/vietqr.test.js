// Mã QR chuyển khoản VietQR do server tự tạo
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bankBin, crc16, qrDataUrl, vietQrPayload } from '../server/services/vietqr.js';

describe('VietQR', () => {
    test('chuỗi dữ liệu giống hệt QR của qr.sepay.vn cho cùng tài khoản, số tiền, nội dung', () => {
        // đọc từ ảnh qr.sepay.vn/img?acc=0000000000&bank=MBBank&amount=1250000&des=XG261124ABCDE
        const expected =
            '00020101021238540010A00000072701240006970422011000000000000208QRIBFTTA5303704540712500005802VN62170813XG261124ABCDE630479AC';
        assert.equal(vietQrPayload({ bin: '970422', account: '0000000000', amount: 1250000, content: 'XG261124ABCDE' }), expected);
        assert.equal(crc16(expected.slice(0, -4)), '79AC');
    });

    test('tra mã BIN theo tên ngân hàng, không phân biệt hoa thường; tên lạ thì không có', () => {
        assert.equal(bankBin('VietinBank'), '970415');
        assert.equal(bankBin('Vietinbank'), '970415');
        assert.equal(bankBin('MB Bank'), '970422');
        assert.equal(bankBin('Ngân hàng lạ'), null);
    });

    test('ảnh QR là SVG nhúng sẵn (data URL), không cần tải từ trang ngoài', () => {
        const url = qrDataUrl('00020101021138540010A000000727');
        assert.match(url, /^data:image\/svg\+xml;base64,/);
        assert.match(Buffer.from(url.split(',')[1], 'base64').toString(), /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    });
});
