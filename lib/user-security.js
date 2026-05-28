/**
 * Schema + nhật ký + thiết bị đăng nhập + email cảnh báo
 */
const crypto = require('crypto');
const emailjs = require('@emailjs/nodejs');
const { getEmailJsConfig } = require('./emailjs-config');
const { normalizeUserRole } = require('./user-roles');
const { getClientIp, getClientUserAgent, resolveClientIp, getReportedPublicIp } = require('./client-ip');

let schemaReady = false;

async function ensureUserSecuritySchema(dbQuery) {
    if (schemaReady) return;
    const alters = [
        'ALTER TABLE users ADD COLUMN avatar_url MEDIUMTEXT NULL',
        'ALTER TABLE users ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0',
        'ALTER TABLE users ADD COLUMN two_factor_secret VARCHAR(64) NULL',
        'ALTER TABLE users ADD COLUMN notify_new_login TINYINT(1) NOT NULL DEFAULT 1',
        'ALTER TABLE users ADD COLUMN last_name_change DATETIME NULL',
        'ALTER TABLE users ADD COLUMN block_reason VARCHAR(500) NULL',
        'ALTER TABLE users ADD COLUMN blocked_at DATETIME NULL',
        'ALTER TABLE users ADD COLUMN facebook_id VARCHAR(50) NULL UNIQUE',
    ];
    for (const sql of alters) {
        try {
            await dbQuery(sql);
        } catch (_) { /* cột đã tồn tại */ }
    }
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS user_activity_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            action VARCHAR(255) NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'Thành công',
            ip VARCHAR(45) NULL,
            user_agent TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_created (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS user_known_devices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            device_hash VARCHAR(64) NOT NULL,
            device_label VARCHAR(255) NULL,
            ip VARCHAR(45) NULL,
            user_agent TEXT NULL,
            first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_device (user_id, device_hash),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    schemaReady = true;
}

function deviceHash(ip, userAgent) {
    return crypto
        .createHash('sha256')
        .update(`${ip || ''}|${userAgent || ''}`)
        .digest('hex');
}

function deviceLabel(userAgent) {
    const ua = String(userAgent || 'Unknown');
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Thiết bị khác';
}

async function updateUserConnectionMeta(dbQuery, userId, req, reportedPublicIp = null) {
    if (!userId || !req) return null;
    const reported = reportedPublicIp ?? getReportedPublicIp(req);
    const ip = resolveClientIp(req, reported);
    const ua = getClientUserAgent(req);
    await dbQuery('UPDATE users SET ip = ?, user_agent = ? WHERE id = ?', [ip, ua, userId]);
    return { ip, userAgent: ua };
}

async function logUserActivity(dbQuery, userId, action, status = 'Thành công', req = null) {
    await ensureUserSecuritySchema(dbQuery);
    const ip = req ? resolveClientIp(req, getReportedPublicIp(req)) : null;
    const ua = req ? getClientUserAgent(req) : null;
    await dbQuery(
        'INSERT INTO user_activity_logs (user_id, action, status, ip, user_agent) VALUES (?,?,?,?,?)',
        [userId, action, status, ip, ua],
    );
}

async function fetchUserLogs(dbQuery, userId, limit = 50) {
    await ensureUserSecuritySchema(dbQuery);
    const rows = await dbQuery(
        `SELECT action, status, created_at FROM user_activity_logs
         WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, limit],
    );
    return rows.map((r) => ({
        action: r.action,
        status: r.status,
        time: r.created_at,
    }));
}

async function sendNewLoginEmail({ email, name, deviceInfo, ip, loginTime }) {
    const { publicKey: pubKey, privateKey: privKey, serviceId, templateId } =
        getEmailJsConfig('new_login');
    if (!pubKey || !privKey || !serviceId || !templateId || templateId === 'your_new_login_template_id_here') {
        console.warn(
            '[SECURITY] EmailJS thiết bị lạ chưa đủ cấu hình (NEW_LOGIN_* hoặc EMAILJS_NEW_LOGIN_TEMPLATE_ID). Xem docs/EMAIL_NEW_LOGIN.md',
        );
        return false;
    }
    const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const profileLink = `${base}/`;
    const timeStr =
        loginTime ||
        new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

    try {
        await emailjs.send(
            serviceId,
            templateId,
            {
                name: name || 'Thành viên',
                email,
                to_email: email,
                user_email: email,
                reply_to: email,
                device: deviceInfo || 'Thiết bị không xác định',
                ip: ip || 'Không rõ',
                login_time: timeStr,
                profile_link: profileLink,
            },
            { publicKey: pubKey, privateKey: privKey },
        );
        console.log(`[SECURITY] New-login email sent → ${email}`);
        return true;
    } catch (err) {
        console.error('[NEW LOGIN EMAIL]', err.message || err);
        return false;
    }
}

/**
 * Ghi nhận thiết bị; nếu mới + bật thông báo → gửi email + log
 */
async function recordLoginDevice(dbQuery, user, req) {
    await ensureUserSecuritySchema(dbQuery);
    const reported = getReportedPublicIp(req);
    await updateUserConnectionMeta(dbQuery, user.id, req, reported);
    const ip = resolveClientIp(req, reported);
    const ua = getClientUserAgent(req) || 'Unknown';
    const hash = deviceHash(ip, ua);
    const label = deviceLabel(ua);

    const existing = await dbQuery(
        'SELECT id FROM user_known_devices WHERE user_id = ? AND device_hash = ?',
        [user.id, hash],
    );

    if (existing.length) {
        await dbQuery(
            'UPDATE user_known_devices SET last_seen = NOW(), ip = ?, user_agent = ? WHERE id = ?',
            [ip, ua, existing[0].id],
        );
        return { isNew: false };
    }

    await dbQuery(
        'INSERT INTO user_known_devices (user_id, device_hash, device_label, ip, user_agent) VALUES (?,?,?,?,?)',
        [user.id, hash, label, ip, ua],
    );

    const notify = user.notify_new_login !== 0 && user.notify_new_login !== false;
    if (notify) {
        await sendNewLoginEmail({
            email: user.email,
            name: user.name,
            deviceInfo: label,
            ip,
        });
        await logUserActivity(
            dbQuery,
            user.id,
            `Đăng nhập thiết bị mới (${label}) — đã gửi email thông báo`,
            'Thành công',
            req,
        );
    } else {
        await logUserActivity(
            dbQuery,
            user.id,
            `Đăng nhập thiết bị mới (${label})`,
            'Thành công',
            req,
        );
    }

    return { isNew: true, label };
}

function mapUserRow(u, logs = []) {
    return {
        id: 'usr-' + u.id,
        dbId: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: normalizeUserRole(u.role),
        status: u.status,
        balance: parseFloat(u.balance),
        totalDeposited: parseFloat(u.total_deposited),
        registeredAt: u.created_at,
        joinDate: u.created_at,
        avatar: u.avatar_url || null,
        twoFactorEnabled: !!u.two_factor_enabled,
        notifyNewLogin: u.notify_new_login !== 0,
        lastNameChange: u.last_name_change || null,
        logs,
    };
}

module.exports = {
    ensureUserSecuritySchema,
    updateUserConnectionMeta,
    logUserActivity,
    fetchUserLogs,
    recordLoginDevice,
    mapUserRow,
    deviceHash,
    deviceLabel,
};
