// Ảnh nằm trong src/static/IMAGES (và IMAGES/bg); Vite gắn hash và đường dẫn đúng cho cả dev lẫn build.
// Tra theo tên file (không phân biệt đuôi) nên p1.png, p1.svg hay "p1" đều khớp.
const files = import.meta.glob('/src/static/IMAGES/**/*.{png,jpg,jpeg,webp,svg}', { eager: true, query: '?url', import: 'default' });

const imagesByName = Object.fromEntries(Object.entries(files).map(([path, url]) => [
    path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase(),
    url
]));

const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#eceee9"/>' +
    '<text x="200" y="208" font-family="sans-serif" font-size="20" fill="#8a918b" text-anchor="middle">Chưa có ảnh</text></svg>'
);

const nameOf = (path) => String(path || '').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();

// Ảnh admin tải lên (/uploads/products/..., /uploads/banners/...) dùng nguyên đường dẫn; còn lại tra theo tên ảnh có sẵn.
export function productImage(path) {
    if (/^\/uploads\/(products|banners)\/[\w.-]+$/.test(String(path || ''))) return path;
    return imagesByName[nameOf(path)] || PLACEHOLDER;
}

export const bannerImage = productImage;

// Ảnh chụp thật tại vườn (src/static/IMAGES/bg): dùng cho banner mặc định và mục "Hình ảnh thực tế".
export const gardenPhoto = (index) => imagesByName[`bg${index}`] || PLACEHOLDER;
