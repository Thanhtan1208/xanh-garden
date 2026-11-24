// Đọc số tiền thành chữ tiếng Việt cho hóa đơn: 1250000 -> "Một triệu hai trăm năm mươi nghìn đồng"
const CHU_SO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const DON_VI = ['', ' nghìn', ' triệu', ' tỷ'];

// Đọc một nhóm ba chữ số; fullHundreds = true thì nhóm đứng sau nhóm lớn hơn phải đọc đủ "không trăm", "lẻ"
function readGroup(value, fullHundreds) {
    const hundreds = Math.floor(value / 100);
    const tens = Math.floor((value % 100) / 10);
    const units = value % 10;
    let text = '';
    if (hundreds > 0 || fullHundreds) text += `${CHU_SO[hundreds]} trăm`;
    if (tens === 0 && units > 0 && (hundreds > 0 || fullHundreds)) text += ' lẻ';
    if (tens > 1) text += ` ${CHU_SO[tens]} mươi`;
    if (tens === 1) text += ' mười';
    if (units > 0) {
        if (tens > 1 && units === 1) text += ' mốt';
        else if (tens > 0 && units === 5) text += ' lăm';
        else text += ` ${CHU_SO[units]}`;
    }
    return text.trim();
}

export function soThanhChu(amount) {
    const number = Math.round(Number(amount));
    if (!Number.isFinite(number) || number < 0) return '';
    if (number === 0) return 'Không đồng';
    const groups = [];
    for (let rest = number; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
    const parts = [];
    for (let index = groups.length - 1; index >= 0; index -= 1) {
        if (groups[index] === 0) continue;
        parts.push(readGroup(groups[index], index < groups.length - 1) + DON_VI[index % 4]);
    }
    const text = `${parts.join(' ')} đồng`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}
