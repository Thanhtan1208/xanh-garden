# Xanh Garden: kiến trúc phần mềm và luồng dữ liệu

Cập nhật ngày 05/11/2026, viết theo code hiện tại trong `backend/` và `frontend/`. Cách cài đặt và chạy dự án xem ở `README.md`.

- Muốn nắm nhanh: đọc mục 1, 2 và 5.
- Muốn biết một chức năng chạy thế nào: đọc mục 6.

## 1. Tổng quan

Xanh Garden là website bán cây cảnh, gồm khu mua hàng cho khách và khu quản lý cho cửa hàng. Hệ thống theo mô hình client-server, chia thành 3 phần:

| Phần | Thư mục | Vai trò |
|---|---|---|
| Frontend | `frontend/` | 23 trang HTML và JavaScript chạy trên trình duyệt. Hiển thị dữ liệu, gửi yêu cầu. |
| Backend | `backend/server/` | REST API bằng Express. Chứa toàn bộ nghiệp vụ và kiểm tra. |
| Dữ liệu | `backend/data/` | File `db.json`, nhật ký hành vi, ảnh tải lên, bản sao lưu. |

**Nguyên tắc xuyên suốt:** frontend chỉ hiển thị và gửi yêu cầu, backend mới là nơi quyết định. Hai bên chỉ trao đổi bằng HTTP và JSON qua đường dẫn `/api`.

| Thành phần | Công nghệ | Dùng để |
|---|---|---|
| Giao diện | HTML, CSS, JavaScript thuần (ES Modules) | Nhiều trang riêng (MPA), không dùng framework |
| Công cụ frontend | Vite | Chạy dev, chuyển tiếp API, đóng gói khi build |
| File Excel, PDF | `xlsx`, jsPDF + autoTable | Xuất và đọc file ngay trên trình duyệt |
| Backend | Node.js, Express | REST API |
| Lưu trữ | File JSON | Không dùng hệ quản trị cơ sở dữ liệu |
| Email | Nodemailer qua SMTP | Mã OTP, hóa đơn |
| Thanh toán | SePay | Mã QR chuyển khoản, webhook báo tiền về |
| Chatbot | OpenAI (`gpt-4o-mini`, `text-embedding-3-small`) | Tư vấn theo mô hình RAG |
| Test | `node:test` | Test API, chạy bằng `npm test` |

## 2. Sơ đồ kiến trúc

```
┌──────────────────────────────────────────────────────┐
│ TRÌNH DUYỆT                                          │
│ 23 trang HTML + src/js                               │
│ localStorage, sessionStorage: phiên, giỏ, bản nhớ    │
└───────────┬───────────────────────────────┬──────────┘
            │ /api, /uploads                │ tải ảnh QR
            ▼                               ▼
┌───────────────────────────┐        ┌──────────────┐
│ VITE, cổng 5173           │        │ qr.sepay.vn  │
│ Trả về HTML, JS, CSS      │        └──────────────┘
│ Chuyển tiếp /api, /uploads│
└───────────┬───────────────┘
            ▼
┌───────────────────────────┐  gửi mail     ┌──────────────────┐
│ EXPRESS, cổng 3000        │ ────────────► │ SMTP             │
│                           │               └──────────────────┘
│ routes  : nhận yêu cầu    │  hỏi AI       ┌──────────────────┐
│ services: nghiệp vụ       │ ────────────► │ OpenAI           │
│ core    : nền tảng        │               └──────────────────┘
│ ai      : chatbot         │  báo tiền về  ┌──────────────────┐
│ db      : dữ liệu trên RAM│ ◄──────────── │ SePay (webhook)  │
└───────────┬───────────────┘               └──────────────────┘
            │ đọc 1 lần khi khởi động, ghi mỗi lần save()
            ▼
┌───────────────────────────┐
│ backend/data              │
│ db.json, analytics.ndjson │
│ uploads/, backups/        │
└───────────────────────────┘
```

Khi chạy trên máy có 2 tiến trình: `npm run dev` trong `frontend/` và `npm run server` trong `backend/`.

Trình duyệt chỉ làm việc với cổng 5173. Vite chuyển tiếp `/api` và `/uploads` sang cổng 3000 (`frontend/vite.config.js`), nên frontend không phải viết cứng địa chỉ server và không vướng CORS.

Khóa OpenAI, mật khẩu SMTP và khóa SePay chỉ nằm ở backend (`backend/.env`), không bao giờ gửi xuống trình duyệt.

## 3. Workflow toàn web

### 3.1. Khách hàng

```
Trang chủ ─► Danh sách, chi tiết sản phẩm ─► Thêm vào giỏ ─► Giỏ hàng
                                                                │
                      Chưa đăng nhập: Đăng nhập hoặc Đăng ký ◄──┤
                                                                ▼
                 Thanh toán: chọn địa chỉ, cách giao, voucher, cách trả tiền
                                                                │
                                                                ▼
                              Server tạo đơn, trừ kho, trả về mã đơn
                                                                │
                      ┌─────────────────────────────────────────┴───┐
                      ▼                                             ▼
          COD: gửi hóa đơn ngay                 Chuyển khoản: hiện QR, chờ tối đa 30 phút
                      │                                             │ SePay báo tiền về
                      │                                             ▼
                      │                         Đủ tiền: ghi nhận và gửi hóa đơn
                      └─────────────────────┬───────────────────────┘
                                            ▼
          Cửa hàng xác nhận ─► Đang giao ─► Đã giao ─► Khách đánh giá sản phẩm
```

Ngoài luồng mua hàng, khách còn có: trang Tài khoản (thông tin, ảnh đại diện, địa chỉ, sản phẩm yêu thích, ví voucher, đổi mật khẩu), Kho voucher, Góp ý và chatbot.

### 3.2. Cửa hàng

Tài khoản quản lý đăng nhập xong vào thẳng `admin-dashboard.html` và không mua hàng. Menu chỉ hiện các trang mà vai trò đó được phép.

| Trang | Việc chính | Nhân viên | Chủ cửa hàng | Admin |
|---|---|---|---|---|
| `admin-dashboard.html` | Doanh thu, kho, nhu cầu, đánh giá, khách hàng | Chỉ tab Kho & vận hành | Có | Có |
| `admin-orders.html` | Xác nhận, giao, hủy đơn, gửi hóa đơn | Có | Có | Có |
| `admin-products.html` | Sản phẩm, nhập kho, Excel, PDF, cài đặt New và giảm giá | Xem, xuất file, nhập kho | Có | Có |
| `admin-vouchers.html` | Tạo và quản lý voucher | Không | Có | Có |
| `admin-banners.html` | Banner, sự kiện, màu giao diện | Không | Có | Có |
| `admin-reviews.html` | Xem, lọc đánh giá, phản hồi công khai; chỉ chủ và admin có nút Xóa | Xem, phản hồi | Có | Có |
| `feedback.html` | Xem và trả lời góp ý | Có | Có | Có |
| `admin-settings.html` | Thông tin cửa hàng | Không | Có | Có |
| `admin-team.html` | Tài khoản, vai trò, đặt lại mật khẩu, xóa | Không | Không | Có |

Công việc hằng ngày với một đơn: đơn mới vào danh sách, nhân viên xác nhận, chuyển sang đang giao, rồi đánh dấu đã giao. Đơn COD được tính là đã trả tiền ở bước cuối này.

### 3.3. Việc hệ thống tự chạy

| Khi nào | Việc | Code |
|---|---|---|
| Lúc khởi động | Chuyển dữ liệu cũ sang định dạng mới, sao lưu trong ngày, nạp embedding cho chatbot | `backend/server/index.js` |
| Mỗi phút, và mỗi request vào `/api/orders` | Hủy đơn quá hạn chuyển khoản, tự đồng ý yêu cầu hủy quá 48 giờ, xóa tài khoản chưa xác minh quá 24 giờ | `sweepExpired()` |
| Mỗi phút | Xóa tệp tải lên mà không gắn vào đánh giá nào sau 1 giờ | `sweepUploads()` |
| Mỗi 10 phút | Tặng voucher người dùng mới và sinh nhật | `sweepAutoVouchers()` |
| Mỗi giờ | Sao lưu `db.json` nếu hôm nay chưa có, giữ 7 bản | `backupDaily()` |

## 4. Cấu trúc bên trong

### 4.1. Frontend

```
trang.html
   │  nạp đúng 1 file
   ▼
pages/*-page.js ──► components/  giao diện dùng lại
        │
        ├─────────► utils/       đăng nhập, quyền, định dạng, ảnh
        │
        ├─────────► config/      thông tin cửa hàng, con số nghiệp vụ
        ▼
services/ ──► api-service.js ──► fetch('/api/...')
```

| Thư mục trong `frontend/src/js` | Chứa | Ví dụ |
|---|---|---|
| `pages/` | Logic riêng của từng trang | `checkout-page.js` |
| `components/` | Phần giao diện dùng lại | `header.js`, `product-card.js`, `invoice.js`, `chat-widget.js` |
| `services/` | Gọi API, đồng bộ dữ liệu | `api-service.js`, `cart-service.js`, `tracker.js` |
| `utils/` | Hàm tiện ích | `auth.js`, `permissions.js`, `format.js`, `images.js` |
| `config/` | Thông tin cửa hàng, lấy từ `/api/shop` | `shop.js` |

Mọi trang đều import `components/header.js`. Nhờ vậy mỗi trang đều có header, menu, footer, ghi nhận hành vi và màu giao diện theo sự kiện. Chatbot cũng được nạp ở đây, trừ khi người dùng là tài khoản quản lý.

### 4.2. Backend

```
index.js    khởi động, gắn middleware và route
   ▼
routes/     nhận request, kiểm tra quyền, trả JSON
   ▼
services/   nghiệp vụ: tính tiền, tồn kho, voucher, đơn hàng, email
   ▼
core/       store (db), http (token, lỗi), rules, permissions, mailer, codes
   ▼
data/db.json
```

| Route trong `backend/server/routes` | Đường dẫn | Nội dung |
|---|---|---|
| `auth.js` | `/api/auth` | Đăng ký, xác minh, đăng nhập, mật khẩu, ảnh đại diện |
| `shop.js`, `site.js` | `/api` | Sản phẩm, danh mục, đánh giá, banner, thông tin cửa hàng |
| `pages.js` | `/api/pages` | Trang thông tin (giới thiệu, chính sách) |
| `cart.js` | `/api/cart` | Giỏ hàng theo tài khoản |
| `orders.js` | `/api/orders` | Tính giá, đặt đơn, đổi trạng thái, hủy, hóa đơn |
| `payments.js` | `/api/payments` | Webhook SePay |
| `vouchers.js` | `/api/vouchers` | Kho voucher, ví của khách, ngày sinh |
| `addresses.js`, `favorites.js` | `/api/addresses`, `/api/favorites` | Địa chỉ, sản phẩm yêu thích |
| `feedbacks.js` | `/api/feedbacks` | Góp ý |
| `uploads.js` | `/api/uploads` | Tải ảnh, video cho đánh giá |
| `track.js` | `/api/track` | Ghi nhận hành vi khách |
| `chat.js` | `/api/chat` | Chatbot |
| `admin.js` | `/api/admin` | Tài khoản, thống kê, kho, sản phẩm, cài đặt |
| `admin-content.js` | `/api/admin` | Banner, sự kiện, voucher, nhật ký kho, tải ảnh |

### 4.3. Dữ liệu trong `db.json`

| Khóa | Lưu gì |
|---|---|
| `categories`, `products` | Danh mục, sản phẩm |
| `user` | Tài khoản, gồm cả `addresses` và `favorites` của người đó |
| `orders` | Đơn hàng, gồm bản chụp sản phẩm lúc đặt và lịch sử trạng thái |
| `payments` | Giao dịch SePay gửi về |
| `carts` | Giỏ hàng theo tài khoản |
| `stockLogs` | Nhật ký mọi lần tồn kho thay đổi |
| `vouchers`, `userVouchers` | Voucher của cửa hàng, voucher trong ví từng khách |
| `reviews`, `uploads` | Đánh giá, tệp đính kèm |
| `feedbacks` | Góp ý |
| `events`, `banners` | Sự kiện, banner |
| `chats` | Lịch sử chat của khách đã đăng nhập |
| `settings` | Cài đặt admin chỉnh trên giao diện |

## 5. Dữ liệu đi như thế nào

### 5.1. Quy tắc nền

Server đọc `db.json` **một lần** lúc khởi động và giữ trong RAM. Mọi yêu cầu sau đó đọc và sửa bản trên RAM. Khi có thay đổi, `save()` ghi đè lại toàn bộ file (`backend/server/core/store.js`).

Vì vậy, sửa tay `db.json` lúc server đang chạy sẽ không có tác dụng, và lần `save()` kế tiếp sẽ ghi đè mất phần đã sửa. Muốn sửa tay thì phải tắt server trước.

### 5.2. Luồng đọc: mở trang chủ

```
home-page.js
  │  api.load(['/categories', '/products', '/products/featured?limit=8', '/products/new?limit=4'])
  │
  │  1. Có bản nhớ trong sessionStorage thì vẽ trang ngay
  │  2. Vẫn gửi yêu cầu lên server
  ▼
Vite ──► Express
  │  3. express.json(), authenticate
  │  4. routes/site.js, routes/shop.js đọc db trên RAM
  │  5. presentProduct() tính thêm: isNew, restocked, newPromoPercent, sold, rating
  ▼
res.json(...)
  │
  ▼
api.load
     6. Lưu lại bản nhớ
     7. Dữ liệu khác bản nhớ thì vẽ lại, giống thì giữ nguyên
```

Cách này gọi là stale-while-revalidate: trang hiện ngay khi chuyển trang mà vẫn cập nhật được dữ liệu mới. Khi có thao tác đổi dữ liệu, bản nhớ bị xóa để trang sau tải mới (trừ thao tác giỏ hàng và chat).

Các nhãn Mới, Mới về, số đã bán và điểm đánh giá không lưu trong `db.json`. Server tính ra mỗi lần trả dữ liệu, nên hết hạn là nhãn tự mất.

### 5.3. Luồng ghi: gửi một thay đổi

```
Trình duyệt   api.post('/orders', {...})  kèm header Authorization: Bearer <token>
   ▼
express.json        đọc JSON, tối đa 50 KB (riêng nhập Excel 2 MB)
   ▼
authenticate        kiểm tra token, gắn req.user lấy từ db
   ▼
requireRole,        chưa đăng nhập trả 401, không đủ quyền trả 403
requirePermission
   ▼
core/rules.js       kiểm tra và chuẩn hóa dữ liệu gửi lên
   ▼
services/           chạy nghiệp vụ
   ▼
db trên RAM         sửa dữ liệu
   ▼
save()              ghi db.json.tmp rồi đổi tên thành db.json
   ▼
res.json(...)       trả kết quả, trình duyệt vẽ lại
```

Việc mất thời gian như gửi email chạy sau `save()` và không chặn phản hồi. Mail lỗi chỉ ghi log, đơn hàng vẫn thành công.

### 5.4. Luồng lỗi

```
fail(409, 'Sản phẩm đã hết hàng')              ném ra ApiError
   ▼
handle() bắt lỗi, chuyển vào error middleware  backend/server/index.js
   ▼
Trả về HTTP 409 và { message: '...' }
   ▼
api-service.js ném Error kèm message
   ▼
Trang bắt lỗi và hiện thông báo cho người dùng
```

Nhận 401 khi đang có token nghĩa là phiên đã hết hạn, `api-service.js` sẽ xóa phiên để người dùng đăng nhập lại.

### 5.5. Mỗi loại dữ liệu nằm ở đâu

| Dữ liệu | Nơi lưu | Còn lại khi nào |
|---|---|---|
| Sản phẩm, đơn, tài khoản, giỏ của tài khoản | `backend/data/db.json` | Lâu dài |
| Ảnh sản phẩm có sẵn | `frontend/src/static/IMAGES` | Lâu dài |
| Ảnh, video tải lên | `backend/data/uploads/` (`products`, `banners`, `avatars`, `reviews`) | Lâu dài, trừ tệp đánh giá không dùng |
| Hành vi khách | `backend/data/analytics.ndjson` | 90 ngày |
| Sao lưu | `backend/data/backups/` | 7 bản gần nhất |
| Vector của chatbot | `backend/server/ai/.cache/embeddings.json` | Tự tính lại khi nội dung đổi |
| Số lần đăng nhập sai, tần suất chat | RAM của server | Mất khi tắt server |
| Phiên đăng nhập | localStorage `session` | Đến khi đăng xuất hoặc token hết hạn |
| Giỏ hàng trên trình duyệt | localStorage `cart`, `cart:<userId>` | Lâu dài trên máy đó |
| Thông tin cửa hàng, màu sự kiện | localStorage `shopInfo`, `siteTheme` | Bản nhớ, được làm mới mỗi trang |
| Bản nhớ API, danh mục, chat của khách chưa đăng nhập | sessionStorage | Mất khi đóng tab |

Ảnh sản phẩm trong `db.json` chỉ là tên file (`sp-chau-treo.jpg`) hoặc đường dẫn (`/uploads/products/...`). Hàm `productImage()` trong `frontend/src/js/utils/images.js` đổi giá trị đó thành địa chỉ ảnh thật.

## 6. Các luồng nghiệp vụ chính

### 6.1. Đăng ký và đăng nhập

```
ĐĂNG KÝ
register-page.js ── POST /api/auth/register
   Server: kiểm tra dữ liệu, băm mật khẩu bằng scrypt, tạo user với verified = false
   Server: tạo mã 6 số, chỉ lưu bản băm, gửi mã qua email
verify-email-page.js ── POST /api/auth/verify-email
   Server: mã đúng thì verified = true, tặng voucher người dùng mới, trả token

ĐĂNG NHẬP
login-page.js ── POST /api/auth/login
   Server: kiểm tra mật khẩu, sai 5 lần thì khóa 10 phút, đúng thì trả token và user
   Trình duyệt: lưu vào localStorage, khách về trang trước, quản lý vào admin-dashboard

CÁC REQUEST SAU
   Trình duyệt gửi header Authorization: Bearer <token>
   authenticate kiểm tra chữ ký và hạn, rồi lấy người dùng từ db theo id trong token
```

Token có dạng `dữ liệu.chữ_ký`, ký bằng HMAC-SHA256, hạn 7 ngày (`backend/server/core/http.js`). Vai trò luôn đọc từ `db`, không đọc từ dữ liệu trình duyệt gửi lên, nên đổi vai trò là có hiệu lực ngay.

### 6.2. Giỏ hàng

```
Bấm Thêm vào giỏ
   ▼
cart-service.js ghi localStorage ngay  ──► giao diện cập nhật liền
   │
   ├─ Chưa đăng nhập: chỉ lưu ở khóa cart
   │
   └─ Đã đăng nhập: sau 500 ms gửi PUT /api/cart
                    Server loại sản phẩm hết hàng, giới hạn theo tồn kho, lưu vào carts
                    Trình duyệt lấy bản của server làm chuẩn

Đăng nhập xong, ở lần tải trang đầu: POST /api/cart/merge gộp giỏ của khách vào giỏ tài khoản
```

Giỏ hàng chỉ lưu `id` và `qty`. Tên và giá luôn lấy từ danh sách sản phẩm lúc hiển thị, nên giá trong giỏ không bị cũ.

### 6.3. Đặt hàng

```
checkout-page.js
   │  Mở trang, đổi cách giao hoặc voucher
   ├─ POST /api/orders/quote ──► Server tính tiền, chưa lưu gì
   │                             Giao diện hiện số tiền server trả về
   │  Bấm Đặt hàng
   └─ POST /api/orders { items, addressId, shippingMethod, paymentMethod, voucherIds }

routes/orders.js
   1. Kiểm tra quyền mua, địa chỉ phải thuộc tài khoản
   2. buildLines(): sản phẩm còn tồn tại, tối đa 20 cái mỗi loại, đủ tồn kho
   3. quote(): server tự tính tiền hàng, voucher, ưu đãi sản phẩm mới, phí ship
   4. Kiểm tra quy tắc: tiền hàng trên 1 triệu phải chuyển khoản,
      tối đa 3 đơn chưa thanh toán, chặn đơn trùng trong 10 giây
   5. Tạo đơn, lưu bản chụp tên, giá, ảnh của từng sản phẩm
   6. Trừ kho và ghi stockLogs, đánh dấu voucher đã dùng, bỏ sản phẩm đã đặt khỏi giỏ
   7. save()
   8. Đơn COD thì gửi hóa đơn
   9. Trả đơn về, trình duyệt chuyển sang order-success.html
```

Trình duyệt chỉ gửi mã sản phẩm và số lượng, không gửi giá. Số tiền luôn do `backend/server/services/pricing.js` tính.

### 6.4. Thanh toán chuyển khoản

```
Trình duyệt                     Backend                     SePay, ngân hàng
    │  GET /orders/:id/payment-info │                              │
    │ ─────────────────────────────►│                              │
    │ ◄─────────────────────────────│ STK, số tiền, nội dung,      │
    │                                 link ảnh QR                  │
    │                                                              │
    │  Khách quét QR và chuyển tiền ──────────────────────────────►│
    │                                                              │
    │                               │ POST /api/payments/sepay/webhook
    │                               │◄─────────────────────────────│
    │                               │ 1. Kiểm tra khóa API         │
    │                               │ 2. Bỏ qua giao dịch đã xử lý │
    │                               │ 3. Tìm đơn theo nội dung CK  │
    │                               │ 4. So số tiền, markPaid()    │
    │                               │ 5. save(), gửi hóa đơn       │
    │                               │─────────────────────────────►│ { success: true }
    │                               │                              │
    │  Cứ 4 giây GET /orders/:id    │                              │
    │ ─────────────────────────────►│                              │
    │ ◄─────────────────────────────│ đã thanh toán                │
    │  Vẽ lại trang                 │                              │
```

Webhook là việc SePay chủ động gọi vào server của mình khi có tiền về. Trình duyệt không báo được là đã trả tiền, nên khách không thể tự xác nhận thanh toán.

| Trường hợp khi tiền về | Kết quả ghi nhận | Xử lý |
|---|---|---|
| Đủ tiền | `paid` | Đánh dấu đã trả, gửi hóa đơn, đơn trên 1 triệu tự chuyển sang `pending` |
| Thừa tiền | `overpaid` | Xử lý như đủ tiền, lưu lại để cửa hàng theo dõi |
| Thiếu tiền | `underpaid` | Chưa ghi nhận, lần chuyển sau được cộng dồn |
| Không tìm thấy đơn | `no_order` | Lưu giao dịch để admin xử lý tay |
| Đơn đã trả rồi | `duplicate_payment` | Lưu giao dịch |
| Đơn đã hủy | `order_cancelled` | Đơn chuyển sang cần hoàn tiền |

Nếu nội dung chuyển khoản bị sai, admin có thể ghi nhận tay ở trang Đơn hàng. Thao tác này dùng chung `markPaid()` với webhook.

### 6.5. Trạng thái đơn hàng

```
 tiền hàng trên 1 triệu             từ 1 triệu trở xuống
         │                                 │
         ▼                                 ▼
    unconfirmed ──── nhận đủ tiền ───► pending ──► confirmed ──► shipping ──► delivered
    chờ trả tiền                     chờ xác nhận  đã xác nhận   đang giao    đã giao
         │                                │            │            │
         │                                │            │            │
         ▼                                ▼            ▼            ▼
    ──────────────────────────────── cancelled ────────────────────────
```

| Từ | Sang | Ai được làm |
|---|---|---|
| `unconfirmed` | `pending` | Hệ thống, khi nhận đủ tiền (webhook hoặc người có quyền ghi nhận) |
| `unconfirmed` | `cancelled` | Admin, chủ cửa hàng, khách |
| `pending` | `confirmed` | Admin, chủ cửa hàng, nhân viên. Đơn chuyển khoản phải trả tiền trước |
| `pending` | `cancelled` | Admin, chủ cửa hàng, nhân viên, khách |
| `confirmed` | `shipping` | Admin, chủ cửa hàng, nhân viên |
| `confirmed` | `cancelled` | Admin, chủ cửa hàng, nhân viên |
| `shipping` | `delivered`, `cancelled` | Admin, chủ cửa hàng, nhân viên |

Bảng này nằm ở `ORDER_TRANSITIONS` trong `backend/server/core/rules.js`. Server từ chối mọi bước chuyển không có trong bảng.

Trạng thái thanh toán đi riêng: `unpaid` → `paid`. Nếu đơn đã trả tiền bị hủy thì `paid` → `refund_pending` → `refunded`.

**Hủy đơn (theo luồng Shopee):**

| Trạng thái đơn | Khách làm được gì |
|---|---|
| Chưa xác nhận | Hủy trực tiếp, chọn lý do |
| Đã xác nhận | Gửi yêu cầu hủy. Cửa hàng đồng ý hoặc từ chối, sau 48 giờ không phản hồi thì tự đồng ý |
| Đang giao, đã giao | Không hủy được. Giao không thành công thì cửa hàng hủy và hàng về kho |

Khi hủy, `cancelOrder()` trong `backend/server/services/orders.js` hoàn kho, trả voucher về ví và đánh dấu cần hoàn tiền nếu khách đã trả. Hàm này chỉ chạy một lần cho mỗi đơn.

### 6.6. Hóa đơn

| Hình thức | Tạo ở đâu | Khi nào |
|---|---|---|
| Email HTML, tự gửi | Backend, `backend/server/services/order-mail.js` | COD: sau khi đặt đơn hoặc đổi sang COD. Chuyển khoản: sau khi nhận đủ tiền |
| Email HTML, gửi tay | Backend, cùng file trên | Bấm nút gửi hóa đơn, tối đa 3 lần mỗi giờ cho mỗi đơn |
| File PDF | Trình duyệt, `frontend/src/js/components/invoice.js` | Bấm nút xuất PDF |

Hóa đơn email luôn gửi về email của tài khoản đặt đơn và dựng từ dữ liệu đơn trên server, nên không ai gửi được nội dung tùy ý.

### 6.7. Mật khẩu

| Luồng | Các bước |
|---|---|
| Đổi mật khẩu | Nhập mật khẩu hiện tại → `POST /auth/change-password/code` gửi OTP về email → nhập OTP và mật khẩu mới → `POST /auth/change-password` |
| Quên mật khẩu | Nhập email → `POST /auth/forgot-password` (luôn trả ok để không lộ email nào đã đăng ký) → nhập OTP và mật khẩu mới → `POST /auth/reset-password` |
| Admin đặt lại | `POST /admin/users/:id/reset-password`, ghi `passwordResetAt` nên các phiên cũ của tài khoản đó mất hiệu lực |

Mã OTP gồm 6 số, hiệu lực 3 phút, sai tối đa 5 lần, gửi lại sau 60 giây. Trong `db.json` chỉ có bản băm của mã (`backend/server/core/codes.js`).

### 6.8. Sản phẩm và kho

```
TẠO, SỬA SẢN PHẨM
Chọn ảnh ── POST /api/admin/uploads/product ──► kiểm tra nội dung tệp là ảnh thật
                                                lưu vào uploads/products, trả về đường dẫn
Bấm Lưu ─── POST hoặc PUT /api/admin/products ──► parseProduct() kiểm tra, ghi stockLogs, save()

XUẤT EXCEL, PDF
Dữ liệu đang có trên trang ──► xlsx hoặc jsPDF tạo file ngay trên trình duyệt

NHẬP EXCEL
Trình duyệt đọc file ──► POST /api/admin/products/import { rows }
   Server kiểm tra hết mọi dòng trước khi lưu
   ├─ Có dòng sai: không lưu gì, trả về danh sách lỗi theo số dòng
   └─ Đúng hết:    có ID thì cập nhật, không đổi tồn kho
                   không có ID thì tạo mới
                   sản phẩm không có trong file giữ nguyên

NHẬP KHO
PATCH /api/admin/products/:id/stock ──► cộng tồn kho, ghi stockLogs, cập nhật lastImportedAt
```

Mọi thay đổi tồn kho đều ghi vào `stockLogs`: nhập hàng, bán, hoàn kho, điều chỉnh.

**Sản phẩm mới và giảm giá:**

- Trang chủ luôn hiện 4 sản phẩm có `createdAt` gần nhất, nên tháng này chưa có sản phẩm mới thì vẫn còn của tháng trước.
- Nhập thêm hàng cho sản phẩm cũ chỉ đổi `lastImportedAt`, hiện nhãn "Mới về" và không tính là sản phẩm mới.
- Nhãn Mới mặc định 30 ngày, giảm giá mặc định 7 ngày, cùng tính từ lúc tạo. Từng sản phẩm đặt được hạn riêng (`newUntil`, `promoUntil`). Server từ chối nếu hạn giảm giá không sớm hơn hạn nhãn Mới.

### 6.9. Voucher

```
Admin tạo voucher (vouchers)
   ▼
Khách lưu về ví (userVouchers)     hoặc hệ thống tự tặng: người dùng mới, sinh nhật
   ▼
Trang thanh toán: POST /orders/quote kiểm tra từng voucher, báo dùng được hay không
   ▼
POST /orders: voucher sai thì từ chối cả đơn, đúng thì đánh dấu đã dùng
   ▼
Hủy đơn: voucher trả về ví
```

Mỗi đơn dùng tối đa 1 voucher giảm tiền hàng và 1 voucher giảm phí ship. Toàn bộ quy tắc nằm ở hàm `evaluate()` trong `backend/server/services/pricing.js`, dùng chung cho tính giá và tạo đơn.

### 6.10. Thống kê và hành vi khách

```
DOANH THU
admin-dashboard-page.js ── GET /api/admin/stats?period=month&year=...&month=...
   Server duyệt db.orders, chỉ tính đơn delivered, gom theo ngày hoặc tháng giờ Việt Nam
   Trình duyệt vẽ biểu đồ, mặc định tháng hiện tại theo từng ngày

HÀNH VI KHÁCH
tracker.js ── POST /api/track ──► làm sạch, bỏ qua tài khoản quản lý
                                  giữ trên RAM, mỗi giây ghi nối vào analytics.ndjson
Trang thống kê ── GET /api/admin/demand, /api/admin/customer-analytics ──► tổng hợp từ dữ liệu trên
```

Số thống kê không lưu sẵn mà được tính lại mỗi lần mở trang, nên luôn khớp với đơn hàng. Hành vi khách nằm ở file riêng để không phải ghi lại cả `db.json` mỗi lần khách mở một trang, và chỉ dùng mã ẩn danh ngẫu nhiên.

### 6.11. Chatbot

RAG là cách tìm các đoạn dữ liệu liên quan trước, rồi đưa cho AI để AI trả lời dựa trên đó thay vì tự nhớ.

```
chat-widget.js ── POST /api/chat { message, history, visitor }
   ▼
routes/chat.js
   1. Kiểm tra độ dài và giới hạn tần suất
   2. Lấy lịch sử: đã đăng nhập thì từ db.chats, chưa đăng nhập thì từ trình duyệt gửi lên
   3. ai/kb.js tìm 6 đoạn liên quan nhất trong:
         tài liệu ai/kb/*.md
         dữ liệu sống: sản phẩm, danh mục, sản phẩm mới, khuyến mãi
      │
      ├─ CÓ AI:    gửi quy tắc + dữ liệu + lịch sử + câu hỏi cho OpenAI
      │            AI được gọi 4 hàm để lấy giá, tồn kho, khuyến mãi, đơn của chính khách
      │            Server chạy hàm trên db rồi gửi kết quả lại, tối đa 3 vòng
      │            fixProductLinks() sửa link sai mã sản phẩm trong câu trả lời
      │
      └─ KHÔNG AI: chưa có khóa hoặc khóa bị từ chối thì dùng ai/quick-answer.js tra dữ liệu thật
   4. Lưu 40 tin gần nhất nếu khách đã đăng nhập
   5. Trả câu trả lời
```

Giá và tồn kho luôn lấy từ dữ liệu thật qua hàm. Câu hỏi về đơn hàng chỉ xem được đơn của chính khách đang đăng nhập.

### 6.12. Các luồng nhỏ khác

| Luồng | Dữ liệu đi như thế nào |
|---|---|
| Đánh giá | Chỉ khách có đơn `delivered` mới được đánh giá, mỗi sản phẩm một lần. Khách không xóa được, chỉ bấm Đóng để ẩn trên màn hình của mình (`POST /api/reviews/:id/close`); cửa hàng vẫn thấy. Nhân viên, chủ, admin phản hồi công khai bằng `PATCH /api/reviews/:id/reply`; chỉ chủ và admin xóa được bằng `DELETE /api/reviews/:id`. Tải tệp lên `/api/uploads/reviews` trước, rồi `POST /api/reviews` gắn tệp vào đánh giá |
| Ảnh đại diện | `POST /api/auth/avatar`, chỉ vai trò user, tối đa 2 MB, xóa ảnh cũ khi đổi |
| Góp ý | `POST /api/feedbacks`, nhân viên trả lời bằng `PATCH /api/feedbacks/:id/reply` |
| Yêu thích | `PUT`, `DELETE /api/favorites/:productId`, lưu trong `user.favorites` |
| Sổ địa chỉ | `/api/addresses`, lưu trong `user.addresses`. Đơn hàng chép lại địa chỉ lúc đặt |
| Banner, sự kiện | Admin tạo ở `/api/admin/banners`, `/api/admin/events`. Mọi trang gọi `GET /api/site` rồi áp màu bằng biến CSS |
| Thông tin cửa hàng | Admin sửa ở `PUT /api/admin/shop`. Mọi trang lấy từ `GET /api/shop`, gồm cả phí ship và các ngưỡng nghiệp vụ, nên giao diện không viết cứng |

## 7. Phân quyền

Có 4 vai trò: `user` (khách), `staff` (nhân viên), `owner` (chủ cửa hàng), `admin`.

| Chức năng | Khách | Nhân viên | Chủ | Admin |
|---|---|---|---|---|
| Mua hàng | Có | | | |
| Xem và xử lý đơn | | Có | Có | Có |
| Ghi nhận tiền, hoàn tiền | | | Có | Có |
| Xem sản phẩm | | Có | Có | Có |
| Thêm, sửa, xóa, nhập Excel sản phẩm | | | Có | Có |
| Nhập kho | | Có | Có | Có |
| Tab Kho & vận hành | | Có | Có | Có |
| Doanh thu, phân tích khách hàng | | | Có | Có |
| Banner, sự kiện, thông tin cửa hàng | | | Có | Có |
| Voucher | | | Có | Có |
| Xem và trả lời góp ý | | Có | Có | Có |
| Xóa góp ý, đánh giá | | | Có | Có |
| Xem và phản hồi đánh giá sản phẩm | | Có | Có | Có |
| Quản lý tài khoản | | | | Có |

Quyền được kiểm tra ở 2 lớp:

| Lớp | Code | Tác dụng |
|---|---|---|
| Frontend | `frontend/src/js/utils/permissions.js`, `frontend/src/js/utils/auth.js` | Ẩn menu, chuyển hướng. Chỉ giúp giao diện gọn, không phải lớp bảo mật |
| Backend | `backend/server/core/permissions.js`, `requirePermission` trong `backend/server/core/http.js` | Lớp quyết định. Gọi thẳng API mà không đủ quyền vẫn bị trả 403 |

## 8. Vì sao thiết kế như vậy

| Quyết định | Lý do |
|---|---|
| Server tự tính tiền | Dữ liệu từ trình duyệt có thể bị sửa, nên giá gửi lên không đáng tin |
| Kiểm tra tồn kho và trừ kho trong cùng một đoạn đồng bộ | Node.js chạy một luồng. Không có `await` ở giữa nên 2 khách đặt cùng lúc không thể cùng đọc một số tồn kho cũ, tránh bán quá số lượng |
| Lưu bản chụp sản phẩm trong đơn | Sau này đổi giá hoặc xóa sản phẩm, đơn cũ và doanh thu vẫn đúng |
| Ghi file tạm rồi đổi tên | Server dừng giữa lúc ghi cũng không làm hỏng `db.json` |
| Chỉ lưu bản băm của mật khẩu và OTP | Lộ `db.json` cũng không đọc được mật khẩu hay mã |
| Nhận tiền qua webhook thay vì để trình duyệt báo | Khách không thể tự đánh dấu đã trả tiền |
| Webhook bỏ qua `txId` đã xử lý | SePay gửi lại một giao dịch thì không bị ghi nhận 2 lần |
| Gửi mail sau `save()` và không chờ | Mail lỗi không làm hỏng đơn hàng |
| Tách backend và frontend | Mỗi phần có `package.json` riêng. Vite không phục vụ thư mục backend nên trình duyệt không tải được `db.json` hay `.env` |
| Vẽ bằng bản nhớ rồi cập nhật ở nền | Chuyển trang không bị giật |

## 9. Giới hạn hiện tại

- **Chỉ chạy được một tiến trình server.** Dữ liệu nằm trên RAM của một tiến trình, và mỗi lần ghi phải ghi lại cả file. Cách này đủ cho đồ án nhưng không hợp khi có nhiều người dùng cùng lúc.
- **Đổi sang cơ sở dữ liệu thật sẽ phải sửa nhiều file.** Route đang đọc và sửa `db` trực tiếp, chưa có lớp truy cập dữ liệu riêng.
- **Chưa triển khai thật.** Express không phục vụ giao diện, nên khi đưa lên mạng cần chạy `npm run build` rồi dùng một web server trả về thư mục `frontend/dist` và chuyển tiếp `/api`, `/uploads` sang backend.
- **Webhook SePay cần địa chỉ công khai.** Chạy trên localhost thì SePay không gọi vào được. Các lần test đều giả lập lời gọi webhook.
- **Phải đặt khóa riêng trước khi đưa lên mạng.** Thiếu `AUTH_SECRET` hoặc `SEPAY_API_KEY` thì server dùng giá trị mặc định có sẵn trong code. Ai đọc được code sẽ giả được token hoặc giả được báo tiền về.
- **Token nằm trong localStorage.** Nếu trang bị chèn script, token có thể bị lấy. Code đang giảm rủi ro bằng cách escape dữ liệu trước khi đưa vào HTML.
