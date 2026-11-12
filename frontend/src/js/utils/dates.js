// Chuyển qua lại giữa ISO (server lưu) và giá trị ô <input type="datetime-local"> (giờ máy người dùng).
export function toLocalInput(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

// Trạng thái theo thời gian: sắp diễn ra / đang diễn ra / đã kết thúc.
export function timeState(item, now = Date.now()) {
    if (item.startAt && now < Date.parse(item.startAt)) return 'upcoming';
    if (item.endAt && now > Date.parse(item.endAt)) return 'ended';
    return 'running';
}
