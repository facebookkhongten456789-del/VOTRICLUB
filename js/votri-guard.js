/**
 * Kiểm soát truy cập sau đăng nhập — chống spam tab/API.
 * Mọi chuyển view phải qua navigate(); allowApi() chỉ kiểm tra đăng nhập.
 */
(function () {
    const MEMBER_TABS = new Set([
        'dashboard',
        'create-order',
        'deposit',
        'history',
        'pricing',
        'support',
        'profile',
        'pages',
        'analytics',
        'settings',
        'service-facebook',
        'service-tiktok',
        'service-instagram',
        'service-shopee',
        'service-telegram',
        'service-youtube',
        'service-traffic',
        'service-whatsapp',
    ]);

    const ADMIN_ONLY_TABS = new Set(['accounts', 'apiservice', 'service-api-update']);

    const TAB_FEATURES = {
        pricing: ['smm_fetch'],
        'create-order': ['smm_fetch'],
        history: ['orders_list'],
        deposit: ['deposit_init'],
        support: ['support_ui'],
        pages: ['pages_list'],
        analytics: ['pages_list'],
        settings: ['pages_list'],
        dashboard: ['pages_list'],
        profile: ['profile_load'],
        accounts: ['accounts_sync'],
    };

    const SERVICE_TAB_PLATFORM = {
        'service-facebook': 'Facebook',
        'service-tiktok': 'TIKTOK',
        'service-instagram': 'Instagram',
        'service-shopee': 'Shopee',
        'service-telegram': 'Telegram',
        'service-youtube': 'Youtube',
        'service-traffic': 'Traffic',
        'service-whatsapp': 'WhatsApp',
    };

    let sessionBootstrapped = false;

    function toast(msg, type) {
        window.VotriApp?.showToast?.(msg, type || 'info');
    }

    function isLoggedIn() {
        return (
            sessionStorage.getItem('votri_sys_logged_in') === 'true' &&
            !!sessionStorage.getItem('votri_sys_token')
        );
    }

    function isAdmin() {
        const role = (sessionStorage.getItem('votri_sys_user_role') || '').toLowerCase();
        return role === 'admin' || window.VotriApp?.isCurrentUserAdmin?.();
    }

    function normalizeTabId(tabId) {
        if (!tabId) return null;
        if (SERVICE_TAB_PLATFORM[tabId]) return { view: 'create-order', platform: SERVICE_TAB_PLATFORM[tabId] };
        return { view: tabId, platform: null };
    }

    function canAccessTab(tabId) {
        if (!isLoggedIn()) return { ok: false, reason: 'Chưa đăng nhập.' };
        if (ADMIN_ONLY_TABS.has(tabId) && !isAdmin()) {
            return { ok: false, reason: 'Chỉ quản trị viên mới truy cập được mục này.' };
        }
        const norm = normalizeTabId(tabId);
        const view = norm.view;
        if (ADMIN_ONLY_TABS.has(view) && !isAdmin()) {
            return { ok: false, reason: 'Chỉ quản trị viên mới truy cập được mục này.' };
        }
        if (!MEMBER_TABS.has(view) && !ADMIN_ONLY_TABS.has(view)) {
            return { ok: false, reason: 'Chức năng không được phép.' };
        }
        return { ok: true, view, platform: norm.platform };
    }

    function allowApi() {
        if (!isLoggedIn()) {
            return { ok: false, reason: 'Phiên đăng nhập không hợp lệ.' };
        }
        return { ok: true };
    }

    function releaseApi() {
        /* no-op — client rate limit đã tắt */
    }

    function activateFeaturesForTab(view) {
        const features = TAB_FEATURES[view];
        if (!features) return;

        features.forEach((feat) => {
            if (feat === 'smm_fetch' && window.VotriSmm) window.VotriSmm.ensureLoaded();
            if (feat === 'orders_list' && window.OrdersPage) window.OrdersPage.loadAndRender();
            if (feat === 'deposit_init' && window.VotriDeposit) window.VotriDeposit.init();
            if (feat === 'pages_list' && window.VotriFanpages) window.VotriFanpages.loadPagesFromServer();
            if (feat === 'support_ui' && window.VotriSupport) window.VotriSupport.renderTicketsTable();
            if (feat === 'profile_load' && window.VotriProfile) window.VotriProfile.onTabVisible();
            if (feat === 'accounts_sync' && window.VotriAccountsAdmin) window.VotriAccountsAdmin.onTabVisible();
        });
    }

    /**
     * Sau đăng nhập: chỉ dashboard + sync — không gọi hàng loạt API.
     */
    function onLoginBootstrap() {
        if (sessionBootstrapped) return;
        sessionBootstrapped = true;
        // #region agent log
        window.__votriDbg?.('votri-guard.js:onLoginBootstrap', 'minimal', {}, 'G1');
        // #endregion
        if (window.VotriNav) window.VotriNav.showMainTab('dashboard', { skipGuard: true });
    }

    function resetSession() {
        sessionBootstrapped = false;
    }

    function navigate(tabId, options = {}) {
        if (!options.skipGuard && !isLoggedIn()) {
            toast('Vui lòng đăng nhập.', 'info');
            return false;
        }

        const access = canAccessTab(tabId);
        if (!access.ok) {
            toast(access.reason, 'info');
            // #region agent log
            window.__votriDbg?.('votri-guard.js:navigate', 'denied', { tabId, reason: access.reason }, 'G2');
            // #endregion
            return false;
        }

        if (access.platform && window.VotriSmm) {
            window.VotriSmm.switchToPlatformOrder(access.platform, { skipNavigate: true });
            if (window.VotriNav) window.VotriNav.showMainTab('create-order', { skipGuard: true });
            activateFeaturesForTab('create-order');
            // #region agent log
            window.__votriDbg?.('votri-guard.js:navigate', 'platform-order', { tabId, platform: access.platform }, 'G3');
            // #endregion
            return true;
        }

        if (window.VotriNav) window.VotriNav.showMainTab(access.view, { skipGuard: true });
        activateFeaturesForTab(access.view);
        // #region agent log
        window.__votriDbg?.('votri-guard.js:navigate', 'ok', { tabId: access.view }, 'G3');
        // #endregion
        return true;
    }

    window.VotriGuard = {
        isLoggedIn,
        isAdmin,
        canAccessTab,
        navigate,
        allowApi,
        releaseApi,
        onLoginBootstrap,
        resetSession,
        MEMBER_TABS,
        ADMIN_ONLY_TABS,
    };
})();
