import { SHOP } from "../config/shop.js";
import { PAYMENT_METHODS, PAYMENT_STATUS, SHIPPING_METHODS } from "../utils/format.js";

// Xuất hóa đơn PDF cho 1 đơn hàng, làm theo bài xuất PDF (jsPDF + autoTable) của cô
// jsPDF và autoTable được nhúng bằng thẻ <script> trong my-orders.html và admin-orders.html

// tên font tiếng Việt dùng trong file PDF
const TEN_FONT = "BeVietnamPro";
// màu xanh của cửa hàng dạng [R, G, B]
const MAU_XANH = [46, 125, 50];

// định dạng tiền tệ
function dinhDangTienTe(gia) {
    return Number(gia).toLocaleString("vi-VN", { style: "currency", currency: "VND" });
}

// lấy mã voucher đã dùng của đơn, ví dụ " (SALE10)"
function maVoucher(donHang, loai) {
    const dsMa = (donHang.vouchers || []).filter((voucher) => voucher.kind === loai).map((voucher) => voucher.code);
    return dsMa.length > 0 ? ` (${dsMa.join(", ")})` : "";
}

// đọc file font .ttf thành chuỗi base64 để nạp vào jsPDF
async function docFontBase64(duongDan) {
    const response = await fetch(duongDan);
    if (!response.ok) {
        throw new Error("Không tải được font " + duongDan);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // kết quả có dạng "data:...;base64,AAAA", chỉ lấy phần sau dấu phẩy
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// font mặc định của jsPDF không có dấu tiếng Việt nên phải nạp font riêng (file trong thư mục public/fonts)
async function napFontTiengViet(doc) {
    const fontThuong = await docFontBase64("./fonts/BeVietnamPro-Regular.ttf");
    const fontDam = await docFontBase64("./fonts/BeVietnamPro-Bold.ttf");
    // đưa file font vào bộ nhớ của jsPDF rồi đặt tên font
    doc.addFileToVFS("BeVietnamPro-Regular.ttf", fontThuong);
    doc.addFont("BeVietnamPro-Regular.ttf", TEN_FONT, "normal");
    doc.addFileToVFS("BeVietnamPro-Bold.ttf", fontDam);
    doc.addFont("BeVietnamPro-Bold.ttf", TEN_FONT, "bold");
}

// phương thức xuất hóa đơn PDF
// donHang: đơn cần xuất, btnXuatPDF: nút vừa bấm, thongBao: chỗ hiện thông báo
export async function xuatHoaDon(donHang, btnXuatPDF, thongBao) {
    try {
        // nếu đơn không có sản phẩm thì thông báo
        if (!donHang || donHang.items.length === 0) {
            thongBao.textContent = "Đơn hàng không có sản phẩm để xuất hóa đơn.";
            return;
        }
        // vô hiệu hóa nút trong khi đang xuất
        btnXuatPDF.disabled = true;
        thongBao.textContent = "Đang xuất hóa đơn...";
        // lấy constructor của jsPDF (có sẵn khi nhúng thư viện jsPDF)
        const { jsPDF } = window.jspdf;
        // tạo file pdf mới: giấy A4 dọc, đơn vị mm
        const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4"
        });
        await napFontTiengViet(doc);

        // tên cửa hàng, cú pháp doc.text(nội dung, x, y, tùy chọn)
        // 105 là giữa trang A4 (rộng 210mm), 18 là cách mép trên 18mm
        doc.setFont(TEN_FONT, "bold");
        doc.setFontSize(16);
        doc.setTextColor(...MAU_XANH);
        doc.text(SHOP.name, 105, 18, { align: "center" });
        // thông tin liên hệ của cửa hàng (chữ xám)
        doc.setFont(TEN_FONT, "normal");
        doc.setFontSize(9);
        doc.setTextColor(110);
        doc.text(`${SHOP.address} · Hotline ${SHOP.hotline} · ${SHOP.email}`, 105, 24, { align: "center" });

        // tiêu đề hóa đơn
        doc.setFont(TEN_FONT, "bold");
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text("HÓA ĐƠN BÁN HÀNG", 105, 36, { align: "center" });
        // mã đơn, ngày đặt và ngày xuất
        const ngayDat = new Date(donHang.createdAt).toLocaleDateString("vi-VN");
        const ngayXuat = new Date().toLocaleDateString("vi-VN");
        doc.setFont(TEN_FONT, "normal");
        doc.setFontSize(10);
        doc.text(`Mã đơn: ${donHang.code}   ·   Ngày đặt: ${ngayDat}   ·   Ngày xuất: ${ngayXuat}`, 105, 42, { align: "center" });

        // thông tin khách hàng, mỗi dòng cách nhau 5.5mm
        const khach = donHang.customer;
        const dongThongTin = [
            `Khách hàng: ${khach.fullName}`,
            `Điện thoại: ${khach.phone}`,
            // splitTextToSize: chữ dài quá 182mm thì tự xuống dòng
            ...doc.splitTextToSize(`Địa chỉ: ${khach.address}`, 182),
            `Thanh toán: ${PAYMENT_METHODS[donHang.paymentMethod]} · ${PAYMENT_STATUS[donHang.paymentStatus]}`,
            `Vận chuyển: ${SHIPPING_METHODS[donHang.shippingMethod]}`
        ];
        if (khach.note) {
            dongThongTin.push(...doc.splitTextToSize(`Ghi chú: ${khach.note}`, 182));
        }
        let y = 52;
        dongThongTin.forEach((dong) => {
            doc.text(dong, 14, y);
            y += 5.5;
        });

        // chuẩn bị dữ liệu cho bảng
        const headers = ["STT", "Sản phẩm", "Đơn giá", "SL", "Thành tiền"];
        // mỗi sản phẩm trong đơn là 1 dòng của bảng
        const rows = donHang.items.map((sp, index) => [
            index + 1,
            sp.name,
            dinhDangTienTe(sp.price),
            sp.qty,
            dinhDangTienTe(sp.price * sp.qty)
        ]);
        // sử dụng autoTable để xuất bảng, startY là tọa độ y bắt đầu vẽ bảng
        doc.autoTable({
            head: [headers],
            body: rows,
            startY: y + 2,
            theme: "grid",
            // bảng cũng phải dùng font tiếng Việt
            styles: { font: TEN_FONT, fontSize: 10 },
            headStyles: { font: TEN_FONT, fontStyle: "bold", fillColor: MAU_XANH, halign: "center" },
            // canh lề từng cột: 0 là STT, 2 là Đơn giá, 3 là SL, 4 là Thành tiền
            columnStyles: {
                0: { halign: "center", cellWidth: 14 },
                2: { halign: "right", cellWidth: 32 },
                3: { halign: "center", cellWidth: 16 },
                4: { halign: "right", cellWidth: 36 }
            }
        });

        // phần tổng tiền nằm dưới bảng, finalY là tọa độ y cuối bảng
        y = doc.lastAutoTable.finalY + 8;
        // bảng dài gần hết trang thì sang trang mới
        if (y > 240) {
            doc.addPage();
            y = 20;
        }
        const tongTien = [["Tạm tính", dinhDangTienTe(donHang.subtotal)]];
        if (donHang.discount) {
            tongTien.push([`Giảm giá${maVoucher(donHang, "order")}`, "- " + dinhDangTienTe(donHang.discount)]);
        }
        tongTien.push(["Phí vận chuyển", donHang.shippingFee ? dinhDangTienTe(donHang.shippingFee) : "Miễn phí"]);
        if (donHang.shippingDiscount) {
            tongTien.push([`Giảm phí vận chuyển${maVoucher(donHang, "shipping")}`, "- " + dinhDangTienTe(donHang.shippingDiscount)]);
        }
        // tên khoản bên trái (x = 106), số tiền canh phải sát lề (x = 196)
        tongTien.forEach(([ten, soTien]) => {
            doc.text(ten, 106, y);
            doc.text(soTien, 196, y, { align: "right" });
            y += 6;
        });
        // kẻ 1 đường ngang rồi in tổng thanh toán chữ đậm
        doc.setDrawColor(200);
        doc.line(106, y - 3, 196, y - 3);
        doc.setFont(TEN_FONT, "bold");
        doc.setFontSize(12);
        doc.text("Tổng thanh toán", 106, y + 3);
        doc.text(dinhDangTienTe(donHang.total), 196, y + 3, { align: "right" });

        // lời cảm ơn cuối hóa đơn
        doc.setFont(TEN_FONT, "normal");
        doc.setFontSize(10);
        doc.setTextColor(110);
        doc.text(`Cảm ơn quý khách đã mua hàng tại ${SHOP.name}!`, 105, y + 18, { align: "center" });

        // tải file PDF về máy tính
        doc.save(`Hoa_don_${donHang.code}.pdf`);
        thongBao.textContent = `Đã xuất hóa đơn ${donHang.code}.`;
    } catch (error) {
        console.error("Lỗi khi xuất hóa đơn:", error);
        thongBao.textContent = "Có lỗi xảy ra khi xuất hóa đơn.";
    } finally {
        // luôn bật lại nút sau khi xử lý xong
        btnXuatPDF.disabled = false;
    }
}
