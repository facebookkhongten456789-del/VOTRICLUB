/**
 * Middleware bảo mật: chặn path nhạy cảm, header, static an toàn.
 */
const path = require('path');
const express = require('express');

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/** Chỉ trả mã OTP/link reset trong response khi bật rõ ràng (dev local). */
function isDevSimulatorAllowed() {
    if (process.env.ALLOW_DEV_SIMULATOR === '1') return true;
    if (process.env.ALLOW_DEV_SIMULATOR === '0') return false;
    return !isProduction();
}

const BLOCKED_PATH_RE = [
    /^\/database(\/|$)/i,
    /^\/routes(\/|$)/i,
    /^\/lib(\/|$)/i,
    /^\/scripts(\/|$)/i,
    /^\/docs(\/|$)/i,
    /^\/node_modules(\/|$)/i,
    /^\/\.env/i,
    /^\/server\.js$/i,
    /^\/package(-lock)?\.json$/i,
    /^\/implementation_plan\.md$/i,
    /^\/API_DOCS\.md$/i,
    /^\/debug-[\w-]+\.log$/i,
    /^\/\.git(\/|$)/i,
    /phpmyadmin/i,
    /pma\//i,
    /\/myadmin/i,
];

function blockSensitivePaths(req, res, next) {
    const raw = (req.path || req.url || '').split('?')[0];
    const decoded = decodeURIComponent(raw).toLowerCase();

    if (decoded.includes('..') || raw.includes('%2e')) {
        return res.status(400).json({ success: false, message: 'Not found' });
    }

    for (const re of BLOCKED_PATH_RE) {
        if (re.test(raw) || re.test(decoded)) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
    }
    next();
}

function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-XSS-Protection', '0');
    if (isProduction()) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}

function buildCorsMiddleware(corsModule) {
    const raw = process.env.ALLOWED_ORIGINS || '';
    const allowed = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    if (!allowed.length) {
        return corsModule({
            origin(origin, callback) {
                if (!origin) return callback(null, true);
                if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
                    return callback(null, true);
                }
                return callback(null, false);
            },
            credentials: true,
        });
    }

    return corsModule({
        origin(origin, callback) {
            if (!origin || allowed.includes(origin)) return callback(null, true);
            return callback(null, false);
        },
        credentials: true,
    });
}

/** Chỉ phục vụ app.js, style.css, js/* — không expose server.js, database/, lib/. */
function applySafeStatic(app, rootDir) {
    const staticOpts = {
        etag: false,
        lastModified: false,
        dotfiles: 'deny',
        setHeaders(res) {
            res.setHeader('Cache-Control', 'no-cache');
        },
    };

    app.use('/js', express.static(path.join(rootDir, 'js'), staticOpts));
    app.use('/assets', express.static(path.join(rootDir, 'assets'), staticOpts));
    app.use('/views', express.static(path.join(rootDir, 'views'), staticOpts));
    app.use('/uploads', express.static(path.join(rootDir, 'uploads'), staticOpts));

    app.get('/app.js', (_req, res) => {
        res.sendFile(path.join(rootDir, 'app.js'));
    });
    app.get('/style.css', (_req, res) => {
        res.sendFile(path.join(rootDir, 'style.css'));
    });
}

function sanitizeIncludePath(relativePath) {
    if (!relativePath || relativePath.includes('..')) return null;
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized.startsWith('views/') || !normalized.endsWith('.html')) return null;
    return normalized;
}

module.exports = {
    isProduction,
    isDevSimulatorAllowed,
    blockSensitivePaths,
    securityHeaders,
    buildCorsMiddleware,
    applySafeStatic,
    sanitizeIncludePath,
};
