# Cấu trúc và logic project Xanh Garden

Đọc theo thứ tự **1 → 2 → 3** để nắm tổng thể, sau đó tra cứu các mục còn lại khi cần.

---

## 1. Tổng quan kiến trúc

```text
Trình duyệt (HTML + CSS + JavaScript thuần, nhiều trang)
        │  fetch('/api/...')  kèm header Authorization: Bearer <token>
        ▼
frontend/: Vite (5173)  ── proxy /api, /uploads ──►  backend/: Express (3000)
                                                      │
               ┌──────────────────────┬───────────────┼──────────────────────┐
               ▼                      ▼               ▼                      ▼
   backend/data/db.json     analytics.ndjson      uploads/              Dịch vụ ngoài
   (toàn bộ dữ liệu cửa hàng)  (hành vi khách)   (ảnh đánh giá, banner,  Gmail SMTP · SePay/VietQR
                                                  sản phẩm, đại diện)   · OpenAI (chatbot)
```

- **Hai phần riêng**: `frontend/` và `backend/` có `package.json`, `node_modules` riêng, chỉ nói chuyện với nhau qua `/api`.
- **Giao diện**: mỗi trang = 1 file HTML trong `frontend/` + 1 file JS trong `frontend/src/js/pages/`. Giao diện chỉ hiển thị và kiểm tra nhanh.
- **Server là nơi quyết định cuối**: giá, giảm giá, phí ship, tồn kho, phân quyền, trạng thái đơn đều do server tính. Mọi con số client gửi lên đều bị bỏ qua.
- **Dữ liệu**: mọi thứ sinh ra khi chạy nằm trong thư mục `backend/data/` (mục 5): `db.json` nạp vào bộ nhớ khi khởi động, ghi nguyên tử (ghi file tạm rồi đổi tên), **sao lưu tự động mỗi ngày** vào `backend/data/backups/` (giữ 7 bản). Server chạy một tiến trình nên mọi thao tác trừ kho/dùng voucher trong cùng một lượt đồng bộ không bị tranh chấp. `backend/` nằm ngoài thư mục gốc của Vite nên trình duyệt không tải trực tiếp được `db.json` hay `.env`.

---

## 2. Cây thư mục

```text
caycanh/
├─ backend/                  BACKEND (npm run server, npm test, npm run mail)
│  ├─ package.json, .env, .env.example
│  ├─ server/
│  │  ├─ index.js            Khởi động: migrate dữ liệu, gắn route, hẹn giờ dọn dẹp/cấp voucher
│  │  ├─ core/               Hạ tầng dùng chung, không chứa nghiệp vụ cụ thể
│  │  ├─ services/           Logic nghiệp vụ (kho, đơn, giá, voucher, hóa đơn, bán chạy, ...)
│  │  ├─ routes/             API: mỗi file một nhóm đường dẫn, chỉ kiểm tra quyền + gọi services
│  │  ├─ ai/                 Chatbot: kết nối OpenAI, cơ sở tri thức (RAG), kb/*.md
│  │  └─ data/               Dữ liệu mẫu nạp lần đầu (voucher mẫu, thông số sản phẩm)
│  ├─ data/                  DỮ LIỆU KHI CHẠY
│  │  ├─ db.json             Cơ sở dữ liệu (bảng ở mục 5)
│  │  ├─ db.sample.json      Dữ liệu mẫu để chạy lần đầu
│  │  ├─ analytics.ndjson    Nhật ký hành vi khách (giữ 90 ngày)
│  │  ├─ uploads/            Tệp tải lên: reviews/, banners/, products/, avatars/ (ảnh đại diện)
│  │  └─ backups/            Bản sao lưu db.json mỗi ngày (giữ 7 bản)
│  ├─ scripts/               mail-ao.mjs (hộp thư ảo), them-san-pham.mjs + san-pham-them.json (thêm hàng loạt sản phẩm)
│  └─ tests/                 Bộ test nghiệp vụ tự động (mục 8)
├─ docs/                     Tài liệu phân tích thiết kế: SRS, USECASE, SDS (.docx) và sơ đồ ERD, use case, kiến trúc (.png)
└─ frontend/                 FRONTEND (npm run dev, npm run build)
   ├─ *.html                 23 trang (xem mục 6)
   ├─ package.json, vite.config.js
   ├─ public/fonts/          Font Be Vietnam Pro (.ttf) để PDF có dấu tiếng Việt
   └─ src/
      ├─ js/pages/           Mỗi trang HTML một file
      ├─ js/components/      Thành phần giao diện dùng chung
      ├─ js/services/        Gọi API, giỏ hàng, yêu thích, danh mục, Excel, giao diện theo sự kiện, theo dõi hành vi
      ├─ js/utils/           Hàm tiện ích nhỏ (định dạng, icon, ảnh, ngày giờ, phiên đăng nhập)
      └─ static/             CSS/main.css + IMAGES/ (ảnh sản phẩm p*, sp-*, ảnh tại vườn bg*, banner events/, NGUON_ANH.md)
```

---

## 3. Công nghệ

| Công nghệ | Dùng ở đâu | Để làm gì |
|---|---|---|
| JavaScript ES Modules | toàn bộ `frontend/src/`, `backend/server/` | Ngôn ngữ duy nhất của project |
| Node.js ≥ 22 + Express 4 | `backend/server/` | API, middleware, phục vụ tệp tải lên |
| Vite 6 | `frontend/vite.config.js` | Chạy giao diện, proxy `/api`; đóng gói 23 trang; đưa script trang lên `<head>` kèm `blocking="render"` để chuyển trang không giật |
| SheetJS `xlsx` | `frontend/src/js/services/excel-service.js`, `pages/admin-products-page.js`, `pages/admin-dashboard-page.js` | Đọc và ghi file Excel ngay trên trình duyệt (xuất, nhập sản phẩm; xuất báo cáo), làm theo bài B16 |
| jsPDF 3.0.3 + jsPDF-AutoTable 5.0.2 (CDN) | `my-orders.html`, `admin-orders.html`, `admin-products.html`, `components/invoice.js` | Xuất hóa đơn PDF cho từng đơn và danh sách sản phẩm, làm theo bài B16: nhúng bằng thẻ `<script>`, dùng `window.jspdf` và `doc.autoTable`; nạp font Be Vietnam Pro để có dấu tiếng Việt |
| Nodemailer | `backend/server/core/mailer.js` | Gửi qua SMTP: mã xác minh, mã OTP đổi mật khẩu, quên mật khẩu, hóa đơn HTML, mail sinh nhật |
| `node:crypto` | `core/http.js`, `core/codes.js`, `core/store.js`, `ai/kb.js` | Băm mật khẩu (scrypt), ký token (HMAC), mã 6 số, ID, băm nội dung chunk |
| OpenAI API (gọi bằng `fetch`, không cần SDK) | `backend/server/ai/` | Embedding (`text-embedding-3-small`) để tìm kiến thức + Chat Completions có gọi hàm (`gpt-4o-mini`) |
| SePay / VietQR | `services/sepay.js`, `routes/payments.js` | Mã QR chuyển khoản; **webhook** báo tiền về → ghi nhận thanh toán và tự xác nhận đơn trên 1 triệu |
| CSS thuần (biến CSS, Grid, `color-mix`) | `frontend/src/static/CSS/main.css` | Giao diện; màu chủ đề đổi theo sự kiện qua biến `--green`, `--green-dark`, `--accent` |
| SVG nội tuyến | `frontend/src/js/utils/icons.js`, biểu đồ thống kê | Icon cho nút, biểu đồ đường doanh thu (không dùng thư viện) |
| `localStorage` / `sessionStorage` | `utils/auth.js`, `services/cart-service.js`, `services/site-service.js`, chatbot | Phiên đăng nhập, bản đệm giỏ hàng, màu chủ đề, lịch sử chat của khách chưa đăng nhập |

---

## 4. Backend (`backend/server/`)

### 4.1 `core/`: hạ tầng

| File | Vai trò |
|---|---|
| `paths.js` | Đường dẫn thư mục dữ liệu (`backend/data/`, đổi bằng biến `DATA_DIR`). |
| `store.js` | Nạp `db.json` thành biến `db`, `save()` ghi nguyên tử (tăng `version` để số liệu tính sẵn biết khi nào tính lại), `backupDaily()` sao lưu mỗi ngày, `newId()`, `byId()`. Danh sách bảng ở `COLLECTIONS`. |
| `http.js` | `ApiError`/`fail()` ném lỗi có mã HTTP; băm/kiểm mật khẩu; tạo/đọc token (7 ngày); `authenticate` (vai trò luôn lấy từ db); `requireRole`; `handle()` bọc handler. |
| `rules.js` | **Mọi hằng số và hàm kiểm tra dữ liệu đầu vào**: phí ship, giới hạn đơn, COD, ngưỡng hàng mới, quy tắc voucher, giới hạn chatbot; `parseRegistration`, `parseBirthday`, `parseOrderOptions`, `parseProduct`, `parseVoucher`, `parseEvent`, `parseBanner`... |
| `codes.js` | Mã xác nhận 6 số: chỉ lưu bản băm, hết hạn, sai tối đa 5 lần, gửi lại cách 60 giây. |
| `mailer.js` | Gửi mail qua SMTP (pool 1 kết nối, thử lại 1 lần); không cấu hình thì in ra console. |

### 4.2 `services/`: nghiệp vụ

| File | Vai trò |
|---|---|
| `inventory.js` | `logStock()` ghi **nhật ký nhập/xuất** mỗi lần tồn kho đổi (nhập hàng, bán, hoàn kho khi hủy, điều chỉnh) và cập nhật `lastImportedAt`; `presentProduct()` gắn cờ `isNew` (theo hạn riêng `newUntil`, không có thì tính từ lúc tạo theo số ngày chung, mặc định 30), `restocked` (nhập thêm ≤ 7 ngày), `newPromoPercent` (đang được giảm giá sản phẩm mới, tính ở `newPromoOf()`), **`sold`** (số đã bán từ đơn đã chốt) và **`rating`/`ratingCount`** (điểm đánh giá thật); `arrivalTime()` để sắp "mới nhất". |
| `sales.js` | `bestSellers()`: **bán chạy theo tháng** (giờ VN) tính từ chi tiết đơn đã được chốt (`confirmed/shipping/delivered`); thiếu thì bổ sung từ tháng trước rồi hàng mới; không đề xuất hàng hết. |
| `pricing.js` | `quote()`: **nơi duy nhất tính tiền**: tiền hàng, voucher, phí ship, tổng; `evaluate()` kiểm tra 1 voucher có dùng được không và giảm bao nhiêu; `walletFor()` cho màn hình thanh toán. |
| `vouchers.js` | Ví voucher: nhận voucher (`claimVoucher`), điều kiện nhận (`claimProblem`), **tự cấp** voucher người dùng mới/sinh nhật (`syncAutoVouchers`, `sweepAutoVouchers` + mail chúc mừng), đánh dấu đã dùng khi đặt (`consumeVouchers`) và **trả lại khi hủy** (`releaseVouchers`). |
| `orders.js` | `setStatus` (ghi lịch sử), **`markPaid`** (ghi nhận đã thanh toán; đơn trên 1 triệu đang chờ thanh toán thì tự chuyển sang "chờ cửa hàng xác nhận" — dùng chung cho webhook SePay và admin ghi nhận tay), `cancelOrder` (hoàn kho + trả voucher **đúng một lần**, đánh dấu cần hoàn tiền), `publicOrder`, `sweepExpired` (tự hủy đơn chuyển khoản quá hạn 30 phút, dọn tài khoản chưa xác minh quá 24 giờ). |
| `code-mail.js` | Mẫu **email HTML gửi mã 6 số** (xác minh tài khoản, quên mật khẩu, đổi mật khẩu): mã to trong khung dễ chọn, hạn 3 phút, cảnh báo bảo mật. Bản văn bản thuần vẫn giữ cụm "là: <mã>". |
| `order-mail.js` | Mẫu **hóa đơn HTML** gửi qua email. `sendAutoInvoice()` tự gửi về email của tài khoản: COD ngay sau khi đặt, chuyển khoản sau khi nhận đủ tiền. Nút "Gửi hóa đơn về email" dùng cùng mẫu này. |
| `site.js` | Sự kiện lặp **hằng năm** theo dương lịch (Noel 25/12, Halloween 31/10...) hoặc **âm lịch** (Tết 1/1, Trung thu 15/8), chạy từ (ngày lễ − số ngày trước) đến hết (ngày lễ + số ngày sau) theo giờ VN; `eventWindow()` tính lần đang chạy/sắp tới, `currentEvent()` chọn sự kiện đang chạy (trùng thì ưu tiên cao hơn thắng), `activeBanners()` chọn banner của sự kiện hoặc banner mặc định. |
| `lunar.js` | Đổi ngày âm lịch Việt Nam sang dương lịch (thuật toán Hồ Ngọc Đức, có xử lý tháng nhuận). |
| `uploads.js` | Nhận diện loại tệp theo chữ ký đầu tệp, giới hạn dung lượng, xóa ảnh đánh giá/banner/ảnh đại diện/ảnh sản phẩm không còn dùng (ảnh sản phẩm còn trong đơn cũ thì giữ). |
| `sepay.js` | Tài khoản nhận tiền, tạo link QR và nội dung chuyển khoản. |
| `analytics.js`, `demand.js` | Lưu hành vi truy cập ẩn danh và tổng hợp thành báo cáo "Nhu cầu khách hàng". |

### 4.3 `routes/`: API

| File | Đường dẫn | Quyền | Chức năng |
|---|---|---|---|
| `auth.js` | `/api/auth` | công khai / đăng nhập | Đăng ký (kèm ngày sinh tùy chọn), xác minh email (+ tặng voucher người dùng mới), đăng nhập (khóa 10 phút sau 5 lần sai), quên/đặt lại mật khẩu, **đổi mật khẩu có OTP** (`/change-password/code`, `/change-password`), **ảnh đại diện** (`/avatar`) |
| `site.js` | `/api/site`, `/api/products/featured`, `/api/products/new` | công khai | Sự kiện + banner đang chạy; bán chạy tháng này; 4 sản phẩm mới nhất theo thời gian tạo |
| `shop.js` | `/api/categories`, `/api/products`, `/api/reviews` | công khai (đánh giá cần đăng nhập) | Sản phẩm (cờ Mới/Mới về, đã bán, điểm đánh giá, `?sort=newest`), đánh giá kèm ảnh/video, `/reviews/latest` (đánh giá tốt gần đây cho trang chủ) |
| `favorites.js` | `/api/favorites` | user | **Sản phẩm yêu thích** theo tài khoản: xem, thêm, bỏ, `/ids` |
| `pages.js` | `/api/pages` | công khai | Trang Chính sách / Cẩm nang / Hỏi đáp lấy từ `server/ai/kb/*.md` (cùng nguồn với chatbot, ẩn mục chỉ dành cho bot) |
| `cart.js` | `/api/cart` | user | **Giỏ hàng theo tài khoản**: xem, ghi đè, gộp giỏ lúc chưa đăng nhập (`/merge`), xóa |
| `addresses.js` | `/api/addresses` | user | Sổ địa chỉ (tối đa 10, có mặc định) |
| `vouchers.js` | `/api/vouchers` | công khai / user | Kho voucher, ví của tôi (`/mine`), nhận voucher (`/claim`), khai ngày sinh (`/birthday`, chỉ 1 lần) |
| `orders.js` | `/api/orders` | đăng nhập | Xem trước giá (`/quote`), đặt hàng (tiền hàng trên 1 triệu bắt buộc chuyển khoản, trạng thái chờ thanh toán), đổi trạng thái, **đổi COD ↔ chuyển khoản** (`/payment-method`, chỉ khi chưa thanh toán, cửa hàng chưa xác nhận và chưa có giao dịch chuyển khoản nào), thông tin QR, ghi nhận thanh toán |
| `payments.js` | `/api/payments/sepay/webhook` | khóa SePay | Nhận báo tiền về, chống trùng, phân loại thiếu/thừa/trùng/đơn đã hủy; **cộng dồn các lần chuyển thiếu** của cùng đơn; đủ tiền thì gọi `markPaid` (**tự xác nhận đơn trên 1 triệu**) và tự gửi hóa đơn cho khách |
| `feedbacks.js` | `/api/feedbacks` | đăng nhập | Góp ý/khiếu nại, admin trả lời |
| `uploads.js` | `/api/uploads/reviews` | user | Tải ảnh/video đánh giá |
| `admin.js` | `/api/admin/stats`, `/inventory`, `/products`, `/demand`, `/payments` | admin | Thống kê doanh thu (mở theo tháng, biểu đồ theo ngày), kho & vận hành, CRUD sản phẩm, nhập hàng, **nhập sản phẩm từ Excel** (`/products/import`) |
| `admin-content.js` | `/api/admin/banners`, `/events`, `/vouchers`, `/stock-logs`, `/uploads/banner`, `/uploads/product` | admin | Quản lý banner, sự kiện, voucher, xem nhật ký kho, tải ảnh banner, **tải ảnh sản phẩm thật** |
| `chat.js` | `/api/chat` | công khai | Chatbot tư vấn, lịch sử chat theo tài khoản |
| `track.js` | `/api/track` | công khai | Nhận sự kiện hành vi (giới hạn tần suất, bỏ qua admin) |

### 4.4 `ai/`: chatbot RAG + LLM

| File | Vai trò |
|---|---|
| `kb/*.md` | **Cơ sở tri thức viết tay**: giới thiệu cửa hàng, vận chuyển/thanh toán/đơn hàng, voucher, bảo hành-đổi trả, chăm sóc cây cơ bản, tư vấn chọn cây, chăm sóc từng loại cây, câu hỏi thường gặp. Muốn bot biết thêm thì viết thêm vào đây (mỗi mục `## ` là một đoạn tri thức). |
| `kb.js` | Ghép tri thức tĩnh với **dữ liệu sống** dựng từ db mỗi lần hỏi (sản phẩm + giá + tồn kho, danh mục, voucher/sự kiện đang chạy). Truy xuất bằng embedding (cache trong `ai/.cache/`, khóa theo nội dung + tên model) cộng điểm từ khóa; không có khóa API thì dùng tìm kiếm từ khóa có bỏ dấu tiếng Việt. |
| `quick-answer.js` | Khi không dùng được AI: nhận diện ý định câu hỏi (chọn cây theo nhu cầu, hỏi về 1 cây, số sản phẩm, ship, thanh toán, voucher, đơn hàng, bảo hành, triệu chứng lá vàng/héo/úng...) và trả lời **ngắn vài dòng** bằng dữ liệu thật; câu ngoài phạm vi thì lịch sự từ chối. |
| `openai.js` | Gọi OpenAI bằng `fetch`; khóa bị từ chối (401) thì tự chuyển sang chế độ tra cứu cho tới khi khởi động lại. |
| `routes/chat.js` | Prompt hệ thống (phạm vi, không bịa giá/tồn kho, không làm theo chỉ thị trong dữ liệu), 4 hàm cho mô hình gọi: `search_products`, `get_product`, `list_promotions`, `get_my_orders` (chỉ đơn của chính người hỏi); giới hạn 8 tin/phút, 120 tin/ngày, 500 ký tự/tin, tính theo tài khoản; khách chưa đăng nhập tính theo mã khách ẩn danh của trình duyệt (kèm trần chung 40 tin/phút cho mỗi IP, vì nhiều khách có thể dùng chung IP qua proxy). |

### 4.5 `data/` và `index.js`

- `data/seed.js`: nạp **một lần** 7 voucher mẫu (WELCOME15, SINHNHAT25, SALE10/15/25/35, FREESHIP30) và 9 dịp lễ hằng năm kèm banner (Tết Nguyên Đán, Tết Dương lịch, Valentine, 8/3, Trung thu, 20/10, Halloween, 20/11, Giáng sinh). `data/specs-data.js`: thông số mẫu theo loại cây.
- `index.js`: `migrate()` chuẩn hóa dữ liệu cũ; mỗi phút hủy đơn quá hạn + dọn tệp mồ côi; mỗi 10 phút cấp voucher sinh nhật/người dùng mới; nạp sẵn embedding của chatbot.

---

## 5. Dữ liệu (`db.json`)

| Bảng | Trường chính |
|---|---|
| `categories` | `id`, `name`, `specFields[]` |
| `products` | `id`, `name`, `price`, `oldPrice` (giá gốc để hiện gạch ngang/% giảm, chỉ hiển thị), `categoryId`, `image` (tên ảnh có sẵn hoặc `/uploads/products/...`), `description`, `care[]`, `stock`, `specs{}`, `createdAt`, `lastImportedAt`, `newUntil` (hạn nhãn Mới riêng), `promoUntil` (hạn giảm giá riêng) |
| `stockLogs` | `productId`, `type` (`import`/`sale`/`cancel_return`/`adjust`), `qty` (+/−), `balanceAfter`, `note`, `by`, `createdAt` |
| `user` | `id`, `name`, `email`, `passwordHash` (scrypt), `role`, `verified`, `avatar`, `addresses[]`, `favorites[]` (mã sản phẩm yêu thích), `birthday`, `createdAt` |
| `carts` | `userId`, `items[{id, qty}]`, `updatedAt` |
| `orders` | `code`, `userId`, `customer{}`, `items[]` (bản chụp giá lúc đặt), `subtotal`, `discount`, `shippingFee`, `shippingDiscount`, `total`, `vouchers[]`, `paymentMethod`, `paymentStatus`, `status`, `history[]` |
| `vouchers` | `code`, `name`, `kind` (`order`/`shipping`), `type` (`percent`/`fixed`), `value`, `maxDiscount`, `minOrder`, `audience` (`all`/`newUser`/`birthday`), `scope` + `scopeIds`, `startAt`, `endAt`, `totalQuantity`, `perUserLimit`, `validDays`, `claimable`, `active`, `claimedCount`, `usedCount` |
| `userVouchers` | Ví: `userId`, `voucherId`, `code`, `source` (`claim`/`newUser`/`birthday`), `issuedAt`, `expiresAt`, `status` (`available`/`used`), `orderId` |
| `events` | `name`, `recurrence` (`once`/`yearly`/`lunar`), `month`, `day`, `daysBefore`, `daysAfter` (sự kiện lặp) hoặc `startAt`, `endAt` (một lần), `priority`, `active`, `theme{primary, accent, slogan}` |
| `banners` | `name`, `image` (tên ảnh có sẵn hoặc `/uploads/banners/...`), `link` (chỉ trang nội bộ), `eventId` (rỗng = mặc định), `order`, `startAt`, `endAt`, `active` |
| `chats` | `userId`, `messages[{role, content, at}]` (giữ 40 tin gần nhất) |
| `settings` | `newProductDays`, `restockDays`, `newPromo{enabled, percent, maxDiscount, minOrder, days}`, thông tin cửa hàng |
| `reviews`, `feedbacks`, `payments`, `uploads` | Đánh giá, góp ý, nhật ký giao dịch SePay, tệp đánh giá đã tải lên |

**Lưu trữ phía trình duyệt** (chỉ là bản đệm, server là nguồn chính): `localStorage` giữ phiên đăng nhập (token 7 ngày), giỏ hàng (đồng bộ lên server theo tài khoản), mã khách ẩn danh cho thống kê, màu chủ đề sự kiện (áp ngay khi mở trang rồi làm mới ở nền); `sessionStorage` giữ danh mục cho menu, lịch sử chat của khách chưa đăng nhập, và **bản nhớ dữ liệu API** (`apiCache:<tài khoản>:<đường dẫn>`) để trang đã xem hiện ngay khi quay lại (xóa khi đăng xuất, khi token hết hạn và sau mọi thao tác đổi dữ liệu trừ giỏ hàng/chat).

**Trạng thái đơn:** `unconfirmed` (chờ thanh toán, chỉ đơn có tiền hàng > 1 triệu; webhook SePay báo đủ tiền thì tự sang `pending`) → `pending` → `confirmed` → `shipping` → `delivered`; `cancelled` khi chưa giao, hoặc khi admin ghi nhận **giao không thành công** (đơn đang giao, khách không nhận: hoàn hàng về kho, đã trả trước thì cần hoàn tiền, lưu lý do ở `cancelReason`). Đổi COD sang chuyển khoản vẫn tính vào giới hạn 3 đơn chưa thanh toán.

---

## 6. Frontend (`frontend/src/js/`)

### Dùng chung

| File | Vai trò |
|---|---|
| `services/api-service.js` | Cổng gọi API duy nhất (tự gắn token, giới hạn thời gian chờ, thông báo lỗi tiếng Việt), `upload()` gửi tệp; **`load(paths, render)`**: vẽ ngay bằng bản nhớ rồi tải bản mới ở nền, khác thì vẽ lại tại chỗ (stale-while-revalidate) – các trang dùng hàm này để chuyển trang không giật. |
| `services/cart-service.js` | Giỏ hàng: đọc/ghi tức thì trên trình duyệt, **đồng bộ lên server theo tài khoản** (debounce 0,5 giây, gửi nốt khi đóng trang, gộp giỏ khách khi đăng nhập, xóa bản trên máy khi đăng xuất). `cartReady` = lời hứa đồng bộ xong. |
| `services/site-service.js` | Lấy sự kiện/banner, áp màu chủ đề lên mọi trang qua biến CSS. |
| `services/tracker.js` | Theo dõi hành vi ẩn danh. |
| `components/header.js` | Header gọn 1 khối trắng (logo, ô tìm kiếm, tài khoản, yêu thích, giỏ hàng; hàng dưới là menu danh mục dạng chữ; menu trượt trên điện thoại), dải đường dẫn, **footer 4 cột** nền sáng (hotline, chính sách) và nút gọi nhanh tròn nhỏ cho mọi trang; header riêng cho trang quản trị; nạp chatbot (trừ admin). |
| `services/favorite-service.js`, `catalog-service.js` | Nút trái tim yêu thích (đồng bộ server); danh mục dùng chung cho menu (nhớ tạm trong sessionStorage). |
| `components/chat-widget.js` | Nút chat nổi + khung chat (gợi ý câu hỏi, định dạng an toàn, chỉ cho liên kết nội bộ). |
| `components/product-card.js` | Thẻ sản phẩm kiểu shop: nhãn -%/Bán chạy/Mới -N%/Mới/Mới về, chữ "Hết hàng" đè trên ảnh và ở dòng dưới tên, nút yêu thích, sao đánh giá, "Đã bán", giá + giá gốc gạch ngang, nút "Thêm vào giỏ". |
| `components/bank-ui.js` | Thẻ tổng quan lớn và dòng danh sách kiểu app ngân hàng cho các trang thống kê. |
| `components/order-view.js`, `notify.js` | Hiển thị đơn (có dòng giảm giá voucher); thông báo nhanh góc phải và hộp thoại. |
| `components/invoice.js` | `xuatHoaDon(donHang, btnXuatPDF, thongBao)`: xuất hóa đơn PDF của một đơn (thông tin khách, bảng sản phẩm, giảm giá, phí ship, tổng tiền), khóa nút khi đang xuất. |
| `utils/icons.js` | Bộ icon SVG + `iconButton()` (nút chỉ có icon luôn kèm chữ mô tả khi rê chuột/đọc màn hình). |
| `utils/format.js`, `images.js`, `dates.js`, `auth.js`, `validate.js`, `password*.js` | Định dạng tiền/ngày, tra ảnh (kể cả ảnh banner tải lên), chuyển đổi ô ngày giờ, phiên đăng nhập, kiểm tra form, mật khẩu. |

### Trang

| HTML | JS (`pages/`) | Chức năng |
|---|---|---|
| `index.html` | `home-page.js` | Thanh sự kiện; danh mục bên trái + **banner trượt** (banner sự kiện do admin quản lý + ảnh thật tại vườn) + 2 ô khuyến mãi; danh mục nổi bật, **bán chạy tháng**, chọn cây theo không gian, **4 sản phẩm mới nhất**, hình ảnh thực tế tại vườn, đánh giá thật của khách, cẩm nang |
| `products.html` | `products-page.js` | Lọc theo danh mục/giá/còn hàng/đang giảm giá, tìm không phân biệt dấu (cả từ ô tìm kiếm ở header), sắp xếp (nổi bật, bán chạy, mới về, giá, tên), lưới/danh sách, phân trang |
| `product-detail.html` | `product-detail-page.js` | Giá + giá gốc/% giảm, chip ánh sáng/tưới nước, thêm giỏ/mua ngay/yêu thích, hộp chính sách; tab Mô tả & chăm sóc / Thông số / Đánh giá; sản phẩm tương tự |
| `account.html` | `account-page.js` | **Tài khoản của tôi**: thông tin + khai ngày sinh, **ảnh đại diện**, tóm tắt mua sắm, sổ địa chỉ, sản phẩm yêu thích, đổi mật khẩu có OTP, link quên mật khẩu |
| `info.html` | `info-page.js` | **Chính sách & cẩm nang** (vận chuyển, đổi trả, chăm cây, chọn cây, hỏi đáp) từ API `/pages` |
| `cart.html`, `checkout.html` | `cart-page.js`, `checkout-page.js` | Các bước mua hàng; giỏ theo tài khoản (thanh tiến độ freeship); thanh toán với **chọn voucher** (tự chọn voucher lợi nhất, nêu lý do voucher không dùng được), giá do server tính |
| `vouchers.html` | `vouchers-page.js` | Kho voucher (bấm nhận), ví của tôi, khai ngày sinh |
| `order-success.html`, `my-orders.html` | cùng tên | Mã QR thanh toán (tự cập nhật khi webhook báo tiền về), đổi COD ↔ QR; đơn của tôi (lọc theo trạng thái, **xuất hóa đơn PDF** từng đơn) |
| `login.html`, `dangky.html`, `verify-email.html`, `forgot-password.html`, `feedback.html` | cùng tên | Tài khoản, góp ý |
| `admin-dashboard.html` | `admin-dashboard-page.js` + `admin-demand.js` | Thống kê 5 tab: Doanh thu (mở theo tháng hiện tại, biểu đồ theo ngày, đổi được sang quý/năm; so cùng kỳ, theo danh mục/thanh toán, bán chạy), Kho & vận hành, Nhu cầu khách, Đánh giá, Khách hàng |
| `admin-reviews.html` | `admin-reviews-page.js` | Quản lý đánh giá sản phẩm (nhân viên, chủ, admin): lọc theo sao, có ảnh/video, chưa phản hồi; phản hồi công khai; chủ và admin xóa đánh giá xấu |
| `admin-orders.html` | `admin-orders-page.js` | Quản lý đơn, thẻ tổng quan theo kỳ, xuất CSV, **xuất hóa đơn PDF** từng đơn |
| `admin-products.html` | `admin-products-page.js` | Quản lý sản phẩm **làm theo bài B17**: 1 form dùng chung cho thêm/sửa (ô ẩn `productId`, nút "Thêm sản phẩm" ↔ "Cập nhật", "Hủy sửa"), các hàm `loadCategories`, `loadProducts`, `editProduct`, `updateForm`, `deleteProduct`, `resetForm`, `showPreview`; thêm tải ảnh thật, giá gốc, thông số theo danh mục, hạn nhãn Mới và hạn giảm giá riêng, cài đặt số ngày chung, phiếu nhập hàng, lịch sử nhập/xuất, **xuất Excel, xuất PDF, nhập từ Excel** |
| `admin-banners.html` | `admin-banners-page.js` | Sự kiện (màu chủ đề, khẩu hiệu, thời gian) và banner (tải ảnh, liên kết, thứ tự) |
| `admin-vouchers.html` | `admin-vouchers-page.js` | Tạo/sửa/tắt voucher |

Thêm trang mới: tạo HTML trong `frontend/`, file JS trong `pages/`, **khai báo trong `frontend/vite.config.js`**.

---

## 7. Quy tắc nghiệp vụ chính

| Nhóm | Quy tắc |
|---|---|
| Vận chuyển | Tiêu chuẩn 30.000 ₫, miễn phí khi tiền hàng (trước giảm giá) ≥ 500.000 ₫; giao nhanh 50.000 ₫ |
| Đơn hàng | ≤ 20 cái/sản phẩm, tiền hàng + ship ≤ 50 triệu (xét trước giảm giá), tối đa 3 đơn chờ, chặn đặt trùng trong 10 giây; **tiền hàng > 1 triệu bắt buộc chuyển khoản QR và được xác nhận tự động qua webhook SePay khi nhận đủ tiền**; chuyển thiếu rồi chuyển bù (cùng nội dung) được cộng dồn; đơn chuyển khoản phải trả trong 30 phút, quá hạn tự hủy và hoàn kho (đã nhận một phần tiền thì đánh dấu cần hoàn tiền); mã đơn theo ngày giờ Việt Nam |
| Voucher (kiểu TikTok Shop) | Tối đa 1 voucher giảm đơn + 1 voucher ship mỗi đơn; % luôn có mức giảm tối đa (1–70%); đơn tối thiểu tính trên sản phẩm đủ điều kiện; giới hạn tổng số lượng và mỗi người; voucher ship không dùng khi đã miễn phí ship; voucher người dùng mới chỉ cho đơn đầu tiên; voucher sinh nhật mỗi năm 1 lần (29/2 nhận vào 28/2 năm không nhuận); hủy đơn thì voucher trở lại ví; voucher đã có người nhận thì không đổi được điều kiện/mức giảm và không xóa được (chỉ tắt) |
| Ngày sinh | Không bắt buộc, tuổi 10–100, chỉ khai được một lần |
| Kho | Mọi thay đổi tồn kho đều có nhật ký; "Mới" = tạo ≤ 30 ngày, "Mới về" = nhập thêm ≤ 7 ngày (đổi được trên trang Sản phẩm) |
| Sản phẩm mới | Trang chủ luôn hiện 4 sản phẩm tạo gần nhất, nhập thêm hàng cũ không tính. Giảm giá sản phẩm mới mặc định tắt, số ngày giảm phải ít hơn số ngày hiện nhãn Mới; từng sản phẩm đặt được hạn riêng, hạn giảm phải sớm hơn hạn Mới |
| Hóa đơn | COD: gửi ngay sau khi đặt. Chuyển khoản: gửi sau khi nhận đủ tiền. Luôn gửi về email của tài khoản |
| Bán chạy | Theo tháng dương lịch giờ VN, chỉ tính đơn đã được chốt, không đề xuất hàng hết |
| Sự kiện/banner | Kết thúc phải sau bắt đầu; trùng thời gian thì ưu tiên cao hơn thắng; liên kết banner chỉ được trỏ trang nội bộ; sự kiện còn banner thì không xóa được |
| Giỏ hàng | Gộp dòng trùng, giới hạn theo tồn kho và 20/dòng, tự loại sản phẩm đã xóa/hết hàng, xóa phần đã đặt khỏi giỏ sau khi đặt |
| Chatbot | Chỉ trả lời về cửa hàng/cây cảnh; giá, tồn kho, đơn hàng lấy từ dữ liệu thật; giới hạn tần suất |
| Tài khoản | Mật khẩu mạnh; khóa 10 phút sau 5 lần sai; token 7 ngày; tài khoản chưa xác minh quá 24 giờ bị xóa |

---

## 8. Kiểm thử tự động

```powershell
cd backend
npm test
```

Chạy toàn bộ nghiệp vụ trên **server thật** nhưng với thư mục dữ liệu tạm (`DATA_DIR`) và dữ liệu mẫu riêng: không đụng `backend/data/db.json`, không gửi email thật (mã xác minh được đọc từ console), không gọi OpenAI.

| File | Nội dung |
|---|---|
| `auth.test.js` | Đăng ký (mật khẩu yếu, trùng tên/email, ngày sinh), xác minh email (sai 5 lần, gửi lại), đăng nhập (khóa sau 5 lần sai, token giả), quên/đặt lại/đổi mật khẩu, phân quyền |
| `orders.test.js` | Tính giá/phí ship, đặt hàng (trừ kho, nhật ký kho, xóa giỏ, chụp giá), giới hạn (20/dòng, tồn kho, 50 triệu, 3 đơn chờ, đặt trùng), luồng trạng thái, đổi COD ↔ QR, webhook SePay (sai khóa, thiếu, cộng dồn, thừa, trùng, đơn đã hủy), tự hủy quá hạn, hoàn tiền |
| `vouchers.test.js` | Kho voucher, nhận voucher, điều kiện/mức giảm, 1 voucher giảm giá + 1 voucher ship, voucher theo danh mục, người dùng mới, sinh nhật, trả voucher khi hủy, quy tắc quản trị |
| `shop.test.js` | Sản phẩm, bán chạy, hàng mới về, yêu thích, trang thông tin, giỏ hàng, sổ địa chỉ, đánh giá kèm ảnh, góp ý, chatbot, ghi nhận hành vi |
| `admin.test.js` | Sản phẩm (giá gốc, tải ảnh), nhập kho/điều chỉnh, thống kê doanh thu, kho & vận hành, âm lịch, sự kiện/banner, lưu trữ (thư mục data, sao lưu, không lưu mật khẩu dạng rõ) |
