/**
 * Phiên đăng nhập & token tạm (2FA) — lưu MySQL cho Vercel/serverless.
 */
let schemaReady = false;

async function ensureAuthStoreSchema(dbQuery) {
    if (schemaReady) return;
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token VARCHAR(64) PRIMARY KEY,
            user_id INT NOT NULL,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL,
            expires_at BIGINT NOT NULL,
            INDEX idx_auth_sess_expires (expires_at),
            INDEX idx_auth_sess_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS auth_pending_tokens (
            token VARCHAR(64) PRIMARY KEY,
            kind VARCHAR(32) NOT NULL,
            user_id INT NOT NULL,
            secret VARCHAR(64) NULL,
            expires_at BIGINT NOT NULL,
            INDEX idx_auth_pending_expires (expires_at),
            INDEX idx_auth_pending_user_kind (user_id, kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS auth_otp_codes (
            email VARCHAR(255) PRIMARY KEY,
            code VARCHAR(10) NOT NULL,
            otp_type VARCHAR(32) NOT NULL DEFAULT 'register',
            attempts INT NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            INDEX idx_auth_otp_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS auth_reset_tokens (
            token VARCHAR(64) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            created_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL,
            INDEX idx_auth_reset_email (email),
            INDEX idx_auth_reset_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    schemaReady = true;
}

async function purgeExpired(dbQuery) {
    const now = Date.now();
    await dbQuery('DELETE FROM auth_sessions WHERE expires_at < ?', [now]);
    await dbQuery('DELETE FROM auth_pending_tokens WHERE expires_at < ?', [now]);
    await dbQuery('DELETE FROM auth_otp_codes WHERE expires_at < ?', [now]);
    await dbQuery('DELETE FROM auth_reset_tokens WHERE expires_at < ?', [now]);
}

async function saveSession(dbQuery, token, session) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery(
        `INSERT INTO auth_sessions (token, user_id, email, role, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           email = VALUES(email),
           role = VALUES(role),
           status = VALUES(status),
           expires_at = VALUES(expires_at)`,
        [token, session.id, session.email, session.role, session.status, session.expiresAt],
    );
}

async function getSession(dbQuery, token) {
    await ensureAuthStoreSchema(dbQuery);
    const rows = await dbQuery(
        'SELECT user_id, email, role, status, expires_at FROM auth_sessions WHERE token = ? LIMIT 1',
        [token],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.now() > Number(row.expires_at)) {
        await deleteSession(dbQuery, token);
        return null;
    }
    return {
        id: row.user_id,
        email: row.email,
        role: row.role,
        status: row.status,
        expiresAt: Number(row.expires_at),
    };
}

async function deleteSession(dbQuery, token) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('DELETE FROM auth_sessions WHERE token = ?', [token]);
}

async function updateSessionsRoleForUser(dbQuery, userId, newRole) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('UPDATE auth_sessions SET role = ? WHERE user_id = ?', [newRole, userId]);
}

async function savePendingToken(dbQuery, { token, kind, userId, secret, expiresAt }) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('DELETE FROM auth_pending_tokens WHERE user_id = ? AND kind = ?', [userId, kind]);
    await dbQuery(
        'INSERT INTO auth_pending_tokens (token, kind, user_id, secret, expires_at) VALUES (?, ?, ?, ?, ?)',
        [token, kind, userId, secret || null, expiresAt],
    );
}

async function getPendingToken(dbQuery, token, kind) {
    await ensureAuthStoreSchema(dbQuery);
    const rows = await dbQuery(
        'SELECT user_id, secret, expires_at FROM auth_pending_tokens WHERE token = ? AND kind = ? LIMIT 1',
        [token, kind],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.now() > Number(row.expires_at)) {
        await deletePendingToken(dbQuery, token);
        return null;
    }
    return {
        userId: row.user_id,
        secret: row.secret || null,
        expiresAt: Number(row.expires_at),
    };
}

async function deletePendingToken(dbQuery, token) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('DELETE FROM auth_pending_tokens WHERE token = ?', [token]);
}

async function saveOtp(dbQuery, email, { code, type, expiresAt }) {
    await ensureAuthStoreSchema(dbQuery);
    const key = email.toLowerCase();
    const now = Date.now();
    await dbQuery(
        `INSERT INTO auth_otp_codes (email, code, otp_type, attempts, created_at, expires_at)
         VALUES (?, ?, ?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE
           code = VALUES(code),
           otp_type = VALUES(otp_type),
           attempts = 0,
           created_at = VALUES(created_at),
           expires_at = VALUES(expires_at)`,
        [key, code, type || 'register', now, expiresAt],
    );
}

async function getOtp(dbQuery, email) {
    await ensureAuthStoreSchema(dbQuery);
    const rows = await dbQuery(
        'SELECT code, otp_type, attempts, created_at, expires_at FROM auth_otp_codes WHERE email = ? LIMIT 1',
        [email.toLowerCase()],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.now() > Number(row.expires_at)) {
        await deleteOtp(dbQuery, email);
        return null;
    }
    return {
        code: row.code,
        type: row.otp_type,
        attempts: row.attempts,
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
    };
}

async function incrementOtpAttempts(dbQuery, email) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE email = ?', [email.toLowerCase()]);
}

async function deleteOtp(dbQuery, email) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('DELETE FROM auth_otp_codes WHERE email = ?', [email.toLowerCase()]);
}

async function saveResetToken(dbQuery, token, email, expiresAt) {
    await ensureAuthStoreSchema(dbQuery);
    const key = email.toLowerCase();
    const now = Date.now();
    await dbQuery('DELETE FROM auth_reset_tokens WHERE email = ?', [key]);
    await dbQuery(
        'INSERT INTO auth_reset_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
        [token, key, now, expiresAt],
    );
}

async function getResetToken(dbQuery, token) {
    await ensureAuthStoreSchema(dbQuery);
    const rows = await dbQuery(
        'SELECT email, created_at, expires_at FROM auth_reset_tokens WHERE token = ? LIMIT 1',
        [token],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.now() > Number(row.expires_at)) {
        await deleteResetToken(dbQuery, token);
        return null;
    }
    return {
        email: row.email,
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
    };
}

async function getRecentResetForEmail(dbQuery, email) {
    await ensureAuthStoreSchema(dbQuery);
    const rows = await dbQuery(
        'SELECT created_at FROM auth_reset_tokens WHERE email = ? ORDER BY created_at DESC LIMIT 1',
        [email.toLowerCase()],
    );
    return rows[0] ? { createdAt: Number(rows[0].created_at) } : null;
}

async function deleteResetToken(dbQuery, token) {
    await ensureAuthStoreSchema(dbQuery);
    await dbQuery('DELETE FROM auth_reset_tokens WHERE token = ?', [token]);
}

module.exports = {
    ensureAuthStoreSchema,
    purgeExpired,
    saveSession,
    getSession,
    deleteSession,
    updateSessionsRoleForUser,
    savePendingToken,
    getPendingToken,
    deletePendingToken,
    saveOtp,
    getOtp,
    incrementOtpAttempts,
    deleteOtp,
    saveResetToken,
    getResetToken,
    getRecentResetForEmail,
    deleteResetToken,
    PENDING_2FA_SETUP: '2fa_setup',
    PENDING_2FA_LOGIN: '2fa_login',
};
