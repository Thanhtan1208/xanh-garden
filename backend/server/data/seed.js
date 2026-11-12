import { db, newId } from '../core/store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Voucher mẫu cho lần chạy đầu tiên (các mức giảm 10/15/25/35%, người dùng mới, sinh nhật, freeship).
// Chỉ nạp một lần: sau đó admin xóa hay sửa thế nào cũng không bị nạp lại.
export function seedVouchers() {
    db.seeded ||= {};
    if (db.seeded.vouchers) return false;
    db.seeded.vouchers = true;
    if (db.vouchers.length) return false;

    const startAt = new Date(Date.now() - DAY_MS).toISOString();
    const endAt = new Date(Date.now() + 120 * DAY_MS).toISOString();
    const base = {
        kind: 'order',
        audience: 'all',
        scope: 'all',
        scopeIds: [],
        startAt,
        endAt,
        totalQuantity: 0,
        perUserLimit: 1,
        validDays: 30,
        claimable: true,
        active: true,
        claimedCount: 0,
        usedCount: 0,
        createdAt: startAt
    };
    const percent = (code, name, value, maxDiscount, minOrder, extra = {}) => ({
        id: newId(),
        ...base,
        code,
        name,
        type: 'percent',
        value,
        maxDiscount,
        minOrder,
        ...extra
    });

    db.vouchers.push(
        percent('WELCOME15', 'Chào bạn mới - giảm 15%', 15, 50000, 100000, { audience: 'newUser', claimable: false }),
        percent('SINHNHAT25', 'Quà sinh nhật - giảm 25%', 25, 100000, 100000, { audience: 'birthday', claimable: false }),
        percent('SALE10', 'Giảm 10% đơn từ 150k', 10, 30000, 150000, { totalQuantity: 500 }),
        percent('SALE15', 'Giảm 15% đơn từ 300k', 15, 50000, 300000, { totalQuantity: 300 }),
        percent('SALE25', 'Giảm 25% đơn từ 500k', 25, 80000, 500000, { totalQuantity: 200 }),
        percent('SALE35', 'Giảm 35% đơn từ 800k', 35, 120000, 800000, { totalQuantity: 100 }),
        {
            id: newId(),
            ...base,
            code: 'FREESHIP30',
            name: 'Giảm 30.000 ₫ phí vận chuyển',
            kind: 'shipping',
            type: 'fixed',
            value: 30000,
            maxDiscount: 30000,
            minOrder: 200000,
            totalQuantity: 1000
        }
    );
    return true;
}

// Các dịp lễ hằng năm (tự lặp lại mỗi năm; Tết và Trung thu tính theo âm lịch), mỗi dịp có màu chủ đề,
// khẩu hiệu và 1 banner minh họa (ảnh trong src/static/IMAGES/events). Chỉ nạp một lần; admin sửa/tắt/xóa tùy ý.
const YEARLY_EVENTS = [
    {
        key: 'tet',
        name: 'Tết Nguyên Đán',
        recurrence: 'lunar',
        month: 1,
        day: 1,
        daysBefore: 21,
        daysAfter: 6,
        priority: 50,
        primary: '#9b1c1c',
        accent: '#d97706',
        slogan: 'Rước lộc đầu xuân – cây phong thủy giảm đến 35%',
        banner: 'Đón Tết sum vầy – cây phong thủy rước lộc vào nhà',
        link: './products.html?category=2'
    },
    {
        key: 'nam-moi',
        name: 'Tết Dương lịch',
        recurrence: 'yearly',
        month: 1,
        day: 1,
        daysBefore: 5,
        daysAfter: 1,
        priority: 20,
        primary: '#1e1b4b',
        accent: '#ca8a04',
        slogan: 'Năm mới xanh tươi – nhận voucher đầu năm',
        banner: 'Chào năm mới – thêm chút xanh cho góc làm việc',
        link: './vouchers.html'
    },
    {
        key: 'valentine',
        name: 'Valentine',
        recurrence: 'yearly',
        month: 2,
        day: 14,
        daysBefore: 7,
        daysAfter: 0,
        priority: 30,
        primary: '#9d174d',
        accent: '#db2777',
        slogan: 'Tặng nhau một chậu cây thay lời yêu thương',
        banner: 'Valentine xanh – món quà tình yêu lớn lên mỗi ngày',
        link: './products.html?category=1'
    },
    {
        key: 'phu-nu',
        name: 'Quốc tế Phụ nữ 8/3',
        recurrence: 'yearly',
        month: 3,
        day: 8,
        daysBefore: 7,
        daysAfter: 0,
        priority: 30,
        primary: '#86198f',
        accent: '#db2777',
        slogan: 'Gửi tặng một nửa thế giới chút xanh dịu dàng',
        banner: 'Mừng 8/3 – quà tặng xanh cho người phụ nữ bạn yêu thương',
        link: './products.html?category=1'
    },
    {
        key: 'trung-thu',
        name: 'Tết Trung thu',
        recurrence: 'lunar',
        month: 8,
        day: 15,
        daysBefore: 14,
        daysAfter: 1,
        priority: 40,
        primary: '#1e3a8a',
        accent: '#d97706',
        slogan: 'Trăng rằm sum họp – quà tặng xanh cho cả nhà',
        banner: 'Trung thu đoàn viên – tặng nhau mầm xanh may mắn',
        link: './products.html'
    },
    {
        key: 'phu-nu',
        name: 'Phụ nữ Việt Nam 20/10',
        recurrence: 'yearly',
        month: 10,
        day: 20,
        daysBefore: 7,
        daysAfter: 0,
        priority: 30,
        primary: '#9d174d',
        accent: '#ea580c',
        slogan: 'Mừng 20/10 – quà xanh tặng người phụ nữ của bạn',
        banner: 'Mừng ngày Phụ nữ Việt Nam 20/10 – quà tặng xanh ý nghĩa',
        link: './products.html?category=1'
    },
    {
        key: 'halloween',
        name: 'Halloween',
        recurrence: 'yearly',
        month: 10,
        day: 31,
        daysBefore: 10,
        daysAfter: 0,
        priority: 30,
        primary: '#3b0764',
        accent: '#ea580c',
        slogan: 'Không ma quỷ, chỉ có cây xanh giảm giá',
        banner: 'Halloween rộn ràng – sen đá, xương rồng đáng yêu chờ bạn',
        link: './products.html?category=4'
    },
    {
        key: 'nha-giao',
        name: 'Nhà giáo Việt Nam 20/11',
        recurrence: 'yearly',
        month: 11,
        day: 20,
        daysBefore: 7,
        daysAfter: 0,
        priority: 30,
        primary: '#1e40af',
        accent: '#059669',
        slogan: 'Tri ân thầy cô bằng một mầm xanh',
        banner: 'Tri ân thầy cô 20/11 – món quà xanh thay lời cảm ơn',
        link: './products.html?category=1'
    },
    {
        key: 'noel',
        name: 'Giáng sinh',
        recurrence: 'yearly',
        month: 12,
        day: 25,
        daysBefore: 14,
        daysAfter: 1,
        priority: 30,
        primary: '#14532d',
        accent: '#dc2626',
        slogan: 'Giáng sinh an lành – trang trí nhà với cây xanh',
        banner: 'Merry Christmas – cây xanh và chậu xinh cho mùa lễ hội',
        link: './products.html'
    }
];

export function seedEvents() {
    db.seeded ||= {};
    if (db.seeded.events) return false;
    db.seeded.events = true;
    const createdAt = new Date().toISOString();
    YEARLY_EVENTS.forEach((item) => {
        const event = {
            id: newId(),
            name: item.name,
            recurrence: item.recurrence,
            month: item.month,
            day: item.day,
            daysBefore: item.daysBefore,
            daysAfter: item.daysAfter,
            startAt: null,
            endAt: null,
            priority: item.priority,
            active: true,
            theme: { primary: item.primary, accent: item.accent, slogan: item.slogan, heroTitle: '', heroText: '' },
            createdAt
        };
        db.events.push(event);
        db.banners.push({
            id: newId(),
            name: item.banner,
            image: item.key,
            link: item.link,
            eventId: event.id,
            order: 0,
            active: true,
            startAt: null,
            endAt: null,
            createdAt
        });
    });
    return true;
}
