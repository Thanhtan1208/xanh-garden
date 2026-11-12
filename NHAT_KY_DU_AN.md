# Nhật ký dự án Xanh Garden

**Cập nhật:** 27/10/2026. Project hiện không có lịch sử Git, nên các chặng dưới đây được dựng lại từ mã nguồn và mô tả quá trình mở rộng **theo chức năng**, không khẳng định ngày hoàn thành hoặc thứ tự commit.

## Từ bản website cơ bản đến ứng dụng hiện tại

### 1. Dựng khung web và backend

- **Đã làm:** 21 trang HTML ở gốc app, CSS dùng chung tại `src/static/CSS/main.css`, JavaScript riêng cho từng trang trong `src/js/pages/`. `vite.config.js` khai báo nhiều trang để build và proxy `/api`, `/uploads` đến Express cổng 3000.
- **Lưu dữ liệu:** `server/index.js` gắn các route; `server/core/store.js` nạp `data/db.json` và ghi bằng file tạm rồi đổi tên để tránh ghi dở. Server sao lưu dữ liệu hằng ngày trong `data/backups/`, giữ 7 bản. Vite chặn truy cập trực tiếp `data/`, `server/`, `tests/`, `.env`.
- **Khi mở lại:** xem `package.json`, `vite.config.js`, `server/index.js`, `server/core/store.js`, `README.md`. Chạy API bằng `npm run server`, giao diện bằng `npm run dev` trong thư mục app.

### 2. Làm tài khoản và thông tin cá nhân

- **Đã làm:** đăng ký, email xác minh bằng mã 6 số, gửi lại mã, đăng nhập, quên/đặt lại/đổi mật khẩu, sổ địa chỉ và trang tài khoản.
- **Luồng:** `register-page.js` gửi POST `/api/auth/register`; backend kiểm tra dữ liệu, băm mật khẩu bằng `scrypt`, gán role `user` và gửi mã email. `verify-email-page.js` xác minh rồi lưu session. `login-page.js` gửi tên/email và mật khẩu lên `/api/auth/login`, nhận token qua `utils/auth.js`.
- **Quy tắc:** backend đọc role mới nhất từ `db` ở mỗi request, không lấy role do client gửi. Đăng nhập sai 5 lần bị khóa 10 phút. `server/index.js` còn có `migrate()` để băm mật khẩu cũ, chuẩn hóa role và dữ liệu đơn cũ.
- **File:** `server/routes/auth.js`, `server/core/http.js`, `codes.js`, `rules.js`, `src/js/pages/account-page.js`, `src/js/utils/auth.js`.

### 3. Làm danh mục, tìm kiếm và chi tiết cây

- **Đã làm:** trang chủ có banner/sự kiện, cây bán chạy và cây mới; trang sản phẩm có tìm không dấu, lọc danh mục/giá/còn hàng/giảm giá, sắp xếp và đổi dạng lưới/danh sách. Trang chi tiết có mô tả, thông số, chăm sóc, đánh giá, yêu thích và thêm giỏ.
- **Phân trang:** `products-page.js` đặt `PAGE_SIZE = 12`; lọc xong mới tính `Math.ceil(result.length / PAGE_SIZE)` và `slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)`. Ví dụ 101 sản phẩm thành 9 trang, trang cuối 5 sản phẩm. Có **Trước/Sau**, đánh dấu trang hiện tại và về trang 1 khi đổi bộ lọc. Hiện phần này chia trang trên frontend sau khi tải danh sách.
- **Nhãn:** `inventory.js` đánh dấu “Mới” khi tạo trong 14 ngày, “Mới về” khi nhập thêm trong 7 ngày. `product-card.js` tạo nhãn; CSS đặt cụm nhãn ở góc phải, giảm giá màu `#f57c00`, “Mới” màu `#e3262f`; nút yêu thích ở góc trái.
- **File:** `home-page.js`, `products-page.js`, `product-detail-page.js`, `components/product-card.js`, `server/routes/shop.js`, `server/services/inventory.js`.

### 4. Làm giỏ hàng, báo giá và checkout

- **Đã làm:** giỏ theo tài khoản, tăng/giảm/xóa hàng, chọn địa chỉ, phương thức giao/thanh toán, áp voucher và đặt đơn.
- **Luồng:** `cart-page.js` dùng `cart-service.js` để đồng bộ giỏ. `checkout-page.js` gọi POST `/api/orders/quote` khi lựa chọn thay đổi; `server/services/pricing.js` tính `subtotal`, giảm đơn, phí ship, giảm ship và `total`. Khi POST `/api/orders`, server kiểm lại giá/tồn kho/điều kiện, tạo đơn, trừ kho và cập nhật giỏ/voucher. **Không lấy số tiền do client tự tính làm kết quả cuối.**
- **Giới hạn:** tối đa 20 chiếc trên một dòng; đơn trước giảm không quá 50 triệu; tối đa 3 đơn đang mở chưa thanh toán/xác nhận. Ship thường 30.000đ, nhanh 50.000đ; ship thường miễn phí khi tiền hàng **trước giảm** từ 500.000đ.
- **File:** `src/js/pages/cart-page.js`, `checkout-page.js`, `src/js/services/cart-service.js`, `server/routes/cart.js`, `orders.js`, `server/services/pricing.js`, `server/core/rules.js`.

### 5. Làm trạng thái đơn, COD và chuyển khoản

- **Đã làm:** đặt COD hoặc quét VietQR/SePay, trang kết quả đơn, “Đơn hàng của tôi”, hủy/mua lại, quản lý đơn và xử lý thanh toán bên admin.
- **Trạng thái:** `pending → confirmed → shipping → delivered`; các trường hợp hợp lệ có thể `cancelled`. Đơn chuyển khoản giá trị cao có `unconfirmed` chờ tiền. Quy tắc chuyển trạng thái nằm trong `ORDER_TRANSITIONS` của `server/core/rules.js`.
- **Ngưỡng:** tiền hàng trên 1 triệu phải chuyển khoản trước; đơn chuyển khoản chờ tối đa 30 phút, quá hạn tự hủy và hoàn kho. `order-success-page.js` hiện QR, đếm ngược và hỏi lại trạng thái mỗi 4 giây.
- **Webhook:** `server/routes/payments.js` kiểm API key SePay, chống trùng `txId`, tìm mã đơn trong nội dung chuyển khoản và so số tiền. Chuyển thiếu được cộng dồn; đủ tiền thì `markPaid()` ghi nhận và có thể tự xác nhận đơn. Chuyển sau khi đơn hủy được đánh dấu để xử lý hoàn tiền.
- **File:** `order-success-page.js`, `my-orders-page.js`, `admin-orders-page.js`, `server/routes/orders.js`, `payments.js`, `server/services/orders.js`, `sepay.js`.

### 6. Làm voucher, đánh giá và phản hồi

- **Voucher:** có kho/ví voucher, giảm đơn hoặc ship, phạm vi toàn bộ/danh mục/sản phẩm, điều kiện đơn tối thiểu và giới hạn lượt. Mỗi đơn dùng tối đa **1 voucher giảm đơn + 1 voucher giảm ship**. Có quà khách mới/sinh nhật; hủy đơn thì voucher được trả lại theo quy tắc.
- **Khách mới:** `customer-analytics.js` tính người **chưa từng có bất kỳ đơn nào**, kể cả đơn đã hủy. `hasOrdered()` trong `vouchers.js` cũng xét mọi đơn; riêng voucher `newUser` yêu cầu thêm tài khoản tạo trong 30 ngày.
- **Tương tác:** khách có thể đánh giá sản phẩm kèm ảnh/video và gửi góp ý hoặc khiếu nại gắn mã đơn; nhân sự có quyền xem/trả lời phản hồi.
- **File:** `vouchers-page.js`, `admin-vouchers-page.js`, `feedback-page.js`, `product-detail-page.js`, `server/services/vouchers.js`, `pricing.js`, `customer-analytics.js`, `server/routes/vouchers.js`, `feedbacks.js`, `shop.js`, `uploads.js`.

### 7. Làm hóa đơn PDF và email

- **Hóa đơn:** `my-orders.html` và `admin-orders.html` có nút xuất từng đơn. `components/invoice.js` dùng jsPDF + autoTable để in khổ A4: thông tin khách, bảng hàng, voucher, ship, tổng tiền. Font `public/fonts/BeVietnamPro-*.ttf` giúp PDF có dấu tiếng Việt. Đơn hủy không hiện nút xuất.
- **Email:** `server/core/mailer.js` gửi mã xác minh/đặt lại mật khẩu và email nghiệp vụ. Trong môi trường dev chưa cấu hình SMTP, nội dung email được in ở console server.
- **File:** `src/js/components/invoice.js`, `my-orders-page.js`, `admin-orders-page.js`, `server/core/mailer.js`, `server/services/order-mail.js`.

### 8. Làm khu quản trị và phân quyền

- **Role:** `admin > owner > staff > user`. `server/core/permissions.js` chứa capability và API dùng `requirePermission(...)` để chặn thật. `src/js/utils/permissions.js` phản chiếu quyền để ẩn/hiện menu, nút. `header.js` dựng giao diện khách hoặc quản trị và hiện màu thanh quản trị khác nhau cho admin/owner/staff.
- **Nghiệp vụ:** admin đổi role; owner xem doanh thu và quản lý hoạt động cửa hàng; staff xử lý đơn, nhập kho, phản hồi; user mua hàng và quản lý tài khoản riêng. Backend lấy role từ db ở mỗi request nên đổi role có hiệu lực cho lần gọi API tiếp theo.
- **Nhân sự:** `admin-team.html` GET `/api/admin/users`, lọc tài khoản rồi PATCH `/api/admin/users/:id/role`. Chỉ admin được làm, chỉ đổi tài khoản đã xác minh, không đổi admin hoặc tự đổi mình. **Chưa có API/form tạo staff mới trực tiếp**: người đó phải đăng ký rồi admin nâng role. Ảnh chụp dữ liệu 27/10/2026 có admin và user, chưa có tài khoản mẫu owner/staff.
- **Các trang:** `admin-products.html` quản lý sản phẩm/nhập kho; `admin-orders.html` quản lý đơn; `admin-banners.html` quản lý sự kiện/banner/theme; `admin-vouchers.html` quản lý voucher; `admin-dashboard.html` báo cáo; `admin-team.html` gán role.
- **File:** `server/core/permissions.js`, `server/core/http.js`, `server/routes/admin.js`, `admin-content.js`, `src/js/utils/permissions.js`, `src/js/components/header.js`.

### 9. Làm dashboard, theo dõi hành vi và export

- **Dashboard:** KPI, biểu đồ và bảng cho doanh thu, kho/vận hành, nhu cầu khách, đánh giá và khách hàng. `server/routes/admin.js` tính doanh thu từ đơn **đã giao**. Kho hiển thị sắp hết/hết hàng và việc cần xử lý.
- **Hành vi:** `tracker.js` gửi sự kiện xem trang, tìm kiếm, lọc, thêm giỏ, checkout, đặt đơn tới `/api/track`; dữ liệu lưu trong `data/analytics.ndjson`. `demand.js` tổng hợp funnel, giờ truy cập, sản phẩm/danh mục và từ khóa được quan tâm.
- **Chỉ số khách:** `customer-analytics.js` tách khách truy cập ẩn danh, tài khoản đã đăng ký, khách có đơn, khách mua lần đầu/quay lại. “Chưa từng đặt đơn” xét mọi đơn kể cả hủy; “mua lần đầu” dựa trên đơn đầu tiên không bị hủy.
- **Export:** đơn hàng, nhu cầu, khách hàng có CSV; nhiều báo cáo có `.xlsx` thông qua `excel-service.js`. Doanh thu/kho/đánh giá hiện xuất Excel, **không phải báo cáo nào cũng có cả CSV và Excel**.
- **Lỗi hiện có:** HTML đã có tab/panel **Khách hàng**, API và `admin-customers.js` đã có, nhưng `showTab()` trong `admin-dashboard-page.js` thiếu key `customers` ở object `allowed`; bấm tab bị chuyển về Doanh thu.
- **File:** `admin-dashboard.html`, `admin-dashboard-page.js`, `admin-demand.js`, `admin-customers.js`, `src/js/services/tracker.js`, `excel-service.js`, `server/services/analytics.js`, `demand.js`, `customer-analytics.js`.

### 10. Làm chatbot, theme sự kiện và giảm giật

- **Chatbot:** `server/ai/kb/*.md` là kho kiến thức cho chính sách/cách chăm cây. Bot lấy giá, tồn kho, đơn thật qua hàm; có OpenAI API thì dùng mô hình, không có thì `quick-answer.js` trả lời từ dữ liệu sẵn có. Có giới hạn tần suất và lịch sử chat cho tài khoản khách.
- **Theme:** admin có thể tạo sự kiện và banner. API `/api/site` chọn sự kiện hiện hành; `site-service.js` áp các CSS variable `--green`, `--green-dark`, `--accent`, đồng thời cache theme trong localStorage để trang sau không chớp màu mặc định. Theme sự kiện là dùng chung; role hiện chủ yếu khác ở thanh quản trị, **chưa có theme toàn trang riêng cho từng role**.
- **Giảm giật:** `vite.config.js` đưa module trang vào `<head>` với `blocking="render"`; CSS dùng `scrollbar-gutter: stable`; một số trang giữ thẻ rồi chỉ ẩn/hiện khi lọc và dùng bản nhớ `api.load` để vẽ dữ liệu sớm. Đây là cơ chế đã code, **không phải bằng chứng mọi trường hợp giật đều hết**.
- **File:** `server/routes/chat.js`, `server/ai/kb.js`, `openai.js`, `quick-answer.js`, `src/js/components/chat-widget.js`, `server/services/site.js`, `src/js/services/site-service.js`, `vite.config.js`, `main.css`.

## Bản đồ nhanh theo trang

| Trang | Chức năng chính | JavaScript |
|---|---|---|
| `index.html` | Trang chủ, banner, sự kiện, cây nổi bật/mới | `home-page.js` |
| `products.html` | Tìm, lọc, sắp xếp, phân trang | `products-page.js` |
| `product-detail.html` | Chi tiết, yêu thích, giỏ, đánh giá | `product-detail-page.js` |
| `cart.html` | Xem và sửa giỏ | `cart-page.js` |
| `checkout.html` | Địa chỉ, voucher, quote, đặt đơn | `checkout-page.js` |
| `order-success.html` | QR và trạng thái thanh toán | `order-success-page.js` |
| `my-orders.html` | Lọc/hủy/mua lại đơn, PDF | `my-orders-page.js` |
| `account.html` | Tài khoản, địa chỉ, yêu thích, mật khẩu | `account-page.js` |
| `vouchers.html` | Kho và ví voucher | `vouchers-page.js` |
| `feedback.html` | Góp ý, phản ánh, trả lời | `feedback-page.js` |
| `info.html` | Chính sách và cẩm nang từ KB | `info-page.js` |
| `login.html`, `dangky.html`, `verify-email.html`, `forgot-password.html` | Đăng nhập, đăng ký, OTP, khôi phục mật khẩu | Các file `*-page.js` tương ứng |
| `admin-dashboard.html` | Báo cáo 5 tab | `admin-dashboard-page.js`, `admin-demand.js`, `admin-customers.js` |
| `admin-orders.html` | Đơn, thanh toán, CSV/Excel, PDF | `admin-orders-page.js` |
| `admin-products.html` | Sản phẩm, ảnh, kho và stock log | `admin-products-page.js` |
| `admin-banners.html` | Sự kiện, theme, banner | `admin-banners-page.js` |
| `admin-vouchers.html` | Tạo/sửa/tắt voucher | `admin-vouchers-page.js` |
| `admin-team.html` | Xem tài khoản, gán role | `admin-team-page.js` |

## Cách lần theo code khi một chức năng bị xóa hoặc hỏng

1. **Phân trang sản phẩm:** mở `products.html` để thấy vùng danh sách và nút trang; sang `src/js/pages/products-page.js` tìm `PAGE_SIZE`, `Math.ceil`, `slice` và nơi reset `state.page`. Danh sách đầu vào lấy từ API sản phẩm trong `server/routes/shop.js`. Nếu thêm lọc mới, lọc trước rồi mới chia trang; 101 cây với limit 12 phải ra 9 trang, không được tạo trang rỗng.
2. **Đặt một đơn:** từ `checkout.html` → `src/js/pages/checkout-page.js` (gọi `/api/orders/quote`, rồi POST `/api/orders`) → `server/routes/orders.js` (xác thực, giới hạn, tạo đơn) → `server/services/pricing.js` (tính giá) và `server/services/inventory.js` (kiểm/trừ tồn) → `server/core/store.js` (ghi `data/db.json`). Khi sửa giá hoặc voucher, luôn dò cả quote lẫn lúc tạo đơn để hai kết quả khớp.
3. **Thanh toán chuyển khoản:** `order-success-page.js` hiện QR và hỏi trạng thái; `server/services/sepay.js` tạo nội dung chuyển khoản và URL QR. `server/routes/payments.js` nhận webhook, đối chiếu API key, mã đơn, số tiền và `txId`; sau đó dùng `server/services/orders.js` để ghi nhận đã trả và đổi trạng thái. Nếu một giao dịch không khớp, kiểm tra các dữ liệu đối chiếu và trạng thái đơn trước khi sửa.
4. **Quyền và trang admin:** xem `server/core/permissions.js` để biết capability của từng role; `server/core/http.js` dùng `requirePermission` tại route; `src/js/utils/permissions.js` cùng `src/js/components/header.js` quyết định menu/nút được thấy. Khi thêm quyền mới, cập nhật cả backend lẫn giao diện, nhưng API phải tự chặn người không có quyền.
5. **Một báo cáo:** `admin-dashboard.html` chứa nút tab và panel → `admin-dashboard-page.js` chọn tab, tải dữ liệu → `server/routes/admin.js` trả thống kê → các service analytics tính số → `excel-service.js` xuất file. Riêng tab `customers` đang bị thiếu trong object `allowed` của `showTab()`: đây là điểm cần sửa trước khi coi báo cáo khách hàng đã dùng được.
6. **Hóa đơn:** nút ở `my-orders.html` hoặc `admin-orders.html` gọi `src/js/components/invoice.js`. File này lấy dữ liệu đơn đã tải và tạo PDF bằng jsPDF/autoTable; cần giữ font tiếng Việt trong `public/fonts/` khi khôi phục hoặc di chuyển project.

## Những việc còn thiếu hoặc cần kiểm tra thực tế

- **Nhân sự:** `admin-team.html` chỉ nâng/hạ role tài khoản đã đăng ký; chưa có form/API tạo staff trực tiếp. Theo quyết định hiện tại, admin là người duy nhất được thêm staff; nếu làm tiếp, cần định nghĩa rõ owner có quyền quản lý staff thuộc cửa hàng mình hay không.
- **Dashboard khách hàng:** panel/API đã có nhưng nút tab chưa mở đúng vì thiếu `customers` trong `showTab()`; CSV và Excel chưa đồng đều giữa các báo cáo.
- **Theme theo role:** đã có màu thanh quản trị theo admin/owner/staff và theme sự kiện toàn site; chưa có bộ theme toàn trang riêng cho từng role.
- **Cảm giác chuyển trang:** đã có `blocking="render"`, cache theme và giữ chỗ scrollbar. Chưa có kết quả đo hoặc kiểm thử trình duyệt đủ để khẳng định mọi trường hợp giật đã hết.

## Khi quay lại project

- `README.md`: cách chạy và cấu hình.
- `CAU_TRUC_PROJECT.md`: cấu trúc thư mục, API và quy tắc nghiệp vụ.
- `../Huong_dan_code_Xanh_Garden.docx`: giải thích 21 trang và bản chụp mã nguồn có số dòng để khôi phục code.
- Muốn lần theo một chức năng: **trang HTML → `src/js/pages/` → `src/js/services/` → `server/routes/` → `server/services/` → `data/db.json`**.

## Ghi tiếp sau mỗi lần sửa

Thêm một mục theo mẫu: `YYYY-MM-DD — Sửa phần nào; vì sao; file chính; đã kiểm tra gì; còn vướng gì.`

- **2026-10-27:** Tạo rồi mở rộng nhật ký từ mã nguồn: ghi 10 chặng chức năng, bảng tra 21 trang, các luồng code và việc còn thiếu. Không sửa chức năng website; không chạy test trong lần viết tài liệu này.
- **2026-10-27:** Ghi riêng, kèm code để copy, các việc 20–27/10 (hóa đơn PDF theo B16, hết giật khi chuyển trang, giao diện mới, quản lý sản phẩm theo B17, sửa giao không thành công + phân quyền hủy đơn của khách) vào một file nhật ký riêng (đã gộp vào mục này và xóa); `npm test` 83/83 đạt.

### 2026-10-27 — Thông số sản phẩm: màu sắc, kích thước, chậu, quà tặng

- **Yêu cầu được ghi lại:** Mỗi sản phẩm cần cho khách biết màu, kích thước, có kèm chậu hay không và có quà tặng hay không. Theo mô tả thay đổi được cung cấp, đợt đầu bổ sung dữ liệu cho 13 sản phẩm; `color`, `size`, `pot`, `gift` được điền dựa trên loại cây/mô tả nên **chưa xác nhận với hàng thật**.
- **Cấu trúc đang có trong project:** Các giá trị nằm trong `data/db.json` dưới `product.specs.color`, `product.specs.size`, `product.specs.pot`, `product.specs.gift`, không nằm trực tiếp ở `product.color`... `product.gift`. Lúc đối chiếu để ghi nhật ký, database có **14 sản phẩm**: 13 sản phẩm id 1–13 trong ghi chú ban đầu và một sản phẩm khác có id `GkElK70s`. Không có lịch sử Git để xác định lúc sản phẩm thứ 14 được thêm. Sản phẩm id 11, 12, 13 là chậu/đất, không có `specs.pot`.
- **Trang chi tiết:** `src/js/pages/product-detail-page.js` gọi `renderSpecs(category)`. Hàm đọc `category.specFields`, lấy những `product.specs[key]` có giá trị, rồi tạo `<dl class="specs">` tại `#specPanel`. Cả nhãn và giá trị đều qua `escapeHtml`. CSS của `.specs` nằm trong `src/static/CSS/main.css`; admin có thể nhập các trường do danh mục quy định qua `src/js/pages/admin-products-page.js`.
- **Trang danh sách:** `src/js/pages/products-page.js` hiện **một** dòng `.row-spec` ghép `specs.size` với `specs.pot` (hoặc `specs.material`) bằng dấu ` · ` và `escapeHtml` chuỗi kết quả. Code hiện **chưa** hiện dòng `color · size` và dòng `pot · gift` như ghi chú thay đổi. CSS `.row-spec` cũng nằm trong `main.css`.
- **Quy tắc cần hoàn thiện:** Trường trống được bỏ qua trên trang chi tiết. Riêng `gift` trống hiện cũng bị bỏ qua, **chưa** hiện “Không có”; muốn khách biết chắc là không tặng quà thì cần sửa `renderSpecs()` và cân nhắc cách hiện trên trang danh sách. Với chậu/đất, không tự suy diễn rằng sản phẩm có kèm thêm chậu.
- **Dữ liệu mẫu hiện tại của id 1:** Lưỡi hổ có `color: "Lá xanh sẫm, viền vàng"`, `size: "Cao 40–50 cm, chậu Ø15 cm"`, `pot: "Chậu sứ Ø15 cm"`, `gift: "Đĩa lót chậu"`. Giá trị này khác ví dụ do người dùng cung cấp, nên khi bán thật cần đối chiếu SKU và cập nhật lại `db.json`.
- **Vận hành và kiểm tra:** Server giữ database trong RAM; sau khi sửa `data/db.json` bằng tay phải dừng và chạy lại `npm run server` trước khi server ghi tiếp, tránh ghi đè bản sửa. Theo ghi chú được cung cấp, phần JS từng được kiểm tra bằng `node --check`; giao diện chưa được kiểm tra trên trình duyệt. Lần ghi nhật ký này chỉ đọc code và dữ liệu, không chạy lại kiểm tra hoặc khởi động server.
