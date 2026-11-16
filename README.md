# Xanh Garden

Online plant shop with a customer storefront and a back office for staff. The whole project is written in JavaScript and split into two independent apps, each with its own `package.json`:

- [`backend/`](backend): REST API on Node.js and Express. Data is stored in a JSON file.
- [`frontend/`](frontend): multi-page website (HTML, CSS, JavaScript ES Modules) served and bundled by Vite.

The UI text is in Vietnamese. Documentation is in [`docs/`](docs):

| File | Content |
|---|---|
| [docs/HUONG_DAN_CODE_XANH_GARDEN.docx](docs/HUONG_DAN_CODE_XANH_GARDEN.docx) | What each folder and file contains and does |
| [docs/SRS_XANH_GARDEN.docx](docs/SRS_XANH_GARDEN.docx) | Software Requirements Specification (SRS) |
| [docs/USECASE_XANH_GARDEN.docx](docs/USECASE_XANH_GARDEN.docx) | Use case diagram and use case descriptions |
| [docs/SDS_XANH_GARDEN.docx](docs/SDS_XANH_GARDEN.docx) | Software Design Specification (SDS), includes the data dictionary |
| [docs/ERD_XANH_GARDEN.png](docs/ERD_XANH_GARDEN.png) | Database diagram (ERD), full resolution |

## Table of contents

1. [Features](#features)
2. [Roles](#roles)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Getting started](#getting-started)
6. [Scripts](#scripts)
7. [Configuration](#configuration)
8. [Data and backups](#data-and-backups)
9. [Back office settings](#back-office-settings)
10. [Testing email and payments locally](#testing-email-and-payments-locally)
11. [Deployment](#deployment)
12. [Code style](#code-style)
13. [Known limits](#known-limits)
14. [Change log](#change-log)

## Features

**Customers**

- Browse, search and filter products; product detail pages; favorites; shopping cart saved per account.
- One products page (`products.html`) for all products and each category (`?category=`). Left column: categories, price range, "Đang giảm giá". The search box (`?q=`) sits in the header of this page only, since it only searches products; other pages have no search box; active filters show as chips with ×, and "Xóa bộ lọc" appears only while a filter is on. Sorting is a row of buttons like Shopee: Nổi bật, Bán chạy, Hàng mới về, Giá thấp → cao, Giá cao → thấp (`?sort=`).
- Cart like Shopee: tick the items to buy (checkbox per item, "Chọn tất cả"); only ticked items are counted and go to checkout ("Mua hàng (N)"), the rest stay in the cart. "Mua ngay" and "Mua lại" tick only their own items. The choice is kept per browser tab (`sessionStorage`).
- Checkout with saved addresses, vouchers and two payment methods: cash on delivery (COD) and QR bank transfer through SePay. An old-format address (missing province/ward or a wrong phone) is marked in red and must be edited before ordering.
- Order tracking with the time of each step; cancel directly before the shop confirms, or send a cancel request afterwards. The "Chờ thanh toán" tab also lists unpaid QR orders.
- Receiving: on a shipping order the customer presses "Đã nhận được hàng" (order becomes "Đã giao", COD counted as paid, thank-you email sent). Without it, the system confirms delivery 7 days after shipping starts (`AUTO_RECEIVE_DAYS` in `backend/server/core/rules.js`); the card shows that date. Delivered orders have a "Đánh giá" button for each product.
- Reviews with photos and videos (only after receiving the product). A customer can hide ("Close") their own review but cannot delete it.
- One "Voucher" page (`vouchers.html`, no tabs): "Voucher của bạn" (usable vouchers, soonest expiry first, including new-user and birthday gifts that are given automatically), then "Voucher có thể nhận" ("Nhận" moves a voucher up), then a collapsed "Đã dùng / hết hạn" list. The birthday form sits at the bottom until the customer sets a birthday.
- Feedback form.
- Account: profile, avatar upload, address book, change password with an email code, forgot password.
- Delivery address (like TikTok Shop), in this order: Province/City first, then Ward/Commune of that province, then house number and street (free text, only required). Uses the current administrative units (since 1 July 2025: 34 provinces, 3,321 wards and communes, no district level), stored in `backend/server/data/vn-divisions.json` (source: provinces.open-api.vn v2) and served by `GET /api/divisions`. Both boxes suggest while typing (accents optional, matching letters in bold, aliases such as hcm, hn). The ward box stays locked until a province is picked, then lists only that province's wards; changing the province clears the ward. Leaving a box after typing part of a name keeps the previous choice. The address line on orders still reads house number, ward, province. Province, ward and house number/street are all required (marked with a red *): the browser blocks saving, outlines the missing boxes in red and names them; the server (`addressProblem` in `backend/server/core/address.js`) checks the same three again, both when saving an address and when placing an order. The province and ward boxes look and work like dropdowns (arrow, click to open or close, type to search) and only accept a value picked from the list. The server also checks that the ward exists and belongs to the province. The phone must be a Vietnamese mobile number (10 digits, `0` or `+84` prefix, saved as `0xxxxxxxxx`). Addresses saved before this change must be edited before the next order.
- Email codes are valid for 3 minutes. The page shows the address the code is sent to, a countdown, and a paste button.
- Invoice emailed automatically (right after a COD order, or after a transfer is received). Customers have no "send invoice" button; only staff, owner and admin can resend it from order management (`POST /orders/:id/invoice-email`, permission `orders.manage`, max 3 per order per hour).
- Shopping assistant chatbot (OpenAI with retrieval); falls back to a knowledge-base lookup when no valid API key is set.
  - It only advises. Requests to do something for the customer (place or cancel an order, pay, refund, change the account or address, apply a voucher, check a balance, haggle) are caught by `backend/server/ai/guard.js` before the AI is called. The bot says it cannot do that and gives the steps and links; an order request also shows the product link, price, stock and the per-order limit. Questions about how to do it ("hủy đơn thế nào?") still get a normal answer.
  - Retrieval covers the Markdown files in `backend/server/ai/kb/` (including `09-huong-dan-su-dung-website.md`, a step-by-step guide to every page) plus live data: products, categories, promotions, store contact and the current rules (fees, limits, deadlines) read from `core/rules.js` and the store settings.
  - Offline mode answers "how to" questions with the matching guide section.

**Back office** (staff, owner, admin)

- Dashboard: revenue by month, quarter or year, inventory, demand, reviews, customer analytics. **Revenue = selling price − cost price** of the delivered items (after discounts; shipping fees are not counted because they go to the carrier); the dashboard also shows "Tiền bán" and "Giá vốn hàng bán" next to it, and the same formula is used for every chart, quarter, category, top product and the per-product panel.
- Orders: confirm, ship, cancel, record payments and refunds, handle cancel requests, send or export invoices (PDF).
- Products and stock: create, edit, import stock, Excel export and import, PDF export, "new product" label and discount settings.
- Cost price (`costPrice`, owner and admin only): every product has a cost (giá vốn / giá nhập) that is required when creating or editing (whole VND, at least 1.000 and not above the selling price; also a "Giá vốn" column in the Excel file, empty = keep the current cost). "Nhập hàng" takes an optional import price for the batch and sets the new cost to the **weighted average** of the stock on hand and the new batch. The cost of each line is copied into the order when it is placed (`items[].cost`), so later cost changes do not rewrite old revenue; orders from before this feature use the product's current cost. Customers and staff never receive the cost (public API, order responses, staff product list). Products from before this feature get an estimate of 70% of the price, marked "(ước tính)" in the admin table until an owner or admin saves the real cost.
- Categories (owner and admin): the "Danh mục" tab on the products page adds a category (2–40 characters, unique, at most 30) or deletes one. Deleting opens a list of the category's products: tick the ones to **hide** along with the category, the rest move to "Chưa có danh mục" (`categoryId: null`) and stay on sale under "Khác" (`?category=none`) on the shop. Nothing is erased. A category voucher drops the deleted category and is switched off when none is left. Category ids are never reused. A product may have no category (also in Excel: empty Danh mục column or "Chưa có danh mục"). API: `POST /api/admin/categories`, `DELETE /api/admin/categories/:id` with `{ "hideProductIds": [...] }`.
- Hidden products (`hidden: true`, owner and admin): the "Ẩn" / "Hiện lại" button on each product row (`PATCH /api/admin/products/:id/visibility`) or the tick list when deleting a category. Customers and the chatbot do not see a hidden product (shop lists, home page, search, cart, favorites, ordering, chat answers), its page returns 404 except for staff and for a customer who already bought it, and existing orders keep working. The admin product table shows an "Đang ẩn" tag (`GET /api/products?all=1`, staff only).
- Per-product sales (owner and admin): delivered units, in-process units and revenue columns in the product table, plus a "Doanh thu" panel with 12-month history (`GET /api/admin/product-sales`).
- Reviews: filter by stars, media or unanswered; reply publicly; delete bad reviews (owner and admin only).
- Vouchers, banners and seasonal events, store information, customer feedback.
- Accounts (admin only): change roles, reset passwords, delete accounts.

## Roles

Permissions are defined once per role in `backend/server/core/permissions.js` (the frontend copy in `frontend/src/js/utils/permissions.js` is checked against it by a test). Every API route is guarded with `requirePermission(...)`.

| Permission | Customer | Staff | Owner | Admin |
|---|:-:|:-:|:-:|:-:|
| Shop, cart, address book, voucher wallet, review, own orders (`customer.purchase`) | yes | | | |
| View and process all orders (`orders.view`, `orders.manage`) | own only | yes | yes | yes |
| Operations stats and stock (`dashboard.operations`, `inventory.view`, `inventory.manage`) | | yes | yes | yes |
| View products and store settings (`products.view`) | | yes | yes | yes |
| View and reply to reviews and feedback (`feedback.viewAll`, `feedback.reply`) | | yes | yes | yes |
| Sales statistics and per-product revenue (`dashboard.sales`) | | | yes | yes |
| Customer analytics (`customers.analytics`) | | | yes | yes |
| Create, edit, delete products (`products.manage`) | | | yes | yes |
| Payments, vouchers, banners and events, store information (`payments.manage`, `vouchers.manage`, `content.manage`) | | | yes | yes |
| Delete reviews and feedback (`feedback.delete`) | | | yes | yes |
| Accounts: change role, reset password, delete (`team.manage`) | | | | yes |

Management accounts (staff, owner, admin) do not shop: cart, address book and voucher wallet are for customers only. An admin cannot change or delete another admin or their own account.

Permissions are enforced on the server. The frontend only hides what a role cannot use.

## Tech stack

| Part | Technology |
|---|---|
| Frontend | HTML5, CSS3, JavaScript (ES Modules), Vite 6, SheetJS (`xlsx`), jsPDF and jsPDF-AutoTable |
| Backend | Node.js 22, Express 4, Nodemailer |
| Storage | JSON file (`db.json`); newline-delimited JSON for analytics |
| Auth | HMAC-SHA256 signed tokens, scrypt password hashing, email codes |
| External services | SMTP (Gmail or a local fake mailbox), SePay (QR payments and webhook), OpenAI (chatbot) |
| Tests | Node built-in test runner (`node:test`) |
| Formatting | Prettier, EditorConfig |

## Project structure

```text
.
├── backend/                  REST API (Node.js + Express)
│   ├── server/               All server source code
│   │   ├── index.js          Entry point: mounts routes, background jobs, daily backup, serves the built website
│   │   ├── core/             Foundation: store (db.json), auth/http helpers, validation rules, mailer, permissions, production config check
│   │   ├── routes/           HTTP endpoints, one file per feature (auth, shop, orders, cart, vouchers, admin...)
│   │   ├── services/         Business logic used by routes (pricing, vouchers, inventory, mail templates, statistics)
│   │   ├── ai/               Chatbot: OpenAI client, retrieval, offline answers
│   │   │   └── kb/           Knowledge base (Markdown) the chatbot searches
│   │   └── data/             Seed data and product specification templates
│   ├── data/                 Runtime data (not committed except db.sample.json)
│   │   ├── db.json           Main database: products, orders, users, vouchers, reviews...
│   │   ├── db.sample.json    Sample data, used automatically when db.json does not exist yet
│   │   ├── analytics.ndjson  Customer behavior events, one JSON per line (kept 90 days)
│   │   ├── uploads/          Files uploaded by users: avatars, banners, products, reviews
│   │   └── backups/          Daily copies of db.json (last 7 kept)
│   ├── scripts/              Helper scripts (fake mailbox, bulk product import, sample accounts)
│   ├── tests/                API tests (node:test) and shared test helpers
│   ├── .env.example          Template for environment variables (copy to .env)
│   └── package.json
│
├── frontend/                 Website (Vite)
│   ├── *.html                One file per page (23 pages: shop pages and admin-* pages)
│   ├── src/
│   │   ├── js/
│   │   │   ├── pages/        One script per page (the page logic)
│   │   │   ├── components/   Reusable UI: header, product card, dialogs/toasts, chat widget, invoice
│   │   │   ├── services/     API client, cart, favorites, catalog, Excel and tracking helpers
│   │   │   ├── utils/        Pure helpers: auth session, formatting, permissions, validation, icons
│   │   │   └── config/       Shop-level constants (labels, delivery options)
│   │   └── static/
│   │       ├── CSS/          main.css, the only stylesheet
│   │       └── IMAGES/       Product photos, backgrounds, seasonal event banners, favicon
│   ├── public/fonts/         Be Vietnam Pro font files, copied as-is to the build
│   ├── vite.config.js        Dev server, proxy for /api and /uploads, list of pages to build
│   └── package.json
│
├── docs/                     SRS, use case, SDS, deploy guide (Word) and diagrams (ERD, use case, architecture)
├── .github/workflows/ci.yml  CI: Prettier check, backend tests, frontend build
├── .editorconfig             Editor settings shared by everyone (4 spaces, LF, UTF-8)
├── .gitattributes            LF line endings on every machine
├── .prettierrc.json          Prettier rules
├── .gitignore
├── ecosystem.config.cjs      PM2 config for running on a VPS
├── package.json              Root: Prettier, and the build/start scripts for deployment
└── *.md                      Documentation
```

How the layers talk to each other: the browser loads a page from `frontend/`, the page script in `src/js/pages/` calls the API through `src/js/services/api-service.js`, Vite forwards `/api` to Express, a file in `backend/server/routes/` handles the request, uses `services/` for business rules and `core/store.js` to read and write `db.json`. In production there is no Vite: Express serves the built pages from `frontend/dist` itself.

## Getting started

Requires Node.js 22 or newer.

```powershell
# Terminal 1: backend, API at http://localhost:3000/api
cd backend
npm install
npm run server   # first run: no db.json yet, so the sample data (data/db.sample.json) is used

# Terminal 2: frontend, website at http://localhost:5173
cd frontend
npm install
npm run dev
```

Open the site through Vite (http://localhost:5173), never port 3000. Vite forwards `/api` and `/uploads` to Express.

The sample data includes one admin account for local testing: `admin` / `Demo@Garden2026`. Customers register on the website. In production the server will not start while a management account still uses this password; set `ADMIN_PASSWORD` to replace it (see [Deployment](#deployment)).

If you see `EADDRINUSE :3000`, an old server is still running: `netstat -ano | findstr :3000`, then `taskkill /PID <PID> /F`.

## Scripts

| Where | Command | Purpose |
|---|---|---|
| `backend/` | `npm run server` (or `npm start`) | Start the API on port 3000 |
| `backend/` | `npm test` | Run the API test suite (uses temporary data, never touches `db.json`) |
| `backend/` | `npm run mail` | Start the fake mailbox (SMTP 1025, web 1080) |
| `frontend/` | `npm run dev` | Start the website on port 5173 |
| `frontend/` | `npm run build` | Production build into `frontend/dist/` |
| root | `npm install` then `npm run format` | Format all JavaScript with Prettier |
| root | `npm run format:check` | Check formatting without changing files |
| root | `npm run build` | Deployment: install, build the frontend, install the backend without dev dependencies |
| root | `npm start` | Deployment: start the server (website + API on one port) |

### Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull request, in three parallel jobs on Node 22:

1. **Định dạng code**: `npm run format:check` at the root.
2. **Test backend**: `npm test` in `backend/`. No secrets needed: the suite uses temporary data, sends no real mail and does not call OpenAI.
3. **Build và chạy thử production**: root `npm run build` (the deploy command), then the server is started with `NODE_ENV=production` and the job checks `/api/health`, the home page, `/products` and `/api/products`.

A pull request shows ✅ or ❌ for each job. Merge only when all three pass.

## Configuration

Environment variables live in `backend/.env` (template: `backend/.env.example`). Never commit `.env`.

| Variable | Meaning |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Send real emails. Without them, email content is printed to the server console. |
| `SEPAY_API_KEY` | SePay webhook key (defaults to `dev-sepay-key` for local testing; required in production) |
| `PAYMENT_DEMO` | `on`/`off`: show the "Thanh toán … (demo)" button on the QR payment page (default: on locally, off when `NODE_ENV=production`) |
| `SEPAY_BANK`, `SEPAY_ACCOUNT`, `SEPAY_ACCOUNT_NAME` | Receiving bank account shown on the QR code |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL` | Chatbot. Without a valid key the chatbot uses the offline knowledge-base mode. With `npm run server` (`server/start.js`), values in `backend/.env` take priority over system environment variables of the same name, so an old system `OPENAI_API_KEY` no longer overrides the project key; the server log names any variable it replaced (names only, never values). Without a `.env` file (deploy), normal environment variables are used. |
| `AUTH_SECRET` | Key used to sign login tokens, at least 32 random characters. Required in production. |
| `NODE_ENV` | `production` on a real server: turns on the startup config check and turns off the demo payment button |
| `ADMIN_PASSWORD` | Production only: replaces the sample password of management accounts that still use it, once. Can be removed afterwards. |
| `TRUST_PROXY` | Proxies in front of the server, used to read the customer's real IP. Default `loopback` (Caddy, Nginx or Cloudflare Tunnel on the same machine); set `1` on Render. |
| `PORT`, `DATA_DIR`, `FRONTEND_DIST` | Port (default 3000), data folder (default `backend/data`), built website folder (default `frontend/dist`) |

The built-in defaults of `AUTH_SECRET` and `SEPAY_API_KEY` are public in the source code. With `NODE_ENV=production` the server refuses to start until both are set; the log says exactly what is missing.

## Data and backups

- Runtime data lives in `backend/data/` (see the structure above).
- When `db.json` does not exist (first run, new server), the server starts from `db.sample.json` and writes `db.json` right away.
- Once a day the server copies `db.json` to `backend/data/backups/db-YYYY-MM-DD.json` and keeps the last 7 copies. If the data is damaged, stop the server and copy a backup over `db.json`.
- `backend/` is outside the Vite root, so the browser cannot download `db.json` or `.env`.
- The server loads `db.json` into memory and overwrites the file on every save. To edit `db.json` by hand or run a script from `backend/scripts/`, stop the server first.
- `db.json`, `analytics.ndjson`, `uploads/` and `backups/` contain customer data and are not committed. `db.sample.json` is the committed sample.

## Back office settings

- **Store information** (hotline, email, address, hours, Facebook and Zalo links): the Store information page.
- **New products and discount**: Products page, section "New products and promotion". The discount is off by default and must last shorter than the "New" label. A product can have its own deadline in the edit form.
- **Excel and PDF**: buttons at the top of the Products page. On import, a row with an ID updates that product (never its stock), a row without an ID creates a product, and products missing from the file are kept.
- **Reviews**: Reviews page. Only owner and admin see the Delete button.
- **Product photos**: Products, Edit, Product photo (stored in `backend/data/uploads/products/`).

Product photos come from Wikimedia Commons; sources and licenses are in [frontend/src/static/IMAGES/NGUON_ANH.md](frontend/src/static/IMAGES/NGUON_ANH.md).

## Testing email and payments locally

Fake mailbox:

```powershell
cd backend
npm run mail   # SMTP on port 1025, read emails at http://localhost:1080
```

In `backend/.env` set `SMTP_HOST=localhost`, `SMTP_PORT=1025`, leave `SMTP_USER` and `SMTP_PASS` empty, then restart the server.

Simulate SePay reporting an incoming transfer (replace the order code and amount):

```powershell
curl.exe -X POST http://localhost:3000/api/payments/sepay/webhook -H "Authorization: Apikey dev-sepay-key" -H "Content-Type: application/json" -d '{\"id\":1001,\"transferType\":\"in\",\"transferAmount\":2250000,\"content\":\"XG261008ABCDE\"}'
```

## Deployment

The app is one Node.js process. It keeps its data in files (`backend/data/`) and runs background jobs every minute (payment timeout, auto receive, backups). It needs a server that runs all the time and keeps its disk.

- **Serverless platforms (Vercel, Netlify Functions) cannot run the backend**: their file system is temporary and nothing runs between requests. Vercel can host the built frontend alone, but the backend still needs a server.
- In production Express serves the built website (`frontend/dist`) and the API on the same address, so one process and one port is enough.
- Step-by-step guide in Vietnamese, with the settings to choose at each step and a troubleshooting table: `docs/HUONG_DAN_DEPLOY.docx` (Azure for Students VM, or own computer + Cloudflare Tunnel).

### Checklist

1. At the root: `npm run build`.
2. Create `backend/.env` from `backend/.env.example` and set at least `NODE_ENV=production`, `AUTH_SECRET`, `SEPAY_API_KEY`, `ADMIN_PASSWORD` (first start), and the `SMTP_*` values. Use `SMTP_PORT=587` where port 465 is blocked.
3. `npm start`, or PM2 on a VPS. If something required is missing, the server stops and lists it.
4. Open `https://<domain>/api/health`, which should answer `{"ok":true,...}`.
5. In SePay, set the webhook to `https://<domain>/api/payments/sepay/webhook` with the same API key.
6. To keep current data instead of the sample, copy your `db.json` and `uploads/` into `backend/data/` before the first start.

### Option A: VPS (recommended)

Ubuntu with Node.js 22, PM2 and Caddy (automatic HTTPS):

```bash
git clone https://github.com/Thanhtan1208/xanh-garden.git && cd xanh-garden
npm run build
cp backend/.env.example backend/.env   # then fill it in
sudo npm install -g pm2
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

`/etc/caddy/Caddyfile` (point the domain's DNS to the server first):

```text
shop.example.com {
    encode zstd gzip
    reverse_proxy localhost:3000
}
```

Update: `git pull && npm run build && pm2 restart xanh-garden`. Copy `backend/data/` off the server from time to time: the daily backups stay on the same disk.

### Option B: own computer + Cloudflare Tunnel (free, demo only)

Build, start the server with the production `.env`, then run `cloudflared tunnel --url http://localhost:3000`. It prints a temporary `https://….trycloudflare.com` address. The site is online only while the computer and the tunnel are running, and the address changes on every run.

### Option C: Render (paid)

Web Service on Node, build command `npm run build`, start command `npm start`. Add a Disk (for example mounted at `/var/data`), set `DATA_DIR=/var/data` and `TRUST_PROXY=1`, plus the variables from the checklist. The free instance type does not work: it has no disk, sleeps when idle and blocks SMTP.

## Code style

- 4-space indentation, single quotes, no trailing commas, line width 140 (see `.editorconfig` and `.prettierrc.json`).
- Comments use `//` and stay short.
- Run `npm run format` at the root before committing.

## Known limits

- One server process only: data is held in memory and the whole file is rewritten on every save. Fine for a small shop, not for heavy traffic.
- Cannot run on serverless platforms (Vercel, Netlify Functions): it needs a server that runs all the time and a disk that keeps `db.json` and uploads.
- SePay can only call the webhook when the backend has a public address.
- Login hashing (scrypt) runs on the main thread, so very many simultaneous logins slow the server.

## Change log

Newest first. Add a line here with every change.

| Date | Change |
|---|---|
| 2026-11-16 | Cost price and the new revenue formula. Products now have a required cost price (`costPrice`) in the form, Excel (column "Giá vốn") and "Nhập hàng" (batch import price, weighted-average cost). Revenue in every statistic is now **selling price − cost price** (was the full amount the customer paid, shipping included): dashboard hero shows revenue, "Tiền bán" and "Giá vốn hàng bán"; top products, categories, per-product sales and the Excel report follow the same formula. Order lines keep the cost at order time; old orders and old products use the current/estimated cost (70% of price, flagged "ước tính"). The cost is never sent to customers or staff. 12 new tests (198 in total). |
| 2026-11-16 | Categories can be added and deleted (new "Danh mục" tab on the admin products page, `POST/DELETE /api/admin/categories`). Deleting a category lists its products so the admin ticks which ones to hide (not erased: orders and data stay); the others move to "Chưa có danh mục" and stay on sale under "Khác" on the shop. New hidden-product feature: `hidden` flag, "Ẩn" / "Hiện lại" buttons and an "Đang ẩn" tag in the admin table (`PATCH /api/admin/products/:id/visibility`); hidden products are removed from the shop lists, home page, cart, favorites, ordering and chatbot. An old `?category=` link to a deleted category falls back to all products, category vouchers drop the deleted category (and are switched off if none is left). Products and Excel rows may have no category. New categories use the first product's photo on the home page. An Excel import row that is not an object is now rejected with a clear message. 17 new tests (186 in total). |
| 2026-11-15 | Phone layout fixes found on a real phone: the red count badges on the heart and cart icons covered the icons (badge is now 18 px and anchored to the top-right corner of the icon); the floating chat button covered prices and totals (on phones it slides away while scrolling down and returns when scrolling up or at the top of the page). |
| 2026-11-15 | Deploy guide in Vietnamese (`docs/HUONG_DAN_DEPLOY.docx`): Azure for Students VM step by step (create VM, free domain name, Node/Caddy/PM2, `.env`, copying data, HTTPS, checks, SePay), own computer + Cloudflare Tunnel for demos, daily operations, troubleshooting, security notes. |
| 2026-11-15 | Ready for deployment. In production Express serves the built website and the API on one port. Added `GET /api/health`, basic security headers, and the customer's real IP behind a proxy (`TRUST_PROXY`), so chat and tracking limits count each customer separately. With `NODE_ENV=production` the server refuses to start without `AUTH_SECRET` and `SEPAY_API_KEY`, or while a management account still uses the sample password (`ADMIN_PASSWORD` replaces it once). The first run uses `db.sample.json` when `db.json` is missing. The server shuts down gracefully. Added root `npm run build` / `npm start`, a PM2 config and a Deployment section. CI now builds with the deploy command and test-starts the server in production mode. 12 new tests (169 in total). SRS 2.1. |
| 2026-11-15 | `.gitattributes`: LF line endings on every machine, so the Prettier check also passes on Windows with `core.autocrlf=true`. |
| 2026-11-15 | CI with GitHub Actions (`.github/workflows/ci.yml`): Prettier check, backend tests and frontend build on every push to `main` and every pull request. |
| 2026-11-15 | SRS rewritten (`docs/SRS_XANH_GARDEN.docx`) to match the current features, business rules and API. |
| 2026-11-15 | UI review fixes: saved addresses in the old format (no province/ward or a wrong phone) show a red note in Checkout and Account, and placing an order with one opens the edit form instead of an error from the server; voucher cards in "Voucher của bạn" no longer show "Còn x lượt nhận"; order action buttons fill the width on mobile; product card meta has no stray "·" on narrow screens. Block comments in JS changed to `//`. |
| 2026-11-15 | Search box only on the products page (header of `products.html`, also the mobile search button); other pages no longer show it. Knowledge base updated. |
| 2026-11-15 | Chatbot follow-ups: questions about the bot ("bạn là ai", "dùng model AI nào") get a fixed answer (`aboutBotReply` in `ai/guard.js`; names the OpenAI model or says offline mode). Short follow-ups ("giá bao nhiêu", "còn hàng không") use the product being discussed (`topicProduct`: last customer message or the latest reply with one product link; also told to the AI); after a list of several products the bot asks which one. Offline mode: whole-word matching (no more "ai" matching "tài khoản" or "giá" matching "Đánh giá"), "để bàn" counts as low light, "giá rẻ" sorts by price, vague requests get easy plants plus a question, "có X không" for items not sold says so and lists categories. AI prompt: indoor/desk plants prefer shade-tolerant ones; price and stock are always looked up. 1 new test. |
| 2026-11-15 | Voucher page merged into one page: the "Kho voucher" and "Ví của tôi" tabs are gone; the page lists "Voucher của bạn", "Voucher có thể nhận" (already claimed ones are no longer repeated) and a collapsed "Đã dùng / hết hạn". One name everywhere: menu, footer, account menu and home tile say "Voucher" (were "Khuyến mãi", "Ví voucher", "Chương trình khuyến mãi"). Checkout, admin hints, birthday email, chatbot replies and knowledge base updated; KB no longer says the birthday can only be set once. |
| 2026-11-15 | Chatbot: action requests ("lập cho tôi đơn 20 cây…", "tra số dư", "hủy đơn giúp mình") are refused with steps and links by a new rule check (`ai/guard.js`) that runs before the AI. Knowledge base: new website guide (`kb/09`), live store contact and rule chunks, and corrections (cancel rules, 7-day auto receive, invoice, per-item reviews, "Mới" = 30 days). Offline mode answers "how to" questions from the guide. 2 new tests. |
| 2026-11-15 | Shop simplified. Top menu: removed the "Danh mục" dropdown (it opened the same products page; categories stay in the products page's left column, on the home page and in breadcrumbs). Products page: removed the "Lọc theo tên cây" box (same as the header search), "Chỉ hiện còn hàng" (only 6 sold-out items, already listed last), the "Tên A – Z" sort, the icon-only grid/list switch and the generic intro text; sorting is now a row of buttons; "Xóa bộ lọc" shows only when a filter is on; "Đang giảm giá" has its own chip. Product page: removed the internal "Mã SP". Bigger buttons: "Thêm vào giỏ" on cards, "Thêm vào giỏ"/"Mua ngay", cart quantity buttons, filter rows, page numbers; checkout button is orange like "Mua hàng". My orders: "Xem chi tiết" and "Mua lại" are text buttons (were icons only); main actions (Thanh toán ngay, Đã nhận được hàng, Đánh giá, Mua lại, Hủy đơn) are normal size and grouped on the right. |
| 2026-11-15 | README: 15 change log rows from 14–15/11 had been added to the "Tech stack" table by mistake; moved here (newest first). |
| 2026-11-15 | Order flow like Shopee/TikTok Shop. Cart: a checkbox per item and "Chọn tất cả"; the summary counts only checked items and the button is "Mua hàng (N)"; checkout takes only checked items and only those leave the cart after ordering. "Mua ngay" (product page) and "Mua lại" (my orders) check only their items. "Đơn hàng của tôi": "Đã nhận được hàng" button on shipping orders (the customer may move shipping to delivered), auto-confirmed 7 days after shipping starts (`AUTO_RECEIVE_DAYS`, date shown on the card as `autoReceiveAt`); delivery marks COD as paid and sends the thank-you email (`markDelivered`); per-product "Đánh giá" buttons open the review tab; the timeline shows the time of each step; the "Chờ thanh toán" tab also lists unpaid QR orders. Tests: customer confirms receipt, auto-confirm after 8 days. |
| 2026-11-15 | Voucher page: gifted vouchers (new customer, birthday) go straight into the wallet and were not visible in "Kho voucher", so customers thought they had none. "Kho voucher" now starts with a "Quà tặng cho bạn" section listing them ("Trong ví", "Dùng ngay"), and the "Ví của tôi" tab shows how many vouchers are usable. Admin hint for new-customer and birthday vouchers explains this; the outdated "birthday can only be set once" text was fixed. |
| 2026-11-14 | Chatbot: `npm run server` now starts `server/start.js`, which loads `backend/.env` with priority over system variables (an old, rejected system `OPENAI_API_KEY` had silently forced offline mode). Prompt rule: only suggest products returned by the tools, with link and exact price, never estimated prices. Offline mode: "ít nắng" questions no longer suggest sun-loving plants ("nắng nhẹ" was matched as low light), and off-topic questions no longer get an unrelated knowledge-base excerpt. |
| 2026-11-14 | Address form: the red * now sits on the same line as the label; when the province list cannot be loaded, clicking or typing in the province box opens a dropdown that explains the error and says to restart the server. |
| 2026-11-14 | Invoice email button removed from "Đơn hàng của tôi"; `POST /orders/:id/invoice-email` now requires `orders.manage` (staff, owner, admin). Customers still get the invoice automatically when the order is placed (COD) or paid (QR). |
| 2026-11-14 | QR payment page: the demo button is now a large "Thanh toán <amount> (demo)" button right under the QR code (was a small button below the instructions). |
| 2026-11-14 | Province box shows "Không tải được danh sách tỉnh/thành" in red when `GET /api/divisions` fails (for example a server started before this API existed) instead of silently giving no suggestions. |
| 2026-11-14 | Address now requires province, ward and house number: red * on required fields, browser check outlines missing boxes in red, province/ward boxes styled as searchable dropdowns; server `addressProblem` also blocks orders whose saved address has no house number. |
| 2026-11-14 | Address form split back into two boxes: pick Province/City first, then Ward/Commune suggested from that province only (locked until a province is chosen); house number and street moved below. |
| 2026-11-14 | Ward and province merged into one TikTok-style search box "Phường/Xã, Tỉnh/Thành phố": suggestions while typing (provinces and wards, matching letters in bold, accents optional, aliases such as hcm), pick a province to narrow to its wards, or type "ward, province". |
| 2026-11-14 | Address switched to the current administrative units (34 provinces, 3,321 wards, no district since 1/7/2025). Field order: house number/street, ward, province. Ward and province are search boxes with filtering (`components/division-select.js`); a ward pick fills the province. Saved address line: "street, ward, province". Old addresses (with district or without ward) are blocked at checkout until edited. |
| 2026-11-14 | Tests: new-user voucher `WELCOME15` is checked end to end (in wallet after verification, discount applied on the first order, marked used). |
| 2026-11-14 | QR payment: button "Đã chuyển khoản (demo)" on the payment page marks the order as paid like a SePay webhook (`POST /orders/:id/demo-pay`, owner only). On by default on a local machine, off when `NODE_ENV=production`; set `PAYMENT_DEMO=on` or `off` to choose. |
| 2026-11-14 | Profile: every role (customer, staff, owner, admin) can edit own username (the account name) and birth date and change the avatar on `account.html` (management roles see only the profile and password tabs; the admin top bar links to it). New API `PATCH /auth/profile`; username must stay unique, email and role cannot be changed there. Birth date can now be changed freely; a birthday voucher is still given once per year. |
| 2026-11-14 | Order emails: the invoice was already sent automatically (COD right after ordering, QR after the payment is recorded, including the demo button). New: a thank-you email when the order becomes "delivered" (`sendThanksMail` in `backend/server/services/order-mail.js`), sent once per order (`thanksSent`), with an invitation to review the products. Without `SMTP_*` settings the emails are printed in the server console. |
| 2026-11-14 | Address form like TikTok Shop: Province/City, District and Ward are linked dropdowns (required); house number and street are free text. Replaces the old rule that checked the address text for a house number and keywords. Saved addresses now keep `street`, `province`, `district`, `ward` and a joined `address` line. Code: `components/division-select.js`, `locationProblem` in `backend/server/core/address.js`. |
| 2026-11-14 | Vouchers: a new-user or birthday voucher is now given right after the admin saves it (before, customers waited up to 10 minutes); the toast says how many customers got it. Admin voucher page: field hints in plain words, a "Khách sẽ thấy" summary with warnings (program under 1 day, discount not smaller than the minimum order), and new columns "Đã dùng" (orders) and "Tiền đã giảm". Wallet shows "Sắp hết hạn: còn N ngày" when 3 days or less are left. Code: `grantNow` and `voucherRow` in `backend/server/routes/admin-content.js`. |
| 2026-11-12 | Statistics tables: clearer column names, e.g. "Doanh thu T11/2026", "Số đơn T11/2026", "Doanh thu T10/2026" instead of bare "T11/2026" and "T10/2026" (also in the Excel export). |
| 2026-11-12 | Tables: click a column name to sort ascending, click again for descending (arrow shows the direction). Understands dates (12/11/2026, 14:56 5/11/26), numbers and money (16.595.000 ₫, 45%) and text with numbers (Tháng 2 before Tháng 10). Code: `frontend/src/js/components/table-sort.js`; add `data-no-sort` to a table to turn it off. |
| 2026-11-12 | Statistics: filter by day and by week (Monday to Sunday), with a date picker. Day shows revenue by hour, week shows revenue by day, both compared with the previous day or week; Excel export follows the filter. |
| 2026-11-12 | Products page: two tabs, "Danh sách sản phẩm" and "Thêm sản phẩm" (the add form is no longer above the list). "Sửa" opens the form tab titled "Sửa sản phẩm"; saving or cancelling returns to the list. |
| 2026-11-12 | Products page: a failed load of per-product revenue now shows an error toast instead of silently showing "—" (it happened when the server still ran old code without `/admin/product-sales`). |
| 2026-11-12 | Admin tables (orders, products, accounts, vouchers, events, banners): view switch like the product page, "Dạng bảng" (header row stays pinned while scrolling the rows) or "Dạng thẻ" (one card per row). The choice is remembered per table. Shared code: `frontend/src/js/components/table-view.js`, enabled with `data-view-key` on a `.table-wrap`. |
| 2026-11-12 | Permissions standardized: account management now uses the `team.manage` permission (was a hard-coded admin check), the admin-only frontend helper was removed, and new tests check the frontend table against the backend and every role against 19 API routes. README roles table rewritten. |
| 2026-11-12 | Delivery address and phone rules: Vietnamese mobile number only (the address part was replaced on 2026-11-14 by dropdowns). Applies when saving an address and when placing an order. |
| 2026-11-12 | Tables: the header row (column names) stays visible while scrolling; long tables scroll inside their own frame (max 70% of the screen height). |
| 2026-11-12 | Statistics page: "Biểu đồ / Bảng" switch. Only one form is shown at a time: chart mode hides the tables, table mode hides the charts and shows every data table (choice is remembered in the browser). |
| 2026-11-12 | Admin "Đặt lại mật khẩu": the dialog showing the new password now has a "Sao chép" (copy) button. The dialog helper supports a copy button on any row. |
| 2026-11-12 | Fix: restored banner images (`IMAGES/events/*.svg`) and `bg/bg1.jpg` that were deleted by mistake. They are looked up by short name (`tet`, `noel`, `bg1`), not by full file name. |
| 2026-11-12 | Dashboard: "Cần cải thiện" list has a fixed height with its own scrollbar. |
| 2026-11-12 | Admin tables: larger text. Products page: delivered units and revenue per product, with a 12-month panel (`GET /api/admin/product-sales`). |
| 2026-11-12 | Documentation reduced to this README plus Word files in `docs/` (SRS, use cases, SDS, ERD, code guide). |
| 2026-11-11 | Cleanup before publishing: removed unused files, removed a broken record from the local `db.json`. First push of the `backend/` and `frontend/` layout to GitHub. |
| 2026-11 | Reviews with an admin Reviews page, email codes (3 minutes) with a copy button, Prettier and EditorConfig, SRS/use case/SDS/ERD documents. |
