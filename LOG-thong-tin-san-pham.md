## Thêm thông tin màu sắc, kích thước, chậu và quà tặng kèm cho sản phẩm

### Yêu cầu
Phần sản phẩm phải ghi rõ: có kèm chậu hay không, có phụ kiện tặng kèm hay không, và mô tả màu sắc, kích thước của cây.

### Thay đổi

| File | Nội dung |
|---|---|
| `db.json` | Thêm 4 trường cho cả 13 sản phẩm: `color` (màu sắc), `size` (kích thước), `pot` (chậu), `gift` (quà tặng kèm) |
| `src/js/pages/product-detail-page.js` | Thêm bảng thông số (`<dl class="specs">`) dưới phần mô tả: Màu sắc, Kích thước, Chậu, Tặng kèm |
| `src/js/pages/products-page.js` | Dạng danh sách thêm 2 dòng nhỏ: "màu · kích thước" và "chậu · quà tặng" |
| `src/static/CSS/main.css` | Thêm style `.specs` và `.row-spec` ở cuối file |

### Quy tắc hiển thị
- Trường nào trống thì không hiện dòng đó (`color`, `size`, `pot`).
- Riêng "Tặng kèm": nếu `gift` trống thì hiện "Không có", để khách biết rõ là không có quà.
- Sản phẩm chậu và đất (id 11, 12, 13) không có trường `pot`.
- Giá trị lấy từ `db.json` và được `escapeHtml` trước khi chèn vào trang.

### Ví dụ dữ liệu
```json
{
  "id": "1",
  "name": "Lưỡi hổ",
  "color": "Xanh đậm, viền vàng",
  "size": "Cao 35–45cm",
  "pot": "Kèm chậu nhựa đen 12cm",
  "gift": "Tặng đĩa lót chậu"
}
```

### Lưu ý
- Phải khởi động lại `npm run server`. Server giữ `db` trong RAM, nếu không khởi động lại thì không thấy trường mới và lần ghi tiếp theo sẽ ghi đè mất dữ liệu mới thêm.
- Các giá trị màu, kích thước, chậu, quà tặng do Claude tự điền dựa trên mô tả và loại cây, chưa đối chiếu hàng thật. Cần sửa lại trong `db.json` cho đúng với cửa hàng.
- Đã kiểm tra cú pháp JS bằng `node --check`. Chưa kiểm tra giao diện trên trình duyệt.
