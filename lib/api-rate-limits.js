/**
 * Rate limit theo user (session) hoặc IP — chống spam API sau đăng nhập.
 */
const rateLimit = require('express-rate-limit');

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

function userKey(req) {
    if (req.user?.id != null) return `u:${req.user.id}`;
    return `ip:${getClientIp(req)}`;
}

function createUserLimiter({ windowMs, max, message }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message },
        keyGenerator: userKey,
    });
}

module.exports = {
    getClientIp,
    syncLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 8,
        message: 'Đồng bộ quá nhanh. Đợi 1 phút rồi thử lại.',
    }),
    smmServicesLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 120,
        message: 'Tải bảng giá quá nhiều lần. Đợi 1 phút.',
    }),
    smmOrderLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 8,
        message: 'Đặt đơn quá nhanh. Đợi 1 phút.',
    }),
    pagesListLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 120,
        message: 'Tải Fanpage quá nhanh. Đợi 1 phút.',
    }),
    pagesWriteLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 15,
        message: 'Thao tác Fanpage quá nhanh. Đợi 1 phút.',
    }),
    checkPageLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 20,
        message: 'Kiểm tra Fanpage quá nhanh. Đợi 1 phút.',
    }),
    supportTicketLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 5,
        message: 'Tạo ticket quá nhanh. Đợi 1 phút.',
    }),
    supportReplyLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 20,
        message: 'Gửi tin nhắn quá nhanh. Đợi 1 phút.',
    }),
    ordersListLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 120,
        message: 'Tải lịch sử đơn quá nhanh. Đợi 1 phút.',
    }),
    momoPaymentLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 5,
        message: 'Tạo thanh toán MoMo quá nhanh. Đợi 1 phút.',
    }),
    profileUpdateLimiter: createUserLimiter({
        windowMs: 60 * 1000,
        max: 60,
        message: 'Cập nhật hồ sơ quá nhanh. Đợi 1 phút.',
    }),
};
