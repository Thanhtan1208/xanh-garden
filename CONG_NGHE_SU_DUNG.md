# Xanh Garden: công nghệ sử dụng

Cập nhật ngày 09/11/2026. Phiên bản lấy từ `node_modules` đang cài trên máy. Kiến trúc và luồng dữ liệu chi tiết xem ở `KIEN_TRUC_VA_LUONG_DU_LIEU.md`.

## 1. Dự án xây dựng trên gì

Xanh Garden là website thương mại điện tử bán cây cảnh, chạy theo mô hình client-server và viết hoàn toàn bằng **JavaScript** (cả giao diện lẫn máy chủ).

| Phần | Nền tảng |
|---|---|
| Frontend | Trình duyệt, nhiều trang HTML riêng (MPA), JavaScript ES Modules, không dùng framework |
| Backend | Node.js 22, Express 4, REST API trả JSON |
| Lưu trữ | File JSON, không dùng hệ quản trị cơ sở dữ liệu |
| Công cụ dựng | Vite 6 (chạy dev, chuyển tiếp API, đóng gói) |

## 2. Frontend (`frontend/`)

| Công nghệ | Phiên bản | Dùng để |
|---|---|---|
| HTML5 | | 23 trang riêng: mua hàng và quản lý |
| CSS3 thuần | | Một file `main.css`, dùng biến CSS, bố cục grid và flex, co giãn cho điện thoại. Không dùng Bootstrap hay Tailwind |
| JavaScript (ES Modules) | | Logic từng trang trong `src/js/pages`, dùng lại ở `components`, `services`, `utils` |
| Vite | 6.4.5 | Server dev cổng 5173, chuyển tiếp `/api` và `/uploads` sang backend, đóng gói khi build |
| SheetJS (`xlsx`) | 0.18.5 | Đọc và xuất file Excel ngay trên trình duyệt |
| jsPDF | 3.0.3 (CDN) | Xuất PDF: hóa đơn, danh sách sản phẩm |
| jsPDF-AutoTable | 5.0.2 (CDN) | Vẽ bảng trong file PDF |
| Google Fonts | Be Vietnam Pro | Font chữ hỗ trợ tiếng Việt |
| `fetch` API | | Gọi backend, bọc trong `api-service.js` |
| `localStorage`, `sessionStorage` | | Phiên đăng nhập, giỏ hàng, bản nhớ để chuyển trang không giật |

Điểm đáng nói:
- Không có framework (React, Vue). Mỗi trang nạp đúng một file JS riêng.
- Biểu đồ thống kê tự vẽ bằng SVG, không dùng thư viện biểu đồ.
- Icon nằm trong code (`utils/icons.js`), không dùng thư viện icon.

## 3. Backend (`backend/`)

| Công nghệ | Phiên bản | Dùng để |
|---|---|---|
| Node.js | 22.23.2 | Chạy máy chủ, dùng các module có sẵn: `crypto`, `fs`, `node:test` |
| Express | 4.22.3 | Định tuyến REST API, middleware |
| Nodemailer | 10.3.1 | Gửi email qua SMTP (mã OTP, hóa đơn) |
| `crypto` (có sẵn trong Node) | | Băm mật khẩu bằng scrypt, ký token HMAC-SHA256, sinh mã OTP |
| `fetch` (có sẵn trong Node) | | Gọi OpenAI, không cần cài thư viện |
| `node:test` | | Chạy bộ test API (106 test) |
| smtp-server, mailparser | 3.21.3, 3.14.2 | Chỉ để dựng hộp thư ảo khi test và demo |

Backend chỉ có **2 thư viện chạy thật** là `express` và `nodemailer`. Phần còn lại dùng thẳng thư viện có sẵn của Node.

## 4. Lưu trữ dữ liệu

| Dữ liệu | Nơi lưu |
|---|---|
| Sản phẩm, đơn, tài khoản, giỏ, voucher, đánh giá... | `backend/data/db.json` (đọc một lần lên RAM, ghi lại mỗi lần thay đổi) |
| Hành vi khách | `backend/data/analytics.ndjson` (mỗi dòng một sự kiện, giữ 90 ngày) |
| Ảnh, video tải lên | `backend/data/uploads/` |
| Sao lưu | `backend/data/backups/` (mỗi ngày một bản, giữ 7 bản) |
| Ảnh sản phẩm có sẵn | `frontend/src/static/IMAGES/` |

## 5. Dịch vụ bên ngoài

| Dịch vụ | Dùng để | Cách nối |
|---|---|---|
| **SMTP** (Gmail hoặc hộp thư ảo) | Gửi mã OTP, hóa đơn | Nodemailer, cấu hình trong `.env` |
| **SePay** | Mã QR chuyển khoản, báo tiền về | Ảnh QR từ `qr.sepay.vn`; ngân hàng báo tiền thì SePay gọi webhook vào `/api/payments/sepay/webhook` |
| **OpenAI** | Chatbot tư vấn | `gpt-4o-mini` để trả lời, `text-embedding-3-small` để tìm đoạn liên quan; gọi từ backend |

## 6. Kỹ thuật và mô hình đã áp dụng

| Kỹ thuật | Áp dụng ở đâu |
|---|---|
| Kiến trúc client-server, tách backend và frontend | Hai thư mục, hai `package.json`, chỉ nói chuyện qua `/api` |
| REST API | Mỗi chức năng một đường dẫn và phương thức HTTP rõ ràng |
| Kiến trúc phân lớp ở backend | `routes` (nhận yêu cầu) → `services` (nghiệp vụ) → `core` (nền tảng) |
| Đăng nhập bằng token | Token tự ký HMAC-SHA256, hạn 7 ngày, gửi qua header `Authorization: Bearer` |
| Phân quyền theo vai trò (RBAC) | 4 vai trò: khách, nhân viên, chủ cửa hàng, admin; kiểm tra ở cả backend và frontend |
| Băm mật khẩu | scrypt kèm salt ngẫu nhiên |
| OTP qua email | Mã 6 số, hiệu lực 3 phút, chỉ lưu bản băm |
| Webhook | Nhận báo tiền về từ SePay, bỏ qua giao dịch gửi trùng |
| RAG (truy xuất rồi sinh câu trả lời) | Chatbot tìm dữ liệu liên quan bằng embedding, đưa cho AI trả lời; có gọi hàm lấy giá và tồn kho thật |
| Stale-while-revalidate | Trang vẽ ngay bằng bản nhớ rồi cập nhật dữ liệu mới ở nền |
| Ghi file nguyên tử | Ghi file tạm rồi đổi tên, tránh hỏng `db.json` |
| Server tự tính tiền | Trình duyệt chỉ gửi mã sản phẩm và số lượng |
| Test tự động | `node:test`, và test giao diện bằng Chrome điều khiển qua CDP |

## 7. Công cụ phát triển và chạy

| Việc | Lệnh |
|---|---|
| Chạy API (cổng 3000) | `cd backend` rồi `npm run server` |
| Chạy giao diện (cổng 5173) | `cd frontend` rồi `npm run dev` |
| Chạy test | `cd backend` rồi `npm test` |
| Chạy hộp thư ảo | `cd backend` rồi `npm run mail` |
| Đóng gói giao diện | `cd frontend` rồi `npm run build` |

Cấu hình bí mật (SMTP, OpenAI, SePay) đặt trong `backend/.env`, không đưa lên GitHub.

## 8. Tóm tắt một dòng

> Website bán cây cảnh viết bằng JavaScript: frontend HTML, CSS, JS thuần dựng bằng Vite; backend Node.js với Express; dữ liệu lưu file JSON; gửi email bằng Nodemailer (SMTP), thanh toán QR qua SePay, chatbot tư vấn dùng OpenAI theo mô hình RAG.
