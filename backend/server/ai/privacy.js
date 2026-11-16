// Che thông tin cá nhân trong nội dung khách gõ trước khi gửi sang OpenAI (cả khi tìm kiếm ngữ nghĩa lẫn khi trả lời).
// Chỉ ảnh hưởng nội dung gửi đi; lịch sử chat lưu trên server và cách bot trả lời nội bộ vẫn dùng bản gốc.
export function redact(text) {
    return (
        String(text ?? '')
            .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
            .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{10,}/g, '[khóa]')
            .replace(/(?:\+?84|0)[\s.-]?\d(?:[\s.-]?\d){8,9}/g, '[số điện thoại]')
            // dãy từ 10 chữ số liền (số tài khoản, thẻ...); giá tiền viết có dấu chấm (12.000.000) không bị che
            .replace(/\d(?:[ -]?\d){9,}/g, '[số]')
    );
}

// Từ khóa khách gõ ở ô tìm kiếm là chữ tự do: bỏ những từ khóa có vẻ chứa thông tin cá nhân
export const safeKeyword = (keyword) => {
    const text = String(keyword ?? '');
    return text.length <= 40 && !text.includes('@') && !/\d(?:[ .-]?\d){5,}/.test(text);
};
