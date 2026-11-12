import { fail } from './http.js';

export const FREE_SHIPPING_FROM = 500000;
export const SHIPPING_FEES = { standard: 30000, express: 50000 };
export const PAYMENT_METHODS = ['cod', 'sepay'];
export const HIGH_VALUE_FROM = 1000000; // Tiền hàng lớn hơn mức này phải chuyển khoản trước; đơn được xác nhận tự động qua webhook SePay
export const MAX_ORDER_TOTAL = 50000000; // Chặn đơn quá lớn (nhập nhầm/gian lận)
export const MAX_COD_TOTAL = 5000000; // Đơn lớn hơn mức này bắt buộc thanh toán trước (SePay)
export const MAX_OPEN_UNPAID_ORDERS = 3; // Tránh giữ hàng bằng nhiều đơn chưa xác nhận/chưa thanh toán
export const PAYMENT_TTL_MS = 30 * 60 * 1000; // hạn chuyển khoản; quá hạn đơn tự hủy và hoàn kho
export const MAX_ADDRESSES = 10;
export const MAX_PRODUCT_PRICE = 100000000;
export const MAX_PRODUCT_STOCK = 100000;
export const LOW_STOCK_AT = 5;
export const FEEDBACK_TYPES = ['suggestion', 'complaint', 'praise', 'other'];
export const MAX_LINE_QUANTITY = 20;
export const MAX_OPEN_FEEDBACKS = 5;

// Hủy đơn (theo luồng Shopee)
// Chưa được cửa hàng xác nhận: khách hủy ngay. Đã xác nhận nhưng chưa giao cho vận chuyển: khách gửi yêu cầu hủy,
// cửa hàng đồng ý/từ chối (quá hạn không phản hồi thì tự đồng ý). Đã giao cho vận chuyển: không hủy được.
export const CANCEL_REASONS = Object.freeze({
    change_mind: 'Tôi đổi ý, không còn nhu cầu mua',
    change_items: 'Muốn đổi sản phẩm hoặc số lượng',
    change_address: 'Muốn thay đổi địa chỉ nhận hàng',
    found_cheaper: 'Tìm được nơi bán giá tốt hơn',
    payment_issue: 'Gặp vấn đề khi thanh toán',
    other: 'Lý do khác'
});
export const CANCEL_REQUEST_TTL_MS = 48 * 60 * 60 * 1000;

// Hàng mới / hàng mới về
export const NEW_PRODUCT_DAYS = 30; // sản phẩm tạo trong N ngày gần đây: nhãn "Mới"
export const RESTOCK_DAYS = 7; // vừa nhập thêm trong N ngày: nhãn "Mới về"

// Voucher (quy tắc giống TikTok Shop)
// Mỗi đơn dùng tối đa 1 voucher giảm đơn hàng + 1 voucher giảm phí vận chuyển.
// Điều kiện đơn tối thiểu tính trên giá trị hàng đủ điều kiện; giảm theo % luôn có mức giảm tối đa;
// phí ship miễn phí (từ 500k) xét theo giá trị hàng TRƯỚC giảm giá để voucher không làm khách mất freeship.
export const VOUCHER_KINDS = ['order', 'shipping'];
export const VOUCHER_TYPES = ['percent', 'fixed'];
export const VOUCHER_AUDIENCES = ['all', 'newUser', 'birthday'];
export const VOUCHER_SCOPES = ['all', 'category', 'product', 'newProduct'];
export const MAX_VOUCHER_PERCENT = 70;
export const MAX_VOUCHER_VALUE = 5000000;
export const MAX_WALLET_VOUCHERS = 50; // ví voucher tối đa 50 voucher còn hiệu lực
export const DEFAULT_VOUCHER_VALID_DAYS = 30; // voucher tự cấp (người dùng mới/sinh nhật) có hiệu lực N ngày kể từ lúc cấp
export const NEW_USER_DAYS = 30; // tài khoản tạo trong N ngày và chưa mua gì: "người dùng mới"
export const MIN_AGE = 10;
export const MAX_AGE = 100;

// Chatbot
export const MAX_CHAT_MESSAGE = 500; // ký tự mỗi tin nhắn của khách
export const MAX_CHAT_HISTORY = 12; // số tin gần nhất gửi kèm cho AI
export const CHAT_LIMIT_PER_MINUTE = 8;
export const CHAT_LIMIT_PER_DAY = 120; // giới hạn mỗi người/IP để không bị đốt chi phí API

// Luồng trạng thái hợp lệ: trạng thái hiện tại -> { trạng thái mới: ai được phép }.
export const ORDER_TRANSITIONS = {
    // 'customer' = khách đặt đơn: chỉ được tự hủy khi cửa hàng chưa xác nhận; các bước còn lại do admin/owner/staff làm
    unconfirmed: { cancelled: ['admin', 'owner', 'customer'] }, // sang "pending" chỉ khi đã nhận đủ tiền (webhook SePay hoặc admin ghi nhận) - xem markPaid
    pending: { confirmed: ['admin', 'owner', 'staff'], cancelled: ['admin', 'owner', 'staff', 'customer'] },
    confirmed: { shipping: ['admin', 'owner', 'staff'], cancelled: ['admin', 'owner', 'staff'] },
    // Đang giao mà khách không nhận hàng (giao không thành công): admin hủy đơn, hàng hoàn về kho, đã trả trước thì hoàn tiền
    shipping: { delivered: ['admin', 'owner', 'staff'], cancelled: ['admin', 'owner', 'staff'] },
    delivered: {},
    cancelled: {}
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^(0|\+84)\d{9,10}$/;
const NAME_PATTERN = /^[A-Za-z0-9_.]+$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function textField(value, label, min, max) {
    const result = text(value);
    if (result.length < min) fail(400, `${label} phải có ít nhất ${min} ký tự.`);
    if (result.length > max) fail(400, `${label} không được vượt quá ${max} ký tự.`);
    return result;
}

function enumField(value, label, allowed) {
    if (!allowed.includes(value)) fail(400, `${label} không hợp lệ.`);
    return value;
}

// Chính sách mật khẩu (giữ khớp với src/js/utils/password.js ở giao diện).
export function passwordProblem(password, ...personal) {
    if (password.length < 8) return 'Mật khẩu quá ngắn: cần ít nhất 8 ký tự.';
    if (password.length > 64) return 'Mật khẩu không được vượt quá 64 ký tự.';
    if (/\s/.test(password)) return 'Mật khẩu không được chứa khoảng trắng.';
    if (!/[a-z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ thường.';
    if (!/[A-Z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ in hoa.';
    if (!/\d/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ số.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Mật khẩu cần ít nhất 1 ký tự đặc biệt (ví dụ ! @ # $ %).';
    if (/(.)\1\1/.test(password)) return 'Mật khẩu không được có 3 ký tự giống nhau liên tiếp (ví dụ aaa, 111).';
    const lower = password.toLowerCase();
    if (personal.some((item) => item && item.length >= 3 && lower.includes(String(item).toLowerCase()))) {
        return 'Mật khẩu không được chứa tên đăng nhập hoặc email của bạn.';
    }
    return null;
}

export function parseRegistration(body = {}) {
    const name = textField(body.name, 'Tên đăng nhập', 3, 20);
    if (!NAME_PATTERN.test(name)) fail(400, 'Tên đăng nhập chỉ gồm chữ, số, dấu gạch dưới và dấu chấm.');
    const email = textField(body.email, 'Email', 5, 80).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) fail(400, 'Email không hợp lệ.');
    const password = typeof body.password === 'string' ? body.password : '';
    const problem = passwordProblem(password, name, email.split('@')[0]);
    if (problem) fail(400, problem);
    const birthday = text(body.birthday) ? parseBirthday(body.birthday) : null; // không bắt buộc
    return { name, email, password, birthday };
}

export function parseAddress(body = {}) {
    const phone = text(body.phone).replace(/[\s.-]/g, '');
    if (!PHONE_PATTERN.test(phone)) fail(400, 'Số điện thoại không hợp lệ (VD: 0901234567).');
    return {
        fullName: textField(body.fullName, 'Tên người nhận', 2, 60),
        phone,
        address: textField(body.address, 'Địa chỉ giao hàng', 10, 200)
    };
}

export function parseOrderOptions(body = {}) {
    if (typeof body.shippingMethod !== 'string' || !Object.hasOwn(SHIPPING_FEES, body.shippingMethod))
        fail(400, 'Phương thức vận chuyển không hợp lệ.');
    return {
        shippingMethod: body.shippingMethod,
        paymentMethod: enumField(body.paymentMethod, 'Phương thức thanh toán', PAYMENT_METHODS)
    };
}

export function shippingFee(method, subtotal) {
    return method === 'standard' && subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEES[method];
}

export function parseFeedback(body = {}) {
    return {
        type: enumField(body.type, 'Loại phản hồi', FEEDBACK_TYPES),
        subject: textField(body.subject, 'Tiêu đề', 5, 120),
        content: textField(body.content, 'Nội dung', 10, 1000),
        orderCode: text(body.orderCode).toUpperCase().slice(0, 40)
    };
}

export function parseReview(body = {}) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'Số sao phải từ 1 đến 5.');
    return { rating, comment: textField(body.comment, 'Nội dung đánh giá', 5, 500) };
}

export const parseReply = (body = {}) => textField(body.reply, 'Nội dung phản hồi', 2, 1000);

// Thông số theo loại: chỉ nhận các trường mà danh mục cho phép, bỏ trường để trống, mỗi giá trị tối đa 100 ký tự.
function parseSpecs(raw, category) {
    const specs = {};
    (category?.specFields || []).forEach(({ key, label }) => {
        const value = text(raw?.[key]);
        if (value.length > 100) fail(400, `${label} không được vượt quá 100 ký tự.`);
        if (value) specs[key] = value;
    });
    return specs;
}

export function parseProduct(body = {}, categories = []) {
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < 1000 || price > MAX_PRODUCT_PRICE)
        fail(400, `Giá phải là số nguyên từ 1.000 đến ${MAX_PRODUCT_PRICE.toLocaleString('vi-VN')} ₫.`);
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_PRODUCT_STOCK)
        fail(400, `Tồn kho phải là số nguyên từ 0 đến ${MAX_PRODUCT_STOCK}.`);
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId)) fail(400, 'Vui lòng chọn danh mục.');
    // Ảnh: ảnh admin tải lên (/uploads/products/...) hoặc tên ảnh có sẵn trong src/static/IMAGES.
    const rawImage = text(body.image);
    const image = rawImage.startsWith('/uploads/') ? rawImage : rawImage.split('/').pop();
    if (image && !PRODUCT_IMAGE_PATTERN.test(image)) fail(400, 'Ảnh sản phẩm không hợp lệ. Hãy tải ảnh lên lại.');
    const oldPrice =
        body.oldPrice === undefined || body.oldPrice === null || body.oldPrice === '' || Number(body.oldPrice) === 0
            ? null
            : Number(body.oldPrice);
    if (oldPrice !== null && (!Number.isInteger(oldPrice) || oldPrice <= price || oldPrice > MAX_PRODUCT_PRICE)) {
        fail(400, 'Giá gốc (giá trước giảm) phải là số nguyên lớn hơn giá bán, để trống nếu không giảm giá.');
    }
    return {
        name: textField(body.name, 'Tên sản phẩm', 2, 80),
        price,
        oldPrice,
        stock,
        categoryId,
        image: image || 'p1.png',
        description: textField(body.description, 'Mô tả', 5, 500),
        specs: parseSpecs(
            body.specs,
            categories.find((category) => Number(category.id) === categoryId)
        ),
        // Hạn hiển thị nhãn "Mới" đặt riêng cho sản phẩm; để trống thì theo số ngày chung trong cài đặt
        newUntil: isoDate(body.newUntil, 'Hạn nhãn Mới'),
        // Hạn giảm giá sản phẩm mới đặt riêng; để trống thì theo số ngày giảm chung
        promoUntil: isoDate(body.promoUntil, 'Hạn giảm giá')
    };
}

// Cài đặt sản phẩm mới: số ngày hiện nhãn "Mới" / "Mới về" và khuyến mãi tự động cho sản phẩm mới.
export const SETTINGS_DEFAULTS = Object.freeze({
    newProductDays: NEW_PRODUCT_DAYS,
    restockDays: RESTOCK_DAYS,
    newPromo: Object.freeze({ enabled: false, percent: 10, maxDiscount: 50000, minOrder: 0, days: 7 })
});

export function parseSettings(body = {}) {
    const promo = body.newPromo || {};
    const enabled = promo.enabled === true;
    const newProductDays = intField(body.newProductDays, 'Số ngày hiện nhãn Mới', 1, 90);
    const days = intField(promo.days ?? SETTINGS_DEFAULTS.newPromo.days, 'Số ngày giảm giá', 1, 90);
    if (enabled && days >= newProductDays) fail(400, 'Số ngày giảm giá phải ít hơn số ngày hiện nhãn Mới.');
    return {
        newProductDays,
        restockDays: intField(body.restockDays, 'Số ngày hiện nhãn Mới về', 1, 90),
        newPromo: {
            enabled,
            percent: intField(promo.percent ?? SETTINGS_DEFAULTS.newPromo.percent, 'Mức giảm (%)', 1, MAX_VOUCHER_PERCENT),
            maxDiscount: intField(promo.maxDiscount ?? SETTINGS_DEFAULTS.newPromo.maxDiscount, 'Giảm tối đa (₫)', 1000, MAX_VOUCHER_VALUE),
            minOrder: intField(promo.minOrder ?? 0, 'Đơn tối thiểu', 0, MAX_ORDER_TOTAL),
            days
        }
    };
}

// Ngày sinh dạng YYYY-MM-DD; phải là ngày có thật, trong quá khứ và tuổi từ MIN_AGE đến MAX_AGE.
export function parseBirthday(value) {
    const raw = text(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) fail(400, 'Ngày sinh không hợp lệ (định dạng năm-tháng-ngày).');
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
        fail(400, 'Ngày sinh không tồn tại.');
    const now = new Date();
    let age = now.getUTCFullYear() - year;
    if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
    if (age < MIN_AGE || age > MAX_AGE) fail(400, `Ngày sinh không hợp lệ (tuổi phải từ ${MIN_AGE} đến ${MAX_AGE}).`);
    return raw;
}

function isoDate(value, label, { required = false } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) fail(400, `${label} là bắt buộc.`);
        return null;
    }
    const time = Date.parse(value);
    if (Number.isNaN(time)) fail(400, `${label} không hợp lệ.`);
    return new Date(time).toISOString();
}

function intField(value, label, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max)
        fail(400, `${label} phải là số nguyên từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}.`);
    return number;
}

const PRODUCT_IMAGE_PATTERN = /^(\/uploads\/products\/[\w.-]+|[\w.-]+)$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LINK_PATTERN = /^(\.\/[a-z0-9-]+\.html(\?[\w=&%.-]*)?|\/[a-z0-9-]+\.html(\?[\w=&%.-]*)?)$/i;
const IMAGE_PATTERN = /^(\/uploads\/banners\/[\w.-]+|[\w.-]+)$/;

export const EVENT_RECURRENCES = ['once', 'yearly', 'lunar'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // tháng 2 cho phép 29 (năm thường tự lùi về 28)

// Thời gian của sự kiện: một lần (ngày giờ cụ thể) hoặc lặp hằng năm theo dương lịch / âm lịch.
function parseEventSchedule(body) {
    const recurrence = enumField(body.recurrence ?? 'once', 'Kiểu lặp', EVENT_RECURRENCES);
    if (recurrence === 'once') {
        const startAt = isoDate(body.startAt, 'Ngày bắt đầu', { required: true });
        const endAt = isoDate(body.endAt, 'Ngày kết thúc', { required: true });
        if (Date.parse(endAt) <= Date.parse(startAt)) fail(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
        return { recurrence, startAt, endAt, month: null, day: null, daysBefore: 0, daysAfter: 0 };
    }
    const month = intField(body.month, 'Tháng', 1, 12);
    // Âm lịch chỉ nhận ngày 1–29 vì không phải tháng âm nào cũng có ngày 30.
    const maxDay = recurrence === 'lunar' ? 29 : DAYS_IN_MONTH[month - 1];
    const day = intField(body.day, 'Ngày', 1, maxDay);
    return {
        recurrence,
        month,
        day,
        daysBefore: intField(body.daysBefore ?? 0, 'Số ngày bắt đầu trước', 0, 60),
        daysAfter: intField(body.daysAfter ?? 0, 'Số ngày kéo dài sau', 0, 60),
        startAt: null,
        endAt: null
    };
}

export function parseEvent(body = {}) {
    const schedule = parseEventSchedule(body);
    const theme = body.theme || {};
    const color = (value, label, fallback) => {
        const result = text(value) || fallback;
        if (!COLOR_PATTERN.test(result)) fail(400, `${label} phải là mã màu dạng #RRGGBB.`);
        return result.toLowerCase();
    };
    return {
        name: textField(body.name, 'Tên sự kiện', 2, 80),
        ...schedule,
        priority: intField(body.priority ?? 0, 'Độ ưu tiên', 0, 100),
        active: body.active !== false,
        theme: {
            primary: color(theme.primary, 'Màu chủ đạo', '#124d29'),
            accent: color(theme.accent, 'Màu nhấn', '#d35400'),
            slogan: text(theme.slogan).slice(0, 80),
            heroTitle: text(theme.heroTitle).slice(0, 100),
            heroText: text(theme.heroText).slice(0, 200)
        }
    };
}

export function parseBanner(body = {}, events = []) {
    const startAt = isoDate(body.startAt, 'Ngày bắt đầu');
    const endAt = isoDate(body.endAt, 'Ngày kết thúc');
    if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) fail(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
    const image = text(body.image);
    if (!image || !IMAGE_PATTERN.test(image)) fail(400, 'Vui lòng chọn ảnh banner (tải lên hoặc nhập tên file trong src/static/IMAGES).');
    const link = text(body.link);
    if (link && !LINK_PATTERN.test(link))
        fail(400, 'Liên kết banner chỉ được trỏ tới trang trong cửa hàng (ví dụ ./products.html?category=3).');
    const eventId = body.eventId ? String(body.eventId) : null;
    if (eventId && !events.some((event) => event.id === eventId)) fail(400, 'Sự kiện không tồn tại.');
    return {
        name: textField(body.name, 'Tên banner', 2, 80),
        image,
        link,
        eventId,
        order: intField(body.order ?? 0, 'Thứ tự', 0, 1000),
        active: body.active !== false,
        startAt,
        endAt
    };
}

// Sửa voucher ĐÃ có người nhận: chỉ được đổi tên, ngày kết thúc, tổng số lượng và bật/tắt.
// Không kiểm tra lại phạm vi áp dụng (sản phẩm trong phạm vi có thể đã bị xóa) để admin luôn tắt được voucher.
export function parseVoucherUpdate(body = {}, voucher) {
    const endAt = isoDate(body.endAt ?? voucher.endAt, 'Ngày kết thúc', { required: true });
    if (Date.parse(endAt) <= Date.parse(voucher.startAt)) fail(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
    const totalQuantity = intField(body.totalQuantity ?? voucher.totalQuantity, 'Tổng số lượng (0 = không giới hạn)', 0, 1000000);
    if (totalQuantity && totalQuantity < (voucher.claimedCount || 0))
        fail(409, `Tổng số lượng không được thấp hơn số đã nhận (${voucher.claimedCount}).`);
    return {
        name: textField(body.name ?? voucher.name, 'Tên voucher', 2, 80),
        endAt,
        totalQuantity,
        active: body.active === undefined ? voucher.active : body.active !== false
    };
}

// Voucher giảm giá. Các ràng buộc ở đây là điều kiện cứng: sai là từ chối ngay khi admin tạo.
export function parseVoucher(body = {}, { categories = [], products = [] } = {}) {
    const kind = enumField(body.kind, 'Loại voucher', VOUCHER_KINDS);
    const type = enumField(body.type, 'Kiểu giảm', VOUCHER_TYPES);
    const audience = enumField(body.audience ?? 'all', 'Đối tượng', VOUCHER_AUDIENCES);
    const scope = enumField(body.scope ?? 'all', 'Phạm vi áp dụng', VOUCHER_SCOPES);
    const code = text(body.code).toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) fail(400, 'Mã voucher gồm 4–20 ký tự chữ in hoa hoặc số, không dấu cách.');

    const startAt = isoDate(body.startAt, 'Ngày bắt đầu', { required: true });
    const endAt = isoDate(body.endAt, 'Ngày kết thúc', { required: true });
    if (Date.parse(endAt) <= Date.parse(startAt)) fail(400, 'Ngày kết thúc phải sau ngày bắt đầu.');

    const value =
        type === 'percent'
            ? intField(body.value, 'Mức giảm (%)', 1, MAX_VOUCHER_PERCENT)
            : intField(body.value, 'Mức giảm (₫)', 1000, MAX_VOUCHER_VALUE);
    // Giảm theo % bắt buộc có mức giảm tối đa; giảm cố định thì mức tối đa chính là giá trị giảm.
    const maxDiscount = type === 'percent' ? intField(body.maxDiscount, 'Giảm tối đa (₫)', 1000, MAX_VOUCHER_VALUE) : value;

    if (kind === 'shipping' && scope !== 'all') fail(400, 'Voucher phí vận chuyển luôn áp dụng cho cả đơn hàng.');
    if (audience === 'birthday' && scope !== 'all') fail(400, 'Voucher sinh nhật áp dụng cho cả đơn hàng.');
    let scopeIds = [];
    if (scope === 'category' || scope === 'product') {
        const source = scope === 'category' ? categories : products;
        scopeIds = [...new Set((Array.isArray(body.scopeIds) ? body.scopeIds : []).map(String))];
        if (!scopeIds.length) fail(400, `Hãy chọn ít nhất 1 ${scope === 'category' ? 'danh mục' : 'sản phẩm'}.`);
        if (scopeIds.length > 50 || scopeIds.some((id) => !source.some((item) => String(item.id) === id)))
            fail(400, 'Phạm vi áp dụng chứa mục không tồn tại.');
    }
    const auto = audience !== 'all'; // người dùng mới / sinh nhật: hệ thống tự cấp, khách không tự nhận
    return {
        code,
        name: textField(body.name, 'Tên voucher', 2, 80),
        kind,
        type,
        value,
        maxDiscount,
        minOrder: intField(body.minOrder ?? 0, 'Đơn tối thiểu', 0, MAX_ORDER_TOTAL),
        audience,
        scope,
        scopeIds,
        startAt,
        endAt,
        totalQuantity: intField(body.totalQuantity ?? 0, 'Tổng số lượng (0 = không giới hạn)', 0, 1000000),
        perUserLimit: intField(body.perUserLimit ?? 1, 'Giới hạn mỗi người', 1, 5),
        validDays: intField(body.validDays ?? DEFAULT_VOUCHER_VALID_DAYS, 'Số ngày hiệu lực sau khi nhận', 1, 365),
        claimable: !auto && body.claimable !== false,
        active: body.active !== false
    };
}

// Lý do hủy đơn do khách chọn (bắt buộc). Chọn "Lý do khác" thì phải ghi rõ.
export function parseCancelReason(body = {}) {
    const id = text(body.reasonId);
    if (!Object.hasOwn(CANCEL_REASONS, id)) fail(400, 'Vui lòng chọn lý do hủy đơn.');
    const note = text(body.note).slice(0, 200);
    if (id === 'other' && note.length < 3) fail(400, 'Vui lòng ghi rõ lý do hủy đơn.');
    return { id, label: id === 'other' ? note : CANCEL_REASONS[id] };
}

// Thông tin cửa hàng hiển thị trên website (admin chỉnh ở trang Cài đặt cửa hàng).
export const SHOP_DEFAULTS = Object.freeze({
    name: 'Xanh Garden',
    tagline: 'Cây cảnh văn phòng & quà tặng xanh',
    hotline: '0901 234 567',
    email: 'hotro@xanhgarden.vn',
    address: 'TP. Hồ Chí Minh',
    hours: '8:00 – 21:00, tất cả các ngày',
    facebook: 'https://facebook.com/',
    zalo: 'https://zalo.me/0901234567',
    warrantyDays: 7
});

export function parseShop(body = {}) {
    const url = (value, label) => {
        const raw = text(value);
        if (!/^https?:\/\/\S{3,200}$/.test(raw)) fail(400, `${label} phải bắt đầu bằng http:// hoặc https://.`);
        return raw;
    };
    const hotline = text(body.hotline);
    if (!/^[0-9 .+()-]{8,20}$/.test(hotline)) fail(400, 'Hotline chỉ gồm số, từ 8 đến 20 ký tự.');
    const email = text(body.email).toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 80) fail(400, 'Email cửa hàng không hợp lệ.');
    return {
        name: textField(body.name, 'Tên cửa hàng', 2, 40),
        tagline: textField(body.tagline, 'Khẩu hiệu', 2, 80),
        hotline,
        email,
        address: textField(body.address, 'Địa chỉ', 3, 150),
        hours: textField(body.hours, 'Giờ mở cửa', 3, 80),
        facebook: url(body.facebook, 'Liên kết Facebook'),
        zalo: url(body.zalo, 'Liên kết Zalo'),
        warrantyDays: intField(body.warrantyDays, 'Số ngày bảo hành cây', 1, 90)
    };
}
