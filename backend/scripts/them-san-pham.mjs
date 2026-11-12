// Thêm hàng loạt sản phẩm từ san-pham-them.json vào db.json. Chỉ chạy khi server ĐÃ TẮT, vì server giữ dữ liệu trong RAM và sẽ ghi đè db.json.
// Cách chạy: node scripts/them-san-pham.mjs (sản phẩm trùng tên thì bỏ qua nên chạy lại nhiều lần vẫn an toàn)
import { existsSync, readFileSync } from 'node:fs';
import { db, newId, save } from '../server/core/store.js';
import { parseProduct } from '../server/core/rules.js';
import { logStock } from '../server/services/inventory.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const items = JSON.parse(readFileSync(new URL('./san-pham-them.json', import.meta.url), 'utf8'));
const imageFile = (name) => new URL(`../../frontend/src/static/IMAGES/${name}`, import.meta.url);

// Kiểm tra trước cả danh sách, có lỗi thì dừng và không lưu gì
for (const item of items) {
    const category = db.categories.find((row) => Number(row.id) === item.categoryId);
    const stop = (message) => {
        throw new Error(`${item.name}: ${message}`);
    };
    if (!category) stop('không có danh mục này');
    if (!existsSync(imageFile(item.image))) stop(`không có file ảnh ${item.image}`);
    // parseProduct sẽ âm thầm bỏ thông số sai tên nên phải kiểm tra ở đây
    (category.specFields || []).forEach(({ key }) => {
        if (!item.specs?.[key]) stop(`thiếu thông số ${key}`);
    });
    if (item.categoryId !== 5 && !item.care?.length) stop('thiếu hướng dẫn chăm sóc');
}

let added = 0;
for (const item of items) {
    if (db.products.some((product) => product.name.toLowerCase() === item.name.toLowerCase())) continue;
    const createdAt = new Date(Date.now() - item.daysAgo * DAY_MS).toISOString();
    const product = { id: newId(), ...parseProduct(item, db.categories), care: item.care || [], createdAt };
    db.products.push(product);
    const log = logStock(product, 'import', product.stock, { note: 'Nhập lần đầu khi tạo sản phẩm', by: 'system' });
    if (log) {
        log.createdAt = createdAt;
        product.lastImportedAt = createdAt;
    }
    added += 1;
}
save();
console.log(`Đã thêm ${added} sản phẩm, tổng cộng ${db.products.length} sản phẩm.`);
process.exit(0);
