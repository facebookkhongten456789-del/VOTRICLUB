/**
 * VÔ TRI CLUB - SYSTEM
 * Điều phối chính — logic tính năng tách ra js/* (xem docs/MODULE_MAP.md).
 * 
 * @version 1.1.0
 */

// --- Demo Seed Data removed ---

// Core -> js/votri-core.js | Fanpage -> js/votri-fanpages.js
// Fanpage handlers (js/votri-fanpages.js)
function openPageModal(id) { return window.VotriFanpages?.openPageModal(id); }
function closePageModal() { return window.VotriFanpages?.closePageModal(); }
function handleFormSubmit(e) { return window.VotriFanpages?.handleFormSubmit(e); }
function deletePage(id) { return window.VotriFanpages?.deletePage(id); }
function saveDatabase() { return window.VotriFanpages?.saveDatabase(); }
function runPageCheck(id, btn) { return window.VotriFanpages?.runPageCheck(id, btn); }

const apiBase = () => (window.VotriApp && window.VotriApp.API_BASE) || '';
const getSessionToken = () => window.VotriApp.getSessionToken();
const authHeaders = (e) => window.VotriApp.authHeaders(e);
const parseJsonResponse = (r) => window.VotriApp.parseJsonResponse(r);
const escapeHTML = (s) => window.VotriApp.escapeHTML(s);
const showToast = (m, t) => window.VotriApp.showToast(m, t);
const normalizeEmail = (e) => window.VotriApp.normalizeEmail(e);
const isCurrentUserAdmin = () => window.VotriApp.isCurrentUserAdmin();
const resolveFacebookPageKey = (p) => window.VotriApp.resolveFacebookPageKey(p);

// --- Client-side Hybrid Encryption (AES-GCM + RSA-OAEP) ---
let cachedRsaPublicKey = null;

async function getRsaPublicKey() {
    if (cachedRsaPublicKey) return cachedRsaPublicKey;
    try {
        const response = await fetch(`${apiBase()}/api/auth/public-key`);
        const data = await response.json();
        if (data.success && data.publicKey) {
            cachedRsaPublicKey = data.publicKey;
            return cachedRsaPublicKey;
        }
    } catch (err) {
        console.error('[CRYPTO] Failed to fetch RSA Public Key:', err);
    }
    return null;
}

async function importRsaPublicKey(pem) {
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const cleanPem = pem.replace(pemHeader, "").replace(pemFooter, "").replace(/\s/g, "");

    const binaryDerString = window.atob(cleanPem);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer.buffer,
        {
            name: "RSA-OAEP",
            hash: "SHA-256"
        },
        true,
        ["encrypt"]
    );
}

async function encryptPayload(payload) {
    try {
        const pemPublicKey = await getRsaPublicKey();
        if (!pemPublicKey) {
            console.warn('[CRYPTO] Falling back to plaintext auth payload (no public key).');
            return payload;
        }

        const rsaPublicKey = await importRsaPublicKey(pemPublicKey);

        // 1. Generate AES-256 key
        const aesKey = await window.crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );

        const exportedAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
        const aesKeyHex = Array.from(new Uint8Array(exportedAesKey))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Generate dynamic 12-byte IV
        const aesIv = window.crypto.getRandomValues(new Uint8Array(12));
        const aesIvHex = Array.from(aesIv)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // 2. Encrypt original payload with AES key
        const plaintext = JSON.stringify(payload);
        const encodedPlaintext = new TextEncoder().encode(plaintext);

        const encryptedDataBuffer = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: aesIv
            },
            aesKey,
            encodedPlaintext
        );

        const encryptedDataBytes = new Uint8Array(encryptedDataBuffer);
        let dBase64 = "";
        for (let i = 0; i < encryptedDataBytes.length; i++) {
            dBase64 += String.fromCharCode(encryptedDataBytes[i]);
        }
        const d = window.btoa(dBase64);

        // 3. Encrypt AES key configuration with RSA Public Key
        const aesConfigJson = JSON.stringify({ key: aesKeyHex, iv: aesIvHex });
        const encodedAesConfig = new TextEncoder().encode(aesConfigJson);

        const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP"
            },
            rsaPublicKey,
            encodedAesConfig
        );

        const encryptedKeyBytes = new Uint8Array(encryptedKeyBuffer);
        let kBase64 = "";
        for (let i = 0; i < encryptedKeyBytes.length; i++) {
            kBase64 += String.fromCharCode(encryptedKeyBytes[i]);
        }
        const k = window.btoa(kBase64);

        return { d, k };
    } catch (err) {
        console.error('[CRYPTO] Hybrid encryption failed:', err);
        return payload;
    }
}

// Normalize URL and prevent stray hash/query from breaking login flow
(function normalizeUrlAndPreventHashClicks() {
    try {
        const { pathname, search, hash } = window.location;
        const keepSearch = (search && search !== '?') ? search : '';
        const clean = pathname + keepSearch;
        // Chỉ xóa nếu query hoặc hash rỗng (như "?" hoặc "#") để tránh làm mất OAuth token ở hash
        const isEmptyQueryOrHash = (search === '?') || (hash === '#');
        if (isEmptyQueryOrHash) {
            window.history.replaceState({}, '', clean);
        }

        // Prevent anchors with href="#" from modifying the URL (global fallback)
        document.addEventListener('click', (e) => {
            const a = e.target.closest && e.target.closest('a[href="#"]');
            if (a) e.preventDefault();
        }, { capture: true });
    } catch (e) {
        /* ignore */
    }
})();

function pageStatusLabel(status) {
    const fn = window.PageStatus?.pageStatusLabel;
    const label = fn ? fn(status) : status;
    return escapeHTML(label);
}
function pageStatusPillClass(status) {
    return window.PageStatus?.statusPillClass(status) || 'status-inactive';
}

function userStatusLabel(status) {
    const map = { Verified: 'Đang hoạt động', Blocked: 'Chặn (hành vi)', Pending: 'Chờ xác minh' };
    return map[status] || escapeHTML(status);
}

let activeTheme = 'cyan';

// Auth State Variables
let users = [];
let pendingUser = null;
let currentOtpEmail = '';
let currentResetToken = '';
let registerOtpSent = false;

// Google reCAPTCHA widget state
const RECAPTCHA_CONTAINER_IDS = {
    login: 'login-recaptcha-container',
    register: 'register-recaptcha-container',
    forgot: 'forgot-recaptcha-container',
};
let RECAPTCHA_SITE_KEY = '';
const captchaWidgetIds = { login: null, register: null, forgot: null };

function sendCaptchaClientLog(hypothesisId, message, data = {}) {
    // #region agent log
    fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a7da5e' },
        body: JSON.stringify({ sessionId: 'a7da5e', runId: 'pre-fix', hypothesisId, location: 'app.js:captcha', message, data, timestamp: Date.now() })
    }).catch(() => { });
    // #endregion
}

async function fetchRecaptchaSiteKey() {
    try {
        const response = await fetch(`${apiBase()}/api/auth/captcha-config`);
        const data = await response.json();
        if (data.success && data.siteKey) {
            RECAPTCHA_SITE_KEY = data.siteKey;
        }
        sendCaptchaClientLog('H5', 'fetched recaptcha site key', { hasKey: !!RECAPTCHA_SITE_KEY, keyLen: RECAPTCHA_SITE_KEY.length });
    } catch (err) {
        sendCaptchaClientLog('H5', 'failed to fetch recaptcha site key', { error: err?.message || String(err) });
        console.warn('Failed to fetch captcha site key:', err);
    }
}

function mountRecaptchaWidget(formKey) {
    const containerId = RECAPTCHA_CONTAINER_IDS[formKey];
    const el = document.getElementById(containerId);
    if (!el) {
        sendCaptchaClientLog('H7', 'captcha container missing', { formKey, containerId });
        return null;
    }
    if (!RECAPTCHA_SITE_KEY) {
        sendCaptchaClientLog('H5', 'captcha render skipped empty site key', { formKey });
        return null;
    }
    if (typeof grecaptcha === 'undefined') {
        sendCaptchaClientLog('H6', 'grecaptcha not loaded yet', { formKey, apiReady: !!window._recaptchaApiReady });
        return null;
    }
    if (captchaWidgetIds[formKey] !== null) {
        grecaptcha.reset(captchaWidgetIds[formKey]);
        sendCaptchaClientLog('H7', 'captcha reset existing widget', { formKey, widgetId: captchaWidgetIds[formKey] });
        return captchaWidgetIds[formKey];
    }
    try {
        el.innerHTML = '';
        const widgetId = grecaptcha.render(el, { sitekey: RECAPTCHA_SITE_KEY, theme: 'dark' });
        captchaWidgetIds[formKey] = widgetId;
        sendCaptchaClientLog('H7', 'captcha rendered', {
            formKey,
            widgetId,
            containerVisible: el.offsetParent !== null,
            formActive: !!el.closest('.auth-form.active'),
        });
        return widgetId;
    } catch (err) {
        sendCaptchaClientLog('H7', 'captcha render failed', { formKey, error: err?.message || String(err) });
        console.error('[CAPTCHA] render failed:', err);
        return null;
    }
}

function getCaptchaToken(formKey) {
    const widgetId = captchaWidgetIds[formKey];
    if (widgetId === null || typeof grecaptcha === 'undefined') return '';
    return grecaptcha.getResponse(widgetId) || '';
}

function resetCaptchaWidget(formKey) {
    const widgetId = captchaWidgetIds[formKey];
    if (widgetId !== null && typeof grecaptcha !== 'undefined') {
        grecaptcha.reset(widgetId);
    }
}

function syncCaptchaForAuthForm(formId) {
    if (formId === 'register') {
        requestAnimationFrame(() => mountRecaptchaWidget('register'));
    } else if (formId === 'forgot') {
        requestAnimationFrame(() => mountRecaptchaWidget('forgot'));
    }
}

async function bootstrapRecaptcha() {
    sendCaptchaClientLog('H8', 'bootstrap recaptcha called', {
        apiReady: !!window._recaptchaApiReady,
        hasGrecaptcha: typeof grecaptcha !== 'undefined',
    });
    await fetchRecaptchaSiteKey();
    const activeForm = document.querySelector('.auth-form.active');
    if (activeForm?.id === 'form-register') mountRecaptchaWidget('register');
    if (activeForm?.id === 'form-forgot') mountRecaptchaWidget('forgot');
}

window.bootstrapRecaptcha = bootstrapRecaptcha;

// --- DOM Elements ---
const sidebar = document.getElementById('sidebar');
const mobileToggle = document.getElementById('mobile-toggle');
const globalSearch = document.getElementById('global-search');
const btnAddPageHeader = document.getElementById('btn-add-page-header');
// DOM elements nằm trong view động  dùng getter  tránh null khi trang login
function pagesTableBody() { return document.getElementById('pages-table-body'); }
function tableEmptyState() { return document.getElementById('table-empty-state'); }
const btnResetFilters = document.getElementById('btn-reset-filters');

// Stats Counters — getter v nằm trong view-dashboard.hếtml
function statTotalPages() { return document.getElementById('stat-total-pages'); }
function statTotalFollowers() { return document.getElementById('stat-total-followers'); }
function statActivePages() { return document.getElementById('stat-active-pages'); }
function statFlaggedPages() { return document.getElementById('stat-flagged-pages'); }

// SMM Stats Counters — getter
function statBalance() { return document.getElementById('stat-balance'); }
function statTotalDeposited() { return document.getElementById('stat-total-deposited'); }
function statTotalOrders() { return document.getElementById('stat-total-orders'); }
function statCompletedOrders() { return document.getElementById('stat-completed-orders'); }

// Filter Inputs — getter (element trong view động)
function filterNiche() { return document.getElementById('filter-niche'); }
function filterTier() { return document.getElementById('filter-tier'); }
function filterStatus() { return document.getElementById('filter-status'); }

// Dynamicc Views/Containers — getter
function pagesCardsGrid() { return document.getElementById('pages-cards-grid'); }
function pagesEmptyState() { return document.getElementById('pages-empty-state'); }
function analyticsEmptyState() { return document.getElementById('analytics-empty-state'); }

// Modal Elements
const modalPage = document.getElementById('modal-page');
const modalTitle = document.getElementById('modal-title');
const formPage = document.getElementById('form-page');
const modalBtnCancel = document.getElementById('modal-btn-cancel');
const modalBtnClose = document.getElementById('modal-btn-close');

// Modal Input Fields
const fieldId = document.getElementById('field-id');
const fieldName = document.getElementById('field-name');
const fieldNiche = document.getElementById('field-niche');
const fieldTier = document.getElementById('field-tier');
const fieldFollowers = document.getElementById('field-followers');
const fieldStatus = document.getElementById('field-status');
const fieldUrl = document.getElementById('field-url');

// Settings Elements
const settingsBtnClear = document.getElementById('settings-btn-clear');
const settingsFormApi = document.getElementById('settings-form-api');
const settingsFbToken = document.getElementById('settings-fb-token');
const btnFbConnectApp = document.getElementById('btn-fb-connect-app');

function dbgLog(hypothesisId, location, message, data) {
    // #region agent log
    fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ff0680' },
        body: JSON.stringify({ sessionId: 'ff0680', hypothesisId, location, message, data, timestamp: Date.now() })
    }).catch(() => { });
    // #endregion
}


// Khởi tạo Facebook JS SDK
window.fbAsyncInit = function () {
    FB.init({
        appId: '2017093972234308',
        cookie: true,
        xfbml: true,
        version: 'v23.0'
    });
    console.log('[FB SDK] Facebook SDK đã khởi tạo thành công.');
};

const FB_APP_ID = '2017093972234308';
const FB_OAUTH_SCOPES = [
    'public_profile',
    'email',
    'pages_show_list',
    'pages_read_engagement',
].join(',');

function handleFacebookOAuthCallback() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token=')) return false;

    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const accessToken = params.get('access_token') || '';
    const fbName = params.get('fb_name') || '';
    const fbAvatar = params.get('fb_avatar') || '';
    const state = params.get('state') || '';
    const expectedState = sessionStorage.getItem('votri_fb_oauth_state') || '';

    // Gửi thông tin hash chi tiết về server console
    fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'OAUTH_CALLBACK_HASH',
            fbName: fbName,
            fbAvatar: fbAvatar ? (fbAvatar.substring(0, 30) + '...') : '',
            state: state,
            expectedState: expectedState,
            tokenSnippet: accessToken ? (accessToken.substring(0, 15) + '...') : ''
        })
    }).catch(() => {});

    dbgLog('FB1', 'app.js:handleFacebookOAuthCallback', 'oauth callback detected', {
        hasToken: Boolean(accessToken),
        hasState: Boolean(state),
        stateMatch: Boolean(state && expectedState && state === expectedState),
    });

    if (!accessToken) return false;
    if (expectedState && state && state !== expectedState) {
        showToast('Facebook OAuth state không khớp. Thử kết nối lại.', 'info');
        return true;
    }

    try {
        localStorage.setItem('votri_sys_api_token', accessToken);
        if (fbName) localStorage.setItem('votri_fb_user_name', fbName);
        if (fbAvatar) localStorage.setItem('votri_fb_user_avatar', fbAvatar);
        
        if (settingsFbToken) settingsFbToken.value = accessToken;
        showToast('Đã lấy Facebook Access Token từ App.', 'success');
        loadFacebookUserProfile();
        syncFacebookPages();
    } catch (_) {
        showToast('Không lưu được token vào trình duyệt.', 'info');
    } finally {
        sessionStorage.removeItem('votri_fb_oauth_state');
        // Clear hash to avoid leaking token in URL bar history.
        try {
            window.history.replaceState({}, '', window.location.pathname + window.location.search);
        } catch (_) { /* ignore */ }
    }

    return true;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // #region agent log
    window.__votriDbg?.('app.js:DOMContentLoaded', 'start', {
        hasLucide: typeof lucide !== 'undefined',
        hasCreateIcons: typeof lucide?.createIcons === 'function',
        hasVotriFanpages: !!window.VotriFanpages
    }, 'A');
    // #endregion
    initUsersDatabase();
    if (window.VotriFanpages) window.VotriFanpages.initDatabase();
    initTheme();
    setupEventListeners();
    setupAuthListeners();
    if (window._recaptchaApiReady) {
        bootstrapRecaptcha();
    } else {
        fetchRecaptchaSiteKey();
    }
    setupLegalModalListeners();
    checkSessionAuth();
    checkResetTokenFromUrl();
    handleFacebookOAuthCallback();
    initLandingPageLogic();

    // Initialize Lucide icons on launch
    lucide.createIcons();
    // #region agent log
    window.__votriDbg?.('app.js:DOMContentLoaded', 'icons-ok', {}, 'A');
    // #endregion
    if (window.VotriSupport) window.VotriSupport.init();
    if (window.VotriSmm) window.VotriSmm.bindOrderForm();
    if (window.OrdersPage) window.OrdersPage.init();
    if (window.VotriProfile) window.VotriProfile.init();
});

// --- Database and Auth Lifecycle ---

function initUsersDatabase() {
    try {
        const localUsers = localStorage.getItem('votri_sys_users');
        if (!localUsers) {
            users = [];
            window.users = users;
            localStorage.setItem('votri_sys_users', JSON.stringify(users));
        } else {
            users = JSON.parse(localUsers);
            if (!Array.isArray(users)) users = [];
        }
        window.users = users;
    } catch (e) {
        console.error("Users database load exception:", e);
        users = [];
    }
}

function addUserLog(email, action, status = 'Thành công') {
    const localUsers = localStorage.getItem('votri_sys_users');
    let usersList = localUsers ? JSON.parse(localUsers) : [];
    const idx = usersList.findIndex(u => u.email === email);

    if (idx !== -1) {
        if (!usersList[idx].logs) usersList[idx].logs = [];
        usersList[idx].logs.unshift({
            action,
            status,
            timestamp: new Date().toISOString()
        });

        // Gi ti a 50 log gn nhết
        if (usersList[idx].logs.length > 50) {
            usersList[idx].logs = usersList[idx].logs.slice(0, 50);
        }

        localStorage.setItem('votri_sys_users', JSON.stringify(usersList));
    }
}

async function syncDatabaseData() {
    const email = sessionStorage.getItem('votri_sys_user_email');
    if (!email) return { success: false };

    if (window.VotriGuard) {
        const gate = window.VotriGuard.allowApi('sync');
        if (!gate.ok) {
            showToast(gate.reason, 'info');
            return { success: false, reason: 'rate_limited' };
        }
    }

    const token = getSessionToken();
    if (!token) {
        console.warn('[DB SYNC] Thiếu token — cần ng nhập lại.');
        return { success: false, reason: 'no_token' };
    }

    try {
        const syncBody = window.VotriApp?.withPublicIp
            ? await window.VotriApp.withPublicIp({})
            : {};
        const response = await fetch(`${apiBase()}/api/sync/data`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(syncBody)
        });
        const result = await parseJsonResponse(response);

        if (response.status === 401) {
            console.warn('[DB SYNC] Token hết hạn.');
            return { success: false, reason: 'unauthorized' };
        }

        if (result.success) {
            users = result.users || [];

            if (Array.isArray(result.tickets)) {
                localStorage.setItem('votri_sys_tickets', JSON.stringify(result.tickets));
            }
            if (Array.isArray(result.orders)) {
                localStorage.setItem('votri_sys_orders', JSON.stringify(result.orders));
            }
            if (Array.isArray(result.deposits)) {
                localStorage.setItem('votri_sys_deposits', JSON.stringify(result.deposits));
            }

            localStorage.setItem('votri_sys_users', JSON.stringify(users));

            const currentUser = users.find(u => normalizeEmail(u.email) === normalizeEmail(email));
            if (currentUser) {
                window.VotriApp?.updateSidebarUserProfile?.(currentUser);
            }
            return { success: true };
        }
        return { success: false };
    } catch (err) {
        console.error('[DB SYNC ERROR]:', err);
        return { success: false };
    }
}
if (window.VotriApp) window.VotriApp.syncDatabaseData = syncDatabaseData;

async function checkSessionAuth() {
    const isLoggedIn = sessionStorage.getItem('votri_sys_logged_in') === 'true';
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.querySelector('.app-container');

    if (isLoggedIn) {
        if (!getSessionToken()) {
            sessionStorage.removeItem('votri_sys_logged_in');
            sessionStorage.removeItem('votri_sys_user_email');
            sessionStorage.removeItem('votri_sys_user_role');
            showToast('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', 'info');
            authScreen.style.display = 'flex';
            if (appContainer) appContainer.style.display = 'none';
            showAuthForm('login');
            return;
        }

        authScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';

        const syncResult = await syncDatabaseData();
        if (syncResult.reason === 'unauthorized') {
            sessionStorage.removeItem('votri_sys_logged_in');
            sessionStorage.removeItem('votri_sys_user_email');
            sessionStorage.removeItem('votri_sys_user_role');
            sessionStorage.removeItem('votri_sys_token');
            showToast('Phiên hết hạn. Đăng nhập lại.', 'info');
            authScreen.style.display = 'flex';
            if (appContainer) appContainer.style.display = 'none';
            showAuthForm('login');
            return;
        }

        const activeUserEmail = sessionStorage.getItem('votri_sys_user_email');
        const activeUser = users.find(u => normalizeEmail(u.email) === normalizeEmail(activeUserEmail));
        if (activeUser) {
            window.VotriApp?.updateSidebarUserProfile?.(activeUser);
        }

        if (window.VotriFanpages?.loadPagesFromServer) {
            await window.VotriFanpages.loadPagesFromServer();
        } else {
            renderAllViews();
        }
        if (window.VotriGuard) {
            window.VotriGuard.onLoginBootstrap();
        } else if (window.VotriNav) {
            window.VotriNav.showMainTab('dashboard', { skipGuard: true });
        }
    } else {
        if (window.VotriGuard) window.VotriGuard.resetSession();
        authScreen.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        showAuthForm('login');
    }
}

function showAuthForm(formId) {
    const subtitle = document.getElementById('auth-subtitle-text');

    // Hide all forms
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));

    // Show target form
    const targetForm = document.getElementById(`form-${formId}`);
    if (targetForm) {
        targetForm.classList.add('active');
    }

    // Update subtitles
    if (formId === 'login') {
        subtitle.textContent = 'Đăng nhập để quản lý hệ thống';
    } else if (formId === 'register') {
        subtitle.textContent = 'Tạo tài khoản tham gia VÔ TRI - SYSTEM';
        resetRegisterOtpState();
    } else if (formId === 'forgot') {
        subtitle.textContent = 'Khôi phục mật khẩu tài khoản';
    } else if (formId === 'reset-password') {
        subtitle.textContent = 'Đặt lại mật khẩu tài khoản';
    } else if (formId === 'login-2fa') {
        subtitle.textContent = 'Xác thực 2 lớp (2FA)';
    }

    syncCaptchaForAuthForm(formId);
}

function finishLoginFromServer(data) {
    if (data.token) sessionStorage.setItem('votri_sys_token', data.token);
    sessionStorage.setItem('votri_sys_logged_in', 'true');
    sessionStorage.setItem('votri_sys_user_email', data.user.email);
    const loginRole = window.VotriRoles
        ? window.VotriRoles.normalize(data.user.role)
        : String(data.user.role || 'member').toLowerCase();
    sessionStorage.setItem('votri_sys_user_role', loginRole);
    sessionStorage.removeItem('votri_pending_2fa');

    const freshUser = {
        id: 'usr-' + data.user.id,
        name: data.user.name,
        email: data.user.email,
        phone: data.user.phone,
        role: data.user.role,
        status: data.user.status,
        balance: data.user.balance,
        totalDeposited: data.user.totalDeposited,
        registeredAt: data.user.registeredAt,
        twoFactorEnabled: data.user.twoFactorEnabled,
        notifyNewLogin: data.user.notifyNewLogin,
    };
    const existingUsers = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
    const idx = existingUsers.findIndex((u) => u.email === freshUser.email);
    if (idx !== -1) existingUsers[idx] = { ...existingUsers[idx], ...freshUser };
    else existingUsers.push(freshUser);
    localStorage.setItem('votri_sys_users', JSON.stringify(existingUsers));
    users = existingUsers;

    showToast(`Chào mừng trở lại, ${data.user.name}!`, 'success');
    checkSessionAuth();
}

function setupAuthListeners() {
    // Go to Forgot Password form
    document.getElementById('link-goto-forgot').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthForm('forgot');
    });

    // Go to Register form
    document.getElementById('link-goto-register').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthForm('register');
    });

    document.getElementById('link-reset-goto-login').addEventListener('click', (e) => {
        e.preventDefault();
        currentResetToken = '';
        window.history.replaceState({}, '', window.location.pathname);
        showAuthForm('login');
    });

    // Go to Login form from Register/Forgot views
    document.getElementById('link-goto-login-1').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthForm('login');
    });
    document.getElementById('link-goto-login-2').addEventListener('click', (e) => {
        e.preventDefault();
        showAuthForm('login');
    });

    // Handle Login Submit
    document.getElementById('form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        let captchaToken = '';
        const loginContainer = document.getElementById('login-recaptcha-container');
        if (loginContainer && loginContainer.style.display === 'flex') {
            captchaToken = getCaptchaToken('login');
            if (!captchaToken) {
                showToast('Vui lòng xác minh CAPTCHA.', 'info');
                return;
            }
        }

        try {
            const loginBody = window.VotriApp?.withPublicIp
                ? await window.VotriApp.withPublicIp({ email, password, captchaToken })
                : { email, password, captchaToken };
            const encryptedBody = await encryptPayload(loginBody);
            const response = await fetch(`${apiBase()}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(encryptedBody)
            });

            const data = await parseJsonResponse(response);

            if (!response.ok || !data.success) {
                if (data.requireCaptcha) {
                    const container = document.getElementById('login-recaptcha-container');
                    if (container) {
                        container.style.display = 'flex';
                        mountRecaptchaWidget('login');
                    }
                }
                showToast(data.message || 'Mật khẩu hoặc Email không chính xác.', 'info');
                return;
            }

            // Clear login captcha state if successful
            const container = document.getElementById('login-recaptcha-container');
            if (container) container.style.display = 'none';
            resetCaptchaWidget('login');

            if (data.requires2fa && data.tempToken) {
                sessionStorage.setItem('votri_pending_2fa', data.tempToken);
                showToast(data.message || 'Nhập mã 2FA.', 'info');
                showAuthForm('login-2fa');
                return;
            }

            finishLoginFromServer(data);
        } catch (err) {
            console.error('Login error:', err);
            const isLocal = window.VotriApp?.isLocalDevHost?.() ?? false;
            const hint = err.message && err.message.includes('HTML')
                ? (isLocal
                    ? 'Chạy start.bat (hoặc node server.js) rồi mở http://localhost:3000 — không dùng Live Server.'
                    : 'Server trả HTML — kiểm tra deploy Vercel (vercel.json includeFiles).')
                : (isLocal
                    ? `Không kết nối API (${apiBase()}). Bật MySQL và chạy: node server.js`
                    : `Không kết nối API (${apiBase()}). Tải lại trang hoặc thử lại sau.`);
            showToast(hint, 'info');
        }
    });

    document.getElementById('form-login-2fa')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tempToken = sessionStorage.getItem('votri_pending_2fa');
        const code = document.getElementById('login-2fa-code')?.value?.trim();
        if (!tempToken || !code) {
            showToast('Thiếu mã 2FA.', 'info');
            return;
        }
        try {
            const response = await fetch(`${apiBase()}/api/auth/verify-2fa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tempToken, code }),
            });
            const data = await parseJsonResponse(response);
            if (!response.ok || !data.success) {
                showToast(data.message || 'Mã 2FA không đúng.', 'info');
                return;
            }
            finishLoginFromServer(data);
        } catch (err) {
            console.error('2FA login:', err);
            showToast('Không kết nối API.', 'info');
        }
    });

    document.getElementById('link-2fa-back-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('votri_pending_2fa');
        showAuthForm('login');
    });

    // Send OTP from register form
    const btnSendOtp = document.getElementById('btn-send-register-otp');
    if (btnSendOtp) {
        btnSendOtp.addEventListener('click', async () => {
            const payload = getRegisterFormData();
            if (!payload) return;

            let captchaToken = getCaptchaToken('register');
            if (!captchaToken) {
                mountRecaptchaWidget('register');
                captchaToken = getCaptchaToken('register');
            }
            if (!captchaToken) {
                showToast('Vui lòng xác minh CAPTCHA trước khi gửi OTP.', 'info');
                return;
            }

            const btnLabel = btnSendOtp.querySelector('span');
            const originalText = btnLabel ? btnLabel.textContent : 'Gửi mã OTP';
            btnSendOtp.disabled = true;
            if (btnLabel) btnLabel.textContent = 'Đang gửi OTP...';

            pendingUser = payload;
            const sent = await triggerOtp(payload.email, payload.name, captchaToken);

            btnSendOtp.disabled = false;
            if (btnLabel) btnLabel.textContent = originalText;

            if (!sent) {
                showToast('Không gửi được OTP. Kiểm tra server đang chạy (npm start) v mở ứng dụng tự động URL hiện tại của server.', 'info');
            }
        });
    } else {
        console.error('[Auth] Missing #btn-send-register-otp  hard refresh trang (Ctrl+F5)');
    }

    // Handle Register Submit (verify OTP + create account in MySQL)
    document.getElementById('form-register').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!registerOtpSent) {
            showToast('Vui lòng gửi và nhập mã OTP trước khi tạo tài khoản.', 'info');
            return;
        }

        const payload = getRegisterFormData();
        if (!payload) return;

        let captchaToken = getCaptchaToken('register');
        if (!captchaToken) {
            mountRecaptchaWidget('register');
            captchaToken = getCaptchaToken('register');
        }
        if (!captchaToken) {
            showToast('Vui lòng xác minh CAPTCHA.', 'info');
            return;
        }

        const ccode = document.getElementById('register-otp-code').value.trim();
        if (!/^\d{6}$/.test(ccode)) {
            showToast('Mã OTP phải gồm 6 chữ số.', 'info');
            return;
        }

        try {
            const regPayload = {
                name: payload.name,
                email: payload.email,
                phone: payload.phone,
                password: payload.password,
                code: ccode,
                captchaToken: captchaToken,
            };
            const regBody = window.VotriApp?.withPublicIp
                ? await window.VotriApp.withPublicIp(regPayload)
                : regPayload;
            const encryptedBody = await encryptPayload(regBody);
            const response = await fetch(`${apiBase()}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(encryptedBody)
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                resetCaptchaWidget('register');
                showToast(data.message || 'Mã OTP không hợp lệ! Vui lòng thử lại tạo tài khoản.', 'info');
                return;
            }

            pendingUser = null;
            resetRegisterOtpState();
            resetCaptchaWidget('register');

            addUserLog(payload.email, 'Đăng ký tài khoản mới');
            showToast('Đăng ký tài khoản thành công! Đang tự động đăng nhập...', 'success');

            // Auto-login
            sessionStorage.setItem('votri_sys_logged_in', 'true');
            sessionStorage.setItem('votri_sys_user_email', payload.email);
            checkSessionAuth();
        } catch (err) {
            console.error('Register Error:', err);
            resetCaptchaWidget('register');
            showToast('Không kết nối server.', 'info');
        }
    });

    // Handle Forgot Password Submit (send reset link via email)
    document.getElementById('form-forgot').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        if (!email) { showToast('Vui lòng nhập email.', 'info'); return; }

        let captchaToken = getCaptchaToken('forgot');
        if (!captchaToken) {
            mountRecaptchaWidget('forgot');
            captchaToken = getCaptchaToken('forgot');
        }
        if (!captchaToken) {
            showToast('Vui lòng xác minh CAPTCHA.', 'info');
            return;
        }

        try {
            const response = await fetch(`${apiBase()}/api/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, captchaToken })
            });

            const data = await response.json();

            resetCaptchaWidget('forgot');

            if (!response.ok || !data.success) {
                showToast(data.message || 'Không thể gửi link đặt lại mật khẩu.', 'info');
                return;
            }

            if (data.simulatorLink) {
                showToast(`Link Đặt lại mật khẩu (dev): ${data.simulatorLink}`, 'info');
            } else {
                showToast(`✅ Link đặt lại mật khẩu đã gửi đến ${email}!`, 'success');
            }

            showAuthForm('login');
        } catch (err) {
            console.error('Forgot password error:', err);
            showToast('Không kết nối server. Hãy chạy npm start.', 'info');
        }
    });

    // Handle Reset Password Submit (from email link)
    document.getElementById('form-reset-password').addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPassword = document.getElementById('reset-new-password').value;
        const confirmPassword = document.getElementById('reset-confirm-password').value;

        if (newPassword.length < 6) {
            showToast('Mật khẩu phải có ít nhất 6 ký tự.', 'info');
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast('Xác nhận mật khẩu không khớp.', 'info');
            return;
        }

        if (!currentResetToken) {
            showToast('Link reset không hợp lệ.', 'info');
            return;
        }

        try {
            const response = await fetch(`${apiBase()}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: currentResetToken, password: newPassword })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                showToast(data.message || 'Không thể đặt lại mật khẩu.', 'info');
                return;
            }

            addUserLog(data.email, 'Đặt lại mật khẩu mới');

            currentResetToken = '';
            window.history.replaceState({}, '', window.location.pathname);

            showToast('Đặt lại mật khẩu thành công! Vui lòng đăng nhập.', 'success');
            showAuthForm('login');
        } catch (err) {
            console.error('Reset password error:', err);
            showToast('Không kết nối server.', 'info');
        }
    });

    // Sidebar Logout Action Trigger
    document.getElementById('btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        const activeEmail = sessionStorage.getItem('votri_sys_user_email');
        if (activeEmail) addUserLog(activeEmail, 'đăng xuất khỏi thiết bị');
        sessionStorage.removeItem('votri_sys_logged_in');
        sessionStorage.removeItem('votri_sys_user_email');
        sessionStorage.removeItem('votri_sys_user_role');
        sessionStorage.removeItem('votri_sys_token');
        if (window.VotriGuard) window.VotriGuard.resetSession();
        showToast('Đã đăng xuất khỏi hệ thống', 'info');
        checkSessionAuth();
    });
}

function getRegisterFormData() {
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm').value;

    if (!name || !email) {
        showToast('Vui lòng điền đầy đủ thông tin.', 'info');
        return null;
    }

    if (password.length < 6) {
        showToast('Mật khẩu phải có ít nhất 6 ký tự.', 'info');
        return null;
    }

    if (password !== confirmPassword) {
        showToast('Xác nhận mật khẩu không khớp.', 'info');
        return null;
    }

    const emailExists = false; // Kiểm tra trng email thcc hi!n server-side (MySQL)
    return { name, email, password };
}

function resetRegisterOtpState() {
    registerOtpSent = false;
    currentOtpEmail = '';

    const otpSection = document.getElementById('register-otp-section');
    const otpInput = document.getElementById('register-otp-code');
    const createBtn = document.getElementById('btn-create-account');

    if (otpSection) otpSection.style.display = 'none';
    if (otpInput) otpInput.value = '';
    if (createBtn) createBtn.disabled = true;
}

function showRegisterOtpSection(email) {
    registerOtpSent = true;
    currentOtpEmail = email;

    document.getElementById('register-otp-target-email').textContent = email;
    document.getElementById('register-otp-section').style.display = 'block';
    document.getElementById('register-otp-code').value = '';
    document.getElementById('btn-create-account').disabled = false;
    document.getElementById('register-otp-code').focus();

    resetCaptchaWidget('register');
}

async function triggerOtp(email, name, captchaToken) {
    currentOtpEmail = email;

    try {
        const response = await fetch(`${apiBase()}/api/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, type: 'register', name, captchaToken })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            resetCaptchaWidget('register');
            showToast(data.message || 'Không thể gửi OTP.', 'info');
            return false;
        }

        showRegisterOtpSection(email);

        if (data.emailSent) {
            showToast(`Mã OTP đã gửi đến ${email}! Kiểm tra hộp thư (v Spam).`, 'success');
        } else {
            showToast(data.message || 'Không gửi được email OTP.', 'info');
            if (data.simulatorCode) {
                showToast(`Mã OTP tạm thời: ${data.simulatorCode}`, 'info');
            }
        }
        return true;
    } catch (err) {
        console.error('OTP API Error:', err);
        showToast('Không kết nối server. Chạy npm start và mở ứng dụng tự động URL server.', 'info');
        return false;
    }
}

function openLegalModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeLegalModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
    const stillOpen = [...document.querySelectorAll('.modal-overlay')].some(m => m.style.display === 'flex' || m.classList.contains('active'));
    if (!stillOpen) document.body.style.overflow = 'auto';
}

function setupLegalModalListeners() {
    window.openLegalModal = openLegalModal;
    window.closeLegalModal = closeLegalModal;

    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-modal]');
        if (!link) return;
        e.preventDefault();
        openLegalModal(link.getAttribute('data-modal'));
    });

    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('[data-close-modal]');
        if (!closeBtn) return;
        e.preventDefault();
        closeLegalModal(closeBtn.getAttribute('data-close-modal'));
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeLegalModal(e.target.id);
        }
    });
}

async function checkResetTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');

    if (!token) return;

    currentResetToken = token;

    try {
        const response = await fetch(`${apiBase()}/api/verify-reset-token?token=${encodeURIComponent(token)}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            showToast(data.message || 'Link reset không hợp lệ.', 'info');
            window.history.replaceState({}, '', window.location.pathname);
            currentResetToken = '';
            return;
        }

        document.getElementById('reset-target-email').textContent = data.email;
        document.getElementById('reset-new-password').value = '';
        document.getElementById('reset-confirm-password').value = '';

        const authScreen = document.getElementById('auth-screen');
        const appContainer = document.querySelector('.app-container');
        authScreen.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        showAuthForm('reset-password');
        const authModalBackdrop = document.getElementById('auth-modal-backdrop');
        if (authModalBackdrop) {
            authModalBackdrop.classList.add('active');
            authModalBackdrop.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Verify reset token error:', err);
        showToast('Không thể xác minh link reset.', 'info');
    }
}

// Load and apply theme color
function initTheme() {
    const savedTheme = localStorage.getItem('votri_sys_theme') || 'cyan';
    activeTheme = savedTheme;
    document.body.className = `theme-${savedTheme}`;

    // Set active button state in Settings
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.getAttribute('data-theme') === savedTheme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Populate API Token setting if saved
    const savedToken = localStorage.getItem('votri_sys_api_token') || '';
    if (settingsFbToken) {
        settingsFbToken.value = savedToken;
    }
    loadFacebookUserProfile();
}

async function loadFacebookUserProfile() {
    const token = localStorage.getItem('votri_sys_api_token') || '';
    const cachedName = localStorage.getItem('votri_fb_user_name') || '';
    const cachedAvatar = localStorage.getItem('votri_fb_user_avatar') || '';

    const userInfoEl = document.getElementById('fb-user-info');
    const avatarEl = document.getElementById('fb-user-avatar');
    const nameEl = document.getElementById('fb-user-name');
    const statusDot = userInfoEl ? userInfoEl.querySelector('.status-dot') : null;
    const statusText = userInfoEl ? userInfoEl.querySelector('.status-text') : null;
    const pagesCardEl = document.getElementById('settings-fb-pages-card');

    if (!token) {
        if (userInfoEl) userInfoEl.classList.add('hidden');
        if (pagesCardEl) pagesCardEl.classList.add('hidden');
        return;
    }

    if (userInfoEl) {
        userInfoEl.classList.remove('hidden');
    }
    if (pagesCardEl) {
        pagesCardEl.classList.remove('hidden');
        renderFacebookPagesCard();
    }

    // Nếu đã có thông tin cached từ quá trình đăng nhập PHP, sử dụng luôn
    if (cachedName) {
        if (nameEl) nameEl.textContent = cachedName;
        if (avatarEl) avatarEl.src = cachedAvatar || 'https://img.icons8.com/color/96/facebook-new.png';
        if (userInfoEl) {
            userInfoEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            userInfoEl.style.background = 'rgba(16, 185, 129, 0.05)';
        }
        if (statusDot) statusDot.style.background = '#10b981';
        if (statusText) statusText.textContent = 'Đã kết nối tài khoản Facebook';
        return;
    }

    // Tạm thời hiện trạng thái đang tải
    if (userInfoEl) {
        userInfoEl.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        userInfoEl.style.background = 'rgba(255, 255, 255, 0.05)';
    }
    if (nameEl) nameEl.textContent = 'Đang tải thông tin...';
    if (avatarEl) avatarEl.src = '';
    if (statusDot) statusDot.style.background = '#888';
    if (statusText) statusText.textContent = 'Đang kiểm tra kết nối...';

    try {
        // Fetch user profile from FB Graph API (needs only public_profile scope)
        const response = await fetch(`https://graph.facebook.com/v21.0/me?fields=name,picture.type(large)&access_token=${token}`);
        const data = await response.json();
        
        // Gửi thông tin debug lên server console
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'FB_GRAPH_RESPONSE', data, tokenSnippet: token.substring(0, 15) + '...' })
        }).catch(() => {});

        if (data && data.name) {
            const avatarUrl = data.picture?.data?.url || 'https://img.icons8.com/color/96/facebook-new.png';
            localStorage.setItem('votri_fb_user_name', data.name);
            localStorage.setItem('votri_fb_user_avatar', avatarUrl);

            if (nameEl) nameEl.textContent = data.name;
            if (avatarEl) avatarEl.src = avatarUrl;
            if (userInfoEl) {
                userInfoEl.style.border = '1px solid rgba(16, 185, 129, 0.4)'; // Viền xanh lá
                userInfoEl.style.background = 'rgba(16, 185, 129, 0.05)';
            }
            if (statusDot) statusDot.style.background = '#10b981';
            if (statusText) statusText.textContent = 'Đã kết nối tài khoản Facebook';
            
            // Tự động đồng bộ Fanpage lần đầu khi kết nối thành công mà chưa có danh sách
            const localPages = (window.pages || []).filter(p => p.fbPageId);
            if (localPages.length === 0) {
                syncFacebookPages();
            }
        } else {
            // Xóa cache cũ nếu token không hoạt động
            localStorage.removeItem('votri_fb_user_name');
            localStorage.removeItem('votri_fb_user_avatar');

            // Token không hợp lệ hoặc sai
            if (nameEl) nameEl.textContent = 'Token không hợp lệ hoặc đã hết hạn';
            if (avatarEl) avatarEl.src = 'https://img.icons8.com/color/96/facebook-new.png';
            if (userInfoEl) {
                userInfoEl.style.border = '1px solid rgba(239, 68, 68, 0.4)'; // Viền đỏ
                userInfoEl.style.background = 'rgba(239, 68, 68, 0.05)';
            }
            if (statusDot) statusDot.style.background = '#ef4444';
            if (statusText) statusText.textContent = 'Token không chính xác hoặc lỗi App';
        }
    } catch (err) {
        console.warn('Failed to load FB user profile info:', err);
        
        // Gửi thông tin debug lỗi lên server console
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'FB_GRAPH_ERROR', error: err.message || String(err), tokenSnippet: token.substring(0, 15) + '...' })
        }).catch(() => {});

        // Lỗi kết nối mạng hoặc CORS
        if (nameEl) nameEl.textContent = 'Lỗi kết nối Facebook Graph API';
        if (avatarEl) avatarEl.src = 'https://img.icons8.com/color/96/facebook-new.png';
        if (userInfoEl) {
            userInfoEl.style.border = '1px solid rgba(245, 158, 11, 0.4)'; // Viền cam
            userInfoEl.style.background = 'rgba(245, 158, 11, 0.05)';
        }
        if (statusDot) statusDot.style.background = '#f59e0b';
        if (statusText) statusText.textContent = 'Không thể gọi API. Kiểm tra kết nối mạng.';
    }
}

window.syncFacebookPages = async function() {
    const token = localStorage.getItem('votri_sys_api_token') || '';
    if (!token) {
        showToast('Thiếu Facebook Access Token.', 'error');
        return;
    }

    const syncBtn = document.getElementById('btn-sync-fb-pages');
    let originalHtml = '';
    if (syncBtn) {
        originalHtml = syncBtn.innerHTML;
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<i data-lucide="loader-2" class="spinning" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> <span>Đang xử lý...</span>';
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        const response = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=name,id,category,followers_count,picture&access_token=${token}`);
        const data = await response.json();

        // Gửi debug log lên server
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'FB_SYNC_PAGES_RESPONSE', dataCount: data?.data?.length || 0 })
        }).catch(() => {});

        if (data && data.data) {
            const fbPages = data.data;
            const existingPages = window.pages || [];

            for (const fbPage of fbPages) {
                const match = existingPages.find(p => p.fbPageId === fbPage.id);
                const payload = {
                    name: fbPage.name,
                    niche: fbPage.category || 'Blog cá nhân',
                    tier: match ? match.tier : 'Tier 3',
                    status: 'Active',
                    followers: fbPage.followers_count || 0,
                    url: `https://facebook.com/${fbPage.id}`,
                    fbPageId: fbPage.id
                };
                if (window.PagesApi && typeof window.PagesApi.savePage === 'function') {
                    await window.PagesApi.savePage(payload, match ? match.id : null);
                }
            }

            if (window.VotriFanpages && typeof window.VotriFanpages.loadPagesFromServer === 'function') {
                await window.VotriFanpages.loadPagesFromServer();
            }

            const now = new Date();
            const timeStr = now.toLocaleTimeString('vi-VN') + ' ' + now.toLocaleDateString('vi-VN');
            localStorage.setItem('votri_fb_pages_last_update', timeStr);
            showToast('Đồng bộ Fanpage thành công!', 'success');
        } else {
            showToast('Không lấy được danh sách Fanpage từ Facebook.', 'error');
        }
    } catch (err) {
        console.error('[Sync FB Pages]', err);
        showToast('Lỗi đồng bộ Fanpage: ' + err.message, 'error');
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
        }
        renderFacebookPagesCard();
    }
};

function renderFacebookPagesCard() {
    const listEl = document.getElementById('settings-fb-pages-list');
    const badgeEl = document.getElementById('settings-fb-pages-badge');
    const updateEl = document.getElementById('settings-fb-pages-last-update');
    
    if (!listEl) return;

    // Lọc danh sách page có fbPageId thực tế (được import từ FB)
    const fbPages = (window.pages || []).filter(p => p.fbPageId);
    
    if (badgeEl) {
        badgeEl.textContent = `✔ ${fbPages.length} fanpage đã kết nối`;
    }

    const lastUpdate = localStorage.getItem('votri_fb_pages_last_update') || 'Chưa cập nhật';
    if (updateEl) {
        updateEl.textContent = `Cập nhật lần cuối: ${lastUpdate}`;
    }

    if (fbPages.length === 0) {
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-secondary); background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-glass); border-radius: 8px;">
                <i data-lucide="help-circle" style="width: 24px; height: 24px; margin-bottom: 8px; color: var(--text-secondary);"></i>
                <p style="margin: 0; font-size: 0.9rem;">Chưa có Fanpage nào được đồng bộ. Bấm <strong>Kiểm tra lại</strong> để tải danh sách.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    listEl.innerHTML = fbPages.map(page => {
        return `
            <div class="glass-card" style="padding: 16px; border: 1px solid var(--border-glass); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.01);">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="color: #10b981; display: flex; align-items: center; justify-content: center; background: rgba(16, 185, 129, 0.1); width: 28px; height: 28px; border-radius: 50%;">
                        <i data-lucide="check" style="width: 16px; height: 16px;"></i>
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${escapeHTML(page.name)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">${escapeHTML(page.niche || 'Blog cá nhân')}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <a href="${escapeHTML(page.url || '#')}" target="_blank" class="btn-icon" style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); color: #fff; border: 1px solid var(--border-glass); transition: all 0.2s;" title="Xem trang trên Facebook">
                        <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                    </a>
                    <button type="button" class="btn-icon btn-settings-fb-page" data-page-id="${page.id}" style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); color: #fff; border: 1px solid var(--border-glass); transition: all 0.2s;" title="Cấu hình Fanpage">
                        <i data-lucide="settings" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Bind event listeners to settings buttons dynamically to support CSP
    listEl.querySelectorAll('.btn-settings-fb-page').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = btn.getAttribute('data-page-id');
            if (window.VotriFanpages && typeof window.VotriFanpages.openPageModal === 'function') {
                window.VotriFanpages.openPageModal(pageId);
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

// Bind all interactive event listeners
function setupEventListeners() {
    // Sidebar Hamburger (Mobile toggles)
    if (mobileToggle) mobileToggle.addEventListener('click', () => {
        if (sidebar) sidebar.classList.toggle('mobile-active');
    });

    document.addEventListener('click', (e) => {
        if (sidebar && sidebar.classList.contains('mobile-active') &&
            !sidebar.contains(e.target) &&
            mobileToggle && !mobileToggle.contains(e.target)) {
            sidebar.classList.remove('mobile-active');
        }
    });

    // View Switching Tabs
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            const targetTab = item.getAttribute('data-tab');
            const platform = item.getAttribute('data-platform');

            if (platform && targetTab && window.VotriGuard) {
                window.VotriGuard.navigate(targetTab);
            } else if (platform) {
                if (window.VotriSmm) window.VotriSmm.switchToPlatformOrder(platform);
            } else if (targetTab) {
                if (window.VotriGuard) {
                    window.VotriGuard.navigate(targetTab);
                } else if (window.VotriNav) {
                    window.VotriNav.showMainTab(targetTab);
                }
                renderAllViews();
            }
            if (sidebar) sidebar.classList.remove('mobile-active');
        });
    });

    // Dashboard Service Cards Click
    document.querySelectorAll('.dashboard-service-card').forEach(ccard => {
        ccard.addEventListener('click', (e) => {
            e.preventDefault();
            const platform = ccard.getAttribute('data-platform');
            if (window.VotriSmm) window.VotriSmm.switchToPlatformOrder(platform);
        });
    });

    // Modal Control — null guard v elements nằm trong view động
    if (btnAddPageHeader) btnAddPageHeader.addEventListener('click', () => openPageModal());
    if (modalBtnClose) modalBtnClose.addEventListener('click', closePageModal);
    if (modalBtnCancel) modalBtnCancel.addEventListener('click', closePageModal);
    if (modalPage) modalPage.addEventListener('click', (e) => {
        if (e.target === modalPage) closePageModal();
    });

    // Modal Form Save
    if (formPage) formPage.addEventListener('submit', handleFormSubmit);

    // Live Filtering — event delegation, filter elements load động
    if (globalSearch) globalSearch.addEventListener('input', renderAllViews);
    document.addEventListener('change', (e) => {
        if (e.target && (e.target.id === 'filter-niche' || e.target.id === 'filter-tier' || e.target.id === 'filter-status')) {
            renderAllViews();
        }
    });

    // Reset Filters Button
    if (btnResetFilters) btnResetFilters.addEventListener('click', () => {
        if (globalSearch) globalSearch.value = '';
        if (filterNiche()) filterNiche().value = '';
        if (filterTier()) filterTier().value = '';
        if (filterStatus()) filterStatus().value = '';
        renderAllViews();
        showToast('Đã xóa bộ lọc', 'info');
    });

    // --- Settings Listeners ---
    // Accent Theme Buttons Click
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            activeTheme = theme;
            document.body.className = `theme-${theme}`;
            localStorage.setItem('votri_sys_theme', theme);

            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            showToast(`Đã áp dụng theme: ${theme.toUpperCase()}`, 'info');
            renderAllViews(); // Redraw canvas charts with the ccorrect neon theme colors
        });
    });



    // Wipe Database Clear button
    if (settingsBtnClear) settingsBtnClear.addEventListener('click', () => {
        if (confirm('CẢNH BÁO: Bạn chắc chắn muốn xóa toàn bộ trang? Hành động này không thể hoàn tác.')) {
            pages = [];
            saveDatabase();
            renderAllViews();
            showToast('Đã xóa sạch dữ liệu', 'info');
        }
    });

    // Save Facebook API Token
    if (settingsFormApi) settingsFormApi.addEventListener('submit', (e) => {
        e.preventDefault();
        const token = settingsFbToken ? settingsFbToken.value.trim() : '';
        localStorage.setItem('votri_sys_api_token', token);
        
        // Xóa cache thông tin profile cũ để bắt đầu tải lại thông tin mới
        localStorage.removeItem('votri_fb_user_name');
        localStorage.removeItem('votri_fb_user_avatar');
        
        showToast('Đã lưu cấu hình Facebook Graph API', 'success');
        loadFacebookUserProfile();
        if (token) {
            syncFacebookPages();
        }
    });

    // Sync Facebook Pages button click handler
    const btnSyncFbPages = document.getElementById('btn-sync-fb-pages');
    if (btnSyncFbPages) {
        btnSyncFbPages.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.syncFacebookPages) {
                window.syncFacebookPages();
            }
        });
    }

    // Check all pages button click handler (dashboard)
    const btnCheckAllPages = document.getElementById('btn-check-all-pages');
    if (btnCheckAllPages) {
        btnCheckAllPages.addEventListener('click', function (e) {
            e.preventDefault();
            if (window.VotriFanpages && typeof window.VotriFanpages.runAllPageChecks === 'function') {
                window.VotriFanpages.runAllPageChecks(this);
            }
        });
    }

    if (btnFbConnectApp) btnFbConnectApp.addEventListener('click', () => {
        // Tạo state ngẫu nhiên và lưu vào sessionStorage để chống CSRF
        const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('votri_fb_oauth_state', state);
        
        const origin = window.location.origin;
        window.location.assign(`login_fb.php?state=${encodeURIComponent(state)}&origin=${encodeURIComponent(origin)}`);
    });

    // Hồ sơ cá nhân -> js/votri-profile.js + js/profile-api.js (MySQL)

    // SMM đặt hàng -> js/votri-smm.js (bindOrderForm trong DOMContentLoaded)
}

// Điều hướng tab -> js/votri-nav.js | SMM -> js/votri-smm.js

// --- Render Operations ---

function renderAllViews() {
    const isLoggedIn = sessionStorage.getItem('votri_sys_logged_in') === 'true';
    if (!isLoggedIn) return;

    // Dynamicc Filter Option Populating (Niches)
    populateNicheFilters();

    // Support Tickets update
    const supportContainer = document.getElementById('view-support');
    if (supportContainer && !supportContainer.classList.contains('hidden') && window.VotriSupport) {
        window.VotriSupport.renderTicketsTable();
    }

    // Order History update
    const historyContainer = document.getElementById('view-history');
    if (historyContainer && !historyContainer.classList.contains('hidden') && window.OrdersPage) {
        window.OrdersPage.loadAndRender();
    }

    // Stats Counters updates
    updateStatsCounters();

    // Render Niche Breakdown Graph card
    updateNicheBreakdown();

    // Apply Filter logic to list
    const searchVal = globalSearch ? globalSearch.value.toLowerCase().trim() : '';
    const nicheFilter = filterNiche() ? filterNiche().value : '';
    const tierFilter = filterTier() ? filterTier().value : '';
    const statusFilter = filterStatus() ? filterStatus().value : '';

    const filteredPages = pages.filter(page => {
        const matchesSearch =
            page.name.toLowerCase().includes(searchVal) ||
            page.niche.toLowerCase().includes(searchVal) ||
            page.tier.toLowerCase().includes(searchVal);

        const matchesNiche = !nicheFilter || page.niche === nicheFilter;
        const matchesTier = !tierFilter || page.tier === tierFilter;
        const matchesStatus = !statusFilter || page.status === statusFilter;

        return matchesSearch && matchesNiche && matchesTier && matchesStatus;
    });

    // Render Dashboard List Table
    renderTableRows(filteredPages);

    // Render Pages View Card Grid
    renderCardsGrid(filteredPages);

    // Draw Dashboard Main Chart
    renderDashboardChart();

    // Draw Analytics Tab Charts
    renderAnalyticsCharts();

    // Render User Accounts Audit Table (admin)
    if (window.VotriAccountsAdmin) {
        const raw = localStorage.getItem('votri_sys_users');
        window.VotriAccountsAdmin.renderTable(raw ? JSON.parse(raw) : users);
    }

    // Render Profile View
    renderProfileView();
}

function populateNicheFilters() {
    const el = filterNiche();
    if (!el) return;
    const currentSelection = el.value;
    const uniqueNiches = [...new Set(pages.map(p => p.niche))].sort();

    el.innerHTML = '<option value="">Tất cả Niche</option>';
    uniqueNiches.forEach(niche => {
        const option = document.createElement('option');
        option.value = niche;
        option.textContent = niche;
        if (niche === currentSelection) {
            option.selected = true;
        }
        el.appendChild(option);
    });
}

function updateStatsCounters() {
    const totalPages = pages.length;
    const elTP = statTotalPages(); if (elTP) elTP.textContent = totalPages;

    const totalFollowers = pages.reduce((sum, p) => sum + p.followers, 0);
    const elTF = statTotalFollowers(); if (elTF) elTF.textContent = formatFollowerNumber(totalFollowers);

    const activeCount = pages.filter(p => p.status === 'Active').length;
    const elAP = statActivePages(); if (elAP) elAP.textContent = `${activeCount}/${totalPages}`;

    const restrictedCount = pages.filter(p => p.status !== 'Active').length;
    const elFP = statFlaggedPages(); if (elFP) elFP.textContent = restrictedCount;

    // Update SMM Stats
    const email = sessionStorage.getItem('votri_sys_user_email');
    const localUsers = localStorage.getItem('votri_sys_users');
    const usersList = localUsers ? JSON.parse(localUsers) : [];
    const currentUser = usersList.find(u => u.email === email);

    const formatMoney = (amount) => Number(amount || 0).toLocaleString('vi-VN') + 'đ';

    if (currentUser) {
        const balance = currentUser.balance || 0;
        const totalDeposited = currentUser.totalDeposited || 0;
        const totalOrders = currentUser.totalOrders || 0;
        const completedOrders = currentUser.completedOrders || 0;

        const elBal = statBalance(); if (elBal) elBal.textContent = formatMoney(balance);
        const elDep = statTotalDeposited(); if (elDep) elDep.textContent = formatMoney(totalDeposited);
        const elOrd = statTotalOrders(); if (elOrd) elOrd.textContent = totalOrders.toLocaleString('vi-VN');
        const elCmp = statCompletedOrders(); if (elCmp) elCmp.textContent = completedOrders.toLocaleString('vi-VN');
        if (window.VotriRankProgress) window.VotriRankProgress.renderAll();
    } else {
        const elBal = statBalance(); if (elBal) elBal.textContent = '0đ';
        const elDep = statTotalDeposited(); if (elDep) elDep.textContent = '0đ';
        const elOrd = statTotalOrders(); if (elOrd) elOrd.textContent = '0';
        const elCmp = statCompletedOrders(); if (elCmp) elCmp.textContent = '0';
        if (window.VotriRankProgress) window.VotriRankProgress.renderAll();
    }
}

function updateNicheBreakdown() {
    const nicheList = document.getElementById('niche-list');
    if (!nicheList) return;

    if (pages.length === 0) {
        nicheList.innerHTML = '<p class="text-dim">Không có trang để phân tích niche.</p>';
        return;
    }

    const nicheCounts = {};
    pages.forEach(p => {
        nicheCounts[p.niche] = (nicheCounts[p.niche] || 0) + 1;
    });

    const nicheSorted = Object.entries(nicheCounts)
        .map(([name, count]) => ({
            name,
            count,
            percentage: Math.round((count / pages.length) * 100)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);

    nicheList.innerHTML = '';
    nicheSorted.forEach(niche => {
        const itemHtml = `
            <div class="niche-item">
                <div class="niche-meta">
                    <span class="niche-name">${escapeHTML(niche.name)}</span>
                    <span class="niche-percentage text-neon-cyan">${niche.percentage}%</span>
                </div>
                <div class="niche-bar-bg">
                    <div class="niche-bar-fill" style="width: ${niche.percentage}%"></div>
                </div>
            </div>
        `;
        nicheList.insertAdjacentHTML('beforeend', itemHtml);
    });
}

// --- Pagination State ---
let pagesCurrentPage = 1;
let gridCurrentPage = 1;

// --- Render Table ---
function renderTableRows(items) {
    const tbody = pagesTableBody();
    const emptyEl = tableEmptyState();
    if (!tbody) return; // view chưa load

    tbody.innerHTML = '';

    if (items.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        const info = document.getElementById('pages-pagination-info');
        if (info) info.textContent = 'Hiển thị 0 - 0 của 0 trang';
        const controls = document.getElementById('pages-pagination-controls');
        if (controls) controls.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // Pagination
    const total = items.length;
    const perPage = 5; // 5 rows per page on dashboard
    const totalPages = Math.ceil(total / perPage) || 1;
    if (pagesCurrentPage > totalPages) pagesCurrentPage = totalPages;
    if (pagesCurrentPage < 1) pagesCurrentPage = 1;
    const start = (pagesCurrentPage - 1) * perPage;
    const pageItems = items.slice(start, start + perPage);

    const info = document.getElementById('pages-pagination-info');
    if (info) {
        info.textContent = `Hiển thị ${start + 1} - ${Math.min(start + perPage, total)} của ${total} trang`;
    }

    pageItems.forEach(page => {
        const tr = document.createElement('tr');

        let statusBadge = '';
        const statusText = pageStatusLabel(page.status);
        statusBadge = `<span class="status-pill ${pageStatusPillClass(page.status)}"><span class="dot-pulse"></span>${statusText}</span>`;

        const displayName = page.name;
        const pageUrl = sanitizeUrl(page.url);
        const displayUrl = page.url ? page.url.replace('https://', '') : 'Chưa có URL';

        tr.innerHTML = `
            <td>
                <div class="page-identity">
                    <div class="page-avatar">
                        ${window.VotriApp?.renderPageAvatarInner?.(page) || '<span class="page-avatar-fb"><i data-lucide="facebook"></i></span>'}
                    </div>
                    <div class="page-details">
                        <span class="page-title-text">${escapeHTML(displayName)}</span>
                        <a href="${escapeHTML(pageUrl)}" target="_blank" class="page-link">
                            ${escapeHTML(displayUrl)} <i data-lucide="external-link" style="width: 10px; height: 10px;"></i>
                        </a>
                    </div>
                </div>
            </td>
            <td><span class="badge badge-neon-cyan">${escapeHTML(page.niche)}</span></td>
            <td><strong>${escapeHTML(page.tier)}</strong></td>
            <td>${statusBadge}</td>
            <td><span class="follower-count">${formatNumberWithCommas(page.followers)}</span></td>
            <td><span class="timestamp">${formatTimeAgo(page.lastCheck)}</span></td>
            <td>
                <div class="actions-flex">
                    <button class="btn-action btn-check" title="Kiểm tra sức khỏe" data-id="${page.id}">
                        <i data-lucide="refresh-cw"></i>
                    </button>
                    <button class="btn-action btn-edit" title="Sửa trang" data-id="${page.id}">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-action btn-delete" title="Xóa trang" data-id="${page.id}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });

    lucide.createIcons();
    bindActionButtons();

    // Render pagination controls
    const controls = document.getElementById('pages-pagination-controls');
    if (!controls) return;
    if (totalPages <= 1) {
        controls.innerHTML = '';
        return;
    }
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button type="button" class="dep-page-btn pages-page-btn" data-page="${i}" style="padding:4px 10px;margin:0 2px;width:32px;height:32px;border-radius:8px;cursor:pointer;background:${i === pagesCurrentPage ? 'var(--theme-color, var(--neon-cyan))' : 'rgba(255,255,255,0.03)'};color:${i === pagesCurrentPage ? '#000' : '#fff'};border:1px solid rgba(255,255,255,0.1);">${i}</button>`;
    }
    controls.innerHTML = html;
    controls.querySelectorAll('.pages-page-btn').forEach((btn) => {
        btn.onclick = (e) => {
            e.preventDefault();
            pagesCurrentPage = parseInt(btn.getAttribute('data-page'), 10);
            renderTableRows(items);
        };
    });
}

// --- Render Pages Card Grid ---
function renderCardsGrid(items) {
    const grid = pagesCardsGrid();
    const emptyEl = pagesEmptyState();
    if (!grid) return; // view chưa load

    grid.innerHTML = '';

    if (items.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        grid.style.display = 'none';
        const info = document.getElementById('cards-pagination-info');
        if (info) info.textContent = 'Hiển thị 0 - 0 của 0 trang';
        const controls = document.getElementById('cards-pagination-controls');
        if (controls) controls.innerHTML = '';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    grid.style.display = 'grid';

    // Pagination
    const total = items.length;
    const perPage = 6; // 6 cards per page
    const totalPages = Math.ceil(total / perPage) || 1;
    if (gridCurrentPage > totalPages) gridCurrentPage = totalPages;
    if (gridCurrentPage < 1) gridCurrentPage = 1;
    const start = (gridCurrentPage - 1) * perPage;
    const pageItems = items.slice(start, start + perPage);

    const info = document.getElementById('cards-pagination-info');
    if (info) {
        info.textContent = `Hiển thị ${start + 1} - ${Math.min(start + perPage, total)} của ${total} trang`;
    }

    pageItems.forEach(page => {
        let statusBadge = '';
        const statusText = pageStatusLabel(page.status);
        statusBadge = `<span class="status-pill ${pageStatusPillClass(page.status)}"><span class="dot-pulse"></span>${statusText}</span>`;

        const ccard = document.createElement('div');
        ccard.className = 'page-card glass-card';
        ccard.innerHTML = `
            <div class="card-top">
                <div class="card-title-group">
                    <span class="card-title-text">${escapeHTML(page.name)}</span>
                    <a href="${escapeHTML(sanitizeUrl(page.url))}" target="_blank" class="page-link">
                        ${escapeHTML(page.url ? page.url.replace('https://', '') : 'Không có URL')} <i data-lucide="external-link" style="width: 10px; height: 10px;"></i>
                    </a>
                </div>
                <span class="badge badge-neon-cyan card-niche-badge">${escapeHTML(page.niche)}</span>
            </div>
            
            <div class="card-stats">
                <div class="card-stat-box">
                    <span class="card-stat-label">Người theo dõi</span>
                    <span class="card-stat-value text-neon-cyan">${formatNumberWithCommas(page.followers)}</span>
                </div>
                <div class="card-stat-box">
                    <span class="card-stat-label">Trạng thái Tier</span>
                    <span class="card-stat-value">${escapeHTML(page.tier)}</span>
                </div>
            </div>
            
            <div class="card-actions">
                <div class="card-check-info">
                    ${statusBadge}
                    <span class="timestamp" style="margin-top: 4px; display:inline-block;">Kiểm tra ${formatTimeAgo(page.lastCheck)}</span>
                </div>
                <div class="actions-flex">
                    <button class="btn-action btn-check" title="Kiểm tra sức khỏe" data-id="${page.id}">
                        <i data-lucide="refresh-cw"></i>
                    </button>
                    <button class="btn-action btn-edit" title="Sửa trang" data-id="${page.id}">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-action btn-delete" title="Xóa trang" data-id="${page.id}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(ccard);
    });

    lucide.createIcons();
    bindActionButtons();

    // Render pagination controls
    const controls = document.getElementById('cards-pagination-controls');
    if (!controls) return;
    if (totalPages <= 1) {
        controls.innerHTML = '';
        return;
    }
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button type="button" class="dep-page-btn cards-page-btn" data-page="${i}" style="padding:4px 10px;margin:0 2px;width:32px;height:32px;border-radius:8px;cursor:pointer;background:${i === gridCurrentPage ? 'var(--theme-color, var(--neon-cyan))' : 'rgba(255,255,255,0.03)'};color:${i === gridCurrentPage ? '#000' : '#fff'};border:1px solid rgba(255,255,255,0.1);">${i}</button>`;
    }
    controls.innerHTML = html;
    controls.querySelectorAll('.cards-page-btn').forEach((btn) => {
        btn.onclick = (e) => {
            e.preventDefault();
            gridCurrentPage = parseInt(btn.getAttribute('data-page'), 10);
            renderCardsGrid(items);
        };
    });
}

function bindActionButtons() {
    document.querySelectorAll('.btn-check').forEach(btn => {
        // Clear previous listeners by cloning (avoids double triggering)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            const id = newBtn.getAttribute('data-id');
            runPageCheck(id, newBtn);
        });
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            const id = newBtn.getAttribute('data-id');
            openPageModal(id);
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            const id = newBtn.getAttribute('data-id');
            deletePage(id);
        });
    });
}

// --- Active Theme Colors Extrator Helper ---
function getThemeAccentColor() {
    switch (activeTheme) {
        case 'green': return '#39ff14';
        case 'purple': return '#bd00ff';
        case 'cyan':
        default:
            return '#00f0ff';
    }
}
function getThemeGlowColor() {
    switch (activeTheme) {
        case 'green': return 'rgba(57, 255, 20, 0.4)';
        case 'purple': return 'rgba(189, 0, 255, 0.4)';
        case 'cyan':
        default:
            return 'rgba(0, 240, 255, 0.4)';
    }
}

// --- Dynamicc Canvas Charts Drawings ---

// 1. Dashboard Chart: follower growth ccurves
function renderDashboardChart() {
    const canvas = document.getElementById('neonChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const accentColor = getThemeAccentColor();
    const glowColor = getThemeGlowColor();

    // Adjust size
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = 250 * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = canvas.width / window.devicePixelRatio;
    const height = 250;

    ctx.clearRect(0, 0, width, height);

    if (pages.length === 0) {
        ctx.fillStyle = '#718096';
        ctx.font = '14px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa có trang. Tải demo trong Cài đặt để xem biểu đồ.', width / 2, height / 2);
        return;
    }

    const paddingLeft = 45;
    const paddingRight = 20;
    const paddingTop = 30;
    const paddingBottom = 40;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Draw Y grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    const totalFollowers = pages.reduce((sum, p) => sum + p.followers, 0);
    const maxVal = totalFollowers * 1.1;
    const minVal = totalFollowers * 0.7;

    for (let i = 0; i <= 4; i++) {
        const y = paddingTop + (chartHeight * i / 4);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - paddingRight, y);
        ctx.stroke();

        ctx.fillStyle = '#718096';
        ctx.font = '10px Outfit';
        ctx.textAlign = 'right';
        const displayVal = formatFollowerNumber(maxVal - ((maxVal - minVal) * i / 4));
        ctx.fillText(displayVal, paddingLeft - 8, y + 4);
    }

    // Draw X labels
    const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const xStep = chartWidth / (days.length - 1);
    for (let i = 0; i < days.length; i++) {
        const x = paddingLeft + (xStep * i);
        ctx.beginPath();
        ctx.moveTo(x, paddingTop);
        ctx.lineTo(x, height - paddingBottom);
        ctx.stroke();

        ctx.fillStyle = '#718096';
        ctx.font = '11px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(days[i], x, height - 15);
    }

    // Generate real-looking ccurves scaled to database size
    const baseValue = totalFollowers;
    // Growth multiplier ccurve over 7 days
    const fators = [0.85, 0.90, 0.94, 0.96, 0.98, 0.99, 1.0];
    const coordinates = fators.map(f => baseValue * f);

    const valToY = (val) => {
        const ratio = (val - minVal) / (maxVal - minVal);
        return height - paddingBottom - (chartHeight * ratio);
    };

    // Draw neon area fill
    ctx.fillStyle = `rgba(${activeTheme === 'cyan' ? '0, 240, 255' : activeTheme === 'green' ? '57, 255, 20' : '189, 0, 255'}, 0.04)`;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, height - paddingBottom);
    for (let i = 0; i < coordinates.length; i++) {
        ctx.lineTo(paddingLeft + (xStep * i), valToY(coordinates[i]));
    }
    ctx.lineTo(paddingLeft + (xStep * (coordinates.length - 1)), height - paddingBottom);
    ctx.closePath();
    ctx.fill();

    // Draw neon line
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(paddingLeft, valToY(coordinates[0]));
    for (let i = 1; i < coordinates.length; i++) {
        ctx.lineTo(paddingLeft + (xStep * i), valToY(coordinates[i]));
    }
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;

    // Draw coordinates peak highlighếts
    for (let i = 0; i < coordinates.length; i++) {
        const x = paddingLeft + (xStep * i);
        const y = valToY(coordinates[i]);

        ctx.fillStyle = '#050508';
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
}

// 2. Analytics Tab Charts: Follower Bar chart & Niche Donut chart
function renderAnalyticsCharts() {
    const followersCanvas = document.getElementById('analyticsFollowersChart');
    const nicheCanvas = document.getElementById('analyticsNicheChart');

    if (!followersCanvas || !nicheCanvas) return;

    const fCtx = followersCanvas.getContext('2d');
    const nCtx = nicheCanvas.getContext('2d');

    if (pages.length === 0) {
        const aeEl = analyticsEmptyState(); if (aeEl) aeEl.style.display = 'flex';
        followersCanvas.parentElement.parentElement.style.display = 'none';
        nicheCanvas.parentElement.parentElement.style.display = 'none';
        return;
    }

    const aeEl2 = analyticsEmptyState(); if (aeEl2) aeEl2.style.display = 'none';
    followersCanvas.parentElement.parentElement.style.display = 'flex';
    nicheCanvas.parentElement.parentElement.style.display = 'flex';

    // Get theme settings
    const accentColor = getThemeAccentColor();
    const glowColor = getThemeGlowColor();

    // A. Render Follower Bar ccomparison Chart
    const fRect = followersCanvas.parentElement.getBoundingClientRect();
    followersCanvas.width = fRect.width * window.devicePixelRatio;
    followersCanvas.height = 250 * window.devicePixelRatio;
    fCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const fWidth = followersCanvas.width / window.devicePixelRatio;
    const fHeight = 250;

    fCtx.clearRect(0, 0, fWidth, fHeight);

    // Sort top 5 pages by followers
    const topPages = [...pages].sort((a, b) => b.followers - a.followers).slice(0, 5);

    const padL = 100; // room for name text
    const padR = 30;
    const padT = 20;
    const padB = 20;

    const drawW = fWidth - padL - padR;
    const drawH = fHeight - padT - padB;

    const maxFollowers = topPages[0].followers;
    const barHeight = Math.min(26, drawH / topPages.length - 12);
    const rowStep = drawH / topPages.length;

    topPages.forEach((page, index) => {
        const y = padT + (rowStep * index) + (rowStep - barHeight) / 2;
        const barWidth = (page.followers / maxFollowers) * drawW;

        // Draw page label
        fCtx.fillStyle = varColorText();
        fCtx.font = '500 12px Outfit';
        fCtx.textAlign = 'right';
        fCtx.fillText(truncateText(page.name, 12), padL - 10, y + barHeight / 2 + 4);

        // Draw bar shadow/glow
        fCtx.shadowBlur = 6;
        fCtx.shadowColor = glowColor;

        // Draw filled bar
        fCtx.fillStyle = accentColor;
        fCtx.beginPath();
        fCtx.roundRect(padL, y, barWidth, barHeight, 6);
        fCtx.fill();

        // Reset shadow
        fCtx.shadowBlur = 0;

        // Draw follower label
        fCtx.fillStyle = '#ffffff';
        fCtx.font = '600 11px Orbitron';
        fCtx.textAlign = 'left';
        fCtx.fillText(formatFollowerNumber(page.followers), padL + barWidth + 8, y + barHeight / 2 + 4);
    });

    // B. Render Niche Representation Donut Chart
    const nRect = nicheCanvas.parentElement.getBoundingClientRect();
    nicheCanvas.width = nRect.width * window.devicePixelRatio;
    nicheCanvas.height = 250 * window.devicePixelRatio;
    nCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const nWidth = nicheCanvas.width / window.devicePixelRatio;
    const nHeight = 250;
    nCtx.clearRect(0, 0, nWidth, nHeight);

    // Compute Niche frequencies
    const niches = {};
    pages.forEach(p => { niches[p.niche] = (niches[p.niche] || 0) + 1; });
    const totalCount = pages.length;

    const colors = [accentColor, '#bd00ff', '#39ff14', '#ffd700', '#ff3131'];

    const centerX = nWidth * 0.35;
    const centerY = nHeight / 2;
    const radius = 65;
    const innerRadius = 42;

    let startAngle = 0;

    // Draw Arcs
    Object.entries(niches).forEach(([niche, count], idx) => {
        const sliceAngle = (count / totalCount) * 2 * Math.PI;
        const color = colors[idx % colors.length];

        nCtx.fillStyle = color;
        nCtx.beginPath();
        nCtx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
        nCtx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
        nCtx.closePath();
        nCtx.fill();

        // Draw legend
        const legendX = nWidth * 0.65;
        const legendY = 40 + (idx * 24);

        nCtx.fillStyle = color;
        nCtx.beginPath();
        nCtx.arc(legendX, legendY, 5, 0, 2 * Math.PI);
        nCtx.fill();

        nCtx.fillStyle = varColorText();
        nCtx.font = '500 12px Outfit';
        nCtx.textAlign = 'left';
        const percent = Math.round((count / totalCount) * 100);
        nCtx.fillText(`${truncateText(niche, 10)} (${percent}%)`, legendX + 14, legendY + 4);

        startAngle += sliceAngle;
    });
}

function varColorText() {
    return '#f5f6fa';
}

function truncateText(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 2) + '..';
}

// --- Formatting Helpers ---

function formatFollowerNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num;
}

function formatNumberWithCommas(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTimeAgo(isoString) {
    if (!isoString) return 'Chưa kiểm tra';

    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Vừa xong';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;

    const days = Math.floor(hours / 24);
    return `${days} ngày trước`;
}

function sanitizeUrl(urlStr) {
    if (!urlStr) return '#';
    const trimmed = urlStr.trim();
    // Block dangerous URI schemes to prevent DOM-based XSS attacks
    if (trimmed.toLowerCase().startsWith('javascript:') ||
        trimmed.toLowerCase().startsWith('data:') ||
        trimmed.toLowerCase().startsWith('vbscript:')) {
        return '#';
    }
    // Only allow HTTP, HTTPS, relative pathing, or standard document hashes
    if (trimmed.match(/^(https?:\/\/|\/|#)/i)) {
        return trimmed;
    }
    return '#';
}

function renderAccountsTable() {
    if (window.VotriAccountsAdmin) {
        window.VotriAccountsAdmin.renderTable(users);
    }
}

function truncateText(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

function renderProfileView() {
    const email = sessionStorage.getItem('votri_sys_user_email');
    if (!email) return;

    const localUsers = localStorage.getItem('votri_sys_users');
    const users = localUsers ? JSON.parse(localUsers) : [];
    const user = users.find(u => u.email === email);

    if (!user) return;

    // Cập nhật text trên Header
    const nameDisplay = document.getElementById('profile-name-display');
    const roleDisplay = document.getElementById('profile-role-display');
    const statusBadge = document.getElementById('profile-status-badge');
    const joinDate = document.getElementById('profile-join-date');

    if (nameDisplay) nameDisplay.innerText = user.name || 'Người dùng';

    const tfaToggle = document.getElementById('profile-2fa-toggle');
    const notifyToggle = document.getElementById('profile-notify-login-toggle');
    if (tfaToggle) tfaToggle.checked = !!user.twoFactorEnabled;
    if (notifyToggle) notifyToggle.checked = user.notifyNewLogin !== false;
    if (roleDisplay) {
        const normRole = window.VotriRoles
            ? window.VotriRoles.normalize(user.role)
            : String(user.role || 'member').toLowerCase();
        roleDisplay.innerText = window.VotriRoles
            ? window.VotriRoles.label(normRole)
            : normRole === 'admin'
                ? 'Quản trị viên'
                : 'Thành viên';
    }

    if (statusBadge) {
        let statusClass = 'status-inactive';
        if (user.status === 'Verified') statusClass = 'status-active';
        if (user.status === 'Blocked') statusClass = 'status-restricted';
        statusBadge.innerHTML = `<span class="status-pill ${statusClass}"><span class="dot-pulse"></span>${userStatusLabel(user.status)}</span>`;
    }

    if (joinDate) {
        const jDate = user.joinDate || new Date().toISOString();
        joinDate.innerText = new Date(jDate).toLocaleDateString('vi-VN');
    }

    // Update Avatar
    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarIcon = document.getElementById('profile-avatar-icon');
    const sidebarAvatar = document.getElementById('sidebar-user-avatar');

    if (user.avatar) {
        if (avatarImg) {
            avatarImg.src = user.avatar;
            avatarImg.style.display = 'block';
        }
        if (avatarIcon) avatarIcon.style.display = 'none';
        if (sidebarAvatar) sidebarAvatar.src = user.avatar;
    } else {
        if (avatarImg) avatarImg.style.display = 'none';
        if (avatarIcon) avatarIcon.style.display = 'block';
        if (sidebarAvatar) sidebarAvatar.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80';
    }

    // Cập nhật số dư
    const creditsDisplay = document.getElementById('profile-credits-display');
    if (creditsDisplay) {
        creditsDisplay.textContent = user.balance || 0;
    }

    // Điền vào form (tránh ghi đè khi đang gõ)
    const emailInput = document.getElementById('profile-email-input');
    const nameInput = document.getElementById('profile-name-input');

    if (emailInput) emailInput.value = user.email;
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = user.name || '';
    }

    const nameCooldown = document.getElementById('profile-name-cooldown');
    const btnUpdateProfile = document.getElementById('btn-update-profile');
    if (nameCooldown) {
        if (user.lastNameChange) {
            const diffTime = Math.abs(new Date() - new Date(user.lastNameChange));
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays < 60) {
                nameCooldown.textContent = `(Còn ${60 - diffDays} ngày)`;
                if (nameInput) {
                    nameInput.disabled = true;
                    nameInput.style.background = 'rgba(255,255,255,0.05)';
                    nameInput.style.color = '#888';
                }
            } else {
                nameCooldown.textContent = '';
                if (nameInput) {
                    nameInput.disabled = false;
                    nameInput.style.background = '';
                    nameInput.style.color = '';
                }
            }
        } else {
            nameCooldown.textContent = '';
            if (nameInput) {
                nameInput.disabled = false;
                nameInput.style.background = '';
                nameInput.style.color = '';
            }
        }
    }

    // Hiển thị nhật ký hoạt động
    const logsTable = document.getElementById('profile-logs-table');
    if (logsTable) {
        const logs = user.logs || [];
        if (logs.length === 0) {
            logsTable.innerHTML = '<tr><td colspan="3" class="text-center text-dim" style="text-align: center;">Chưa có hoạt động nào.</td></tr>';
        } else {
            logsTable.innerHTML = logs.map(log => {
                let statusClass = 'status-active';
                if (log.status === 'Thất bại') statusClass = 'status-restricted';

                // Determine appropriate icon for action
                const actionLower = String(log.action).toLowerCase();
                let iconName = 'activity';
                if (actionLower.includes('đăng nhập') || actionLower.includes('login')) {
                    iconName = 'log-in';
                } else if (actionLower.includes('đăng ký') || actionLower.includes('register')) {
                    iconName = 'user-plus';
                } else if (actionLower.includes('mật khẩu') || actionLower.includes('password')) {
                    iconName = 'key-round';
                } else if (actionLower.includes('2fa')) {
                    iconName = 'shield-check';
                } else if (actionLower.includes('cập nhật') || actionLower.includes('update')) {
                    iconName = 'user-cog';
                }

                return `
                    <tr>
                        <td style="text-align: left; padding: 12px 20px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <i data-lucide="${iconName}" style="width: 15px; height: 15px; color: var(--neon-cyan); opacity: 0.85;"></i>
                                <span style="font-weight: 500; color: #ffffff;">${escapeHTML(log.action)}</span>
                            </div>
                        </td>
                        <td style="text-align: center; padding: 12px 0;">
                            <span class="status-pill ${statusClass}" style="padding: 2px 8px; font-size: 11px; border-radius: 4px; font-weight: 500;">${escapeHTML(log.status)}</span>
                        </td>
                        <td style="text-align: right; padding: 12px 20px;">
                            <span class="timestamp" style="color: #94a3b8; font-size: 12px;">${new Date(log.timestamp || log.time).toLocaleString('vi-VN')}</span>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (window.VotriRankProgress) window.VotriRankProgress.renderAll();
    if (window.lucide) window.lucide.createIcons();
}

// ==========================================
// SMM (bảng giá, Mua ngay, tạo đơn) -> js/votri-smm.js

// // Support -> js/votri-support.js | Deposit -> js/votri-deposit.js
// Xem docs/MODULE_MAP.md

function renderTicketsTable() {
    if (window.VotriSupport) window.VotriSupport.renderTicketsTable();
}

function initLandingPageLogic() {
    const btnShowLogin = document.getElementById('btn-show-login');
    const btnHeroStart = document.getElementById('btn-hero-login-start');
    const btnShowRegister = document.getElementById('btn-show-register');
    const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
    const authModalBackdrop = document.getElementById('auth-modal-backdrop');

    const showModal = (formType) => {
        if (authModalBackdrop) {
            authModalBackdrop.classList.add('active');
            authModalBackdrop.classList.remove('hidden');
        }
        showAuthForm(formType);
    };

    const hideModal = () => {
        if (authModalBackdrop) {
            authModalBackdrop.classList.remove('active');
            setTimeout(() => {
                authModalBackdrop.classList.add('hidden');
            }, 300);
        }
    };

    if (btnShowLogin) btnShowLogin.addEventListener('click', () => showModal('login'));
    if (btnHeroStart) btnHeroStart.addEventListener('click', () => showModal('login'));
    if (btnShowRegister) btnShowRegister.addEventListener('click', () => showModal('register'));
    if (btnCloseAuthModal) btnCloseAuthModal.addEventListener('click', hideModal);

    if (authModalBackdrop) {
        authModalBackdrop.addEventListener('click', (e) => {
            if (e.target === authModalBackdrop) {
                hideModal();
            }
        });
    }

    // Bind FAQ accordions
    const faqTriggers = document.querySelectorAll('.faq-accordion-trigger');
    faqTriggers.forEach(trigger => {
        trigger.addEventListener('click', () => {
            const item = trigger.closest('.faq-accordion-item');
            const isActive = item.classList.contains('active');

            // Close other items
            document.querySelectorAll('.faq-accordion-item').forEach(i => {
                i.classList.remove('active');
            });

            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // Smooth navigation scrolling
    const navLinks = document.querySelectorAll('.landing-nav .nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            const container = document.querySelector('.landing-container');
            if (targetSection && container) {
                container.scrollTo({
                    top: targetSection.offsetTop - 80,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Handle scroll behavior to change active class in nav links
    const landingContainer = document.querySelector('.landing-container');
    if (landingContainer) {
        const sections = document.querySelectorAll('.landing-section');

        landingContainer.addEventListener('scroll', () => {
            let current = 'hero';
            sections.forEach(section => {
                const sectionTop = section.offsetTop - 120;
                if (landingContainer.scrollTop >= sectionTop) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${current}`) {
                    link.classList.add('active');
                }
            });
        });
    }
}

