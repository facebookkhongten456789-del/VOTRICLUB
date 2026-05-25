/**
 * VÔ TRI CLUB - SYSTEM | Backend Server
 * ======================================
 * Express server that:
 * 1. Serves static frontend files (index.html, app.js, style.css)
 * 2. Handles OTP email delivery via EmailJS (server-side, credentials hidden)
 * 3. Generates and validates OTP codes server-side
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const emailjs = require('@emailjs/nodejs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { createOrdersRouter, fetchOrdersForUser } = require('./routes/orders');
const { createSmmRouter } = require('./routes/smm');
const { createPagesRouter, parsePageId } = require('./routes/pages');
const { createFacebookCheckRouter } = require('./routes/facebook-check');
const { createSupportRouter } = require('./routes/support');
const { createProfileRouter } = require('./routes/profile');
const { verifyToken } = require('./lib/totp');
const {
    ensureUserSecuritySchema,
    updateUserConnectionMeta,
    logUserActivity,
    fetchUserLogs,
    recordLoginDevice,
    mapUserRow,
} = require('./lib/user-security');
const { getClientIp, getClientUserAgent, resolveClientIp, getReportedPublicIp } = require('./lib/client-ip');
const { applyAutoRankFromDeposit } = require('./lib/rank-tiers');
const {
    ensureUserRolesSchema,
    normalizeUserRole,
    roleLabelVi,
    isAdminRole,
} = require('./lib/user-roles');
const {
    syncLimiter,
    smmServicesLimiter,
    smmOrderLimiter,
    pagesListLimiter,
    pagesWriteLimiter,
    checkPageLimiter,
    supportTicketLimiter,
    supportReplyLimiter,
    ordersListLimiter,
    momoPaymentLimiter,
    profileUpdateLimiter,
} = require('./lib/api-rate-limits');
const {
    isDevSimulatorAllowed,
    blockSensitivePaths,
    securityHeaders,
    buildCorsMiddleware,
    applySafeStatic,
    sanitizeIncludePath,
    isProduction,
} = require('./lib/security-middleware');

// --- MySQL Connection Pool ---
const db = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'votri_club',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
});

async function dbQuery(sql, params = []) {
    const [rows] = await db.execute(sql, params);
    return rows;
}

// --- Server-side HTML Include Compiler ---
// Xử lý cú pháp: <!-- INCLUDE views/view-dashboard.html -->
function compileIndexHtml() {
    const indexPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    const includeRegex = /<!--\s*INCLUDE\s+([^\s]+)\s*-->/g;
    let match;
    // Reset regex và lặp để thạy thế tất cả include
    while ((match = includeRegex.exec(html)) !== null) {
        const fullMatch = match[0];
        const relativePath = match[1];
        const safePath = sanitizeIncludePath(relativePath);
        if (!safePath) {
            html = html.replace(fullMatch, `<!-- INCLUDE_BLOCKED: ${relativePath} -->`);
            includeRegex.lastIndex = 0;
            continue;
        }
        const filePath = path.join(__dirname, safePath);
        try {
            if (fs.existsSync(filePath)) {
                const viewContent = fs.readFileSync(filePath, 'utf8');
                html = html.replace(fullMatch, viewContent);
                // Reset vì html đã thay đổi
                includeRegex.lastIndex = 0;
            } else {
                console.warn(`[COMPILE WARNING] File not found: ${relativePath}`);
                html = html.replace(fullMatch, `<!-- INCLUDE_NOT_FOUND: ${relativePath} -->`);
                includeRegex.lastIndex = 0;
            }
        } catch (e) {
            console.error(`[COMPILE ERROR] ${relativePath}:`, e.message);
            html = html.replace(fullMatch, `<!-- INCLUDE_ERROR: ${relativePath} -->`);
            includeRegex.lastIndex = 0;
        }
    }
    const cacheTag = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)
        || process.env.VERCEL_DEPLOYMENT_ID
        || (process.env.DEV === '1' ? String(Date.now()) : '1.0.4');
    html = html.replace(/(\.(?:js|css))\?v=[^"']+/g, `$1?v=${cacheTag}`);
    return html;
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}
app.use(securityHeaders);
app.use(blockSensitivePaths);
app.use(buildCorsMiddleware(cors));
app.use(express.json({ limit: '512kb' }));

// --- Auth Middleware ---
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            message: 'Thiếu token xác thực (Authorization: Bearer <token> header).' 
        });
    }
    
    const token = auth.split(' ')[1];
    const session = activeSessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return res.status(401).json({ 
            success: false, 
            message: 'Token hết hạn hoặc không hợp lệ.' 
        });
    }
    
    if (session.status === 'Blocked') {
        activeSessions.delete(token);
        return res.status(403).json({
            success: false,
            message: 'Tài khoản đã bị khóa. Liên hệ hỗ trợ.',
        });
    }

    req.user = session;
    next();
}

function requireAdmin(req, res, next) {
    if (!isAdminRole(req.user?.role)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Không có quyền. Chỉ admin mới được phép.' 
        });
    }
    next();
}

// --- Rate Limiters ---
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,
    message: 'Quá nhiều lần đăng nhập thất bại. Thử lại sau 15 phút.',
    skip: (req) => false,
    keyGenerator: (req) => getClientIp(req)
});

const otpLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 3,
    message: 'Quá nhiều lần gửi OTP. Đợi 1 phút.',
    skip: (req) => false,
    keyGenerator: (req) => req.body?.email || getClientIp(req)
});

const resetLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 3,
    message: 'Quá nhiều lần gửi link đặt lại. Đợi 1 phút.',
    skip: (req) => false,
    keyGenerator: (req) => req.body?.email || getClientIp(req)
});

// Route GET / và /index.html: compile views rồi serve
// Phải đặt TRƯỚC express.static để override file tĩnh
app.get(['/', '/index.html'], (req, res) => {
    try {
        const html = compileIndexHtml();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(html);
    } catch (err) {
        console.error('[COMPILE ERROR]', err);
        res.status(500).send('Lỗi compile views: ' + err.message);
    }
});

// Chỉ phục vụ app.js, style.css, js/* — không lộ server.js, database/, lib/
applySafeStatic(app, __dirname);

app.get('/assets/zalo-icon.svg', (_req, res) => {
    res.type('image/svg+xml');
    res.sendFile(path.join(__dirname, 'assets', 'zalo-icon.svg'));
});

app.get('/favicon.ico', (_req, res) => {
    res.type('image/svg+xml');
    res.sendFile(path.join(__dirname, 'assets', 'favicon.svg'));
});

// --- In-Memory OTP Store (server-side security) ---
// Map<email, { code, expiresAt, type, attempts }>
const otpStore = new Map();

// Map<token, { email, expiresAt }>
const resetTokenStore = new Map();

// Map<token, { id, email, role, expiresAt }>
const activeSessions = new Map();

// Map<tempToken, { userId, expiresAt }> — bước 2 sau mật khẩu khi bật 2FA
const pending2faLogin = new Map();

const OTP_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes (matches email template)
const RESET_VALIDITY_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

function isEmailJsConfigured() {
    const pubKey = process.env.EMAILJS_PUBLIC_KEY;
    const privKey = process.env.EMAILJS_PRIVATE_KEY;
    const serviceId = process.env.EMAILJS_SERVICE_ID;
    return pubKey && privKey && serviceId &&
        pubKey !== 'your_public_key_here' &&
        privKey !== 'your_private_key_here';
}

function getAppBaseUrl(req) {
    if (process.env.APP_BASE_URL) {
        return process.env.APP_BASE_URL.replace(/\/$/, '');
    }
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    return `${protocol}://${host}`;
}

// Cleanup expired OTPs, reset tokens, and sessions every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore.entries()) {
        if (now > data.expiresAt) otpStore.delete(email);
    }
    for (const [token, data] of resetTokenStore.entries()) {
        if (now > data.expiresAt) resetTokenStore.delete(token);
    }
    for (const [token, session] of activeSessions.entries()) {
        if (now > session.expiresAt) activeSessions.delete(token);
    }
    for (const [token, data] of pending2faLogin.entries()) {
        if (now > data.expiresAt) pending2faLogin.delete(token);
    }
}, 5 * 60 * 1000);

function createSessionToken(userRow) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
        id: userRow.id,
        email: userRow.email,
        role: normalizeUserRole(userRow.role),
        status: userRow.status || 'Verified',
        expiresAt: Date.now() + SESSION_VALIDITY_MS,
    });
    return token;
}

function publicUserPayload(userRow) {
    return {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        phone: userRow.phone,
        role: normalizeUserRole(userRow.role),
        status: userRow.status,
        balance: parseFloat(userRow.balance),
        totalDeposited: parseFloat(userRow.total_deposited),
        registeredAt: userRow.created_at,
        twoFactorEnabled: !!userRow.two_factor_enabled,
        notifyNewLogin: userRow.notify_new_login !== 0,
    };
}

function buildEmailParams(email, extra = {}) {
    return {
        email,
        to_email: email,
        user_email: email,
        reply_to: email,
        ...extra
    };
}

const FB_GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v21.0';
const PAGE_DEAD_DAYS = 90;
const DEBUG_LOG_PATH = path.join(__dirname, 'debug-d15afd.log');

// #region agent log
function debugLog(location, message, data, hypothesisId) {
    try {
        fs.appendFileSync(
            DEBUG_LOG_PATH,
            `${JSON.stringify({ sessionId: 'd15afd', location, message, data, hypothesisId, timestamp: Date.now() })}\n`,
        );
    } catch (_) { /* ignore */ }
}
// #endregion

function isInternalDashboardId(value) {
    const s = String(value || '').trim();
    return /^fb-\d+$/i.test(s) || /^usr-/.test(s);
}

function parseFacebookUrl(urlStr) {
    if (!urlStr || !String(urlStr).trim()) return null;
    try {
        const url = new URL(String(urlStr).trim().startsWith('http') ? urlStr.trim() : `https://${urlStr.trim()}`);
        const queryId = url.searchParams.get('id');
        if (queryId && /^\d+$/.test(queryId)) return queryId;

        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'pages' && parts.length >= 2) {
            const last = parts[parts.length - 1];
            if (/^\d+$/.test(last)) return last;
            return parts[1];
        }
        if (parts[0] === 'pg' && parts[1]) return parts[1];

        const last = parts[parts.length - 1];
        if (last && !['profile.php', 'people', 'watch', 'reel', 'photo.php'].includes(last)) {
            return last;
        }
    } catch (_) {
        /* ignore */
    }
    return null;
}

function extractPageIdentifier(identifier, url) {
    const id = identifier ? String(identifier).trim() : '';

    if (id && /^\d+$/.test(id)) return id;
    if (id && !isInternalDashboardId(id)) return id;

    const fromUrl = parseFacebookUrl(url);
    if (fromUrl) return fromUrl;

    return null;
}

function humanizeFbError(message) {
    const msg = (message || '').trim();
    if (!msg) return 'Lỗi Facebook Graph API';
    if (/nonexisting field/i.test(msg)) {
        return 'Một số field không hỗ trợ — vẫn đọc được dữ liệu chính.';
    }
    if (/cannot parse access token/i.test(msg)) {
        return 'Token hết hạn hoặc sai. Generate lại trên Graph Explorer.';
    }
    return compactFbUserMessage(msg);
}

/** Rút gọn toast — bỏ nhiễu me/businesses #100 khi User Token thiếu BM */
function compactFbUserMessage(message) {
    const msg = String(message || '').trim();
    if (!msg) return 'Không đọc được Fanpage.';
    if (/me\/businesses|me\/accounts/i.test(msg) && /#100|Missing Permission|permission/i.test(msg)) {
        return 'Token thiếu quyền hoặc không thấy page. Dùng Page Token (Explorer → chọn Fanpage).';
    }
    if (/me\/accounts/i.test(msg) && /0 page|không thấy page/i.test(msg)) {
        return 'Không thấy page trong token. Dùng Page Token hoặc tick pages_show_list rồi Generate lại.';
    }
    return msg.length > 100 ? `${msg.slice(0, 97)}…` : msg;
}

function pickResolveErrorMessage(warnings, errors) {
    const list = [...(errors || []).map((e) => e.message), ...(warnings || [])].filter(Boolean);
    const useful = list.find((w) => !/me\/businesses|business_management|BM:/i.test(w));
    return compactFbUserMessage(useful || list[0]);
}

async function detectPageAccessToken(accessToken) {
    try {
        const probe = await fbGraphGet('me', accessToken, { fields: 'id,name,category' });
        if (probe.category != null) return { isPage: true, profile: probe };
    } catch (_) {
        /* thử cách khác */
    }
    try {
        await fbGraphGet('me/published_posts', accessToken, { limit: '1', fields: 'id' });
        const profile = await fbGraphGet('me', accessToken, { fields: 'id,name' });
        return { isPage: true, profile };
    } catch (_) {
        return { isPage: false, profile: null };
    }
}

async function fetchBusinessPages(accessToken) {
    const pages = [];
    let bizError = null;
    try {
        const bizRes = await fbGraphGet('me/businesses', accessToken, { fields: 'id,name', limit: '50' });
        for (const biz of bizRes.data || []) {
            for (const edge of ['owned_pages', 'client_pages']) {
                try {
                    const res = await fbGraphGet(`${biz.id}/${edge}`, accessToken, {
                        fields: 'name,id,access_token',
                        limit: '100',
                    });
                    pages.push(...(res.data || []));
                } catch (_) {
                    /* edge không khả dụng */
                }
            }
        }
    } catch (err) {
        const msg = err.message || '';
        if (!/#100|Missing Permission|permission/i.test(msg)) {
            bizError = msg;
        }
    }
    return { pages, bizError };
}

/** Thử đọc thẳng /{page-id|username} — giống Graph Explorer */
async function tryDirectPageById(accessToken, pageKey) {
    const key = pageKey ? String(pageKey).trim() : '';
    if (!key || isInternalDashboardId(key)) return null;
    try {
        const data = await fbGraphGet(key, accessToken, {
            fields: 'id,name,followers_count,fan_count,category',
        });
        if (data?.id) return data;
    } catch (err) {
        // #region agent log
        debugLog('server.js:tryDirectPageById', 'direct lookup failed', {
            key,
            isNumeric: /^\d+$/.test(key),
            error: err.message,
        }, 'A');
        // #endregion
    }
    return null;
}

function applyPageMatch(ctx, match, source, fromUrl, target) {
    ctx.pageId = match.id;
    ctx.pageName = match.name;
    ctx.pageAccessToken = match.access_token || null;
    ctx.activeToken = match.access_token || ctx.activeToken;
    ctx.graphPath = match.access_token ? 'me' : String(match.id);
    ctx.tokenType = match.access_token ? 'page_from_accounts' : 'user_token_page_id';
    ctx.warnings.push(
        `Page "${match.name}" (${match.id}) từ ${source}`
        + (fromUrl ? ` · khớp URL ${fromUrl}` : target ? ` · khớp ID ${target}` : ''),
    );
    return ctx;
}

/** Gộp chunk Graph API — giữ cả connection (posts, published_posts) */
function mergeGraphField(merged, readFields, key, value) {
    if (value === undefined || value === null) return;
    if (value && typeof value === 'object' && Array.isArray(value.data)) {
        merged[key] = value;
        if (!readFields.includes(key)) readFields.push(key);
        return;
    }
    if (typeof value === 'object' && !Array.isArray(value) && key !== 'restrictions') return;
    merged[key] = value;
    if (!readFields.includes(key)) readFields.push(key);
}

/** Gọi từng field riêng — field lỗi không làm fail cả request */
async function fetchGraphFieldsSafe(path, accessToken, fieldNames) {
    const merged = {};
    const readFields = [];
    const skippedFields = [];

    for (const field of fieldNames) {
        try {
            const chunk = await fbGraphGet(path, accessToken, { fields: field });
            Object.entries(chunk).forEach(([key, value]) => {
                mergeGraphField(merged, readFields, key, value);
            });
        } catch (err) {
            skippedFields.push({
                field,
                message: err.message,
                code: err.fbError?.code,
            });
        }
    }

    return { merged, readFields, skippedFields };
}

/** Field expansion giống Graph API Explorer: posts.limit(1){id,message,created_time} */
async function tryFieldExpansion(path, accessToken, expansion) {
    try {
        const data = await fbGraphGet(path, accessToken, { fields: expansion });
        const rootKey = expansion.split('.')[0].split('{')[0];
        const connection = data[rootKey];
        const items = connection?.data || [];
        if (items.length) {
            return { items, source: `${path}?fields=${expansion}`, raw: connection };
        }
    } catch (err) {
        return { items: [], source: null, error: err.message };
    }
    return { items: [], source: null };
}

/**
 * Bước 1: GET me/accounts?fields=name,id,access_token
 * Bước 2: GET /{page-id}?fields=followers_count,fan_count,name,id
 */
function resolveTargetPageId(pageId, identifier, url, userId) {
    const fromUrl = extractPageIdentifier(null, url);
    const candidates = [fromUrl, pageId, identifier].filter(Boolean).map(String);

    for (const id of candidates) {
        if (userId && String(id) === String(userId)) continue;
        if (/^\d+$/.test(id)) return id;
    }
    return fromUrl || null;
}

async function fetchManagedPages(accessToken) {
    const all = [];
    let nextUrl = null;
    let isFirst = true;

    while (isFirst || nextUrl) {
        let res;
        if (isFirst) {
            res = await fbGraphGet('me/accounts', accessToken, {
                fields: 'name,id,access_token',
                limit: '100',
            });
            isFirst = false;
        } else {
            const response = await fetch(nextUrl);
            res = await response.json();
            if (res.error) throw new Error(res.error.message || 'Facebook Graph API error');
        }
        all.push(...(res.data || []));
        nextUrl = res.paging?.next || null;
    }

    return all;
}

function pickPageFromAccounts(accounts, targetPageId, targetUrl, targetPageName, userId) {
    const target = resolveTargetPageId(targetPageId, null, targetUrl, userId);

    let match = null;
    if (target) {
        match = accounts.find((p) => String(p.id) === String(target));
    }
    if (!match && targetPageName) {
        const want = targetPageName.toLowerCase().trim();
        match = accounts.find((p) => p.name.toLowerCase().trim() === want)
            || accounts.find((p) => p.name.toLowerCase().includes(want) || want.includes(p.name.toLowerCase()));
    }
    if (!match && accounts.length === 1) {
        match = accounts[0];
    }

    return { match, target, fromUrl: target };
}

async function resolvePageContext(accessToken, targetPageId, targetUrl, targetPageName) {
    const me = await fbGraphGet('me', accessToken, { fields: 'id,name' });

    const ctx = {
        activeToken: accessToken,
        graphPath: null,
        pageId: null,
        pageName: null,
        pageAccessToken: null,
        tokenHolderId: me.id,
        tokenHolderName: me.name,
        tokenType: 'user_token',
        warnings: [],
        managedPages: [],
        accountsError: null,
    };

    // ── A) Page Access Token (Graph API Explorer → chọn Fanpage) ──
    const pageTokenProbe = await detectPageAccessToken(accessToken);
    if (pageTokenProbe.isPage) {
        const profile = pageTokenProbe.profile || me;
        ctx.pageId = profile.id;
        ctx.pageName = profile.name;
        ctx.graphPath = 'me';
        ctx.activeToken = accessToken;
        ctx.tokenType = 'page_token';
        return ctx;
    }

    const target = resolveTargetPageId(targetPageId, null, targetUrl, me.id);
    // #region agent log
    debugLog('server.js:resolvePageContext', 'resolve target', {
        targetPageId,
        targetUrl: targetUrl ? String(targetUrl).slice(0, 80) : null,
        target,
        meId: me.id,
    }, 'A');
    // #endregion
    if (target) {
        const direct = await tryDirectPageById(accessToken, target);
        // #region agent log
        debugLog('server.js:resolvePageContext', 'direct lookup result', {
            target,
            directId: direct?.id || null,
            directName: direct?.name || null,
        }, 'A');
        // #endregion
        if (direct) {
            ctx.pageId = direct.id;
            ctx.pageName = direct.name;
            ctx.graphPath = String(direct.id);
            ctx.tokenType = 'direct_page_id';
            return ctx;
        }
    }

    // ── B) User Token → me/accounts ──
    let accounts = [];
    try {
        accounts = await fetchManagedPages(accessToken);
        ctx.managedPages = accounts.map((p) => ({ id: p.id, name: p.name }));
    } catch (err) {
        ctx.accountsError = err.message;
        if (!/#100|Missing Permission/i.test(err.message || '')) {
            ctx.warnings.push(`me/accounts: ${compactFbUserMessage(err.message)}`);
        }
    }

    const allPages = [...accounts];
    if (accounts.length === 0) {
        const { pages: bizPages, bizError } = await fetchBusinessPages(accessToken);
        if (bizError) ctx.warnings.push(compactFbUserMessage(bizError));
        for (const bp of bizPages) {
            if (!allPages.some((p) => String(p.id) === String(bp.id))) allPages.push(bp);
        }
    }
    if (allPages.length) {
        ctx.managedPages = allPages.map((p) => ({ id: p.id, name: p.name }));
    }

    if (allPages.length > 0) {
        const { match, target, fromUrl } = pickPageFromAccounts(
            allPages,
            targetPageId,
            targetUrl,
            targetPageName,
            me.id,
        );

        if (match) {
            const source = accounts.some((p) => String(p.id) === String(match.id))
                ? 'me/accounts'
                : 'me/businesses';
            return applyPageMatch(ctx, match, source, fromUrl, target);
        }

        const list = allPages.map((p) => `${p.name} (${p.id})`).join(', ');
        ctx.warnings.push(
            target || fromUrl
                ? `Không tìm page ${fromUrl || target} trong danh sách. Có: ${list}`
                : `Chưa khớp page. Trong BM/accounts: ${list}`,
        );
    } else if (!ctx.accountsError) {
        // #region agent log
        debugLog('server.js:resolvePageContext', 'no pages in token', {
            target,
            accountsCount: allPages.length,
            accountsError: ctx.accountsError,
        }, 'B');
        // #endregion
        ctx.warnings.push('Không thấy page. Dùng Page Token (Explorer → chọn Fanpage).');
    }
    return ctx;
}

/** GET me hoặc /{page-id}?fields=followers_count,... */
async function fetchPageStats(pageId, token, graphPath) {
    const path = graphPath === 'me' ? 'me' : String(pageId);
    const fieldList = ['followers_count', 'fan_count', 'name', 'id', 'link', 'category', 'is_published'];
    try {
        const data = await fbGraphGet(path, token, {
            fields: fieldList.join(','),
        });
        return {
            merged: data,
            readFields: Object.keys(data).filter((k) => data[k] != null),
            skippedFields: [],
        };
    } catch (err) {
        const safe = await fetchGraphFieldsSafe(path, token, fieldList);
        if (!safe.merged.id && !safe.merged.name) {
            safe.skippedFields.push({ field: path, message: err.message, code: err.fbError?.code });
        }
        return safe;
    }
}

function resolveFollowerCount(alive, engagement) {
    if (!alive) return null;
    if (alive.followers_count != null) return Number(alive.followers_count);
    if (alive.fan_count != null) return Number(alive.fan_count);
    const fromInsights = engagement?.metrics?.page_fans;
    if (fromInsights != null) return Number(fromInsights);
    return null;
}

function buildReadSummary(report) {
    const parts = [];
    const alive = report.alive || {};
    if (report.pageContext?.pageName) parts.push(`Page: ${report.pageContext.pageName}`);
    if (alive.id) parts.push(`ID: ${alive.id}`);
    const fans = resolveFollowerCount(alive, report.engagement);
    if (fans != null) parts.push(`Follow/Like: ${fans.toLocaleString('vi-VN')}`);
    if (report.lastPost?.post?.created_time) {
        parts.push(`Post cuối: ${report.lastPost.daysSincePost} ngày trước`);
    } else if (report.lastPost?.postCount > 0) {
        parts.push(`${report.lastPost.postCount} bài viết`);
    }
    if (report.warnings?.length) {
        parts.push(report.warnings[0]);
    }
    if (report.readFields?.length) {
        const unique = [...new Set(report.readFields)];
        parts.push(`Đọc được: ${unique.join(', ')}`);
    }
    return parts.join(' · ') || 'Đã kết nối Graph API';
}

async function fetchLastPost(accessToken, graphPath) {
    const postExpansions = [
        'published_posts.limit(5){id,message,created_time}',
        'posts.limit(5){id,message,created_time}',
        'feed.limit(5){id,message,created_time}',
    ];

    for (const expansion of postExpansions) {
        const result = await tryFieldExpansion(graphPath, accessToken, expansion);
        if (result.items?.length) {
            return {
                post: result.items[0],
                posts: result.items,
                postCount: result.items.length,
                source: result.source,
            };
        }
    }

    const endpoints = [
        [`${graphPath}/published_posts`, { limit: '5', fields: 'id,message,created_time' }],
        [`${graphPath}/posts`, { limit: '5', fields: 'id,message,created_time' }],
    ];

    for (const [path, params] of endpoints) {
        try {
            const posts = await fbGraphGet(path, accessToken, params);
            const items = posts.data || [];
            if (items.length) {
                return {
                    post: items[0],
                    posts: items,
                    postCount: items.length,
                    source: path,
                };
            }
        } catch (_) {
            /* thử endpoint khác */
        }
    }

    return { post: null, posts: [], postCount: 0, source: null };
}

async function fbGraphGet(path, accessToken, params = {}) {
    const url = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${path}`);
    url.searchParams.set('access_token', accessToken);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    });

    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
        const err = new Error(data.error.message || 'Facebook Graph API error');
        err.fbError = data.error;
        throw err;
    }
    return data;
}

/**
 * Kiểm tra Fanpage: me/accounts → /{page-id}?fields=followers_count
 */
async function runFacebookPageChecks(accessToken, targetPageId, targetUrl, targetPageName) {
    const report = {
        mode: 'me_accounts_then_page_id',
        pageContext: null,
        alive: null,
        restrictions: null,
        engagement: null,
        lastPost: null,
        readFields: [],
        skippedFields: [],
        warnings: [],
        errors: [],
    };

    let ctx;
    try {
        ctx = await resolvePageContext(accessToken, targetPageId, targetUrl, targetPageName);
        report.pageContext = {
            pageId: ctx.pageId,
            pageName: ctx.pageName,
            graphPath: ctx.graphPath,
            tokenType: ctx.tokenType,
            tokenHolderName: ctx.tokenHolderName,
            managedPages: ctx.managedPages,
        };
        report.warnings = ctx.warnings || [];
    } catch (err) {
        report.errors.push({ step: 'context', message: err.message, code: err.fbError?.code });
        return report;
    }

        if (!ctx.pageId || !ctx.graphPath) {
        report.errors.push({
            step: 'resolve',
            message: pickResolveErrorMessage(report.warnings, report.errors),
        });
        return report;
    }

    const token = ctx.activeToken;
    const pageId = String(ctx.pageId);
    const graphPath = ctx.graphPath;

    const stats = await fetchPageStats(pageId, token, graphPath);
    const profile = {
        merged: {
            id: pageId,
            name: ctx.pageName,
            ...stats.merged,
        },
        readFields: [
            graphPath === 'me' ? 'me?fields=followers_count' : `/${pageId}?fields=followers_count`,
            ...stats.readFields,
        ],
        skippedFields: stats.skippedFields,
    };
    if (stats.merged.name) profile.merged.name = stats.merged.name;
    if (stats.merged.id) profile.merged.id = stats.merged.id;

    for (const expansion of [
        'published_posts.limit(3){id,message,created_time}',
        'posts.limit(3){id,message,created_time}',
    ]) {
        const result = await tryFieldExpansion(graphPath, token, expansion);
        const rootKey = expansion.split('.')[0];
        if (result.items?.length) {
            profile.merged[rootKey] = { data: result.items };
            profile.readFields.push(`${graphPath}?fields=${rootKey}`);
            break;
        }
        if (result.error) {
            profile.skippedFields.push({ field: expansion, message: result.error });
        }
    }

    try {
        const restr = await fbGraphGet(graphPath, token, { fields: 'restrictions' });
        if (restr.restrictions !== undefined) {
            profile.merged.restrictions = restr.restrictions;
            profile.readFields.push('restrictions');
            const restrictionsList = restr.restrictions?.data || restr.restrictions || [];
            report.restrictions = {
                hasRestrictions: Array.isArray(restrictionsList) ? restrictionsList.length > 0 : Boolean(restr.restrictions),
                restrictions: restrictionsList,
            };
        }
    } catch (err) {
        profile.skippedFields.push({ field: 'restrictions', message: err.message, code: err.fbError?.code });
        report.restrictions = { hasRestrictions: false, error: err.message };
    }

    report.alive = profile.merged;
    report.readFields.push(...profile.readFields);
    report.skippedFields.push(...profile.skippedFields);

    try {
        const insightsPath = graphPath === 'me' ? 'me/insights' : `${pageId}/insights`;
        const insights = await fbGraphGet(insightsPath, token, {
            metric: 'page_fans,page_post_engagements',
            period: 'week',
        });
        const metrics = {};
        (insights.data || []).forEach((item) => {
            const latest = item.values?.[item.values.length - 1]?.value;
            metrics[item.name] = latest ?? null;
        });
        report.engagement = { raw: insights.data, metrics };
        if (metrics.page_fans != null) report.readFields.push('insights.page_fans');
        if (metrics.page_post_engagements != null) report.readFields.push('insights.page_post_engagements');
    } catch (err) {
        report.errors.push({ step: 'engagement', message: err.message, code: err.fbError?.code });
        report.engagement = { metrics: {}, error: err.message };
    }

    try {
        const { post, posts, postCount, source } = await fetchLastPost(token, graphPath);
        let daysSincePost = null;
        let isDead = false;
        if (post?.created_time) {
            const created = new Date(post.created_time);
            daysSincePost = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
            isDead = daysSincePost >= PAGE_DEAD_DAYS;
            report.readFields.push(source || 'posts');
        } else if (postCount === 0) {
            isDead = true;
        }
        report.lastPost = { post, posts, postCount, daysSincePost, isDead, source };
    } catch (err) {
        report.errors.push({ step: 'lastPost', message: err.message, code: err.fbError?.code });
        report.lastPost = { post: null, posts: [], postCount: 0, daysSincePost: null, isDead: false, error: err.message };
    }

    return report;
}

function buildCheckSummary(report, statusInfo) {
    const parts = [statusInfo.reason];
    const fans = resolveFollowerCount(report.alive, report.engagement);
    if (fans != null) {
        parts.push(`${Number(fans).toLocaleString('vi-VN')} follow/like`);
    }
    if (report.alive?.verification_status) {
        parts.push(`Xác minh: ${report.alive.verification_status}`);
    }
    if (report.engagement?.metrics?.page_post_engagements != null) {
        parts.push(`Engagement tuần: ${report.engagement.metrics.page_post_engagements}`);
    }
    if (report.lastPost?.daysSincePost != null) {
        parts.push(`Post cuối: ${report.lastPost.daysSincePost} ngày trước`);
    }
    return parts.join(' · ');
}

app.use('/api', createFacebookCheckRouter({
    runFacebookPageChecks,
    resolveTargetPageId,
    extractPageIdentifier,
    fbGraphGet,
    resolveFollowerCount,
    buildReadSummary,
    buildCheckSummary,
    pickResolveErrorMessage,
    humanizeFbError,
    debugLog,
    requireAuth,
    checkPageLimiter,
    dbQuery,
    parsePageId,
}));

// =========================================================================
// --- DATABASE API ROUTES (MySQL / XAMPP Integration) ---
// =========================================================================

/**
 * POST /api/auth/register
 * Đăng ký tài khoản mới → lưu vào MySQL
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, phone, password, code } = req.body;
        if (!name || !email || !password || !code) {
            return res.status(400).json({ success: false, message: 'Vui lòng cung cấp đầy đủ: Tên, Email, Mật khẩu, OTP.' });
        }

        const stored = otpStore.get(email.toLowerCase());
        if (!stored) return res.status(400).json({ success: false, message: 'Không tìm thấy mã OTP cho email này.' });
        if (stored.attempts >= 5) { otpStore.delete(email.toLowerCase()); return res.status(429).json({ success: false, message: 'Thử OTP quá nhiều lần. Lấy mã mới.' }); }
        if (Date.now() > stored.expiresAt) { otpStore.delete(email.toLowerCase()); return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn.' }); }
        if (code !== stored.code) { stored.attempts++; return res.status(400).json({ success: false, message: `OTP không đúng. Còn ${5 - stored.attempts} lần thử.` }); }
        otpStore.delete(email.toLowerCase());

        const existing = await dbQuery('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
        if (existing.length > 0) return res.status(400).json({ success: false, message: 'Email này đã được sử dụng.' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const ip = getClientIp(req);
        const ua = getClientUserAgent(req) || 'Unknown';
        await dbQuery('INSERT INTO users (name,email,phone,password,role,status,balance,total_deposited,ip,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [name, email.toLowerCase(), phone || null, hashedPassword, 'member', 'Verified', 0, 0, ip, ua]);

        return res.json({ success: true, message: 'Đăng ký thành công! Hãy đăng nhập.' });
    } catch (err) {
        console.error('[REGISTER ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server khi đăng ký.' });
    }
});

/**
 * POST /api/auth/login
 * Đăng nhập → kiểm tra bcrypt trong MySQL → tạo session token
 */
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, message: 'Vui lòng điền Email và Mật khẩu.' });

    // Try DB login first; if DB is unavailable, allow a safe fallback for local dev (admin)
    try {
        const rows = await dbQuery('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
        if (rows.length === 0) return res.status(400).json({ success: false, message: 'Email không tồn tại trong hệ thống.' });

        const user = rows[0];
        if (user.status === 'Blocked') {
            const reason = user.block_reason ? String(user.block_reason).trim() : '';
            const msg = reason
                ? `Tài khoản bị chặn do hành vi vi phạm: ${reason}`
                : 'Tài khoản bị chặn do hành vi vi phạm. Liên hệ hỗ trợ.';
            return res.status(403).json({ success: false, message: msg });
        }

        let isMatch = false;
        if (user.password && String(user.password).startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            // Legacy plaintext password — match then upgrade to bcrypt
            isMatch = password === user.password;
            if (isMatch) {
                const hashed = await bcrypt.hash(password, 10);
                await dbQuery('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
            }
        }
        if (!isMatch) return res.status(400).json({ success: false, message: 'Mật khẩu không chính xác.' });

        await ensureUserSecuritySchema(dbQuery);

        if (user.two_factor_enabled && user.two_factor_secret) {
            const tempToken = crypto.randomBytes(32).toString('hex');
            pending2faLogin.set(tempToken, {
                userId: user.id,
                expiresAt: Date.now() + 5 * 60 * 1000,
            });
            return res.json({
                success: true,
                requires2fa: true,
                tempToken,
                message: 'Nhập mã 6 số từ Google Authenticator.',
            });
        }

        await recordLoginDevice(dbQuery, user, req);
        await logUserActivity(dbQuery, user.id, 'đăng nhập hệ thống (MySQL)', 'Thành công', req);

        const token = createSessionToken(user);
        return res.json({
            success: true,
            token,
            user: publicUserPayload(user),
        });
    } catch (err) {
        console.error('[LOGIN ERROR - DB]:', err.message || err);
        // Chỉ khi bật ALLOW_FALLBACK_ADMIN_LOGIN=1 (dev, DB tắt) — không dùng mật khẩu mặc định trên production
        if (process.env.ALLOW_FALLBACK_ADMIN_LOGIN !== '1') {
            return res.status(500).json({ success: false, message: 'Lỗi server khi đăng nhập. Kiểm tra MySQL (XAMPP) đang chạy.' });
        }

        const fallbackAdmin = {
            email: (process.env.FALLBACK_ADMIN_EMAIL || 'admin@votri.club').toLowerCase(),
            password: process.env.FALLBACK_ADMIN_PASSWORD || '',
        };

        if (!fallbackAdmin.password) {
            return res.status(500).json({ success: false, message: 'Lỗi server khi đăng nhập. Thiếu FALLBACK_ADMIN_PASSWORD trong .env.' });
        }

        if (email.toLowerCase() === fallbackAdmin.email && password === fallbackAdmin.password) {
            console.warn('[LOGIN] Using fallback admin login (DB unavailable).');
            
            // Generate session token
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + SESSION_VALIDITY_MS;
            activeSessions.set(token, {
                id: 0,
                email: fallbackAdmin.email,
                role: 'admin',
                status: 'Verified',
                expiresAt
            });
            
            return res.json({
                success: true,
                token: token,
                user: {
                    id: 0,
                    name: 'Admin (fallback)',
                    email: fallbackAdmin.email,
                    phone: null,
                    role: 'admin',
                    status: 'Verified',
                    balance: 0,
                    totalDeposited: 0,
                    registeredAt: new Date().toISOString()
                }
            });
        }

        return res.status(500).json({ success: false, message: 'Lỗi server khi đăng nhập. Kiểm tra MySQL (XAMPP) đang chạy.' });
    }
});

/**
 * POST /api/auth/verify-2fa
 * Body: { tempToken, code } — hoàn tất đăng nhập sau mật khẩu
 */
app.post('/api/auth/verify-2fa', loginLimiter, async (req, res) => {
    try {
        const { tempToken, code } = req.body || {};
        if (!tempToken || !code) {
            return res.status(400).json({ success: false, message: 'Thiếu mã 2FA hoặc phiên đăng nhập.' });
        }

        const pending = pending2faLogin.get(tempToken);
        if (!pending || Date.now() > pending.expiresAt) {
            pending2faLogin.delete(tempToken);
            return res.status(400).json({ success: false, message: 'Phiên 2FA hết hạn. Đăng nhập lại.' });
        }

        const rows = await dbQuery('SELECT * FROM users WHERE id = ?', [pending.userId]);
        if (!rows.length) {
            pending2faLogin.delete(tempToken);
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản.' });
        }

        const user = rows[0];
        if (!user.two_factor_secret || !verifyToken(user.two_factor_secret, code)) {
            return res.status(400).json({ success: false, message: 'Mã 2FA không đúng.' });
        }

        pending2faLogin.delete(tempToken);
        await recordLoginDevice(dbQuery, user, req);
        await logUserActivity(dbQuery, user.id, 'đăng nhập hệ thống (2FA)', 'Thành công', req);

        const token = createSessionToken(user);
        return res.json({ success: true, token, user: publicUserPayload(user) });
    } catch (err) {
        console.error('[VERIFY 2FA]', err);
        return res.status(500).json({ success: false, message: 'Lỗi xác thực 2FA.' });
    }
});

/**
 * GET /api/auth/me — chỉ user đang đăng nhập (không enumerate email).
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const rows = await dbQuery(
            'SELECT id,name,email,phone,role,status,balance,total_deposited,created_at FROM users WHERE id = ?',
            [req.user.id],
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });

        const u = rows[0];
        return res.json({
            success: true,
            user: {
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                role: u.role,
                status: u.status,
                balance: parseFloat(u.balance),
                totalDeposited: parseFloat(u.total_deposited),
                registeredAt: u.created_at,
            },
        });
    } catch (err) {
        console.error('[ME ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

/**
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 * Validates token and updates password in MySQL
 */
app.post('/api/auth/reset-password', resetLimiter, async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ success: false, message: 'Thiếu token hoặc mật khẩu.' });

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
        }

        const stored = resetTokenStore.get(token);
        if (!stored || Date.now() > stored.expiresAt) {
            resetTokenStore.delete(token);
            return res.status(400).json({ success: false, message: 'Link hết hạn hoặc không hợp lệ.' });
        }

        const email = stored.email;
        const hashed = await bcrypt.hash(password, 10);
        await dbQuery('UPDATE users SET password = ? WHERE email = ?', [hashed, email]);
        resetTokenStore.delete(token);

        return res.json({ success: true, email, message: 'Đặt lại mật khẩu thành công.' });
    } catch (err) {
        console.error('[AUTH RESET-PASSWORD ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server khi đặt lại mật khẩu.' });
    }
});

/**
 * POST /api/sync/data
 * Đồng bộ toàn bộ dữ liệu từ MySQL về client
 * Requires valid session token in Authorization header
 */
app.post('/api/sync/data', requireAuth, syncLimiter, async (req, res) => {
    try {
        const userId = req.user.id;

        const userRows = await dbQuery('SELECT * FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });

        const requester = userRows[0];
        await ensureUserRolesSchema(dbQuery);
        await updateUserConnectionMeta(dbQuery, userId, req, getReportedPublicIp(req));
        const isAdmin = isAdminRole(requester.role);
        let usersList = [], ticketsList = [], depositsList = [], ordersList = [];

        if (isAdmin) {
            await ensureUserSecuritySchema(dbQuery);
            await ensureUserRolesSchema(dbQuery);
            const allUsers = await dbQuery(
                `SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.balance,u.total_deposited,
                        u.ip,u.user_agent,u.block_reason,u.blocked_at,u.created_at,
                        (SELECT d.ip FROM user_known_devices d
                         WHERE d.user_id = u.id ORDER BY d.last_seen DESC LIMIT 1) AS latest_device_ip
                 FROM users u ORDER BY u.created_at DESC`,
            );
            usersList = allUsers.map(u => ({
                id: 'usr-' + u.id, name: u.name, email: u.email, phone: u.phone,
                role: normalizeUserRole(u.role), status: u.status,
                balance: parseFloat(u.balance), totalDeposited: parseFloat(u.total_deposited),
                ip: u.ip || u.latest_device_ip || null,
                userAgent: u.user_agent,
                blockReason: u.block_reason || null,
                blockedAt: u.blocked_at || null,
                registeredAt: u.created_at
            }));

            const allTickets = await dbQuery(`
                SELECT t.id,t.title,t.topic,t.order_id,t.status,t.created_at,t.updated_at,
                       u.email as user_email,u.name as user_name
                FROM support_tickets t JOIN users u ON t.user_id=u.id ORDER BY t.updated_at DESC`);

            for (const t of allTickets) {
                const msgs = await dbQuery(`SELECT m.content,m.created_at,u.email as sender,u.name as sender_name,u.role as sender_role
                    FROM ticket_messages m JOIN users u ON m.sender_id=u.id WHERE m.ticket_id=? ORDER BY m.created_at ASC`, [t.id]);
                ticketsList.push({
                    id: 'TK-' + t.id, title: t.title, topic: t.topic, orderId: t.order_id,
                    status: t.status, userEmail: t.user_email, userName: t.user_name,
                    createdAt: t.created_at, updatedAt: t.updated_at,
                    messages: msgs.map(m => ({ sender: m.sender, senderName: m.sender_name, senderRole: m.sender_role, content: m.content, createdAt: m.created_at }))
                });
            }

            depositsList = (await dbQuery(`SELECT d.*,u.email as user_email FROM deposits d JOIN users u ON d.user_id=u.id ORDER BY d.created_at DESC`))
                .map(d => ({ id: d.id, userEmail: d.user_email, amount: parseFloat(d.amount), method: d.method, transactionId: d.transaction_id, status: d.status, note: d.note, createdAt: d.created_at }));

            ordersList = await fetchOrdersForUser(dbQuery, requester.id, true);
        } else {
            await ensureUserSecuritySchema(dbQuery);
            const fullRows = await dbQuery(
                `SELECT id, name, email, phone, role, status, balance, total_deposited, created_at,
                        avatar_url, two_factor_enabled, notify_new_login, last_name_change
                 FROM users WHERE id = ?`,
                [requester.id],
            );
            const fullUser = fullRows[0] || requester;
            const logs = await fetchUserLogs(dbQuery, requester.id);
            usersList = [mapUserRow(fullUser, logs)];

            const myTickets = await dbQuery(`SELECT t.id,t.title,t.topic,t.order_id,t.status,t.created_at,t.updated_at FROM support_tickets t WHERE t.user_id=? ORDER BY t.updated_at DESC`, [requester.id]);
            for (const t of myTickets) {
                const msgs = await dbQuery(`SELECT m.content,m.created_at,u.email as sender,u.name as sender_name,u.role as sender_role
                    FROM ticket_messages m JOIN users u ON m.sender_id=u.id WHERE m.ticket_id=? ORDER BY m.created_at ASC`, [t.id]);
                ticketsList.push({
                    id: 'TK-' + t.id, title: t.title, topic: t.topic, orderId: t.order_id,
                    status: t.status, userEmail: requester.email, userName: requester.name,
                    createdAt: t.created_at, updatedAt: t.updated_at,
                    messages: msgs.map(m => ({ sender: m.sender, senderName: m.sender_name, senderRole: m.sender_role, content: m.content, createdAt: m.created_at }))
                });
            }

            depositsList = (await dbQuery('SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC', [requester.id]))
                .map(d => ({ id: d.id, amount: parseFloat(d.amount), method: d.method, transactionId: d.transaction_id, status: d.status, note: d.note, createdAt: d.created_at }));

            ordersList = await fetchOrdersForUser(dbQuery, requester.id, false);
        }

        return res.json({ success: true, users: usersList, tickets: ticketsList, deposits: depositsList, orders: ordersList });
    } catch (err) {
        console.error('[SYNC ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi đồng bộ dữ liệu.' });
    }
});

/**
 * POST /api/admin/update-balance
 * Admin cập nhật số dư tài khoản (relative adjustment)
 */
async function userIdFromBody(dbQuery, body) {
    if (body.userId) {
        const uid = parseInt(String(body.userId).replace('usr-', ''), 10);
        return Number.isFinite(uid) ? uid : null;
    }
    if (body.email) {
        const rows = await dbQuery('SELECT id FROM users WHERE email = ? LIMIT 1', [String(body.email).trim()]);
        return rows[0]?.id ?? null;
    }
    return null;
}

app.post('/api/admin/update-balance', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId, email, adjustment, amount, note } = req.body;
        const adjustAmount = parseFloat(adjustment ?? amount);
        
        const uid = await userIdFromBody(dbQuery, { userId, email });
        if (!uid || isNaN(adjustAmount)) {
            return res.status(400).json({ success: false, message: 'Thiếu userId/email hoặc số tiền điều chỉnh.' });
        }
        const userRows = await dbQuery('SELECT id,name,email,balance,total_deposited FROM users WHERE id = ?', [uid]);
        if (!userRows.length) return res.status(404).json({ success: false, message: 'User không tồn tại.' });

        const user = userRows[0];
        const newBalance = parseFloat(user.balance) + adjustAmount;
        
        // Prevent negative balance
        if (newBalance < 0) {
            return res.status(400).json({ success: false, message: 'Số dư không thể âm.' });
        }

        await dbQuery('UPDATE users SET balance = ? WHERE id = ?', [newBalance, uid]);
        
        // Log transaction
        if (note) {
            await dbQuery('INSERT INTO deposits (user_id,amount,method,status,note,confirmed_by) VALUES (?,?,?,?,?,(SELECT id FROM users WHERE id=?))',
                [uid, Math.abs(adjustAmount), 'Admin', 'completed', note, req.user.id]);
        }

        return res.json({ 
            success: true, 
            message: `Cập nhật số dư thành công (${adjustAmount > 0 ? '+' : ''}${adjustAmount} VND).`, 
            user: { 
                id: 'usr-' + user.id, 
                name: user.name, 
                email: user.email, 
                balance: newBalance, 
                totalDeposited: parseFloat(user.total_deposited) 
            } 
        });
    } catch (err) {
        console.error('[UPDATE-BALANCE ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

/**
 * POST /api/admin/users/update-status
 * Admin khóa/mở khóa tài khoản
 */
app.post('/api/admin/users/update-status', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId, email, newStatus, status, blockReason } = req.body;
        const finalStatus = newStatus || status;
        const uid = await userIdFromBody(dbQuery, { userId, email });
        if (!uid || !finalStatus) {
            return res.status(400).json({ success: false, message: 'Thiếu userId/email hoặc trạng thái.' });
        }

        if (uid === req.user.id && finalStatus === 'Blocked') {
            return res.status(400).json({ success: false, message: 'Không thể tự chặn tài khoản đang đăng nhập.' });
        }

        await ensureUserSecuritySchema(dbQuery);

        if (finalStatus === 'Blocked') {
            const reason = String(blockReason || '').trim();
            if (!reason || reason.length < 4) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng ghi rõ hành vi vi phạm khi chặn tài khoản.',
                });
            }
            await dbQuery(
                'UPDATE users SET status = ?, block_reason = ?, blocked_at = NOW() WHERE id = ?',
                [finalStatus, reason.slice(0, 500), uid],
            );
            await logUserActivity(dbQuery, uid, `Admin chặn (hành vi): ${reason.slice(0, 200)}`, 'Chặn', req);
            return res.json({ success: true, message: 'Đã chặn tài khoản theo hành vi vi phạm.' });
        }

        await dbQuery(
            'UPDATE users SET status = ?, block_reason = NULL, blocked_at = NULL WHERE id = ?',
            [finalStatus, uid],
        );
        await logUserActivity(dbQuery, uid, 'Admin mở khóa tài khoản', 'Thành công', req);
        return res.json({ success: true, message: 'Đã mở khóa tài khoản.' });
    } catch (err) {
        console.error('[UPDATE-STATUS ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

/**
 * POST /api/admin/users/delete
 * Admin xóa tài khoản
 */
app.post('/api/admin/users/delete', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId, email } = req.body;
        const uid = await userIdFromBody(dbQuery, { userId, email });
        if (!uid) return res.status(400).json({ success: false, message: 'Thiếu userId hoặc email.' });

        if (uid === req.user.id) {
            return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản đang đăng nhập.' });
        }

        await dbQuery('DELETE FROM users WHERE id = ?', [uid]);
        return res.json({ success: true, message: 'Đã xóa tài khoản.' });
    } catch (err) {
        console.error('[DELETE-USER ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

function refreshSessionsRole(userId, newRole) {
    for (const [, session] of activeSessions) {
        if (session.id === userId) session.role = newRole;
    }
}

/**
 * POST /api/admin/users/update-role
 * Admin đổi vai trò (đồng bộ MySQL / XAMPP)
 */
app.post('/api/admin/users/update-role', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId, email, role } = req.body;
        const newRole = normalizeUserRole(role);
        const uid = await userIdFromBody(dbQuery, { userId, email });
        if (!uid || !newRole) {
            return res.status(400).json({ success: false, message: 'Thiếu userId/email hoặc vai trò.' });
        }

        await ensureUserRolesSchema(dbQuery);

        const rows = await dbQuery('SELECT id, email, role FROM users WHERE id = ?', [uid]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });

        const target = rows[0];
        const rootAdmin = String(target.email).toLowerCase() === 'admin@votri.club';

        if (rootAdmin && newRole !== 'admin') {
            return res.status(400).json({
                success: false,
                message: 'Không thể đổi vai trò tài khoản quản trị gốc.',
            });
        }

        if (uid === req.user.id && isAdminRole(target.role) && newRole !== 'admin') {
            return res.status(400).json({
                success: false,
                message: 'Không thể tự hạ quyền quản trị của chính bạn.',
            });
        }

        if (newRole === 'admin' && !isAdminRole(target.role)) {
            const ok = req.body.confirmAdmin === true;
            if (!ok) {
                return res.status(400).json({
                    success: false,
                    message: 'Cần xác nhận khi cấp quyền Quản trị viên (confirmAdmin: true).',
                });
            }
        }

        await dbQuery('UPDATE users SET role = ? WHERE id = ?', [newRole, uid]);
        await logUserActivity(
            dbQuery,
            uid,
            `Admin đổi vai trò → ${roleLabelVi(newRole)}`,
            'Thành công',
            req,
        );
        refreshSessionsRole(uid, newRole);

        return res.json({
            success: true,
            message: `Đã đổi vai trò thành ${roleLabelVi(newRole)}.`,
            role: newRole,
        });
    } catch (err) {
        console.error('[UPDATE-ROLE ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server.' });
    }
});

app.use('/api/support', createSupportRouter({
    dbQuery,
    requireAuth,
    requireAdmin,
    supportTicketLimiter,
    supportReplyLimiter,
}));

/**
 * POST /api/momo/create-payment
 * Khởi tạo link thanh toán MoMo
 */
app.post('/api/momo/create-payment', requireAuth, momoPaymentLimiter, async (req, res) => {
    try {
        const { amount, userEmail } = req.body;
        const sessionEmail = (req.user.email || '').toLowerCase();
        const bodyEmail = (userEmail || '').trim().toLowerCase();
        if (!bodyEmail || bodyEmail !== sessionEmail) {
            return res.status(403).json({
                success: false,
                message: 'Email thanh toán phải trùng tài khoản đang đăng nhập.',
            });
        }
        const partnerCode = process.env.MOMO_PARTNER_CODE;
        const accessKey   = process.env.MOMO_ACCESS_KEY;
        const secretKey   = process.env.MOMO_SECRET_KEY;
        const env = process.env.MOMO_ENVIRONMENT || 'test';

        if (!partnerCode || partnerCode === 'MOMO_YOUR_PARTNER_CODE')
            return res.status(500).json({ success: false, message: 'Cổng MoMo chưa cấu hình. Điền API keys vào .env.' });

        const endpoint = env === 'production' ? 'https://payment.momo.vn/v2/gateway/api/create' : 'https://test-payment.momo.vn/v2/gateway/api/create';
        const baseUrl   = process.env.APP_BASE_URL || 'http://localhost:3000';
        const orderId   = partnerCode + Date.now();
        const requestId = orderId;
        const orderInfo = `Nap tien VTC - ${userEmail}`;
        const ipnUrl    = `${baseUrl}/api/webhooks/momo`;
        const extraData = ''; const orderGroupId = ''; const requestType = 'captureWallet';

        const rawSig = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${baseUrl}&requestId=${requestId}&requestType=${requestType}`;
        const signature = crypto.createHmac('sha256', secretKey).update(rawSig).digest('hex');

        const body = { partnerCode, partnerName: 'VO TRI CLUB', storeId: 'VTC_STORE', requestId, amount, orderId, orderInfo, redirectUrl: baseUrl, ipnUrl, lang: 'vi', requestType, autoCapture: true, extraData, orderGroupId, signature };
        const result = await (await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

        if (result.resultCode === 0) {
            try {
                const uRows = await dbQuery('SELECT id FROM users WHERE email=?', [userEmail.toLowerCase()]);
                if (uRows.length) await dbQuery('INSERT INTO deposits (user_id,amount,method,transaction_id,status,note) VALUES (?,?,?,?,?,?)', [uRows[0].id, amount, 'MoMo', orderId, 'pending', `Nap tien MoMo (${userEmail})`]);
            } catch (dbErr) { console.error('[DB momo pending]:', dbErr); }
            return res.json({ success: true, payUrl: result.payUrl, qrCodeUrl: result.qrCodeUrl });
        }
        return res.status(400).json({ success: false, message: result.message || 'Lỗi khởi tạo cổng thanh toán' });
    } catch (err) {
        console.error('[MOMO ERROR]:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server khi kết nối MoMo.' });
    }
});

/**
 * POST /api/webhooks/momo
 * MoMo IPN - Tự động cộng tiền khi thanh toán thành công
 */
app.post('/api/webhooks/momo', async (req, res) => {
    try {
        const { partnerCode, orderId, requestId, amount, orderInfo, orderType, transId, resultCode, message, payType, responseTime, extraData, signature } = req.body;
        const secretKey = process.env.MOMO_SECRET_KEY;
        const accessKey = process.env.MOMO_ACCESS_KEY;

        const rawSig = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&message=${message}&orderId=${orderId}&orderInfo=${orderInfo}&orderType=${orderType}&partnerCode=${partnerCode}&payType=${payType}&requestId=${requestId}&responseTime=${responseTime}&resultCode=${resultCode}&transId=${transId}`;
        const expected = crypto.createHmac('sha256', secretKey).update(rawSig).digest('hex');
        if (signature !== expected) return res.status(400).json({ message: 'Invalid signature' });

        if (resultCode === 0) {
            const parts = orderInfo.split(' - ');
            const email = parts[parts.length - 1].trim();
            const pendingRows = await dbQuery(
                'SELECT id, user_id, status, amount FROM deposits WHERE transaction_id = ?',
                [orderId],
            );
            if (pendingRows.length && pendingRows[0].status === 'completed') {
                return res.status(200).json({ message: 'IPN already processed' });
            }
            const dupTrans = await dbQuery(
                'SELECT id FROM deposits WHERE transaction_id = ? AND status = ?',
                [String(transId), 'completed'],
            );
            if (dupTrans.length) {
                return res.status(200).json({ message: 'IPN duplicate transId' });
            }

            const uRows = await dbQuery('SELECT id,balance,total_deposited FROM users WHERE email=?', [email.toLowerCase()]);
            if (uRows.length) {
                const u = uRows[0];
                const credit = parseFloat(amount);
                await dbQuery(
                    'UPDATE users SET balance=?,total_deposited=? WHERE id=?',
                    [parseFloat(u.balance) + credit, parseFloat(u.total_deposited) + credit, u.id],
                );
                await dbQuery(
                    'UPDATE deposits SET status=?,transaction_id=? WHERE transaction_id=? AND status != ?',
                    ['completed', String(transId), orderId, 'completed'],
                );
                const newRole = await applyAutoRankFromDeposit(dbQuery, u.id, logUserActivity);
                console.log(`[MOMO IPN] Credited +${amount} VND → ${email}${newRole ? ` (nâng hạng: ${newRole})` : ''}`);
            }
        } else {
            await dbQuery('UPDATE deposits SET status=? WHERE transaction_id=?', ['failed', orderId]);
        }
        return res.status(200).json({ message: 'IPN processed' });
    } catch (err) {
        console.error('[MOMO IPN ERROR]:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// --- Module routes (orders, smm) ---
app.use('/api/orders', createOrdersRouter({ dbQuery, requireAuth, ordersListLimiter }));
app.use('/api/smm', createSmmRouter({
    db,
    dbQuery,
    requireAuth,
    smmServicesLimiter,
    smmOrderLimiter,
}));
app.use('/api/pages', createPagesRouter({
    dbQuery,
    requireAuth,
    pagesListLimiter,
    pagesWriteLimiter,
}));
app.use('/api/profile', createProfileRouter({
    dbQuery,
    requireAuth,
    profileUpdateLimiter,
}));

// =========================================================================
// --- END DATABASE API ROUTES ---
// =========================================================================

/**
 * POST /api/send-otp
 * Body: { email: string, type: "register" | "forgot" }
 * Generates OTP server-side, sends via EmailJS, returns success/failure
 * OTP code is NEVER sent back to the client
 */
app.post('/api/send-otp', otpLimiter, async (req, res) => {
    try {
        const { email, type, name } = req.body;

        if (!email || !type) {
            return res.status(400).json({ success: false, message: 'Email and type are required.' });
        }

        if (type !== 'register') {
            return res.status(400).json({ success: false, message: 'OTP is only used for registration.' });
        }

        const emailKey = email.toLowerCase();

        // Rate limiting: prevent spam (max 1 OTP per email per 60 seconds)
        const existing = otpStore.get(emailKey);
        if (existing && (Date.now() - (existing.expiresAt - OTP_VALIDITY_MS)) < 60 * 1000) {
            return res.status(429).json({ 
                success: false, 
                message: 'Vui lòng đợi 60 giây trước khi yêu cầu mã OTP mới.' 
            });
        }

        const otpCode = String(crypto.randomInt(100000, 1000000));
        const expiresAt = Date.now() + OTP_VALIDITY_MS;
        const mockIp = `192.168.1.${Math.floor(Math.random() * 230) + 15}`;

        otpStore.set(emailKey, { 
            code: otpCode, 
            expiresAt, 
            type,
            attempts: 0 
        });

        const pubKey = process.env.EMAILJS_PUBLIC_KEY;
        const privKey = process.env.EMAILJS_PRIVATE_KEY;
        const serviceId = process.env.EMAILJS_SERVICE_ID;
        const templateId = process.env.EMAILJS_TEMPLATE_ID;

        const isConfigured = isEmailJsConfigured() && templateId && templateId !== 'your_template_id_here';

        if (isConfigured) {
            // Template variables must match EmailJS editor: {{name}}, {{otp}}
            await emailjs.send(serviceId, templateId, buildEmailParams(email, {
                name: name || 'Thành viên',
                otp: otpCode,
            }), {
                publicKey: pubKey,
                privateKey: privKey,
            });

            console.log(`[OTP] Real email sent to ${email}`);
            return res.json({ 
                success: true, 
                emailSent: true,
                message: `Mã OTP đã gửi đến ${email}.`,
                ip: mockIp
            });
        }

            console.log(`[OTP] Simulator mode for ${email}: ${otpCode}`);
            const simPayload = {
                success: true,
                emailSent: false,
                message: isDevSimulatorAllowed()
                    ? 'EmailJS chưa cấu hình. Mã OTP chỉ hiển thị khi ALLOW_DEV_SIMULATOR=1.'
                    : 'EmailJS chưa cấu hình. Liên hệ quản trị viên.',
                ip: mockIp,
            };
            if (isDevSimulatorAllowed()) simPayload.simulatorCode = otpCode;
            return res.json(simPayload);
    } catch (err) {
        console.error('[OTP] Email send error:', err);
        
        const email = req.body.email?.toLowerCase();
        const stored = otpStore.get(email);
        const errText = err?.text || err?.message || String(err);

        let message = 'Gửi email thất bại. Mã OTP hiển thị trong simulator.';
        if (err?.status === 403 || errText.includes('non-browser')) {
            message = 'EmailJS chưa bật gửi từ server. Vào dashboard.emailjs.com → Account → Security → bật "Allow non-browser API requests".';
        }
        
        const errPayload = {
            success: true,
            emailSent: false,
            message: isDevSimulatorAllowed() ? message : 'Gửi email thất bại. Vui lòng thử lại sau.',
            ip: `192.168.1.${Math.floor(Math.random() * 230) + 15}`,
        };
        if (isDevSimulatorAllowed() && stored) errPayload.simulatorCode = stored.code;
        return res.json(errPayload);
    }
});

/**
 * POST /api/forgot-password
 * Body: { email: string, name?: string }
 * Sends password reset link via EmailJS
 */
app.post('/api/forgot-password', resetLimiter, async (req, res) => {
    try {
        const { email, name } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }

        const emailKey = email.toLowerCase();
        const genericOk =
            'Nếu email đã đăng ký, link đặt lại mật khẩu đã được gửi. Kiểm tra hộp thư (và thư rác).';

        const userRows = await dbQuery('SELECT id, name, status FROM users WHERE email = ?', [emailKey]);
        if (!userRows.length) {
            return res.json({ success: true, emailSent: false, message: genericOk });
        }
        if (userRows[0].status === 'Blocked') {
            return res.json({ success: true, emailSent: false, message: genericOk });
        }
        const userName = name || userRows[0].name || 'Thành viên';

        const existing = [...resetTokenStore.entries()].find(([, data]) => data.email === emailKey);
        if (existing && (Date.now() - (existing[1].expiresAt - RESET_VALIDITY_MS)) < 60 * 1000) {
            return res.status(429).json({
                success: false,
                message: 'Vui lòng đợi 60 giây trước khi yêu cầu link mới.',
            });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + RESET_VALIDITY_MS;
        const baseUrl = getAppBaseUrl(req);
        const resetLink = `${baseUrl}/?reset=${token}`;

        resetTokenStore.set(token, { email: emailKey, expiresAt });

        const pubKey = process.env.EMAILJS_PUBLIC_KEY;
        const privKey = process.env.EMAILJS_PRIVATE_KEY;
        const serviceId = process.env.EMAILJS_SERVICE_ID;
        const resetTemplateId = process.env.EMAILJS_RESET_TEMPLATE_ID;

        const isConfigured = isEmailJsConfigured() &&
            resetTemplateId && resetTemplateId !== 'your_reset_template_id_here';

        if (isConfigured) {
            await emailjs.send(serviceId, resetTemplateId, buildEmailParams(email, {
                name: userName,
                reset_link: resetLink,
            }), {
                publicKey: pubKey,
                privateKey: privKey,
            });

            console.log(`[RESET] Reset link sent to ${email}`);
            return res.json({
                success: true,
                emailSent: true,
                message: `Link đặt lại mật khẩu đã gửi đến ${email}.`
            });
        }

        console.log(`[RESET] Simulator mode for ${email}: ${resetLink}`);
        const resetSim = {
            success: true,
            emailSent: false,
            message: isDevSimulatorAllowed()
                ? 'EmailJS reset template chưa cấu hình. Link chỉ hiển thị khi ALLOW_DEV_SIMULATOR=1.'
                : genericOk,
        };
        if (isDevSimulatorAllowed()) resetSim.simulatorLink = resetLink;
        return res.json(resetSim);
    } catch (err) {
        console.error('[RESET] Email send error:', err);
        const errText = err?.text || err?.message || String(err);
        if (err?.status === 403 || errText.includes('non-browser')) {
            return res.status(403).json({
                success: false,
                message: 'EmailJS chưa bật gửi từ server. Vào dashboard.emailjs.com → Account → Security → bật "Allow non-browser API requests".'
            });
        }
        return res.status(500).json({ success: false, message: 'Không thể gửi email đặt lại mật khẩu.' });
    }
});

/**
 * GET /api/verify-reset-token?token=xxx
 */
app.get('/api/verify-reset-token', (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required.' });
    }

    const stored = resetTokenStore.get(token);

    if (!stored) {
        return res.status(400).json({ success: false, message: 'Link không hợp lệ hoặc đã được sử dụng.' });
    }

    if (Date.now() > stored.expiresAt) {
        resetTokenStore.delete(token);
        return res.status(400).json({ success: false, message: 'Link đã hết hạn. Vui lòng yêu cầu link mới.' });
    }

    return res.json({ success: true, email: stored.email });
});

/**

/**
 * POST /api/verify-otp
 * Body: { email: string, code: string }
 * Validates OTP server-side. Returns success/failure.
 */
app.post('/api/verify-otp', otpLimiter, (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).json({ success: false, message: 'Email and OTP code are required.' });
    }

    const stored = otpStore.get(email.toLowerCase());

    if (!stored) {
        return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    // Max 5 attempts to prevent brute force
    if (stored.attempts >= 5) {
        otpStore.delete(email.toLowerCase());
        return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    // Check expiry
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(email.toLowerCase());
        return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    // Verify code
    if (code !== stored.code) {
        stored.attempts++;
        return res.status(400).json({ 
            success: false, 
            message: `Invalid OTP code. ${5 - stored.attempts} attempts remaining.` 
        });
    }

    // Success - remove OTP from store
    const otpType = stored.type;
    otpStore.delete(email.toLowerCase());

    return res.json({ success: true, type: otpType, message: 'OTP verified successfully.' });
});

/**
 * GET /api/health
 * Server health check
 */
app.get('/api/health', async (req, res) => {
    let dbOk = false;
    try {
        await dbQuery('SELECT 1 AS ok');
        dbOk = true;
    } catch (err) {
        console.error('[HEALTH] MySQL:', err.message);
    }

    if (isProduction()) {
        return res.json({ status: dbOk ? 'ok' : 'degraded' });
    }

    const isConfigured =
        process.env.EMAILJS_PUBLIC_KEY &&
        process.env.EMAILJS_PUBLIC_KEY !== 'your_public_key_here';

    res.json({
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk,
        emailConfigured: isConfigured,
    });
});

// --- Fallback SPA (chỉ GET không phải file tĩnh / API) ---
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/assets/') || req.path.startsWith('/js/')) return next();
    if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).send('Not found');
    try {
        const html = compileIndexHtml();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(html);
    } catch (err) {
        return res.status(500).send('Lỗi compile views.');
    }
});

// --- Start Server ---
async function verifyDatabaseOnStartup() {
    try {
        await dbQuery('SELECT 1');
        await ensureUserRolesSchema(dbQuery);
        await ensureUserSecuritySchema(dbQuery);
        console.log('  ✅ MySQL: kết nối OK (' + (process.env.DB_NAME || 'votri_club') + ')');
        return true;
    } catch (err) {
        console.error('');
        console.error('  ❌ MySQL KHÔNG kết nối được — đăng nhập sẽ lỗi 500.');
        console.error('  → Bật Apache/MySQL trong XAMPP.');
        console.error('  → Chạy database/init.sql trong phpMyAdmin.');
        console.error('  → Kiểm tra DB_HOST, DB_USER, DB_PASSWORD trong .env');
        console.error('  Chi tiết:', err.message);
        console.error('');
        return false;
    }
}

module.exports = app;

/** Chạy local: `node server.js` — Vercel import app, không listen. */
if (require.main === module) {
    const server = app.listen(PORT, async () => {
        const isConfigured = process.env.EMAILJS_PUBLIC_KEY &&
            process.env.EMAILJS_PUBLIC_KEY !== 'your_public_key_here';

        console.log('');
        console.log('  ╔══════════════════════════════════════════╗');
        console.log('  ║   VÔ TRI CLUB - SYSTEM  Backend Server  ║');
        console.log('  ╠══════════════════════════════════════════╣');
        console.log(`  ║   🌐 http://localhost:${PORT}              ║`);
        console.log(`  ║   📧 EmailJS: ${isConfigured ? '✅ Configured' : '⚠️  Not configured'}       ║`);
        console.log('  ╚══════════════════════════════════════════╝');
        console.log('');
        await verifyDatabaseOnStartup();
        if (!isConfigured) {
            console.log('  ⚠️  EmailJS chưa cấu hình. OTP sẽ hiển thị qua simulator.');
            console.log('  → Điền credentials vào file .env để gửi email thực.');
            console.log('');
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error('');
            console.error(`  ❌ Port ${PORT} đang được dùng (server đã chạy rồi).`);
            console.error('  → Mở http://localhost:' + PORT + ' trong trình duyệt.');
            console.error('  → Chạy lại start.bat (không dùng npm).');
            console.error('');
            process.exit(1);
        }
        throw err;
    });
}
