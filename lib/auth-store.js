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
    schemaReady = true;
}

async function purgeExpired(dbQuery) {
    const now = Date.now();
    await dbQuery('DELETE FROM auth_sessions WHERE expires_at < ?', [now]);
    await dbQuery('DELETE FROM auth_pending_tokens WHERE expires_at < ?', [now]);
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
    PENDING_2FA_SETUP: '2fa_setup',
    PENDING_2FA_LOGIN: '2fa_login',
};
