/**
 * Điều hướng tab chính (sidebar) — tách khỏi app.js
 */
(function () {
    function showMainTab(tabId, options = {}) {
        if (!options.skipGuard && window.VotriGuard) {
            const access = window.VotriGuard.canAccessTab(tabId);
            if (!access.ok) {
                window.VotriApp?.showToast?.(access.reason, 'info');
                return false;
            }
            if (access.platform && window.VotriSmm) {
                window.VotriSmm.switchToPlatformOrder(access.platform);
                return true;
            }
            tabId = access.view;
        }

        document.querySelectorAll('.menu-item[data-tab]').forEach((item) => {
            item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
        });

        document.querySelectorAll('.view-container').forEach((container) => {
            container.classList.toggle('hidden', container.id !== `view-${tabId}`);
        });

        if (tabId === 'create-order' && window.VotriSmm) window.VotriSmm.ensureLoaded();
        if (tabId === 'history' && window.OrdersPage) window.OrdersPage.loadAndRender();
        if (tabId === 'accounts' && window.VotriAccountsAdmin) window.VotriAccountsAdmin.onTabVisible();
        window.VotriApp?.updateSidebarUserProfile?.();

        if (window.VotriFanpages) {
            window.VotriFanpages.updateFanpageHeader(tabId);
        }

        // #region agent log
        window.__votriDbg?.('votri-nav.js:showMainTab', 'ok', {
            tabId,
            dashboardHidden: document.getElementById('view-dashboard')?.classList.contains('hidden')
        }, 'H');
        // #endregion
    }

    window.VotriNav = { showMainTab };
})();
