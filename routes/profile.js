/**
 * Hồ sơ cá nhân — mọi cập nhật ghi MySQL (XAMPP)
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateSecret, verifyToken, getOtpAuthUrl } = require('../lib/totp');
const { otpAuthToQrDataUrl } = require('../lib/qr-otp');
const {
    ensureUserSecuritySchema,
    logUserActivity,
    fetchUserLogs,
    mapUserRow,
} = require('../lib/user-security');
const {
    savePendingToken,
    getPendingToken,
    deletePendingToken,
    PENDING_2FA_SETUP,
} = require('../lib/auth-store');

function createProfileRouter({ dbQuery, requireAuth, profileUpdateLimiter }) {
    const router = express.Router();
    const limit = profileUpdateLimiter || ((req, res, next) => next());

    async function loadUser(userId) {
        const rows = await dbQuery(
            `SELECT id, name, email, phone, role, status, balance, total_deposited, created_at,
                    avatar_url, two_factor_enabled, two_factor_secret, notify_new_login, last_name_change
             FROM users WHERE id = ?`,
            [userId],
        );
        return rows[0] || null;
    }

    router.get('/', requireAuth, async (req, res) => {
        try {
            await ensureUserSecuritySchema(dbQuery);
            const user = await loadUser(req.user.id);
            if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({ success: true, user: mapUserRow(user, logs) });
        } catch (err) {
            console.error('[PROFILE GET]', err);
            return res.status(500).json({ success: false, message: 'Lỗi tải hồ sơ.' });
        }
    });

    router.patch('/', requireAuth, limit, async (req, res) => {
        try {
            await ensureUserSecuritySchema(dbQuery);
            const { name } = req.body;
            const newName = String(name || '').trim();
            if (!newName || newName.length < 2) {
                return res.status(400).json({ success: false, message: 'Tên phải có ít nhất 2 ký tự.' });
            }

            const user = await loadUser(req.user.id);
            if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });

            if (user.last_name_change) {
                const diffDays = Math.ceil(
                    Math.abs(Date.now() - new Date(user.last_name_change).getTime()) / (1000 * 60 * 60 * 24),
                );
                if (diffDays < 60 && user.name !== newName) {
                    return res.status(400).json({
                        success: false,
                        message: `Chỉ đổi tên 1 lần / 60 ngày. Còn ${60 - diffDays} ngày.`,
                    });
                }
            }

            if (user.name === newName) {
                return res.json({ success: true, message: 'Tên không thay đổi.', user: mapUserRow(user, await fetchUserLogs(dbQuery, req.user.id)) });
            }

            await dbQuery('UPDATE users SET name = ?, last_name_change = NOW() WHERE id = ?', [
                newName,
                req.user.id,
            ]);
            await logUserActivity(dbQuery, req.user.id, 'Cập nhật họ tên', 'Thành công', req);

            const updated = await loadUser(req.user.id);
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({
                success: true,
                message: 'Cập nhật tên thành công.',
                user: mapUserRow(updated, logs),
            });
        } catch (err) {
            console.error('[PROFILE PATCH]', err);
            return res.status(500).json({ success: false, message: 'Lỗi cập nhật hồ sơ.' });
        }
    });

    router.patch('/settings', requireAuth, limit, async (req, res) => {
        try {
            await ensureUserSecuritySchema(dbQuery);
            const { notifyNewLogin } = req.body;
            if (typeof notifyNewLogin !== 'boolean') {
                return res.status(400).json({ success: false, message: 'Thiếu notifyNewLogin (boolean).' });
            }

            await dbQuery('UPDATE users SET notify_new_login = ? WHERE id = ?', [
                notifyNewLogin ? 1 : 0,
                req.user.id,
            ]);
            await logUserActivity(
                dbQuery,
                req.user.id,
                notifyNewLogin
                    ? 'Bật thông báo đăng nhập thiết bị mới'
                    : 'Tắt thông báo đăng nhập thiết bị mới',
                'Thành công',
                req,
            );

            const user = await loadUser(req.user.id);
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({
                success: true,
                message: 'Đã lưu cài đặt bảo mật.',
                user: mapUserRow(user, logs),
            });
        } catch (err) {
            console.error('[PROFILE SETTINGS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lưu cài đặt.' });
        }
    });

    router.post('/avatar', requireAuth, limit, async (req, res) => {
        try {
            await ensureUserSecuritySchema(dbQuery);
            const { avatar } = req.body;
            if (!avatar || typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
                return res.status(400).json({ success: false, message: 'Ảnh không hợp lệ.' });
            }
            if (avatar.length > 500000) {
                return res.status(400).json({ success: false, message: 'Ảnh quá lớn.' });
            }

            await dbQuery('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar, req.user.id]);
            await logUserActivity(dbQuery, req.user.id, 'Cập nhật ảnh đại diện', 'Thành công', req);

            const user = await loadUser(req.user.id);
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({
                success: true,
                message: 'Cập nhật ảnh đại diện thành công.',
                user: mapUserRow(user, logs),
            });
        } catch (err) {
            console.error('[PROFILE AVATAR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lưu ảnh.' });
        }
    });

    router.post('/password', requireAuth, limit, async (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body;
            if (!oldPassword || !newPassword) {
                return res.status(400).json({ success: false, message: 'Thiếu mật khẩu.' });
            }
            if (newPassword.length < 6) {
                return res.status(400).json({ success: false, message: 'Mật khẩu mới tối thiểu 6 ký tự.' });
            }

            const rows = await dbQuery('SELECT password FROM users WHERE id = ?', [req.user.id]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });

            let ok = false;
            if (String(rows[0].password).startsWith('$2')) {
                ok = await bcrypt.compare(oldPassword, rows[0].password);
            } else {
                ok = oldPassword === rows[0].password;
            }
            if (!ok) {
                return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
            }

            const hashed = await bcrypt.hash(newPassword, 10);
            await dbQuery('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
            await logUserActivity(dbQuery, req.user.id, 'Đổi mật khẩu tài khoản', 'Thành công', req);

            return res.json({ success: true, message: 'Đổi mật khẩu thành công.' });
        } catch (err) {
            console.error('[PROFILE PASSWORD]', err);
            return res.status(500).json({ success: false, message: 'Lỗi đổi mật khẩu.' });
        }
    });

    router.post('/2fa/setup', requireAuth, limit, async (req, res) => {
        try {
            await ensureUserSecuritySchema(dbQuery);
            const user = await loadUser(req.user.id);
            if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
            if (user.two_factor_enabled) {
                return res.status(400).json({ success: false, message: '2FA đã bật. Tắt trước khi thiết lập lại.' });
            }

            const secret = generateSecret();
            const setupToken = crypto.randomBytes(24).toString('hex');
            await savePendingToken(dbQuery, {
                token: setupToken,
                kind: PENDING_2FA_SETUP,
                userId: req.user.id,
                secret,
                expiresAt: Date.now() + 10 * 60 * 1000,
            });

            const otpauthUrl = getOtpAuthUrl(secret, user.email);
            const qrCodeDataUrl = await otpAuthToQrDataUrl(otpauthUrl);

            return res.json({
                success: true,
                setupToken,
                secret,
                otpauthUrl,
                qrCodeDataUrl,
                message: 'Quét mã QR bằng Google Authenticator.',
            });
        } catch (err) {
            console.error('[2FA SETUP]', err);
            return res.status(500).json({ success: false, message: 'Lỗi thiết lập 2FA.' });
        }
    });

    router.post('/2fa/enable', requireAuth, limit, async (req, res) => {
        try {
            const { setupToken, code } = req.body;
            const pending = await getPendingToken(dbQuery, setupToken, PENDING_2FA_SETUP);
            if (!pending || pending.userId !== req.user.id) {
                await deletePendingToken(dbQuery, setupToken);
                return res.status(400).json({ success: false, message: 'Phiên thiết lập 2FA hết hạn. Thử lại.' });
            }
            if (!verifyToken(pending.secret, code)) {
                return res.status(400).json({ success: false, message: 'Mã 2FA không đúng.' });
            }

            await dbQuery(
                'UPDATE users SET two_factor_enabled = 1, two_factor_secret = ? WHERE id = ?',
                [pending.secret, req.user.id],
            );
            await deletePendingToken(dbQuery, setupToken);
            await logUserActivity(dbQuery, req.user.id, 'Bật xác thực 2 lớp (2FA)', 'Thành công', req);

            const user = await loadUser(req.user.id);
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({
                success: true,
                message: 'Đã bật 2FA thành công.',
                user: mapUserRow(user, logs),
            });
        } catch (err) {
            console.error('[2FA ENABLE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi bật 2FA.' });
        }
    });

    router.post('/2fa/disable', requireAuth, limit, async (req, res) => {
        try {
            const { code, password } = req.body;
            const user = await loadUser(req.user.id);
            if (!user?.two_factor_enabled) {
                return res.json({ success: true, message: '2FA chưa bật.' });
            }

            const passRows = await dbQuery('SELECT password FROM users WHERE id = ?', [req.user.id]);
            let passOk = false;
            if (passRows[0]?.password?.startsWith('$2')) {
                passOk = await bcrypt.compare(password || '', passRows[0].password);
            } else {
                passOk = password === passRows[0].password;
            }
            if (!passOk) {
                return res.status(400).json({ success: false, message: 'Mật khẩu không đúng.' });
            }
            if (!verifyToken(user.two_factor_secret, code)) {
                return res.status(400).json({ success: false, message: 'Mã 2FA không đúng.' });
            }

            await dbQuery(
                'UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?',
                [req.user.id],
            );
            await logUserActivity(dbQuery, req.user.id, 'Tắt xác thực 2 lớp (2FA)', 'Thành công', req);

            const updated = await loadUser(req.user.id);
            const logs = await fetchUserLogs(dbQuery, req.user.id);
            return res.json({
                success: true,
                message: 'Đã tắt 2FA.',
                user: mapUserRow(updated, logs),
            });
        } catch (err) {
            console.error('[2FA DISABLE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi tắt 2FA.' });
        }
    });

    return router;
}

module.exports = { createProfileRouter };
