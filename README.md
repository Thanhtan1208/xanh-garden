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
11. [Code style](#code-style)
12. [Known limits](#known-limits)
13. [Change log](#change-log)

## Features

**Customers**

- Browse, search and filter products; product detail pages; favorites; shopping cart saved per account.
- Checkout with saved addresses, vouchers and two payment methods: cash on delivery (COD) and QR bank transfer through SePay.
- Order tracking; cancel directly before the shop confirms, or send a cancel request afterwards.
- Reviews with photos and videos (only after receiving the product). A customer can hide ("Close") their own review but cannot delete it.
- Voucher wallet, new-user and birthday vouchers, feedback form.
- Account: profile, avatar upload, address book, change password with an email code, forgot password.
- Delivery address rules (checked by the server in `backend/server/core/address.js`): the phone must be a Vietnamese mobile number (10 digits, `0` or `+84` prefix, saved as `0xxxxxxxxx`); the address must contain a house number, a ward/commune/town or a district, and a province/city. Addresses saved before these rules must be corrected before the next order.
- Email codes are valid for 3 minutes. The page shows the address the code is sent to, a countdown, and a paste button.
- Invoice emailed automatically (right after a COD order, or after a transfer is received).
- Shopping assistant chatbot (OpenAI with retrieval); falls back to a knowledge-base lookup when no valid API key is set.

**Back office** (staff, owner, admin)

- Dashboard: revenue by month, quarter or year, inventory, demand, reviews, customer analytics.
- Orders: confirm, ship, cancel, record payments and refunds, handle cancel requests, send or export invoices (PDF).
- Products and stock: create, edit, import stock, Excel export and import, PDF export, "new product" label and discount settings.
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
│   │   ├── index.js          Entry point: mounts routes, background jobs, daily backup
│   │   ├── core/             Foundation: store (db.json), auth/http helpers, validation rules, mailer, permissions
│   │   ├── routes/           HTTP endpoints, one file per feature (auth, shop, orders, cart, vouchers, admin...)
│   │   ├── services/         Business logic used by routes (pricing, vouchers, inventory, mail templates, statistics)
│   │   ├── ai/               Chatbot: OpenAI client, retrieval, offline answers
│   │   │   └── kb/           Knowledge base (Markdown) the chatbot searches
│   │   └── data/             Seed data and product specification templates
│   ├── data/                 Runtime data (not committed except db.sample.json)
│   │   ├── db.json           Main database: products, orders, users, vouchers, reviews...
│   │   ├── db.sample.json    Sample data, copied to db.json on first run
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
├── docs/                     SRS, use case, SDS (Word) and diagrams (ERD, use case, architecture)
├── .editorconfig             Editor settings shared by everyone (4 spaces, LF, UTF-8)
├── .prettierrc.json          Prettier rules
├── .gitignore
├── package.json              Root only holds the formatting tool (Prettier)
└── *.md                      Documentation
```

How the layers talk to each other: the browser loads a page from `frontend/`, the page script in `src/js/pages/` calls the API through `src/js/services/api-service.js`, Vite forwards `/api` to Express, a file in `backend/server/routes/` handles the request, uses `services/` for business rules and `core/store.js` to read and write `db.json`.

## Getting started

Requires Node.js 22 or newer.

```powershell
# Terminal 1: backend, API at http://localhost:3000/api
cd backend
npm install
Copy-Item data/db.sample.json data/db.json   # first run only: creates the sample data
npm run server

# Terminal 2: frontend, website at http://localhost:5173
cd frontend
npm install
npm run dev
```

Open the site through Vite (http://localhost:5173), never port 3000. Vite forwards `/api` and `/uploads` to Express.

The sample data includes one admin account for local testing: `admin` / `Demo@Garden2026`. Customers register on the website. Change or remove this account before any real deployment.

If you see `EADDRINUSE :3000`, an old server is still running: `netstat -ano | findstr :3000`, then `taskkill /PID <PID> /F`.

## Scripts

| Where | Command | Purpose |
|---|---|---|
| `backend/` | `npm run server` | Start the API on port 3000 |
| `backend/` | `npm test` | Run the API test suite (uses temporary data, never touches `db.json`) |
| `backend/` | `npm run mail` | Start the fake mailbox (SMTP 1025, web 1080) |
| `frontend/` | `npm run dev` | Start the website on port 5173 |
| `frontend/` | `npm run build` | Production build into `frontend/dist/` |
| root | `npm install` then `npm run format` | Format all JavaScript with Prettier |
| root | `npm run format:check` | Check formatting without changing files |

## Configuration

Environment variables live in `backend/.env` (template: `backend/.env.example`). Never commit `.env`.

| Variable | Meaning |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Send real emails. Without them, email content is printed to the server console. |
| `SEPAY_API_KEY` | SePay webhook key (defaults to `dev-sepay-key` for local testing) |
| `SEPAY_BANK`, `SEPAY_ACCOUNT`, `SEPAY_ACCOUNT_NAME` | Receiving bank account shown on the QR code |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBED_MODEL` | Chatbot. Without a valid key the chatbot uses the offline knowledge-base mode. A system environment variable takes priority over `.env`. |
| `AUTH_SECRET` | Key used to sign login tokens. Required in any real deployment. |

Before deploying, set your own `AUTH_SECRET` and `SEPAY_API_KEY`: the built-in defaults are public in the source code.

## Data and backups

- Runtime data lives in `backend/data/` (see the structure above).
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

## Code style

- 4-space indentation, single quotes, no trailing commas, line width 140 (see `.editorconfig` and `.prettierrc.json`).
- Comments use `//` and stay short.
- Run `npm run format` at the root before committing.

## Known limits

- One server process only: data is held in memory and the whole file is rewritten on every save. Fine for a small shop, not for heavy traffic.
- The production build must be served by a web server that also forwards `/api` and `/uploads` to the backend. Express does not serve the website.
- SePay can only call the webhook when the backend has a public address.
- Login hashing (scrypt) runs on the main thread, so very many simultaneous logins slow the server.

## Change log

Newest first. Add a line here with every change.

| Date | Change |
|---|---|
| 2026-11-12 | Statistics: filter by day and by week (Monday to Sunday), with a date picker. Day shows revenue by hour, week shows revenue by day, both compared with the previous day or week; Excel export follows the filter. |
| 2026-11-12 | Products page: two tabs, "Danh sách sản phẩm" and "Thêm sản phẩm" (the add form is no longer above the list). "Sửa" opens the form tab titled "Sửa sản phẩm"; saving or cancelling returns to the list. |
| 2026-11-12 | Products page: a failed load of per-product revenue now shows an error toast instead of silently showing "—" (it happened when the server still ran old code without `/admin/product-sales`). |
| 2026-11-12 | Admin tables (orders, products, accounts, vouchers, events, banners): view switch like the product page, "Dạng bảng" (header row stays pinned while scrolling the rows) or "Dạng thẻ" (one card per row). The choice is remembered per table. Shared code: `frontend/src/js/components/table-view.js`, enabled with `data-view-key` on a `.table-wrap`. |
| 2026-11-12 | Permissions standardized: account management now uses the `team.manage` permission (was a hard-coded admin check), the admin-only frontend helper was removed, and new tests check the frontend table against the backend and every role against 19 API routes. README roles table rewritten. |
| 2026-11-12 | Delivery address and phone rules: Vietnamese mobile number only; address needs house number, ward/commune or district, and province. Applies when saving an address and when placing an order. |
| 2026-11-12 | Tables: the header row (column names) stays visible while scrolling; long tables scroll inside their own frame (max 70% of the screen height). |
| 2026-11-12 | Statistics page: "Biểu đồ / Bảng" switch. Only one form is shown at a time: chart mode hides the tables, table mode hides the charts and shows every data table (choice is remembered in the browser). |
| 2026-11-12 | Admin "Đặt lại mật khẩu": the dialog showing the new password now has a "Sao chép" (copy) button. The dialog helper supports a copy button on any row. |
| 2026-11-12 | Fix: restored banner images (`IMAGES/events/*.svg`) and `bg/bg1.jpg` that were deleted by mistake. They are looked up by short name (`tet`, `noel`, `bg1`), not by full file name. |
| 2026-11-12 | Dashboard: "Cần cải thiện" list has a fixed height with its own scrollbar. |
| 2026-11-12 | Admin tables: larger text. Products page: delivered units and revenue per product, with a 12-month panel (`GET /api/admin/product-sales`). |
| 2026-11-12 | Documentation reduced to this README plus Word files in `docs/` (SRS, use cases, SDS, ERD, code guide). |
| 2026-11-11 | Cleanup before publishing: removed unused files, removed a broken record from the local `db.json`. First push of the `backend/` and `frontend/` layout to GitHub. |
| 2026-11 | Reviews with an admin Reviews page, email codes (3 minutes) with a copy button, Prettier and EditorConfig, SRS/use case/SDS/ERD documents. |
