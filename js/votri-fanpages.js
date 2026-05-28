/** Fanpage: MySQL + kiểm tra Graph API */

var pages = [];

var activeEditId = null;



const FANPAGE_TOOL_TABS = new Set(['dashboard', 'pages', 'analytics', 'settings']);
window.FANPAGE_TOOL_TABS = FANPAGE_TOOL_TABS;



function initDatabase() {
    try {
        const raw = localStorage.getItem('votri_sys_pages');
        pages = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(pages)) pages = [];
    } catch {
        pages = [];
        localStorage.setItem('votri_sys_pages', '[]');
    }
}



async function loadPagesFromServer() {
    if (window.VotriGuard) {
        const gate = window.VotriGuard.allowApi('pages_list');
        if (!gate.ok) {
            window.VotriApp?.showToast?.(gate.reason, 'info');
            return pages;
        }
    }

    const app = window.VotriApp;
    if (!window.PagesApi || !app?.getSessionToken?.()) return pages;

    try {
        pages = await window.PagesApi.loadPages();
        saveDatabase();
        window.__votriDbg?.('votri-fanpages.js:loadPagesFromServer', 'ok', { count: pages.length }, 'G');
    } catch (e) {
        console.error('[PAGES LOAD]', e);
        window.__votriDbg?.('votri-fanpages.js:loadPagesFromServer', 'error', { msg: String(e.message) }, 'G');
        try {
            const raw = localStorage.getItem('votri_sys_pages');
            const cached = raw ? JSON.parse(raw) : [];
            if (Array.isArray(cached) && cached.length) pages = cached;
        } catch (_) { /* */ }
    }

    if (typeof renderAllViews === 'function') renderAllViews();
    return pages;
}



function saveDatabase() {

    localStorage.setItem('votri_sys_pages', JSON.stringify(pages));

    if (typeof updateStatsCounters === 'function') updateStatsCounters();

    if (typeof updateNicheBreakdown === 'function') updateNicheBreakdown();

}



function updateFanpageHeader(tab) {

    const actions = document.getElementById('header-actions-container');

    const searchWrap = document.querySelector('.header-search');

    const show = FANPAGE_TOOL_TABS.has(tab);

    if (actions) {

        actions.style.display = show ? 'flex' : 'none';

        actions.setAttribute('aria-hidden', show ? 'false' : 'true');

    }

    if (searchWrap) searchWrap.style.display = show ? '' : 'none';

}



function openPageModal(pageId = null) {

    activeEditId = pageId;

    const form = document.getElementById('form-page');

    if (form) form.reset();

    const title = document.getElementById('modal-title');

    const modal = document.getElementById('modal-page');

    if (pageId) {

        if (title) title.textContent = 'Sửa trang Facebook';

        const page = pages.find((p) => p.id === pageId);

        if (page) {

            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };

            set('field-id', page.id);

            set('field-name', page.name);

            set('field-niche', page.niche);

            set('field-tier', page.tier);

            set('field-followers', page.followers);

            set('field-status', page.status);

            set('field-url', page.url || '');

        }

    } else if (title) {

        title.textContent = 'Thêm trang Facebook';

        const fid = document.getElementById('field-id');

        if (fid) fid.value = '';

    }

    if (modal) modal.classList.add('active');

}



function closePageModal() {

    const modal = document.getElementById('modal-page');

    if (modal) modal.classList.remove('active');

    activeEditId = null;

}



async function handleFormSubmit(e) {

    e.preventDefault();

    const app = window.VotriApp;

    if (!app.getSessionToken()) return app.showToast('Đăng nhập lại.', 'error');

    if (!window.PagesApi) return app.showToast('Tải lại trang (Ctrl+F5).', 'error');



    const id = document.getElementById('field-id')?.value;

    const url = document.getElementById('field-url')?.value.trim() || '';

    const payload = {

        name: document.getElementById('field-name')?.value.trim(),

        niche: document.getElementById('field-niche')?.value.trim(),

        tier: document.getElementById('field-tier')?.value,

        followers: parseInt(document.getElementById('field-followers')?.value, 10) || 0,

        status: document.getElementById('field-status')?.value,

        url,

        fbPageId: url ? app.resolveFacebookPageKey({ url }) : null

    };



    try {

        await window.PagesApi.savePage(payload, id || null);

        await loadPagesFromServer();

        app.showToast(id ? 'Đã cập nhật Fanpage' : 'Đã lưu Fanpage', 'success');

        closePageModal();

        if (typeof renderAllViews === 'function') renderAllViews();

    } catch (err) {

        app.showToast(err.message || 'Lỗi lưu Fanpage', 'error');

    }

}



async function deletePage(id) {

    const app = window.VotriApp;

    if (!confirm('Xóa Fanpage?')) return;

    try {

        await window.PagesApi.removePage(id);

        await loadPagesFromServer();

        if (typeof renderAllViews === 'function') renderAllViews();

        app.showToast('Đã xóa', 'info');

    } catch (err) {

        app.showToast(err.message || 'Lỗi xóa', 'error');

    }

}



async function runPageCheck(id, btnElement) {

    const app = window.VotriApp;

    const icon = btnElement.querySelector('svg') || btnElement.querySelector('i');

    if (!icon || icon.classList.contains('spinning')) return;



    if (!app.getSessionToken()) {

        app.showToast('Phiên hết hạn. Đăng nhập lại.', 'error');

        return;

    }

    if (window.VotriGuard) {
        const gate = window.VotriGuard.allowApi('page_check');
        if (!gate.ok) {
            app.showToast(gate.reason, 'info');
            return;
        }
    }



    const fbToken = localStorage.getItem('votri_sys_api_token');

    if (!fbToken) {

        app.showToast('Thiếu Facebook Access Token. Vào Cài đặt → lưu token Graph API.', 'error');

        return;

    }



    const page = pages.find((p) => p.id === id);

    if (!page) return;



    const before = { status: page.status, followers: page.followers, lastCheck: page.lastCheck };



    icon.classList.add('spinning');

    try {

        const targetPageId = page.url ? app.resolveFacebookPageKey(page) : page.fbPageId || null;

        const res = await fetch(`${app.API_BASE}/api/check-page`, {

            method: 'POST',

            headers: app.authHeaders(),

            body: JSON.stringify({

                accessToken: fbToken,

                pageId: targetPageId || undefined,

                url: page.url || undefined,

                pageName: page.name || undefined,

                pageRecordId: page.id

            })

        });

        const data = await app.parseJsonResponse(res);

        if (!res.ok || !data.success) {

            throw new Error((data.message || 'Không kiểm tra được').split('·')[0].trim());

        }



        const checkPayload = {

            name: data.page?.name || page.name,

            status: data.page?.status || page.status,

            followers: data.page?.followers ?? page.followers,

            fbPageId: data.page?.fbPageId || page.fbPageId || null

        };



        // #region agent log

        window.__votriDbg?.('votri-fanpages.js:runPageCheck', 'before-sync', { id, before, checkPayload }, 'G');

        // #endregion



        if (!window.PagesApi?.syncCheckResult) {

            throw new Error('PagesApi chưa sẵn sàng. Tải lại trang (Ctrl+F5).');

        }



        const saved = await window.PagesApi.syncCheckResult(id, checkPayload);

        await loadPagesFromServer();



        // #region agent log

        window.__votriDbg?.('votri-fanpages.js:runPageCheck', 'after-sync', {

            id,

            savedStatus: saved?.status,

            savedFollowers: saved?.followers,

            savedLastCheck: saved?.lastCheck

        }, 'G');

        // #endregion



        if (typeof renderAllViews === 'function') renderAllViews();

        const toastType = checkPayload.status === 'Active' ? 'success' : 'info';

        app.showToast(

            (data.readSummary || data.message || '') + ' · Đã lưu vào cơ sở dữ liệu.',

            toastType

        );

    } catch (err) {

        console.error('[PAGE CHECK]', err);

        app.showToast(err.message || 'Lỗi kiểm tra Fanpage', 'error');

        // #region agent log

        window.__votriDbg?.('votri-fanpages.js:runPageCheck', 'error', { id, msg: String(err.message) }, 'G');

        // #endregion

    } finally {

        icon.classList.remove('spinning');

    }

}



async function runAllPageChecks(buttonEl) {

    const app = window.VotriApp;

    const fbToken = localStorage.getItem('votri_sys_api_token');

    if (!fbToken) {

        app.showToast('Thiếu Facebook Access Token. Vào Cài đặt → lưu token Graph API.', 'error');

        return;

    }

    if (!pages || pages.length === 0) {

        app.showToast('Không có Fanpage nào để kiểm tra.', 'info');

        return;

    }



    let originalHtml = '';

    if (buttonEl) {

        originalHtml = buttonEl.innerHTML;

        buttonEl.disabled = true;

        buttonEl.innerHTML = `<i data-lucide="loader-2" class="spinning"></i> <span>Đang kiểm tra...</span>`;

        if (window.lucide) window.lucide.createIcons();

    }



    app.showToast(`Bắt đầu kiểm tra sức khỏe hàng loạt cho ${pages.length} trang...`, 'info');



    let successCount = 0;

    let failCount = 0;



    for (let i = 0; i < pages.length; i++) {

        const page = pages[i];

        if (buttonEl) {

            buttonEl.innerHTML = `<i data-lucide="loader-2" class="spinning"></i> <span>Kiểm tra (${i + 1}/${pages.length})...</span>`;

            if (window.lucide) window.lucide.createIcons();

        }



        const spinners = document.querySelectorAll(`.btn-check[data-id="${page.id}"] i, [data-id="${page.id}"] .btn-check i`);

        spinners.forEach(s => s.classList.add('spinning'));



        try {

            const targetPageId = page.url ? app.resolveFacebookPageKey(page) : page.fbPageId || null;

            const res = await fetch(`${app.API_BASE}/api/check-page`, {

                method: 'POST',

                headers: app.authHeaders(),

                body: JSON.stringify({

                    accessToken: fbToken,

                    pageId: targetPageId || undefined,

                    url: page.url || undefined,

                    pageName: page.name || undefined,

                    pageRecordId: page.id

                })

            });

            const data = await app.parseJsonResponse(res);

            if (!res.ok || !data.success) {

                throw new Error((data.message || 'Không kiểm tra được').split('·')[0].trim());

            }

            const checkPayload = {

                name: data.page?.name || page.name,

                status: data.page?.status || page.status,

                followers: data.page?.followers ?? page.followers,

                fbPageId: data.page?.fbPageId || page.fbPageId || null

            };

            await window.PagesApi.syncCheckResult(page.id, checkPayload);

            successCount++;

        } catch (err) {

            console.error(`[BULK CHECK ERROR] ${page.name}:`, err);

            failCount++;

        } finally {

            spinners.forEach(s => s.classList.remove('spinning'));

        }

    }



    await loadPagesFromServer();

    if (typeof renderAllViews === 'function') renderAllViews();



    if (buttonEl) {

        buttonEl.disabled = false;

        buttonEl.innerHTML = originalHtml;

        if (window.lucide) window.lucide.createIcons();

    }



    app.showToast(`Hoàn tất kiểm tra: ${successCount} thành công, ${failCount} thất bại.`, 'success');

}



window.VotriFanpages = {

    initDatabase,

    loadPagesFromServer,

    saveDatabase,

    updateFanpageHeader,

    openPageModal,

    closePageModal,

    handleFormSubmit,

    deletePage,

    runPageCheck,

    runAllPageChecks

};


