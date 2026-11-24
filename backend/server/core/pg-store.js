// Lưu dữ liệu vào PostgreSQL theo bảng quan hệ. Khi khởi động nạp hết vào bộ nhớ (code nghiệp vụ giữ nguyên cách dùng db.*),
// mỗi lần save() chỉ ghi các dòng đã đổi, trong một transaction.
// Mỗi bảng: cột thật cho các trường chính + cột extra (json) giữ trường phụ, nên đọc ra đúng như lúc ghi.
import { DB_SCHEMA, query, transaction } from './pg.js';

// Kiểu cột: giá trị không đúng kiểu (VD null, ngày sai định dạng) thì cất vào extra để không mất dữ liệu
const KINDS = {
    text: { sql: 'text', fits: (v) => typeof v === 'string' },
    int: { sql: 'integer', fits: (v) => Number.isInteger(v) && Math.abs(v) < 2 ** 31 },
    bigint: { sql: 'bigint', fits: (v) => Number.isSafeInteger(v) },
    num: { sql: 'double precision', fits: (v) => typeof v === 'number' && Number.isFinite(v) },
    bool: { sql: 'boolean', fits: (v) => typeof v === 'boolean' },
    // chỉ nhận chuỗi ISO chuẩn (toISOString) để đọc ra giống hệt
    ts: { sql: 'timestamptz', fits: (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v },
    date: { sql: 'date', fits: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) },
    json: { sql: 'json', fits: (v) => v !== null && v !== undefined }
};

const snake = (name) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

// field: 'kind' hoặc [tên cột, 'kind']
const T = 'text';
export const TABLES = [
    { table: 'categories', coll: 'categories', key: 'id', cols: { id: T, name: T, specFields: 'json' } },
    {
        table: 'products',
        coll: 'products',
        key: 'id',
        cols: {
            id: T,
            name: T,
            categoryId: 'int',
            price: 'int',
            oldPrice: 'int',
            costPrice: 'int',
            costEstimated: 'bool',
            stock: 'int',
            hidden: 'bool',
            image: T,
            description: T,
            care: 'json',
            specs: 'json',
            createdAt: 'ts',
            lastImportedAt: 'ts',
            newUntil: 'ts',
            promoUntil: 'ts'
        },
        indexes: ['category_id']
    },
    {
        table: 'users',
        coll: 'user',
        key: 'id',
        cols: {
            id: T,
            name: T,
            email: T,
            role: T,
            passwordHash: T,
            verified: 'bool',
            avatar: T,
            birthday: 'date',
            birthdaySetAt: 'ts',
            favorites: 'json',
            termsAcceptedAt: 'ts',
            passwordResetAt: 'ts',
            createdAt: 'ts'
        },
        children: {
            addresses: {
                table: 'user_addresses',
                parent: 'user_id',
                cols: { id: T, fullName: T, phone: T, province: T, ward: T, street: T, address: T, isDefault: 'bool' }
            }
        },
        indexes: ['lower(email)', 'lower(name)']
    },
    {
        table: 'orders',
        coll: 'orders',
        key: 'id',
        cols: {
            id: T,
            code: T,
            invoiceNo: T,
            userId: T,
            status: T,
            paymentMethod: T,
            paymentStatus: T,
            shippingMethod: T,
            subtotal: 'int',
            discount: 'int',
            shippingFee: 'int',
            shippingDiscount: 'int',
            total: 'int',
            customer: 'json',
            delivery: 'json',
            vouchers: 'json',
            carrier: T,
            trackingCode: T,
            cancelReason: T,
            cancelledBy: T,
            payExpiresAt: 'bigint',
            paidAt: 'ts',
            createdAt: 'ts',
            updatedAt: 'ts'
        },
        children: {
            items: {
                table: 'order_items',
                parent: 'order_id',
                cols: { id: ['product_id', T], name: T, price: 'int', cost: 'int', qty: 'int', image: T }
            },
            history: { table: 'order_history', parent: 'order_id', cols: { status: T, at: 'ts', by: ['by_user', T], note: T } }
        },
        indexes: ['user_id', 'code', 'invoice_no', 'status', 'created_at']
    },
    {
        table: 'reviews',
        coll: 'reviews',
        key: 'id',
        cols: {
            id: T,
            productId: T,
            userId: T,
            userName: T,
            rating: 'int',
            comment: T,
            media: 'json',
            reply: 'json',
            authorClosed: 'bool',
            createdAt: 'ts'
        },
        indexes: ['product_id']
    },
    {
        table: 'feedbacks',
        coll: 'feedbacks',
        key: 'id',
        cols: {
            id: 'bigint',
            userId: T,
            userName: T,
            type: T,
            orderCode: T,
            subject: T,
            content: T,
            status: T,
            reply: 'json',
            createdAt: 'ts'
        }
    },
    {
        table: 'payments',
        coll: 'payments',
        key: 'id',
        cols: {
            id: T,
            txId: T,
            amount: 'bigint',
            content: T,
            orderCode: T,
            result: T,
            demo: 'bool',
            autoConfirmed: 'bool',
            receivedAt: 'ts'
        },
        indexes: ['order_code']
    },
    {
        table: 'uploads',
        coll: 'uploads',
        key: 'id',
        cols: { id: T, userId: T, file: T, type: T, size: 'int', used: 'bool', createdAt: 'ts' }
    },
    {
        table: 'stock_logs',
        coll: 'stockLogs',
        key: 'id',
        cols: { id: T, productId: T, type: T, qty: 'int', balanceAfter: 'int', note: T, by: ['by_user', T], createdAt: 'ts' },
        indexes: ['product_id']
    },
    {
        table: 'events',
        coll: 'events',
        key: 'id',
        cols: {
            id: T,
            name: T,
            recurrence: T,
            month: 'int',
            day: 'int',
            daysBefore: 'int',
            daysAfter: 'int',
            startAt: 'ts',
            endAt: 'ts',
            priority: 'int',
            active: 'bool',
            theme: 'json',
            createdAt: 'ts'
        }
    },
    {
        table: 'banners',
        coll: 'banners',
        key: 'id',
        cols: {
            id: T,
            name: T,
            image: T,
            link: T,
            eventId: T,
            order: ['sort_order', 'int'],
            active: 'bool',
            startAt: 'ts',
            endAt: 'ts',
            createdAt: 'ts'
        }
    },
    {
        table: 'vouchers',
        coll: 'vouchers',
        key: 'id',
        cols: {
            id: T,
            code: T,
            name: T,
            kind: T,
            audience: T,
            scope: T,
            scopeIds: 'json',
            type: T,
            value: 'num',
            maxDiscount: 'int',
            minOrder: 'int',
            totalQuantity: 'int',
            perUserLimit: 'int',
            validDays: 'int',
            claimable: 'bool',
            active: 'bool',
            claimedCount: 'int',
            usedCount: 'int',
            startAt: 'ts',
            endAt: 'ts',
            createdAt: 'ts'
        }
    },
    {
        table: 'user_vouchers',
        coll: 'userVouchers',
        key: 'id',
        cols: {
            id: T,
            userId: T,
            voucherId: T,
            code: T,
            source: T,
            status: T,
            orderId: T,
            issuedAt: 'ts',
            expiresAt: 'ts',
            usedAt: 'ts'
        },
        indexes: ['user_id']
    },
    {
        table: 'carts',
        coll: 'carts',
        key: 'userId',
        cols: { userId: T, updatedAt: 'ts' },
        children: { items: { table: 'cart_items', parent: 'cart_user_id', cols: { id: ['product_id', T], qty: 'int' } } }
    },
    { table: 'chats', coll: 'chats', key: 'userId', cols: { userId: T, messages: 'json', updatedAt: 'ts' } }
];

// Chuẩn hóa mô tả cột: [{ field, col, kind }]
const columns = (cols) =>
    Object.entries(cols).map(([field, spec]) => {
        const [col, kind] = Array.isArray(spec) ? spec : [snake(field), spec];
        return { field, col, kind };
    });
TABLES.forEach((spec) => {
    spec.columns = columns(spec.cols);
    spec.keyCol = spec.columns.find((column) => column.field === spec.key);
    spec.childList = Object.entries(spec.children || {}).map(([field, child]) => ({
        field,
        ...child,
        columns: columns(child.cols),
        parentCol: child.parent
    }));
});

// Tên cột được đặt trong ngoặc kép vì có cột trùng từ khóa SQL
const q = (name) => `"${name}"`;

// ---------- tạo bảng
export function schemaSql() {
    const lines = [];
    if (DB_SCHEMA !== 'public') lines.push(`CREATE SCHEMA IF NOT EXISTS ${q(DB_SCHEMA)};`);
    TABLES.forEach((spec) => {
        const defs = spec.columns.map(({ col, kind }) => `${q(col)} ${KINDS[kind].sql}`);
        lines.push(
            `CREATE TABLE IF NOT EXISTS ${q(spec.table)} (\n    seq bigint GENERATED ALWAYS AS IDENTITY,\n    ${defs.join(',\n    ')},\n    extra json,\n    PRIMARY KEY (${q(spec.keyCol.col)})\n);`
        );
        // bảng đã có từ bản cũ: thêm cột mới nếu thiếu
        spec.columns.forEach(({ col, kind }) =>
            lines.push(`ALTER TABLE ${q(spec.table)} ADD COLUMN IF NOT EXISTS ${q(col)} ${KINDS[kind].sql};`)
        );
        (spec.indexes || []).forEach((expr) => {
            const name = `${spec.table}_${expr.replace(/\W+/g, '_').replace(/_+$/, '')}_idx`;
            const target = expr.includes('(') ? expr.replace(/\((\w+)\)/, (_m, col) => `(${q(col)})`) : q(expr);
            lines.push(`CREATE INDEX IF NOT EXISTS ${q(name)} ON ${q(spec.table)} (${target});`);
        });
        spec.childList.forEach((child) => {
            const defs = child.columns.map(({ col, kind }) => `${q(col)} ${KINDS[kind].sql}`);
            lines.push(
                `CREATE TABLE IF NOT EXISTS ${q(child.table)} (\n    ${q(child.parentCol)} ${KINDS[spec.keyCol.kind].sql} NOT NULL REFERENCES ${q(spec.table)} (${q(spec.keyCol.col)}) ON DELETE CASCADE,\n    pos integer NOT NULL,\n    ${defs.join(',\n    ')},\n    extra json,\n    PRIMARY KEY (${q(child.parentCol)}, pos)\n);`
            );
            child.columns.forEach(({ col, kind }) =>
                lines.push(`ALTER TABLE ${q(child.table)} ADD COLUMN IF NOT EXISTS ${q(col)} ${KINDS[kind].sql};`)
            );
        });
    });
    // Cài đặt cửa hàng, số phiếu đã cấp... (mỗi khóa một dòng)
    lines.push('CREATE TABLE IF NOT EXISTS app_state (\n    key text PRIMARY KEY,\n    value json\n);');
    // Ảnh/video tải lên (ổ đĩa của máy chủ miễn phí bị xóa khi khởi động lại nên lưu trong CSDL)
    lines.push(
        'CREATE TABLE IF NOT EXISTS files (\n    path text PRIMARY KEY,\n    data bytea NOT NULL,\n    size integer NOT NULL,\n    created_at timestamptz NOT NULL DEFAULT now()\n);'
    );
    // Nhật ký hành vi khách (xem sản phẩm, thêm giỏ...)
    lines.push(
        'CREATE TABLE IF NOT EXISTS analytics_events (\n    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n    t bigint NOT NULL,\n    data json NOT NULL\n);'
    );
    lines.push('CREATE INDEX IF NOT EXISTS analytics_events_t_idx ON analytics_events (t);');
    return lines.join('\n');
}

// ---------- chuyển đối tượng <-> dòng
const toDb = (kind, value) => (kind === 'json' ? JSON.stringify(value) : value);
const fromDb = (kind, value) => (kind === 'ts' ? value.toISOString() : value);

function toRow(doc, list, arrays = []) {
    const values = [];
    const extra = {};
    const known = new Set(list.map((column) => column.field));
    list.forEach(({ field, kind }) => {
        const value = doc[field];
        if (value !== undefined && KINDS[kind].fits(value)) values.push(toDb(kind, value));
        else {
            values.push(null);
            if (value !== undefined) extra[field] = value;
        }
    });
    const present = [];
    Object.entries(doc).forEach(([field, value]) => {
        if (known.has(field) || value === undefined) return;
        if (arrays.includes(field) && Array.isArray(value)) present.push(field);
        else extra[field] = value;
    });
    if (present.length) extra.$arrays = present;
    values.push(Object.keys(extra).length ? JSON.stringify(extra) : null);
    return values;
}

function fromRow(row, list) {
    const doc = {};
    list.forEach(({ field, col, kind }) => {
        if (row[col] !== null && row[col] !== undefined) doc[field] = fromDb(kind, row[col]);
    });
    const { $arrays = [], ...extra } = row.extra || {};
    Object.assign(doc, extra);
    return { doc, arrays: $arrays };
}

const keyOf = (spec, doc) => doc?.[spec.key];
const validKey = (spec, value) => KINDS[spec.keyCol.kind].fits(value);

// ---------- đọc toàn bộ
export async function ensureSchema() {
    await query(schemaSql());
}

export async function loadAll() {
    const data = {};
    let rows = 0;
    for (const spec of TABLES) {
        const result = await query(`SELECT * FROM ${q(spec.table)} ORDER BY seq`);
        rows += result.rows.length;
        const docs = new Map();
        const list = result.rows.map((row) => {
            const { doc, arrays } = fromRow(row, spec.columns);
            spec.childList.forEach((child) => {
                if (arrays.includes(child.field)) doc[child.field] = [];
            });
            docs.set(doc[spec.key], doc);
            return doc;
        });
        for (const child of spec.childList) {
            const result = await query(`SELECT * FROM ${q(child.table)} ORDER BY ${q(child.parentCol)}, pos`);
            result.rows.forEach((row) => {
                const parent = docs.get(row[child.parentCol]);
                if (parent?.[child.field]) parent[child.field].push(fromRow(row, child.columns).doc);
            });
        }
        data[spec.coll] = list;
    }
    const state = await query('SELECT key, value FROM app_state');
    state.rows.forEach((row) => {
        data[row.key] = row.value;
    });
    return { data, empty: rows === 0 && state.rows.length === 0 };
}

// ---------- ghi phần thay đổi
// snapshot: bản JSON của từng dòng lần ghi trước, so với hiện tại để biết dòng nào thêm/sửa/xóa
let snapshot = new Map();

export function rememberAll(db) {
    snapshot = new Map(
        TABLES.map((spec) => [spec.coll, new Map((db[spec.coll] || []).map((doc) => [keyOf(spec, doc), JSON.stringify(doc)]))])
    );
    snapshot.set('$state', new Map(stateKeys(db).map((key) => [key, JSON.stringify(db[key])])));
}

const COLLECTION_NAMES = new Set(TABLES.map((spec) => spec.coll));
const stateKeys = (db) => Object.keys(db).filter((key) => !COLLECTION_NAMES.has(key) && db[key] !== undefined);

// Tính thay đổi ngay lúc gọi (đồng bộ) để giá trị ghi xuống đúng trạng thái lúc đó
export function diff(db) {
    const changes = [];
    const next = new Map();
    TABLES.forEach((spec) => {
        const before = snapshot.get(spec.coll) || new Map();
        const now = new Map();
        const upserts = [];
        (db[spec.coll] || []).forEach((doc) => {
            const key = keyOf(spec, doc);
            if (!validKey(spec, key)) {
                console.warn(`[db] Bỏ qua bản ghi ${spec.coll} không có khóa hợp lệ`);
                return;
            }
            const text = JSON.stringify(doc);
            now.set(key, text);
            if (before.get(key) !== text) upserts.push(doc);
        });
        const deletes = [...before.keys()].filter((key) => !now.has(key));
        next.set(spec.coll, now);
        if (upserts.length || deletes.length) changes.push({ spec, deletes, rows: upserts.map((doc) => rowsOf(spec, doc)) });
    });
    const beforeState = snapshot.get('$state') || new Map();
    const nowState = new Map(stateKeys(db).map((key) => [key, JSON.stringify(db[key])]));
    const state = [...nowState].filter(([key, text]) => beforeState.get(key) !== text);
    const stateDeletes = [...beforeState.keys()].filter((key) => !nowState.has(key));
    next.set('$state', nowState);
    return { changes, state, stateDeletes, next, empty: !changes.length && !state.length && !stateDeletes.length };
}

function rowsOf(spec, doc) {
    const key = keyOf(spec, doc);
    const children = spec.childList.map((child) => ({
        child,
        rows: Array.isArray(doc[child.field]) ? doc[child.field].map((item, pos) => [key, pos, ...toRow(item, child.columns)]) : []
    }));
    return {
        key,
        values: toRow(
            doc,
            spec.columns,
            spec.childList.map((child) => child.field)
        ),
        children
    };
}

// Câu INSERT nhiều dòng (chia nhỏ để không vượt giới hạn 65535 tham số)
async function bulkInsert(client, table, cols, rows, conflict) {
    const size = Math.max(1, Math.floor(30000 / cols.length));
    for (let start = 0; start < rows.length; start += size) {
        const chunk = rows.slice(start, start + size);
        const params = [];
        const tuples = chunk.map((row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`);
        await client.query(`INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES ${tuples.join(', ')}${conflict || ''}`, params);
    }
}

export async function persist(work) {
    await transaction(async (client) => {
        for (const { spec, deletes, rows } of work.changes) {
            if (deletes.length) await client.query(`DELETE FROM ${q(spec.table)} WHERE ${q(spec.keyCol.col)} = ANY($1)`, [deletes]);
            if (!rows.length) continue;
            const cols = [...spec.columns.map((column) => column.col), 'extra'];
            const update = cols
                .filter((col) => col !== spec.keyCol.col)
                .map((col) => `${q(col)} = EXCLUDED.${q(col)}`)
                .join(', ');
            await bulkInsert(
                client,
                spec.table,
                cols,
                rows.map((row) => row.values),
                ` ON CONFLICT (${q(spec.keyCol.col)}) DO UPDATE SET ${update}`
            );
            // dòng con (sản phẩm trong đơn, lịch sử đơn, địa chỉ...): xóa của các bản ghi vừa đổi rồi chèn lại
            for (const child of spec.childList) {
                await client.query(`DELETE FROM ${q(child.table)} WHERE ${q(child.parentCol)} = ANY($1)`, [rows.map((row) => row.key)]);
                const childRows = rows.flatMap((row) => row.children.find((entry) => entry.child === child).rows);
                if (childRows.length)
                    await bulkInsert(
                        client,
                        child.table,
                        [child.parentCol, 'pos', ...child.columns.map((column) => column.col), 'extra'],
                        childRows
                    );
            }
        }
        if (work.stateDeletes.length) await client.query('DELETE FROM app_state WHERE key = ANY($1)', [work.stateDeletes]);
        for (const [key, text] of work.state) {
            await client.query(
                'INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                [key, text]
            );
        }
    });
    snapshot = work.next;
}
