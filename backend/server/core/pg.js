// Kết nối PostgreSQL (Supabase, Neon hoặc Postgres tự cài). Chỉ bật khi có biến DATABASE_URL;
// không có thì server lưu dữ liệu vào data/db.json như cũ (chạy thử trên máy, bộ test).
export const DATABASE_URL = process.env.DATABASE_URL || '';
export const USE_PG = Boolean(DATABASE_URL);
// DB_SCHEMA: schema riêng (bộ test mỗi file một schema để không đụng nhau); mặc định public
export const DB_SCHEMA = process.env.DB_SCHEMA || 'public';

let pool = null;

async function createPool() {
    const { default: pg } = await import('pg');
    // Kiểu trả về giữ đúng như dữ liệu trong bộ nhớ: ngày (date) là chuỗi YYYY-MM-DD, bigint là số
    pg.types.setTypeParser(1082, (value) => value);
    pg.types.setTypeParser(20, (value) => Number(value));
    const url = new URL(DATABASE_URL);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    url.searchParams.delete('sslmode');
    const options = /^\w+$/.test(DB_SCHEMA) && DB_SCHEMA !== 'public' ? `-c search_path=${DB_SCHEMA}` : undefined;
    // Máy chủ ngoài (Supabase, Neon) bắt buộc SSL
    const created = new pg.Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: false }, max: 5, options });
    created.on('error', (error) => console.error('[db]', error.message));
    return created;
}

export async function getPool() {
    if (!USE_PG) throw new Error('Chưa đặt DATABASE_URL.');
    pool ||= await createPool();
    return pool;
}

export async function query(text, params) {
    return (await getPool()).query(text, params);
}

// Chạy nhiều câu lệnh trong một transaction: lỗi giữa chừng thì không ghi gì cả
export async function transaction(work) {
    const client = await (await getPool()).connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

export async function closePool() {
    if (pool) await pool.end();
    pool = null;
}
