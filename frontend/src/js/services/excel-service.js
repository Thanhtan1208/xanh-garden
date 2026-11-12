export async function downloadWorkbook(filename, sheets) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    sheets.forEach(({ name, rows, widths = [] }) => {
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        if (widths.length) sheet['!cols'] = widths.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
    });
    XLSX.writeFile(workbook, filename);
}

// Đọc sheet đầu tiên của file Excel thành mảng object, tên cột là tên thuộc tính (làm theo bài B16 của cô)
export async function readWorkbook(file) {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    // defval: '' để ô trống thành chuỗi rỗng
    return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
}
