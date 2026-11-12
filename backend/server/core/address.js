// Quy tắc số điện thoại và địa chỉ giao hàng (Việt Nam).

// Bỏ dấu, chữ thường: "Hồ Chí Minh" -> "ho chi minh"
const plain = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd');

// Số di động Việt Nam: 03x, 05x, 07x, 08x, 09x (10 số), viết 0xxxxxxxxx hoặc +84xxxxxxxxx
const MOBILE_PATTERN = /^(?:0|\+?84)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;

// Trả về số dạng 0xxxxxxxxx, hoặc null nếu không phải số di động Việt Nam
export function normalizePhone(value) {
    const raw = String(value || '').replace(/[\s.-]/g, '');
    const match = raw.match(MOBILE_PATTERN);
    return match ? `0${raw.slice(raw.length - 9)}` : null;
}

// 63 tỉnh/thành (đã bỏ dấu) và vài cách viết tắt hay gặp
const PROVINCES = [
    'ha noi',
    'ho chi minh',
    'hcm',
    'tphcm',
    'sai gon',
    'hai phong',
    'da nang',
    'can tho',
    'hue',
    'thua thien hue',
    'an giang',
    'ba ria',
    'vung tau',
    'bac giang',
    'bac kan',
    'bac lieu',
    'bac ninh',
    'ben tre',
    'binh dinh',
    'binh duong',
    'binh phuoc',
    'binh thuan',
    'ca mau',
    'cao bang',
    'dak lak',
    'dak nong',
    'dien bien',
    'dong nai',
    'dong thap',
    'gia lai',
    'ha giang',
    'ha nam',
    'ha tinh',
    'hai duong',
    'hau giang',
    'hoa binh',
    'hung yen',
    'khanh hoa',
    'kien giang',
    'kon tum',
    'lai chau',
    'lam dong',
    'lang son',
    'lao cai',
    'long an',
    'nam dinh',
    'nghe an',
    'ninh binh',
    'ninh thuan',
    'phu tho',
    'phu yen',
    'quang binh',
    'quang nam',
    'quang ngai',
    'quang ninh',
    'quang tri',
    'soc trang',
    'son la',
    'tay ninh',
    'thai binh',
    'thai nguyen',
    'thanh hoa',
    'tien giang',
    'tra vinh',
    'tuyen quang',
    'vinh long',
    'vinh phuc',
    'yen bai'
];

// Có từ khóa đơn vị hành chính (phường, xã, quận...) đứng riêng và có tên theo sau
const hasUnit = (text, words) => new RegExp(`(^|[\\s,])(${words})\\s*\\S`).test(text);

// Trả về câu báo lỗi, hoặc null nếu địa chỉ đủ: số nhà, phường/xã (hoặc quận/huyện), tỉnh/thành phố
export function addressProblem(value) {
    const text = plain(value);
    const missing = [];
    // Phần đầu (trước dấu phẩy đầu tiên) phải có số nhà
    if (!/\d/.test(text.split(',')[0])) missing.push('số nhà');
    if (!hasUnit(text, 'phuong|xa|thi tran|p\\.|x\\.|tt\\.|quan|huyen|thi xa|q\\.|h\\.|tx\\.'))
        missing.push('phường/xã/thị trấn hoặc quận/huyện');
    const padded = ` ${text.replace(/[.,]/g, ' ')} `;
    if (!PROVINCES.some((name) => padded.includes(` ${name} `))) missing.push('tỉnh/thành phố');
    if (!missing.length) return null;
    return `Địa chỉ chưa đủ, còn thiếu: ${missing.join(', ')}. VD: 12 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh.`;
}
