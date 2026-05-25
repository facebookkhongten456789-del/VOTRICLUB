/**
 * VÔ TRI CLUB - MySQL Database Connection Pool
 * =============================================
 * Sử dụng mysql2/promise cho async/await support.
 * Tự động reconnect nếu mất kết nối.
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'votri_club',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

/**
 * Execute a SQL query with parameterized values
 * @param {string} sql - SQL query string
 * @param {Array} params - Parameterized values
 * @returns {Promise<Array>} Query results
 */
async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        await conn.ping();
        conn.release();
        return true;
    } catch (err) {
        console.error('[DB] Connection failed:', err.message);
        return false;
    }
}

module.exports = { pool, query, testConnection };
