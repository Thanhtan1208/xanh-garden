# Xanh Garden – web bán cây cảnh

Frontend JavaScript thuần (Vite, nhiều trang HTML) + backend Node.js/Express, dữ liệu lưu trong thư mục `data/` (`data/db.json`).
Cấu trúc thư mục, vai trò từng file và các luồng nghiệp vụ: xem **[CAU_TRUC_PROJECT.md](CAU_TRUC_PROJECT.md)**.

## Cách chạy

```powershell
npm install
Copy-Item data/db.sample.json data/db.json   # Chỉ làm lần đầu: tạo dữ liệu mẫu
npm run server   # Terminal 1: API tại http://localhost:3000/api
npm run dev      # Terminal 2: giao diện tại http://localhost:5173
npm test         # Chạy bộ test nghiệp vụ (dùng dữ liệu tạm, không đụng data/db.json)
```

## Dữ liệu và sao lưu

- Toàn bộ dữ liệu khi chạy nằm trong `data/`: `db.json`, `analytics.ndjson`, `uploads/` (ảnh đánh giá, banner, ảnh sản phẩm), `backups/`.
- Mỗi ngày server tự chép `db.json` thành `data/backups/db-YYYY-MM-DD.json` (giữ 7 bản). Lỡ hỏng dữ liệu: tắt server, chép bản sao lưu đè lên `data/db.json`.
- Vite chặn `data/`, `server/`, `tests/`: mở `http://localhost:5173/data/db.json` sẽ bị từ chối (403).

## Thông tin cửa hàng trên giao diện

Hotline, email, địa chỉ, giờ mở cửa, link Facebook/Zalo hiển thị ở thanh trên cùng, chân trang và nút gọi nhanh nằm trong **`src/js/config/shop.js`** (đang là giá trị mẫu, hãy thay bằng thông tin thật).
Ảnh sản phẩm: vào trang quản trị **Sản phẩm & kho → Sửa → Ảnh sản phẩm** để tải ảnh chụp thật (ảnh lưu ở `data/uploads/products/`).

Luôn mở trang qua Vite (`npm run dev`); Vite chuyển tiếp `/api` và `/uploads` sang Express.
Nếu báo `EADDRINUSE :3000` là đã có một server khác đang chạy: tắt nó (`netstat -ano | findstr :3000` rồi `taskkill /PID <PID> /F`).

Dữ liệu mẫu có sẵn tài khoản quản trị để chạy thử trên máy: `admin` / `Demo@Garden2026`. Tài khoản khách hàng thì tự đăng ký trên web.

## Biến môi trường (`.env`, mẫu ở `.env.example`)

| Biến | Ý nghĩa |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Gửi email thật. Không đặt thì nội dung email được in ra console server. |
| `SEPAY_API_KEY` | Khóa webhook SePay (mặc định `dev-sepay-key` khi chạy thử). |
| `SEPAY_BANK`, `SEPAY_ACCOUNT`, `SEPAY_ACCOUNT_NAME` | Tài khoản nhận tiền hiển thị trên mã QR. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL` | Chatbot tư vấn. Không có khóa (hoặc khóa bị từ chối) thì chatbot tự chuyển sang chế độ tra cứu cơ sở tri thức. **Biến môi trường hệ thống được ưu tiên hơn `.env`.** |
| `AUTH_SECRET` | Khóa ký token đăng nhập (bắt buộc đặt khi triển khai thật). |

Giả lập SePay báo tiền về (thay mã đơn và số tiền):

```powershell
curl.exe -X POST http://localhost:3000/api/payments/sepay/webhook -H "Authorization: Apikey dev-sepay-key" -H "Content-Type: application/json" -d '{\"id\":1001,\"transferType\":\"in\",\"transferAmount\":2250000,\"content\":\"XG261008ABCDE\"}'
```
