# Hướng dẫn đọc code Xanh Garden

Dùng khi cô chỉ vào **một chỗ trên màn hình** và hỏi "phần này code ở đâu?", hoặc chỉ vào **một đoạn code** và hỏi "phần này hiện ra ở đâu?".
Mọi tên file, tên hàm dưới đây lấy từ chính mã nguồn hiện tại.

---

## 1. Hiểu dự án trong 1 phút

Dự án có **hai nửa** nói chuyện với nhau qua địa chỉ `/api/...`:

```
TRÌNH DUYỆT (nửa "tĩnh" + "động" phía người dùng)          MÁY CHỦ (nửa xử lý dữ liệu)
┌────────────────────────────────────────────┐            ┌─────────────────────────────┐
│ *.html          khung trang (TĨNH)         │            │ server/routes/   nhận yêu cầu│
│ src/static/CSS  giao diện (TĨNH)           │   /api/…   │ server/services/ tính toán   │
│ src/static/IMAGES  ảnh có sẵn (TĨNH)       │ ─────────► │ server/core/     luật, quyền │
│ src/js/pages/   điền dữ liệu vào khung     │ ◄───────── │ data/db.json     dữ liệu     │
│ src/js/...      (ĐỘNG: JavaScript)         │   JSON     │ data/uploads/    ảnh tải lên │
└────────────────────────────────────────────┘            └─────────────────────────────┘
```

- **Tĩnh** = nội dung nằm sẵn trong file, không đổi theo người dùng: file `.html`, `.css`, ảnh trong `src/static/IMAGES`.
- **Động** = nội dung do JavaScript tạo ra sau khi tải trang, lấy từ server: danh sách sản phẩm, đơn hàng, số liệu thống kê, menu theo quyền...
- **Quy tắc vàng:** giao diện chỉ *hiển thị và gửi yêu cầu*; **mọi tính toán tiền, kiểm tra quyền, trừ kho nằm ở server**. Vì người dùng sửa được code trình duyệt, nên server không bao giờ tin dữ liệu giá hay vai trò do trình duyệt gửi lên.

Lệnh chạy: `npm run server` (máy chủ, cổng 3000) và `npm run dev` (giao diện, cổng 5173). `npm test` chạy 85 bài test. `npm run build` đóng gói ra `dist/`.

---

## 2. TỪ TĨNH SANG ĐỘNG: "tôi thấy cái này trên màn hình, code ở đâu?"

Đi theo 6 bước này, từ ngoài vào trong:

| Bước | Làm gì | Ví dụ với trang **Quản lý đơn hàng** |
|---|---|---|
| 1 | Tìm **chữ** trên màn hình trong các file `.html` ở thư mục gốc. Nếu thấy → đó là phần tĩnh. Không thấy → chữ do JavaScript tạo ra (sang bước 3). | Chữ "Quản lý đơn hàng" có trong `admin-orders.html`. |
| 2 | Trong HTML, tìm thẻ có `id="..."` bao quanh chỗ cần điền dữ liệu, và thẻ `<script type="module" src="...">` ở cuối file. | Có `<tbody id="orderBody">` và script `admin-orders-page.js`. |
| 3 | Mở file JS đó trong `src/js/pages/`, tìm `getElementById` hoặc `querySelector('#id')` để thấy **chỗ điền dữ liệu**; tìm hàm `render...` để thấy **cách vẽ**. | `renderOrders()` gán `orderBody.innerHTML = ...`. |
| 4 | Tìm `api.get / api.post / api.patch / api.load(...)` trong file đó để biết trang **xin dữ liệu từ đâu**. | `api.load('/orders', ...)`. |
| 5 | Đường dẫn `/api/X/...` → mở `server/routes/X.js` (bảng ở mục 5) để xem server nhận và trả gì. | `/api/orders` → `server/routes/orders.js`. |
| 6 | Route gọi hàm nào trong `server/services/` hoặc `server/core/` → đó là luật nghiệp vụ; cuối cùng đọc/ghi `db.json` qua `db.<tên-bảng>`. | Đổi trạng thái đơn gọi `setStatus()` trong `services/orders.js`, luật ở `ORDER_TRANSITIONS` trong `core/rules.js`. |

### Mỗi trang gồm những file nào

| Trang (HTML tĩnh) | File JS điền dữ liệu | Gọi API |
|---|---|---|
| `index.html` Trang chủ | `home-page.js` | `/site`, `/products/featured`, `/products/new`, `/reviews/latest` |
| `products.html` Sản phẩm | `products-page.js` | `/categories`, `/products` |
| `product-detail.html` Chi tiết | `product-detail-page.js` | `/products/:id`, `/products/:id/review-status`, `/reviews` |
| `cart.html` Giỏ hàng | `cart-page.js` | `/cart`, `/products` |
| `checkout.html` Thanh toán | `checkout-page.js` | `/orders/quote`, `/orders`, `/addresses`, `/vouchers/claim` |
| `order-success.html` Đặt xong | `order-success-page.js` | `/orders/:id`, `/orders/:id/payment-info`, `/orders/:id/payment-method` |
| `login.html`, `dangky.html`, `verify-email.html`, `forgot-password.html` | `login-page.js`, `register-page.js`, `verify-email-page.js`, `forgot-password-page.js` | `/auth/...` |
| `account.html` Tài khoản | `account-page.js` | `/addresses`, `/favorites`, `/vouchers/mine`, `/auth/change-password` |
| `my-orders.html` Đơn của tôi | `my-orders-page.js` | `/orders`, `/orders/:id/status` |
| `vouchers.html` Khuyến mãi | `vouchers-page.js` | `/vouchers`, `/vouchers/mine`, `/vouchers/claim`, `/vouchers/birthday` |
| `feedback.html` Góp ý (khách) / Phản hồi (quản trị) | `feedback-page.js` | `/feedbacks` |
| `info.html` Chính sách, cẩm nang | `info-page.js` | `/pages`, `/pages/:slug` |
| `admin-dashboard.html` Thống kê | `admin-dashboard-page.js` (+ `admin-demand.js`, `admin-customers.js`) | `/admin/stats`, `/admin/inventory`, `/admin/demand`, `/admin/customer-analytics` |
| `admin-orders.html` Đơn hàng | `admin-orders-page.js` | `/orders`, `/orders/:id/status`, `/orders/:id/payment` |
| `admin-products.html` Sản phẩm & kho | `admin-products-page.js` | `/products`, `/admin/products`, `/admin/stock-logs`, `/admin/uploads/product` |
| `admin-banners.html` Banner & sự kiện | `admin-banners-page.js` | `/admin/banners`, `/admin/events` |
| `admin-vouchers.html` Voucher | `admin-vouchers-page.js` | `/admin/vouchers` |
| `admin-team.html` Tài khoản (admin) | `admin-team-page.js` | `/admin/users`, `/admin/users/:id/...`, `/auth/change-password` |

Các trang đều dùng chung `components/header.js`: nó **vẽ thanh đầu trang và chân trang** (cửa hàng) hoặc **thanh trên + menu bên trái** (khu quản trị) tùy vai trò đăng nhập.

### Phần "động" nhìn thấy được trong giao diện

| Thấy gì | Code ở đâu |
|---|---|
| Menu quản trị chỉ hiện mục có quyền | `ADMIN_MENU` và `adminHeader()` trong `components/header.js`, dùng `utils/permissions.js` |
| Thông báo nổi ở trên cùng, hộp thoại xác nhận | `components/notify.js` (`toast`, `confirmDialog`) |
| Thẻ sản phẩm, nút thêm giỏ, trái tim yêu thích | `components/product-card.js`, `services/favorite-service.js` |
| Số trên biểu tượng giỏ hàng | `services/cart-service.js` + `updateCartBadge()` trong header |
| Trang hiện ngay không giật khi quay lại | `api.load()` trong `services/api-service.js` (dùng bản nhớ rồi cập nhật bản mới) |
| Màu giao diện đổi theo sự kiện (Tết, Noel...) | `services/site-service.js` + `server/services/site.js` + `server/services/lunar.js` |
| Hóa đơn PDF | `components/invoice.js` (jsPDF, font ở `public/fonts`) |
| Xuất CSV/Excel đơn hàng | cuối `pages/admin-orders-page.js`, `services/excel-service.js` |
| Mã QR chuyển khoản | `components/bank-ui.js`, `server/services/sepay.js` |
| Khung chat tư vấn | `components/chat-widget.js` ↔ `server/routes/chat.js`, `server/ai/` |
| Icon | `utils/icons.js` (tập SVG vẽ sẵn) |

---

## 3. TỪ ĐỘNG SANG TĨNH: "tôi thấy đoạn code này, nó hiện ra ở đâu?"

Đi ngược lại:

| Bạn đang đọc... | Hãy tìm... | Để biết... |
|---|---|---|
| Hàm `render...()` trong `pages/*.js` | `innerHTML`, `classList.toggle('hidden')`, `textContent` | Nó gán vào thẻ có `id` nào → mở file `.html` cùng tên trang để xem thẻ đó nằm ở đâu. |
| Một route trong `server/routes/X.js` | Tìm đường dẫn đó trong `src/js` bằng chức năng tìm kiếm toàn dự án (ví dụ `/admin/users`) | Trang nào gọi nó (bảng ở mục 2). |
| Hàm trong `server/services/` | Tìm tên hàm trong `server/routes/` | Route nào dùng nó, rồi suy ra trang nào. |
| Một bảng trong `db.json` | Bảng ở mục 6 | File nào đọc/ghi bảng đó. |
| Một quyền như `orders.manage` | `server/core/permissions.js` | Vai trò nào có quyền; và `requirePermission('orders.manage')` ở route nào. |
| Một class CSS | Tìm tên class trong `src/static/CSS/main.css` | Trông như thế nào; tìm class trong `pages/*.js` hoặc `.html` để biết dùng ở đâu. |

Ví dụ ngược: đọc thấy `DELETE /users/:id` trong `server/routes/admin.js` → `admin-team-page.js` gọi `api.delete('/admin/users/...')` trong hàm `deleteUser()` → nút **Xóa** ở cột Thao tác của trang `admin-team.html` (mục "Quản lý tài khoản").

---

## 4. Vai trò và quyền (file: `server/core/permissions.js`)

| Quyền | admin | owner | staff | user |
|---|:-:|:-:|:-:|:-:|
| Xem doanh thu, biểu đồ (`dashboard.sales`) | ✔ | ✔ | | |
| Xem tồn kho vận hành (`dashboard.operations`) | ✔ | ✔ | ✔ | |
| Phân tích khách (`customers.analytics`) | ✔ | ✔ | | |
| Xem và xử lý đơn (`orders.view`, `orders.manage`) | ✔ | ✔ | ✔ | |
| Xác nhận thu/hoàn tiền (`payments.manage`) | ✔ | ✔ | | |
| Xem sản phẩm, kho (`products.view`, `inventory.view`) | ✔ | ✔ | ✔ | |
| Thêm/sửa/xóa sản phẩm (`products.manage`) | ✔ | ✔ | | |
| Nhập kho (`inventory.manage`) | ✔ | ✔ | ✔ | |
| Banner, sự kiện (`content.manage`) | ✔ | ✔ | | |
| Voucher (`vouchers.manage`) | ✔ | ✔ | | |
| Xem/trả lời phản hồi | ✔ | ✔ | ✔ | |
| Xóa phản hồi | ✔ | ✔ | | |
| Quản lý tài khoản: gán role, đặt lại mật khẩu, xóa (`team.manage`) | ✔ | | | |
| Mua hàng, giỏ, yêu thích, voucher của tôi (`customer.purchase`) | | | | ✔ |

- **Server** kiểm quyền bằng `requirePermission(...)` / `requireRole(...)` (`server/core/http.js`) ở từng route.
- **Giao diện** chỉ ẩn/hiện cho gọn bằng `hasPermission` (`src/js/utils/permissions.js`) và `requirePermission` (`utils/auth.js`, chuyển trang nếu không đủ quyền). Ẩn nút **không phải** bảo mật, bảo mật là ở server.
- Vai trò luôn đọc từ `db.json` ở mỗi yêu cầu, không tin vai trò trình duyệt gửi. Mỗi lần mở trang, `header.js` hỏi `/auth/me` để cập nhật nếu admin vừa đổi vai trò.

### Quản lý tài khoản (admin)
- **Đổi role:** `PATCH /admin/users/:id/role`. Không đổi role admin hoặc chính mình.
- **Đặt lại mật khẩu:** `POST /admin/users/:id/reset-password`. Server sinh mật khẩu tạm 12 ký tự, chỉ hiện một lần, phiên cũ của người đó bị đăng xuất (so `iat` của token với `passwordResetAt` trong `authenticate`, `core/http.js`), đồng thời mở khóa nếu đang bị khóa.
- **Xóa:** `GET /admin/users/:id/delete-check` rồi `DELETE /admin/users/:id`. **Chặn xóa** nếu còn đơn chưa hoàn thành, đơn chờ hoàn tiền, khiếu nại chưa xử lý, hoặc (với nhân sự) đang phụ trách đơn chưa xong. Khi xóa: đơn đã xong, đánh giá và lịch sử xử lý được giữ lại; giỏ hàng, địa chỉ, yêu thích, ví voucher, chat bị xóa. Không xóa admin hoặc chính mình.
- **Đổi mật khẩu của mình:** khung "Đổi mật khẩu của tôi" đầu trang, gọi `POST /auth/change-password`.

---

## 5. Bản đồ API (server/routes → tiền tố `/api`)

| File | Tiền tố | Nội dung |
|---|---|---|
| `auth.js` | `/auth` | đăng ký, xác minh email (mã 6 số), đăng nhập, quên/đặt lại/đổi mật khẩu, `/me` |
| `shop.js`, `site.js`, `pages.js` | `/` | danh mục, sản phẩm, đánh giá, banner/sự kiện/màu giao diện, trang chính sách |
| `cart.js`, `favorites.js`, `addresses.js` | `/cart`, `/favorites`, `/addresses` | giỏ, yêu thích, sổ địa chỉ (theo tài khoản) |
| `orders.js` | `/orders` | báo giá, đặt đơn, xem đơn, đổi trạng thái, đổi phương thức thanh toán, ghi nhận thanh toán |
| `payments.js` | `/payments` | webhook SePay (ngân hàng báo có tiền) |
| `vouchers.js` | `/vouchers` | danh sách, nhận voucher, ví của tôi, ngày sinh |
| `feedbacks.js` | `/feedbacks` | góp ý, khiếu nại; trả lời, xóa |
| `chat.js` | `/chat` | chatbot tư vấn |
| `track.js` | `/track` | ghi lượt truy cập (thống kê khách) |
| `uploads.js` | `/uploads` | ảnh/video đánh giá của khách |
| `admin.js` | `/admin` | tài khoản, thống kê, kho, sản phẩm, thanh toán bất thường |
| `admin-content.js` | `/admin` | banner, sự kiện, voucher, tải ảnh banner/sản phẩm, nhật ký kho |

Cách một route làm việc (luôn cùng khuôn): **kiểm quyền → đọc/kiểm tra dữ liệu gửi lên (`core/rules.js`) → gọi service → `save()` ghi `db.json` → trả JSON**.

---

## 6. Dữ liệu (`data/db.json`) và file dùng nó

| Bảng | Là gì | Chủ yếu do file nào đọc/ghi |
|---|---|---|
| `user` | tài khoản (mật khẩu đã băm), role, địa chỉ, yêu thích | `routes/auth.js`, `routes/admin.js` |
| `products`, `categories` | sản phẩm, danh mục (kèm thông số theo loại cây) | `routes/shop.js`, `routes/admin.js`, `data/specs-data.js` |
| `orders` | đơn hàng (chụp giá, địa chỉ, voucher, lịch sử trạng thái) | `routes/orders.js`, `services/orders.js` |
| `payments` | giao dịch ngân hàng nhận từ SePay | `routes/payments.js` |
| `stockLogs` | nhật ký nhập/bán/hoàn/điều chỉnh kho | `services/inventory.js` |
| `vouchers`, `userVouchers` | voucher cửa hàng tạo; ví voucher của từng khách | `services/vouchers.js`, `services/pricing.js` |
| `reviews`, `feedbacks` | đánh giá sản phẩm; góp ý/khiếu nại | `routes/shop.js`, `routes/feedbacks.js` |
| `events`, `banners` | sự kiện (Tết...), banner trang chủ | `routes/admin-content.js`, `services/site.js` |
| `carts`, `chats`, `uploads` | giỏ hàng, lịch sử chat, tệp tải lên chờ gắn | `routes/cart.js`, `routes/chat.js`, `routes/uploads.js` |

Khác: `data/uploads/` (file ảnh tải lên), `data/backups/` (sao lưu mỗi ngày, giữ 7 bản), `data/analytics.ndjson` (lượt truy cập, mỗi dòng một sự kiện).
**Server chỉ đọc `db.json` một lần lúc khởi động** (`core/store.js`) rồi ghi đè mỗi khi có thay đổi; sửa tay file phải **tắt server trước**, sửa xong mới bật lại.

Ảnh sản phẩm: ảnh có sẵn nằm ở `src/static/IMAGES` (db.json chỉ ghi tên, ví dụ `p1.png`). Ảnh admin tải lên nằm ở `data/uploads/products` (db.json ghi `/uploads/products/tên-file`). Lý do tách: ảnh tải lên là dữ liệu, thư mục `src` thuộc mã nguồn và được đóng gói lúc build.

---

## 7. Các luồng nghiệp vụ chính (và code của chúng)

### 7.1. Đặt hàng
`checkout-page.js` gửi `POST /orders/quote` (xem trước giá) rồi `POST /orders` → `routes/orders.js`:
1. Kiểm tra địa chỉ, số lượng, tồn kho (`buildLines`).
2. **Server tự tính tiền** bằng `quote()` trong `services/pricing.js` (giá hàng, voucher, phí ship), bỏ qua giá trình duyệt gửi.
3. Trừ kho, ghi `stockLogs`, chụp giá và địa chỉ vào đơn, trừ voucher (`consumeVouchers`), xóa các món đã đặt khỏi giỏ.

Hằng số (file `core/rules.js`): miễn phí ship từ 500.000 ₫, ship thường 30.000 ₫, giao nhanh 50.000 ₫; tiền hàng trên 1.000.000 ₫ bắt buộc chuyển khoản; COD tối đa 5.000.000 ₫; đơn tối đa 50.000.000 ₫; tối đa 20 cái/sản phẩm/đơn; tối đa 3 đơn chưa thanh toán cùng lúc; đặt hai lần giống hệt trong 10 giây bị chặn.

### 7.2. Trạng thái đơn (`ORDER_TRANSITIONS` trong `core/rules.js`)
```
unconfirmed (chờ thanh toán) ──► pending (chờ xác nhận) ──► confirmed ──► shipping ──► delivered
        │ hủy                        │ hủy                      │ hủy          │ hủy (giao không thành công)
        ▼                            ▼                          ▼              ▼
                                     cancelled  (hoàn kho đúng một lần; đã trả tiền thì đánh dấu "cần hoàn tiền")
```
- Khách chỉ tự hủy được khi đơn ở "chờ thanh toán" hoặc "chờ xác nhận". Các bước còn lại do admin, owner, staff.
- Đơn chuyển khoản quá 30 phút không trả tiền: tự hủy và hoàn kho (`sweepExpired`, `services/orders.js`).
- Hủy hoặc hết hạn mà voucher đã dùng: hoàn lại voucher (`releaseVouchers`, `services/vouchers.js`).

### 7.3. Thanh toán chuyển khoản (SePay)
Đơn chuyển khoản hiện mã QR (`services/sepay.js`). Khi ngân hàng báo có tiền, SePay gọi `POST /api/payments/sepay/webhook` (`routes/payments.js`): kiểm khóa API, bỏ giao dịch tiền ra, khớp nội dung với mã đơn, **cộng dồn** nếu chuyển thiếu rồi bù, đánh dấu thừa tiền, tiền về sau khi đơn đã hủy thì đánh dấu cần hoàn tiền. Không khớp đơn nào thì lưu lại để admin xử lý ở trang Thống kê. Giao dịch lặp lại không ghi hai lần.

### 7.4. Voucher
Mỗi đơn dùng tối đa **1 voucher giảm đơn + 1 voucher giảm phí ship**. Điều kiện đơn tối thiểu, mức giảm tối đa cho voucher %, phạm vi (tất cả, theo danh mục, sản phẩm, hàng mới) đều kiểm trong `services/pricing.js` (`evaluate`). Voucher tự tặng: người dùng mới (tài khoản dưới 30 ngày và chưa từng đặt đơn nào) và sinh nhật (`syncAutoVouchers` trong `services/vouchers.js`). Giới hạn mỗi người, ví tối đa 50 voucher.

### 7.5. Kho
Nhập kho: `PATCH /admin/products/:id/stock` (staff, owner, admin). Mọi thay đổi (nhập, bán, hoàn khi hủy, điều chỉnh khi sửa sản phẩm) đều ghi `stockLogs` qua `logStock` (`services/inventory.js`). Sản phẩm đã có trong đơn thì **không xóa được**, chỉ đặt tồn kho về 0 để ngừng bán.

### 7.6. Thống kê
`GET /admin/stats` (`routes/admin.js`): doanh thu tính từ chi tiết đơn (`items`) của **đơn đã giao**, không dùng trường `total` điền tay. Chia theo năm, quý, tháng (giờ Việt Nam). Staff không có quyền này, chỉ thấy tab Kho & vận hành. Số liệu khách truy cập lấy từ `data/analytics.ndjson` (`services/analytics.js`, `customer-analytics.js`).

### 7.7. Tài khoản và bảo mật
- Mật khẩu băm bằng scrypt kèm muối (`hashPassword`, `core/http.js`), chính sách mật khẩu ở `passwordProblem` (`core/rules.js`, giao diện phản chiếu ở `utils/password.js`).
- Phiên đăng nhập là token ký HMAC, hạn 7 ngày. Đăng nhập sai 5 lần bị khóa 10 phút (`routes/auth.js`).
- Đăng ký xong phải xác minh email bằng mã 6 số (`core/codes.js`, `core/mailer.js`). Chưa cấu hình SMTP thì mã in ra console của server.

---

## 8. Câu cô hay hỏi và cách trả lời ngắn

| Câu hỏi | Trả lời |
|---|---|
| Vì sao tính tiền ở server mà không ở trình duyệt? | Người dùng sửa được code trình duyệt, nên giá phải do server tính từ bảng sản phẩm thật (`quote` trong `pricing.js`). |
| Ẩn nút ở giao diện đã đủ phân quyền chưa? | Chưa. Nút ẩn chỉ để gọn. Chặn thật ở server bằng `requirePermission`, có test (`tests/admin.test.js`). |
| Hai người cùng mua món cuối cùng thì sao? | Kiểm kho và trừ kho nằm trong cùng phần xử lý đồng bộ của một route, không có `await` chen giữa, nên không bị bán vượt tồn. |
| Vì sao có `db.json` thay vì cơ sở dữ liệu? | Phạm vi đồ án, dễ xem và dễ sửa tay. Ghi qua file tạm rồi đổi tên để không hỏng file, sao lưu mỗi ngày. Hạn chế: một tiến trình, đọc một lần lúc khởi động. |
| Làm sao biết đổi code có làm hỏng chỗ khác không? | Chạy `npm test` (85 bài), chạy trên dữ liệu tạm, không đụng `data/`. |
| Ảnh sản phẩm mới lưu ở đâu? | `data/uploads/products`, `db.json` chỉ lưu đường dẫn; lý do ở mục 6. |
| Đơn quá hạn thanh toán xử lý ra sao? | Tự hủy sau 30 phút, hoàn kho, hoàn voucher; đã chuyển một phần thì đánh dấu cần hoàn tiền. |
| Tại sao khi chuyển trang không bị giật? | `api.load()` hiện dữ liệu đã nhớ ngay rồi cập nhật khi server trả bản mới; `blocking="render"` do plugin trong `vite.config.js`; chỗ trống được giữ trước (`scrollbar-gutter`, `min-height`). |

---

## 9. Thư mục (tóm tắt)

| Thư mục | Chứa gì |
|---|---|
| `*.html` (gốc) | khung từng trang |
| `src/js/pages` | mỗi trang một file JS |
| `src/js/components` | phần dùng lại: header, thông báo, hóa đơn, thẻ sản phẩm, chatbot |
| `src/js/services` | gọi API, giỏ hàng, yêu thích, màu giao diện, đo lượt truy cập |
| `src/js/utils` | hàm nhỏ: định dạng, quyền, đăng nhập, icon, kiểm tra mật khẩu |
| `src/static` | CSS và ảnh có sẵn |
| `public/fonts` | font cho hóa đơn PDF |
| `server/routes` | cửa vào API |
| `server/services` | nghiệp vụ nặng (giá, voucher, kho, thanh toán, thống kê, email) |
| `server/core` | nền tảng (lưu dữ liệu, quyền, luật, mật khẩu, email) |
| `server/data` | dữ liệu khởi tạo và thông số theo loại cây |
| `server/ai` | chatbot và kho kiến thức `kb/*.md` |
| `data` | `db.json`, ảnh tải lên, sao lưu, nhật ký truy cập |
| `tests` | 85 bài test tự động |
| `scripts` | `them-tai-khoan-role.mjs`: thêm tài khoản owner/staff mẫu (chạy khi server tắt; đặt lại mật khẩu về giá trị trong file) |
| `dist` | bản build, tự sinh |
