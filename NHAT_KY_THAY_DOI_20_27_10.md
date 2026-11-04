# Nhật ký thay đổi (20/10 – 27/10/2026)

Ghi lại từng phần đã làm: **mục đích → file sửa → code chính → cách kiểm tra**.
Mọi comment trong code dùng `//`, ngắn gọn, thụt lề 4 khoảng trắng (theo `my-orders.html`).

Chạy thử: mở 2 terminal trong thư mục project, chạy `npm run server` và `npm run dev`. Sửa ở `server/` thì phải chạy lại `npm run server`. Tải lại trang bằng Ctrl+F5.

| # | Phần | File chính |
|---|---|---|
| 1 | Xuất hóa đơn PDF (làm theo bài B16 của cô) | `src/js/components/invoice.js`, `my-orders.html`, `admin-orders.html`, `public/fonts/` |
| 2 | Hết giật khi chuyển trang / đổi tab | `vite.config.js`, `src/js/services/api-service.js`, hầu hết `src/js/pages/*.js`, `main.css` |
| 3 | Giao diện hiện đại, đơn giản | `src/static/CSS/main.css`, `src/js/components/header.js` |
| 4 | Quản lý sản phẩm theo bài B17 của cô | `admin-products.html`, `src/js/pages/admin-products-page.js` |
| 5 | Rà soát nghiệp vụ, sửa 2 lỗi | `server/core/rules.js`, `server/routes/orders.js`, `tests/*.js` |

---

## 1. Xuất hóa đơn PDF

**Mục đích:** mỗi đơn có nút xuất hóa đơn PDF, làm đúng cách cô làm ở bài B16 (jsPDF + autoTable nhúng bằng CDN).

### Cách làm
1. Nhúng 2 thư viện bằng thẻ `<script>` ở **cuối `<body>`** của `my-orders.html` và `admin-orders.html`, **trước** thẻ module của trang (đúng phiên bản của cô):

```html
<!-- jsPDF + AutoTable để xuất hóa đơn PDF -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@3.0.3/dist/jspdf.umd.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.2/dist/jspdf.plugin.autotable.min.js" defer></script>
<script type="module" src="./src/js/pages/my-orders-page.js"></script>
```

2. Font mặc định của jsPDF **không có dấu tiếng Việt** (chữ "Hóa đơn" sẽ lỗi). Tải 2 file font **Be Vietnam Pro** (`BeVietnamPro-Regular.ttf`, `BeVietnamPro-Bold.ttf`, giấy phép OFL) bỏ vào thư mục `public/fonts/`. Thư mục `public/` của Vite được phục vụ ở đường dẫn gốc nên gọi bằng `./fonts/...`.

3. Tạo `src/js/components/invoice.js` với hàm `xuatHoaDon(donHang, btnXuatPDF, thongBao)`. Các bước trong hàm giống bài của cô:

```js
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

async function napFontTiengViet(doc) {
    const fontThuong = await docFontBase64("./fonts/BeVietnamPro-Regular.ttf");
    const fontDam = await docFontBase64("./fonts/BeVietnamPro-Bold.ttf");
    // đưa file font vào bộ nhớ của jsPDF rồi đặt tên font
    doc.addFileToVFS("BeVietnamPro-Regular.ttf", fontThuong);
    doc.addFont("BeVietnamPro-Regular.ttf", TEN_FONT, "normal");
    doc.addFileToVFS("BeVietnamPro-Bold.ttf", fontDam);
    doc.addFont("BeVietnamPro-Bold.ttf", TEN_FONT, "bold");
}
```

Phần chính của `xuatHoaDon` (giống bài B16):

```js
const { jsPDF } = window.jspdf;
const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
await napFontTiengViet(doc);
doc.text(SHOP.name, 105, 18, { align: "center" });        // 105 = giữa trang A4

// bảng sản phẩm: mỗi sản phẩm trong đơn là 1 dòng
const headers = ["STT", "Sản phẩm", "Đơn giá", "SL", "Thành tiền"];
const rows = donHang.items.map((sp, index) => [
    index + 1, sp.name, dinhDangTienTe(sp.price), sp.qty, dinhDangTienTe(sp.price * sp.qty)
]);
doc.autoTable({
    head: [headers], body: rows, startY: y + 2, theme: "grid",
    styles: { font: TEN_FONT, fontSize: 10 },              // bảng cũng phải dùng font tiếng Việt
    headStyles: { font: TEN_FONT, fontStyle: "bold", fillColor: MAU_XANH, halign: "center" },
    columnStyles: { 0: { halign: "center", cellWidth: 14 }, 2: { halign: "right", cellWidth: 32 }, 3: { halign: "center", cellWidth: 16 }, 4: { halign: "right", cellWidth: 36 } }
});

doc.save(`Hoa_don_${donHang.code}.pdf`);
```

Khung `try / catch / finally` khóa nút khi đang xuất và luôn bật lại nút, y hệt `xuatPDF()` của cô:
`btnXuatPDF.disabled = true` → ... → `finally { btnXuatPDF.disabled = false; }`.

4. Gắn nút vào từng đơn:
   - `my-orders-page.js`: nút `data-action="invoice"` (ẩn với đơn đã hủy); khi bấm gọi `xuatHoaDon(order, button, actionMessage)`.
   - `admin-orders-page.js`: thêm `iconButton('download', 'Xuất hóa đơn PDF', { attrs: { 'data-action': 'invoice' } })`; khi bấm cũng gọi `xuatHoaDon(order, button, actionMessage)`.

**Kiểm tra:** bấm nút → tải về `Hoa_don_<mã đơn>.pdf`, chữ có dấu; đơn 40 sản phẩm tự sang trang 2–3, bảng lặp lại tiêu đề; bấm đúp chỉ ra 1 file; font lỗi thì hiện "Có lỗi xảy ra khi xuất hóa đơn." và nút bật lại.

---

## 2. Hết giật khi chuyển trang / đổi tab

### Nguyên nhân
Mỗi "tab" trên menu là **một trang HTML riêng**, nội dung vẽ bằng JavaScript **sau khi gọi API**. Khung hình đầu thiếu dữ liệu, dữ liệu về thì các khối chèn vào và **đẩy phần bên dưới nhảy** (layout shift). Ngoài ra còn có: hiệu ứng mờ dần `@view-transition` trộn trang cũ với trang mới còn trống; màu sự kiện và danh mục menu bị hết hạn bộ nhớ sau 2–5 phút; font tải muộn.

### Cách khắc phục
**a) Chờ khung trang dựng xong rồi mới vẽ** – plugin trong `vite.config.js` chuyển thẻ `<script type="module">` của trang lên `<head>` kèm `blocking="render"` (Chrome/Edge):

```js
const renderBlocking = {
    name: 'render-blocking-page-scripts',
    transformIndexHtml: {
        order: 'post',
        handler(html) {
            const scripts = [];
            const rest = html.replace(/<script type="module"(?![^>]*@vite\/client)([^>]*)><\/script>\s*/g, (_, attrs) => {
                scripts.push(`<script type="module" blocking="render"${attrs}></script>`);
                return '';
            });
            return rest.replace('</head>', `${scripts.join('\n')}\n</head>`);
        }
    }
};
export default defineConfig({ plugins: [renderBlocking], /* ...phần cũ... */ });
```

**b) Vẽ ngay bằng dữ liệu đã nhớ, cập nhật ở nền** (stale-while-revalidate) – hàm `api.load()` trong `src/js/services/api-service.js`:

```js
const CACHE_PREFIX = 'apiCache:';
const cacheKey = (path) => `${CACHE_PREFIX}${getCurrentUser()?.id || 'guest'}:${path}`;
// readCache / writeCache dùng sessionStorage trong try/catch; clearApiCache() xóa mọi khóa bắt đầu bằng CACHE_PREFIX

// paths là 1 đường dẫn hoặc mảng; render nhận kết quả theo đúng thứ tự
async function load(paths, render) {
    const list = Array.isArray(paths) ? paths : [paths];
    const cached = list.map(readCache);
    if (cached.every(Boolean)) render(...cached.map((text) => JSON.parse(text)));   // có bản nhớ: vẽ NGAY
    const fresh = await Promise.all(list.map((path) => request(path)));
    const texts = fresh.map((data) => JSON.stringify(data));
    texts.forEach((text, index) => writeCache(list[index], text));
    if (texts.some((text, index) => text !== cached[index])) render(...fresh);       // dữ liệu mới khác thì vẽ lại
    return fresh;
}
export const api = { upload, load, get: (path) => request(path), /* ... */ };
```

Xóa bản nhớ để không hiện dữ liệu sai:
- trong `request()`: `if (method !== 'GET' && !/^\/(cart|chat)\b/.test(path)) clearApiCache();`
- khi gặp lỗi 401: `clearSession(); clearApiCache();`
- khi đăng xuất (`header.js`): gọi `clearApiCache()` trước `clearSession()`.

Cách dùng trong một trang (ví dụ `my-orders-page.js`):

```js
await api.load('/orders', (data) => {
    orders = data;
    loaded = true;
    renderTabs();
    renderOrders();
    document.querySelector('#loading').classList.add('hidden');
});
```

Các trang đã đổi sang `api.load`: trang chủ, sản phẩm, chi tiết sản phẩm, đơn hàng, voucher, góp ý, tài khoản, cẩm nang, thống kê, quản lý đơn, sản phẩm, banner, voucher (admin).

**c) Đổi tab trong trang không vẽ lại cả danh sách** (`my-orders-page.js`): dựng thẻ của mọi đơn một lần, đổi tab chỉ ẩn/hiện:

```js
function applyFilter() {
    let shown = 0;
    orderList.querySelectorAll('.order-card').forEach((card) => {
        const order = orders.find((entry) => entry.id === card.dataset.id);
        const match = (!filterStatus || order.status === filterStatus) &&
            (!keyword || order.code.toLowerCase().includes(keyword) ||
                order.items.some((item) => item.name.toLowerCase().includes(keyword)));
        card.hidden = !match;
        if (match) shown++;
    });
    orderList.querySelector('#noMatch')?.classList.toggle('hidden', shown > 0);
}
```

Tương tự `account-page.js`: tab đã tải thì không tải/vẽ lại (`loadedTabs`).

**d) Màu sự kiện và danh mục menu nhớ lâu hơn:** `site-service.js` lưu vào `localStorage` (bỏ hạn 2 phút, bỏ khi sự kiện đã kết thúc); `catalog-service.js` bỏ hạn 5 phút; `header.js` chỉ vẽ lại menu khi nội dung khác (`if (nav.innerHTML !== html)`).

**e) CSS (`main.css`):**
- `html { scrollbar-gutter: stable; }` – không lệch ngang khi thanh cuộn hiện/ẩn.
- `.page { min-height: 100vh; }` – chân trang không nhảy khi nội dung về.
- Bỏ `@view-transition` và các quy tắc `::view-transition-*`.
- `.table-wrap:has(> table[hidden]) { display: none; }` – ẩn khung bảng rỗng.
- `.hidden, [hidden] { display: none !important; }`.
- Font Google đổi `display=swap` thành `display=optional` ở mọi file HTML.

**f) Giữ chỗ cho phần tải sau:** thanh tab chưa có số đếm thì vẽ chữ không kèm số; thẻ thống kê admin vẽ khung với `…`; breadcrumb của `product-detail.html` có sẵn "Trang chủ › Sản phẩm"; cột danh mục trang Sản phẩm vẽ từ danh mục đã nhớ.

**Kiểm tra:** đo trên Chrome bằng `PerformanceObserver` loại `layout-shift` khi đi lần lượt qua các trang, 2 lượt (mở lần đầu và quay lại): **không còn layout shift** ở mọi trang (chỉ còn 0,0011 ở trang Thống kê lần đầu, thấp hơn ngưỡng tốt 0,1 rất nhiều).

---

## 3. Giao diện hiện đại, đơn giản

Hầu hết nằm trong `src/static/CSS/main.css`, phần header nằm trong `src/js/components/header.js`.

- **Biến màu và bo góc** (`:root`): màu chữ/viền dịu hơn, `--radius: 10px`, `--radius-lg: 16px`, bóng nhẹ; `--header-h: 113px`; `--green-soft: color-mix(in srgb, var(--green) 9%, #fff)` nên màu nhạt tự đổi theo màu sự kiện.
- **Header gọn 1 khối trắng:** bỏ thanh trên cùng màu đậm (hotline, liên kết nhanh) và nút hotline; ô tìm kiếm bo tròn nền xám nhạt; giỏ hàng chỉ còn icon, giỏ trống thì ẩn số:

```js
const badge = document.querySelector('#cartCount');
if (!badge) return;
badge.textContent = cartCount();
badge.hidden = !cartCount();       // giỏ trống thì ẩn số đếm
```

- **Menu danh mục:** nền trắng, chữ nhẹ, mục đang chọn có gạch chân (thay thanh xanh đậm).
- **Tiêu đề mục (`.section-head`):** bỏ in hoa, icon lá, gạch chân.
- **Thẻ sản phẩm:** bo 16px, rê chuột thì nổi nhẹ; nút "Thêm vào giỏ" nền nhạt `var(--green-soft)` thay viền đậm; badge bo tròn.
- **Chân trang** nền sáng; **nút gọi nhanh** thành nút tròn nhỏ không chữ, không rung.
- **Admin:** thanh menu trắng, mục đang chọn tô nhạt; bảng thoáng (`.data-table`), rê chuột sáng dòng; thẻ thống kê bỏ bóng đậm.
- Các vị trí `position: sticky` đổi từ `top: 146px` sang `top: calc(var(--header-h) + 16px)`.

---

## 4. Quản lý sản phẩm theo bài B17 của cô

Tham khảo `B17_20_10_26/admin.html` và `admin.js`. Viết lại `admin-products.html` và `src/js/pages/admin-products-page.js` theo đúng cấu trúc đó:

- **1 form dùng chung cho thêm và sửa**, có ô ẩn `<input type="hidden" id="productId">`: có id thì cập nhật, rỗng thì thêm mới.
- Nút `submitBtn` đổi chữ "Thêm sản phẩm" ↔ "Cập nhật"; nút `cancelBtn` ("Hủy sửa") chỉ hiện khi đang sửa.
- Các hàm cùng tên với bài của cô: `loadCategories`, `loadProducts`, `editProduct`, `updateForm`, `deleteProduct`, `resetForm`, `showPreview`.
- Danh mục có option mặc định "Chọn danh mục" (`disabled`), mỗi danh mục tạo bằng `document.createElement("option")`.
- Bảng dựng từng dòng bằng `createElement("tr")` + `appendChild`; bắt sự kiện một lần trên `productList` qua class `editBtn` / `deleteBtn`:

```js
productList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const id = button.dataset.id;
    if (button.classList.contains('deleteBtn')) await deleteProduct(id);
    if (button.classList.contains('editBtn')) editProduct(id);
});
```

- `resetForm()`: `form.reset()`, gán tay `productId.value = ''` (vì ô hidden không bị `reset()` xóa), chọn lại "Chọn danh mục", ẩn ảnh xem trước, đổi nút về chế độ thêm.
- Phần **thêm so với bài của cô** (cửa hàng cần): tải ảnh từ máy, giá gốc, tồn kho, thông số theo danh mục (thu gọn bằng `<details>`), phiếu nhập hàng, lịch sử nhập/xuất.
- **Khác bài của cô có chủ đích:** gọi API qua `api-service` (tự gắn token admin) thay cho `axios`; dùng hộp xác nhận/thông báo của web thay cho `confirm()`/`alert()`; cập nhật bằng `PUT` (server `parseProduct` chỉ ghi đè các trường gửi lên).

**Kiểm tra:** thêm, sửa (đổ dữ liệu lên form, nút thành "Cập nhật"), hủy sửa, nhập hàng +5, xem lịch sử, xóa – đều đạt, không lỗi JS.

---

## 5. Rà soát nghiệp vụ so với sàn thương mại lớn

Chạy `npm test` (80 test) rồi thử các tình huống biên bằng server tạm. Kết quả so với Shopee/Lazada/Tiki/TikTok Shop:

| Nghiệp vụ | Kết quả |
|---|---|
| Tính giá, tồn kho, chuyển khoản + webhook, voucher, chống lạm dụng | Đạt, giống sàn lớn |
| Giao không thành công | **Lỗi → đã sửa** |
| Lách giới hạn 3 đơn chưa trả tiền | **Lỗi → đã sửa** |
| Email cho đơn COD, hủy đơn đã trả tiền có duyệt, trả hàng/hoàn tiền, khách bấm "Đã nhận hàng", đánh giá theo từng lần mua, tự xóa tài khoản | Chưa có (đề xuất làm tiếp) |

### Sửa 1 – Giao không thành công (đơn đang giao, khách không nhận)
Trước đây đơn `shipping` không hủy được: hàng kẹt, tồn kho không hoàn (30 → 28). Cách sửa:

- `server/core/rules.js`, bảng `ORDER_TRANSITIONS`:

```js
shipping: { delivered: ['admin', 'owner', 'staff'], cancelled: ['admin', 'owner', 'staff'] },
```

- `server/routes/orders.js`, trong `PATCH /:id/status`:

```js
if (next === 'cancelled') {
    const failedDelivery = order.status === 'shipping';
    cancelOrder(order, req.user.name);          // hoàn kho, trả voucher, đã trả tiền thì đánh dấu cần hoàn tiền
    if (failedDelivery) order.cancelReason = 'Giao hàng không thành công, hàng đã hoàn về kho';
}
```

- `src/js/components/order-view.js`: `canAdminCancel` thêm `'shipping'`; `renderTimeline` hiện `cancelReason`.
- `src/js/pages/admin-orders-page.js`: đơn đang giao có nút "Giao không thành công (hoàn hàng)" và hộp xác nhận riêng.

### Sửa 2 – Lách giới hạn 3 đơn chưa thanh toán
Đặt COD trước, tạo 3 đơn chuyển khoản, rồi đổi COD sang chuyển khoản là có 4 đơn giữ hàng. `PATCH /:id/payment-method` giờ kiểm tra:

```js
if (paymentMethod === 'sepay' && db.orders.filter((other) => other !== order && isOwner(req.user, other) && isOpenUnpaid(other)).length >= MAX_OPEN_UNPAID_ORDERS) {
    fail(409, `Bạn đang có ${MAX_OPEN_UNPAID_ORDERS} đơn chưa thanh toán. Hãy hoàn tất hoặc hủy bớt trước khi đổi sang chuyển khoản.`);
}
```

### Sửa 3 – Phân quyền hủy đơn của khách (khi kiểm tra lại ngày 27/10)
Dự án đã thêm vai trò `owner` (chủ cửa hàng) và `staff`, còn khách đặt đơn trước đó cũng được gọi là `'owner'` nên **khách tự xác nhận được đơn của mình** (test báo 200 thay vì 403). Đã đổi tên vai trò của khách thành `'customer'`:

- `server/routes/orders.js`: `const actor = hasPermission(req.user, 'orders.manage') ? req.user.role : 'customer';`
- `server/core/rules.js`: khách (`customer`) chỉ được hủy khi đơn ở `unconfirmed` hoặc `pending`.

### Sửa tri thức chatbot và test
- `server/ai/kb/02-van-chuyen-thanh-toan-don-hang.md`: câu "khách hủy được trước khi giao" sửa thành "khi cửa hàng chưa xác nhận đơn"; thêm mô tả giao không thành công.
- `tests/orders.test.js`: thêm 3 test (giao không thành công COD, giao không thành công đã chuyển khoản, giới hạn khi đổi sang chuyển khoản); sửa assertion "đang giao thì không hủy" thành "khách không tự hủy".
- `tests/vouchers.test.js`: test voucher người dùng mới sửa theo quy tắc hiện tại (đã từng đặt đơn, kể cả đơn hủy, thì không dùng lại voucher `newUser`).

**Kiểm tra:** `npm test` → **83/83 đạt**.

---

## Cách phát hiện và kiểm tra (để trả lời cô nếu hỏi)

- **Đo giật:** dùng `PerformanceObserver` với `type: 'layout-shift'` trên Chrome, đo qua từng trang trước/sau khi sửa. Điểm CLS dưới 0,1 là tốt.
- **Kiểm thử nghiệp vụ:** dùng bộ test có sẵn (`npm test`) chạy trên dữ liệu tạm, **không đụng `data/db.json`**.
- Các file kịch bản đo và ảnh chụp trước/sau đã dùng để kiểm tra nằm trong thư mục tạm của phiên làm việc, không thuộc project.
