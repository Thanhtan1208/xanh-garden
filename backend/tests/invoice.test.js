// Đọc số tiền thành chữ trên hóa đơn
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { soThanhChu } from '../../frontend/src/js/utils/money-words.js';

describe('Đọc tiền thành chữ', () => {
    test('các cách đọc đặc biệt: lẻ, mốt, lăm, mười', () => {
        assert.equal(soThanhChu(0), 'Không đồng');
        assert.equal(soThanhChu(15000), 'Mười lăm nghìn đồng');
        assert.equal(soThanhChu(21000), 'Hai mươi mốt nghìn đồng');
        assert.equal(soThanhChu(105000), 'Một trăm lẻ năm nghìn đồng');
        assert.equal(soThanhChu(270000), 'Hai trăm bảy mươi nghìn đồng');
    });

    test('số lớn: triệu, tỷ và các nhóm giữa bằng không', () => {
        assert.equal(soThanhChu(1250000), 'Một triệu hai trăm năm mươi nghìn đồng');
        assert.equal(soThanhChu(1005000), 'Một triệu không trăm lẻ năm nghìn đồng');
        assert.equal(soThanhChu(50000000), 'Năm mươi triệu đồng');
        assert.equal(soThanhChu(2000000000), 'Hai tỷ đồng');
        assert.equal(soThanhChu(-5), '');
    });
});
