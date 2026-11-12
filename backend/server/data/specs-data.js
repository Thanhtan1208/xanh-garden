// Thông số mô tả theo từng loại sản phẩm. Mỗi danh mục có danh sách trường riêng (specFields);
// mỗi sản phẩm lưu giá trị trong product.specs. Được nạp vào db.json khi khởi động nếu chưa có.

export const CATEGORY_SPEC_FIELDS = {
    // Cây để bàn
    1: [
        ['color', 'Màu sắc'],
        ['size', 'Kích thước'],
        ['scent', 'Hương thơm'],
        ['pot', 'Chậu đi kèm'],
        ['difficulty', 'Độ khó chăm sóc'],
        ['gift', 'Tặng kèm']
    ],
    // Cây phong thủy
    2: [
        ['color', 'Màu sắc'],
        ['size', 'Kích thước'],
        ['scent', 'Hương thơm'],
        ['pot', 'Chậu đi kèm'],
        ['meaning', 'Ý nghĩa'],
        ['placement', 'Vị trí đặt gợi ý'],
        ['difficulty', 'Độ khó chăm sóc'],
        ['gift', 'Tặng kèm']
    ],
    // Cây lọc không khí
    3: [
        ['color', 'Màu sắc'],
        ['size', 'Kích thước'],
        ['scent', 'Hương thơm'],
        ['pot', 'Chậu đi kèm'],
        ['air', 'Khả năng lọc khí'],
        ['pet', 'Lưu ý thú cưng'],
        ['difficulty', 'Độ khó chăm sóc'],
        ['gift', 'Tặng kèm']
    ],
    // Sen đá & xương rồng
    4: [
        ['color', 'Màu sắc'],
        ['size', 'Kích thước'],
        ['scent', 'Hương thơm'],
        ['pot', 'Chậu đi kèm'],
        ['sun', 'Nhu cầu ánh nắng'],
        ['gift', 'Tặng kèm']
    ],
    // Chậu & phụ kiện
    5: [
        ['material', 'Chất liệu'],
        ['color', 'Màu sắc'],
        ['size', 'Kích thước'],
        ['scent', 'Mùi'],
        ['drain', 'Thoát nước'],
        ['spec', 'Quy cách'],
        ['note', 'Lưu ý']
    ]
};

export const PRODUCT_SPECS = {
    1: {
        color: 'Lá xanh sẫm, viền vàng',
        size: 'Cao 40–50 cm, chậu Ø15 cm',
        scent: 'Không mùi',
        pot: 'Chậu sứ Ø15 cm',
        difficulty: 'Rất dễ',
        gift: 'Đĩa lót chậu',
        air: 'Lọc benzen, formaldehyde; nhả oxy cả ban đêm',
        pet: 'Không nên để thú cưng gặm lá'
    },
    2: {
        color: 'Lá đỏ rượu vang, mặt dưới tím đỏ',
        size: 'Cao 35–45 cm, chậu Ø17 cm',
        scent: 'Không mùi',
        pot: 'Chậu nhựa cao cấp Ø17 cm',
        difficulty: 'Dễ',
        gift: 'Gói phân bón nhỏ',
        air: 'Tốt, giúp giảm hóa chất trong không khí phòng',
        pet: 'Có độc nếu thú cưng nhai lá'
    },
    3: {
        color: 'Lá xanh bóng, thân mập',
        size: 'Cao 40–60 cm, chậu Ø18 cm',
        scent: 'Không mùi',
        pot: 'Chậu sứ Ø18 cm',
        meaning: 'Tài lộc, thịnh vượng',
        placement: 'Bàn làm việc, quầy thu ngân',
        difficulty: 'Dễ',
        gift: 'Bao lì xì may mắn'
    },
    4: {
        color: 'Lá xanh, thân bện màu nâu',
        size: 'Cao 45–55 cm, thân 5 nhánh bện',
        scent: 'Không mùi',
        pot: 'Chậu sứ Ø18 cm',
        meaning: 'Tiền vào như nước',
        placement: 'Phòng khách, gần cửa chính',
        difficulty: 'Dễ',
        gift: 'Dây đỏ may mắn'
    },
    5: {
        color: 'Lá xanh mướt, thân thẳng',
        size: 'Cao 60–80 cm, 3 thân',
        scent: 'Không mùi (hoa nếu nở có hương nhẹ)',
        pot: 'Chậu xi măng Ø25 cm',
        meaning: 'Phát tài, khai trương, tân gia',
        placement: 'Phòng khách, văn phòng',
        difficulty: 'Dễ',
        gift: 'Ruy băng chúc mừng'
    },
    6: {
        color: 'Lá xanh đậm, hoa trắng',
        size: 'Cao 40–50 cm, chậu Ø17 cm',
        scent: 'Hương nhẹ khi ra hoa',
        pot: 'Chậu sứ trắng Ø17 cm',
        air: 'Rất tốt, lọc amoniac và benzen',
        pet: 'Có độc nếu thú cưng nhai lá',
        difficulty: 'Trung bình (cần giữ ẩm)',
        gift: 'Phân bón dạng viên'
    },
    7: {
        color: 'Xanh lục, chuyển hồng khi nắng nhiều',
        size: 'Đường kính 4–6 cm',
        scent: 'Không mùi',
        pot: 'Chậu đất nung mini Ø7 cm',
        sun: 'Nắng nhiều, 4–6 giờ mỗi ngày',
        gift: 'Sỏi và 1 nấm trang trí'
    },
    8: {
        color: 'Xanh lục, gai lông vàng nâu',
        size: 'Cao 12–18 cm',
        scent: 'Không mùi',
        pot: 'Chậu nhựa Ø10 cm',
        sun: 'Nắng đầy đủ',
        gift: 'Sỏi trang trí'
    },
    9: {
        color: 'Xanh phấn, chuyển hồng tím khi gặp nắng sớm',
        size: 'Đường kính 6–8 cm',
        scent: 'Không mùi',
        pot: 'Chậu đất nung Ø9 cm',
        sun: 'Nắng sớm 3–4 giờ mỗi ngày',
        gift: 'Nấm trang trí'
    },
    10: {
        color: 'Lá xanh 3 cánh, hoa tím nhạt',
        size: 'Cao 10–15 cm',
        scent: 'Không mùi',
        pot: 'Chậu sứ mini Ø8 cm',
        difficulty: 'Rất dễ',
        gift: 'Thiệp chúc may mắn'
    },
    11: {
        material: 'Sứ men trắng',
        color: 'Trắng',
        size: 'Ø18 × cao 16 cm',
        scent: 'Không mùi',
        drain: 'Có lỗ thoát nước và đĩa lót',
        spec: '1 chậu',
        note: 'Không kèm cây'
    },
    12: {
        material: 'Xi măng',
        color: 'Xám vân đá',
        size: 'Ø20 × cao 18 cm',
        scent: 'Không mùi',
        drain: 'Có lỗ thoát nước',
        spec: '1 chậu',
        note: 'Nên ngâm nước 1 ngày trước khi trồng để giảm kiềm'
    },
    13: {
        material: 'Hỗn hợp trấu hun, mụn dừa, phân hữu cơ',
        color: 'Nâu đen',
        size: 'Túi 2 kg (khoảng 3 lít)',
        scent: 'Mùi đất tự nhiên, không hôi',
        drain: 'Tơi xốp, thoát nước tốt',
        spec: 'Đủ cho 2–3 chậu Ø15 cm',
        note: 'Dùng cho cây trồng chậu'
    }
};

// Thêm dữ liệu còn thiếu mà không ghi đè những gì admin đã nhập.
export function seedSpecs(db) {
    db.categories.forEach((category) => {
        const fields = CATEGORY_SPEC_FIELDS[Number(category.id)];
        if (fields && !category.specFields) category.specFields = fields.map(([key, label]) => ({ key, label }));
    });
    db.products.forEach((product) => {
        if (!product.specs && PRODUCT_SPECS[Number(product.id)]) product.specs = { ...PRODUCT_SPECS[Number(product.id)] };
    });
}
