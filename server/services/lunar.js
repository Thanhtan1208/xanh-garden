// Đổi ngày âm lịch Việt Nam sang dương lịch (múi giờ +7), theo thuật toán thiên văn của Hồ Ngọc Đức
// (tính ngày Sóc và trung khí để xác định tháng âm và tháng nhuận). Dùng cho sự kiện lặp theo âm lịch: Tết, Trung thu...
const INT = Math.floor;
const TIME_ZONE = 7;

// Số ngày Julius của một ngày dương lịch.
function jdFromDate(dd, mm, yy) {
    const a = INT((14 - mm) / 12);
    const y = yy + 4800 - a;
    const m = mm + 12 * a - 3;
    let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
}

function jdToDate(jd) {
    let b;
    let c;
    if (jd > 2299160) {
        const a = jd + 32044;
        b = INT((4 * a + 3) / 146097);
        c = a - INT((b * 146097) / 4);
    } else {
        b = 0;
        c = jd + 32082;
    }
    const d = INT((4 * c + 3) / 1461);
    const e = c - INT((1461 * d) / 4);
    const m = INT((5 * e + 2) / 153);
    return {
        day: e - INT((153 * m + 2) / 5) + 1,
        month: m + 3 - 12 * INT(m / 10),
        year: b * 100 + d - 4800 + INT(m / 10)
    };
}

// Thời điểm Sóc (trăng mới) thứ k tính từ 1/1/1900.
function newMoon(k) {
    const T = k / 1236.85;
    const T2 = T * T;
    const T3 = T2 * T;
    const dr = Math.PI / 180;
    let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    const deltat = T < -11
        ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
        : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return jd1 + C1 - deltat;
}

// Kinh độ mặt trời (radian) tại một số ngày Julius.
function sunLongitude(jdn) {
    const T = (jdn - 2451545.0) / 36525;
    const T2 = T * T;
    const dr = Math.PI / 180;
    const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    let L = (L0 + DL) * dr;
    L -= Math.PI * 2 * INT(L / (Math.PI * 2));
    return L;
}

const getSunLongitude = (dayNumber) => INT((sunLongitude(dayNumber - 0.5 - TIME_ZONE / 24) / Math.PI) * 6);
const getNewMoonDay = (k) => INT(newMoon(k) + 0.5 + TIME_ZONE / 24);

// Ngày bắt đầu tháng 11 âm lịch (tháng chứa Đông chí) của năm yy.
function lunarMonth11(yy) {
    const off = jdFromDate(31, 12, yy) - 2415021;
    const k = INT(off / 29.530588853);
    const nm = getNewMoonDay(k);
    return getSunLongitude(nm) >= 9 ? getNewMoonDay(k - 1) : nm;
}

// Vị trí tháng nhuận tính từ tháng 11 âm lịch.
function leapMonthOffset(a11) {
    const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let last;
    let i = 1;
    let arc = getSunLongitude(getNewMoonDay(k + i));
    do {
        last = arc;
        i += 1;
        arc = getSunLongitude(getNewMoonDay(k + i));
    } while (arc !== last && i < 14);
    return i - 1;
}

/**
 * Ngày dương lịch của ngày âm lịch (lunarDay/lunarMonth) năm âm lịch lunarYear (tháng thường, không nhuận).
 * Trả về { day, month, year } dương lịch. Ví dụ Tết (1/1) năm 2027 -> { day: 6, month: 2, year: 2027 }.
 */
export function lunarToSolar(lunarDay, lunarMonth, lunarYear) {
    const [a11, b11] = lunarMonth < 11
        ? [lunarMonth11(lunarYear - 1), lunarMonth11(lunarYear)]
        : [lunarMonth11(lunarYear), lunarMonth11(lunarYear + 1)];
    const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
    let off = lunarMonth - 11;
    if (off < 0) off += 12;
    if (b11 - a11 > 365) {
        // Năm có tháng nhuận: các tháng từ sau tháng nhuận bị dời thêm một tháng.
        const leapOff = leapMonthOffset(a11);
        if (off >= leapOff) off += 1;
    }
    return jdToDate(getNewMoonDay(k + off) + lunarDay - 1);
}
