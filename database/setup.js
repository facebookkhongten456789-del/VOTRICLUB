/**
 * VÔ TRI CLUB - Auto Database Initializer
 * ========================================
 * Chạy script này để tự động import schema SQL vào MySQL.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function setup() {
    console.log('--- KHỞI TẠO CƠ SỞ DỮ LIỆU ---');
    try {
        // Connect to MySQL server (with multipleStatements: true)
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            multipleStatements: true
        });

        console.log('[1/3] Kết nối thành công tới MySQL Server.');

        const sqlPath = path.join(__dirname, 'init.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('[2/3] Đang import file init.sql...');
        await connection.query(sql);

        console.log('✅ [3/3] Đã tạo thành công database: votri_club');
        console.log('   - Bảng: users, deposits, support_tickets, ticket_messages, orders');
        console.log('   - Đã tạo tài khoản Admin mặc định: admin@votri.club / Admin@123');
        
        await connection.end();
        process.exit(0);
    } catch (err) {
        console.error('❌ Lỗi thiết lập database:', err.message);
        process.exit(1);
    }
}

setup();
