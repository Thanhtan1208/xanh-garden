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
