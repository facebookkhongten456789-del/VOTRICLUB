/**
 * Fanpage — gọi API MySQL
 */
(function () {
    async function loadPages() {
        const app = window.VotriApp;
        if (!app?.API_BASE || !sessionStorage.getItem('votri_sys_token')) return [];

        const res = await fetch(`${app.API_BASE}/api/pages/list`, {
            method: 'GET',
            headers: app.authHeaders()
        });
        const data = await app.parseJsonResponse(res);
        if (!res.ok || !data.success) throw new Error(data.message || 'Không tải được Fanpage');
        const list = data.pages || [];
        localStorage.setItem('votri_sys_pages', JSON.stringify(list));
        return list;
    }

    async function savePage(payload, existingId) {
        const app = window.VotriApp;
        const url = existingId
            ? `${app.API_BASE}/api/pages/${encodeURIComponent(existingId)}`
            : `${app.API_BASE}/api/pages`;
        const res = await fetch(url, {
            method: existingId ? 'PUT' : 'POST',
            headers: app.authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await app.parseJsonResponse(res);
        if (!res.ok || !data.success) throw new Error(data.message || 'Lưu Fanpage thất bại');
        return data.page;
    }

    async function removePage(id) {
        const app = window.VotriApp;
        const res = await fetch(`${app.API_BASE}/api/pages/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: app.authHeaders()
        });
        const data = await app.parseJsonResponse(res);
        if (!res.ok || !data.success) throw new Error(data.message || 'Xóa Fanpage thất bại');
    }

    /** Lưu kết quả kiểm tra FB vào MySQL (chỉ field từ Graph API) */
    async function syncCheckResult(id, payload) {
        const app = window.VotriApp;
        const res = await fetch(`${app.API_BASE}/api/pages/${encodeURIComponent(id)}/check-sync`, {
            method: 'PATCH',
            headers: app.authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await app.parseJsonResponse(res);
        if (!res.ok || !data.success) throw new Error(data.message || 'Không lưu được kết quả kiểm tra');
        return data.page;
    }

    window.PagesApi = { loadPages, savePage, removePage, syncCheckResult };
})();
