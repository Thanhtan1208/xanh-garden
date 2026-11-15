// Cấu hình PM2 khi chạy trên VPS: giữ server chạy nền, tự khởi động lại khi lỗi hoặc khi máy khởi động lại.
// Dùng: npm run build, rồi pm2 start ecosystem.config.cjs, pm2 save, pm2 startup
module.exports = {
    apps: [
        {
            name: 'xanh-garden',
            cwd: './backend',
            script: 'server/start.js',
            // Dữ liệu nằm trong bộ nhớ của một tiến trình: chỉ chạy 1 bản, không dùng cluster
            instances: 1,
            exec_mode: 'fork',
            max_memory_restart: '400M',
            env: { NODE_ENV: 'production' }
        }
    ]
};
