/**
 * Lấy IP client — socket/proxy + IP công khai do trình duyệt báo (localhost dev)
 */
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function normalizeClientIp(raw) {
    if (!raw) return null;
    let ip = String(raw).trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1') return '127.0.0.1';
    return ip;
}

function isValidPublicIpv4(ip) {
    const n = normalizeClientIp(ip);
    if (!n || !IPV4_RE.test(n)) return false;
    if (n === '127.0.0.1' || n === '0.0.0.0') return false;
    const parts = n.split('.').map(Number);
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    return true;
}

function isLoopbackOrPrivate(ip) {
    const n = normalizeClientIp(ip);
    if (!n) return true;
    if (n === '127.0.0.1' || n === 'localhost') return true;
    if (!IPV4_RE.test(n)) return false;
    const parts = n.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

function getClientIp(req) {
    if (!req) return '127.0.0.1';
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',')[0].trim();
        const n = normalizeClientIp(first);
        if (n) return n;
    }
    const sock =
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        null;
    return normalizeClientIp(sock) || '127.0.0.1';
}

/** IP lưu DB: ưu tiên socket nếu là IP thật; nếu localhost thì dùng IP công khai từ client */
function resolveClientIp(req, reportedPublicIp) {
    const socketIp = getClientIp(req);
    if (!isLoopbackOrPrivate(socketIp)) return socketIp;

    const reported = normalizeClientIp(reportedPublicIp);
    if (reported && isValidPublicIpv4(reported)) return reported;

    return socketIp;
}

function getReportedPublicIp(req) {
    if (!req?.body) return null;
    return req.body.publicIp || req.body.clientPublicIp || null;
}

function getClientUserAgent(req) {
    return req?.get?.('user-agent') || req?.headers?.['user-agent'] || null;
}

module.exports = {
    getClientIp,
    getClientUserAgent,
    normalizeClientIp,
    resolveClientIp,
    getReportedPublicIp,
    isValidPublicIpv4,
    isLoopbackOrPrivate,
};
