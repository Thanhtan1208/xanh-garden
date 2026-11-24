import { SHOP } from '../config/shop.js';
import { PAYMENT_METHODS, PAYMENT_STATUS, SHIPPING_METHODS, shortDay } from '../utils/format.js';
import { soThanhChu } from '../utils/money-words.js';

// Xuất hóa đơn PDF cho 1 đơn hàng (jsPDF + autoTable), bố cục giống hóa đơn của TikTok Shop
// jsPDF và autoTable được nhúng bằng thẻ <script> trong my-orders.html và admin-orders.html

// tên font tiếng Việt dùng trong file PDF
export const TEN_FONT = 'BeVietnamPro';
// màu xanh của cửa hàng dạng [R, G, B]
const MAU_XANH = [46, 125, 50];

// định dạng tiền tệ
function dinhDangTienTe(gia) {
    return Number(gia).toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });
}

// lấy mã voucher đã dùng của đơn, ví dụ " (SALE10)"
function maVoucher(donHang, loai) {
    const dsMa = (donHang.vouchers || []).filter((voucher) => voucher.kind === loai).map((voucher) => voucher.code);
    return dsMa.length > 0 ? ` (${dsMa.join(', ')})` : '';
}

// đọc file font .ttf thành chuỗi base64 để nạp vào jsPDF
async function docFontBase64(duongDan) {
    const response = await fetch(duongDan);
    if (!response.ok) {
        throw new Error('Không tải được font ' + duongDan);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // kết quả có dạng "data:...;base64,AAAA", chỉ lấy phần sau dấu phẩy
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// font mặc định của jsPDF không có dấu tiếng Việt nên phải nạp font riêng (file trong thư mục public/fonts)
export async function napFontTiengViet(doc) {
    const fontThuong = await docFontBase64('./fonts/BeVietnamPro-Regular.ttf');
    const fontDam = await docFontBase64('./fonts/BeVietnamPro-Bold.ttf');
    // đưa file font vào bộ nhớ của jsPDF rồi đặt tên font
    doc.addFileToVFS('BeVietnamPro-Regular.ttf', fontThuong);
    doc.addFont('BeVietnamPro-Regular.ttf', TEN_FONT, 'normal');
    doc.addFileToVFS('BeVietnamPro-Bold.ttf', fontDam);
    doc.addFont('BeVietnamPro-Bold.ttf', TEN_FONT, 'bold');
}

// phương thức xuất hóa đơn PDF
// donHang: đơn cần xuất, btnXuatPDF: nút vừa bấm, thongBao: chỗ hiện thông báo
// Mã vạch Code 128 của số hóa đơn (8 chữ số nên vạch to, máy quét và điện thoại đọc được) dưới dạng ảnh; không có thư viện JsBarcode (mất mạng) thì bỏ qua, hóa đơn vẫn xuất bình thường
function taoMaVach(maDon) {
    try {
        if (!window.JsBarcode) return null;
        const canvas = document.createElement('canvas');
        window.JsBarcode(canvas, maDon, { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 4 });
        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
}

// Vẽ khung có viền mảnh, tiêu đề in đậm và các dòng chữ bên trong; trả về chiều cao khung
function veKhung(doc, x, y, rong, tieuDe, cacDong) {
    const dong = cacDong.flatMap((chuoi) => doc.splitTextToSize(chuoi, rong - 8));
    const cao = 10 + dong.length * 4.8;
    doc.setDrawColor(200);
    doc.roundedRect(x, y, rong, cao, 1.5, 1.5, 'S');
    doc.setFont(TEN_FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MAU_XANH);
    doc.text(tieuDe, x + 4, y + 6);
    doc.setFont(TEN_FONT, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(40);
    dong.forEach((chuoi, index) => doc.text(chuoi, x + 4, y + 11.5 + index * 4.8));
    return cao;
}

const ngayGio = (iso) => new Date(iso).toLocaleString('vi-VN', { hour12: false });

export async function xuatHoaDon(donHang, btnXuatPDF, thongBao) {
    try {
        if (!donHang || donHang.items.length === 0) {
            thongBao.textContent = 'Đơn hàng không có sản phẩm để xuất hóa đơn.';
            return;
        }
        btnXuatPDF.disabled = true;
        thongBao.textContent = 'Đang xuất hóa đơn...';
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        await napFontTiengViet(doc);

        const khach = donHang.customer;
        const ngayXuat = new Date().toLocaleDateString('vi-VN');

        // Đầu hóa đơn: cửa hàng bên trái, tên và số hóa đơn bên phải
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...MAU_XANH);
        doc.text(SHOP.name, 14, 18);
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(110);
        doc.text(doc.splitTextToSize(`${SHOP.address} · Hotline ${SHOP.hotline} · ${SHOP.email}`, 110), 14, 23.5);
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(15);
        doc.setTextColor(30);
        // Phiếu bán hàng, không phải hóa đơn điện tử theo NĐ 123/2020 (hóa đơn đó phải phát hành qua nhà cung cấp được cấp phép)
        doc.text('PHIẾU BÁN HÀNG', 196, 17, { align: 'right' });
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(90);
        // Số phiếu là dãy 8 chữ số tăng dần do hệ thống cấp cho từng đơn
        const soHoaDon = donHang.invoiceNo || donHang.code;
        doc.text(`Số phiếu: ${soHoaDon}`, 196, 24, { align: 'right' });
        doc.text(`Ngày lập: ${ngayXuat}`, 196, 29, { align: 'right' });
        doc.setDrawColor(...MAU_XANH);
        doc.setLineWidth(0.8);
        doc.line(14, 34, 196, 34);
        doc.setLineWidth(0.2);

        // Thông tin đơn hàng bên trái, mã vạch của mã đơn bên phải (như phiếu đơn của TikTok Shop)
        const thongTin = [
            ['Mã đơn hàng', donHang.code],
            ['Ngày đặt', ngayGio(donHang.createdAt)],
            ['Thanh toán', `${PAYMENT_METHODS[donHang.paymentMethod]} · ${PAYMENT_STATUS[donHang.paymentStatus]}`],
            ['Vận chuyển', SHIPPING_METHODS[donHang.shippingMethod] + (donHang.shippingMethod === 'express' ? ' (ưu tiên)' : '')]
        ];
        if (donHang.delivery) thongTin.push(['Dự kiến nhận hàng', `${shortDay(donHang.delivery.from)} – ${shortDay(donHang.delivery.to)}`]);
        if (donHang.trackingCode) thongTin.push(['Mã vận đơn', `${donHang.trackingCode}${donHang.carrier ? ` (${donHang.carrier})` : ''}`]);
        let y = 41;
        doc.setFontSize(9.5);
        thongTin.forEach(([nhan, giaTri]) => {
            doc.setFont(TEN_FONT, 'normal');
            doc.setTextColor(110);
            doc.text(`${nhan}:`, 14, y);
            doc.setFont(TEN_FONT, 'bold');
            doc.setTextColor(30);
            // giá trị dài thì xuống dòng để không chạm mã vạch bên phải
            doc.splitTextToSize(String(giaTri), 80).forEach((dong, index) => doc.text(dong, 50, y + index * 4.6));
            y += 5.2 + (doc.splitTextToSize(String(giaTri), 80).length - 1) * 4.6;
        });
        const maVach = taoMaVach(soHoaDon);
        if (maVach) {
            doc.addImage(maVach, 'PNG', 126, 39, 70, 17);
            doc.setFont(TEN_FONT, 'normal');
            doc.setFontSize(9);
            doc.setTextColor(60);
            doc.text(soHoaDon.split('').join(' '), 161, 61, { align: 'center' });
        }

        // Người bán và người nhận
        y = Math.max(y, 65) + 2;
        const caoBan = veKhung(doc, 14, y, 88, 'NGƯỜI BÁN', [
            SHOP.name,
            ...(SHOP.taxCode ? [`MST: ${SHOP.taxCode}`] : []),
            SHOP.address,
            `Hotline: ${SHOP.hotline}`,
            SHOP.email
        ]);
        const dongNhan = [`${khach.fullName} · ${khach.phone}`, khach.address];
        if (khach.note) dongNhan.push(`Ghi chú: ${khach.note}`);
        const caoNhan = veKhung(doc, 108, y, 88, 'NGƯỜI NHẬN', dongNhan);
        y += Math.max(caoBan, caoNhan) + 6;

        // Bảng sản phẩm
        doc.autoTable({
            head: [['STT', 'Sản phẩm', 'Đơn giá', 'SL', 'Thành tiền']],
            body: donHang.items.map((sp, index) => [
                index + 1,
                sp.name,
                dinhDangTienTe(sp.price),
                sp.qty,
                dinhDangTienTe(sp.price * sp.qty)
            ]),
            startY: y,
            theme: 'striped',
            styles: { font: TEN_FONT, fontSize: 10 },
            headStyles: { font: TEN_FONT, fontStyle: 'bold', fillColor: MAU_XANH, halign: 'center' },
            alternateRowStyles: { fillColor: [245, 248, 245] },
            columnStyles: {
                0: { halign: 'center', cellWidth: 14 },
                2: { halign: 'right', cellWidth: 32 },
                3: { halign: 'center', cellWidth: 16 },
                4: { halign: 'right', cellWidth: 36 }
            }
        });

        // Tổng tiền dưới bảng
        y = doc.lastAutoTable.finalY + 8;
        if (y > 215) {
            doc.addPage();
            y = 20;
        }
        const tongTien = [['Tiền hàng', dinhDangTienTe(donHang.subtotal)]];
        if (donHang.discount) tongTien.push([`Giảm giá${maVoucher(donHang, 'order')}`, '- ' + dinhDangTienTe(donHang.discount)]);
        tongTien.push(['Phí vận chuyển', donHang.shippingFee ? dinhDangTienTe(donHang.shippingFee) : 'Miễn phí']);
        if (donHang.shippingDiscount) {
            tongTien.push([`Giảm phí vận chuyển${maVoucher(donHang, 'shipping')}`, '- ' + dinhDangTienTe(donHang.shippingDiscount)]);
        }
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(50);
        tongTien.forEach(([ten, soTien]) => {
            doc.text(ten, 106, y);
            doc.text(soTien, 196, y, { align: 'right' });
            y += 6;
        });
        doc.setDrawColor(200);
        doc.line(106, y - 3, 196, y - 3);
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(12.5);
        doc.setTextColor(...MAU_XANH);
        doc.text('Tổng thanh toán', 106, y + 3);
        doc.text(dinhDangTienTe(donHang.total), 196, y + 3, { align: 'right' });
        y += 11;
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(70);
        doc.text(doc.splitTextToSize(`Bằng chữ: ${soThanhChu(donHang.total)}.`, 182), 14, y);
        y += 9;

        // Khách cần trả bao nhiêu khi nhận hàng (đơn COD chưa thu tiền) hoặc đã thanh toán
        const thuHo = donHang.paymentMethod === 'cod' && donHang.paymentStatus !== 'paid';
        doc.setDrawColor(...MAU_XANH);
        doc.roundedRect(14, y, 182, 11, 1.5, 1.5, 'S');
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(30);
        doc.text(thuHo ? 'Số tiền khách cần thanh toán khi nhận hàng (COD)' : 'Đơn hàng đã được thanh toán', 18, y + 7);
        if (thuHo) doc.text(dinhDangTienTe(donHang.total), 192, y + 7, { align: 'right' });
        y += 22;

        // Chữ ký hai bên (hóa đơn in ra có thể ký tay)
        if (y > 255) {
            doc.addPage();
            y = 20;
        }
        doc.setFont(TEN_FONT, 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(40);
        doc.text('Người mua hàng', 50, y, { align: 'center' });
        doc.text('Người bán hàng', 160, y, { align: 'center' });
        doc.setFont(TEN_FONT, 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(120);
        doc.text('(Ký, ghi rõ họ tên)', 50, y + 4.5, { align: 'center' });
        doc.text('(Ký, ghi rõ họ tên)', 160, y + 4.5, { align: 'center' });
        doc.text(`Cảm ơn quý khách đã mua hàng tại ${SHOP.name}!`, 105, y + 24, { align: 'center' });
        doc.text('Phiếu này không thay thế hóa đơn GTGT. Cần hóa đơn điện tử, vui lòng liên hệ cửa hàng.', 105, y + 28.5, {
            align: 'center'
        });

        doc.save(`Hoa_don_${donHang.code}.pdf`);
        thongBao.textContent = `Đã xuất hóa đơn ${donHang.code}.`;
    } catch (error) {
        console.error('Lỗi khi xuất hóa đơn:', error);
        thongBao.textContent = 'Có lỗi xảy ra khi xuất hóa đơn.';
    } finally {
        btnXuatPDF.disabled = false;
    }
}
