// Dọn dữ liệu thử trước khi bán thật: giữ danh mục, sản phẩm, banner, sự kiện, voucher, cài đặt cửa hàng và tài khoản admin;
// xóa khách, nhân viên/chủ thử, đơn, đánh giá, góp ý, giỏ, chat, nhật ký kho, ảnh khách tải lên.
// Chạy khi server ĐÃ TẮT: npm run reset-data -- --yes   (bản cũ được sao lưu vào data/backups trước khi xóa)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(import.meta.dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'db.json');

if (!process.argv.includes('--yes')) {
    console.log('Lệnh này xóa toàn bộ khách, đơn hàng, đánh giá, giỏ, chat thử. Tắt server rồi chạy: npm run reset-data -- --yes');
    process.exit(1);
}
if (!existsSync(DB_PATH)) {
    console.error(`Không thấy ${DB_PATH}`);
    process.exit(1);
}

// sao lưu trước khi xóa
const backupDir = join(DATA_DIR, 'backups');
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `db-truoc-khi-don-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
copyFileSync(DB_PATH, backup);

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const admins = db.user.filter((user) => user.role === 'admin');
if (!admins.length) {
    console.error('Không có tài khoản admin nào, dừng lại để không bị khóa ngoài hệ thống.');
    process.exit(1);
}
const removed = {
    'tài khoản': db.user.length - admins.length,
    'đơn hàng': db.orders.length,
    'đánh giá': db.reviews.length,
    'góp ý': db.feedbacks.length,
    'cuộc chat': db.chats.length
};

db.user = admins.map((user) => ({ ...user, addresses: [] }));
for (const key of ['orders', 'reviews', 'feedbacks', 'payments', 'uploads', 'stockLogs', 'userVouchers', 'carts', 'chats']) db[key] = [];
db.settings = { ...db.settings, lastInvoiceNo: 0 }; // số phiếu bán hàng bắt đầu lại từ 00000001
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// nhật ký hành vi và ảnh/video khách tải lên (giữ ảnh sản phẩm, banner, avatar)
rmSync(join(DATA_DIR, 'analytics.ndjson'), { force: true });
rmSync(join(DATA_DIR, 'uploads', 'reviews'), { recursive: true, force: true });

console.log(`Đã sao lưu bản cũ: ${backup}`);
console.log(
    'Đã xóa:',
    Object.entries(removed)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ')
);
console.log(
    `Giữ lại: ${db.products.length} sản phẩm, ${db.categories.length} danh mục, tài khoản ${admins.map((user) => user.name).join(', ')}`
);
const estimated = db.products.filter((product) => product.costEstimated).length;
if (estimated) console.log(`Lưu ý: ${estimated} sản phẩm còn giá vốn ước tính 70%, nhập giá vốn thật ở Admin > Sản phẩm.`);
