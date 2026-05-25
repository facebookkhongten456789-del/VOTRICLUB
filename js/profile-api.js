/**
 * API Hồ sơ — đồng bộ MySQL
 */
(function () {
    const app = () => window.VotriApp || {};

    async function request(path, options = {}) {
        const base = app().API_BASE;
        const token = app().getSessionToken?.();
        if (!base || !token) throw new Error('Chưa đăng nhập');

        const res = await fetch(`${base}/api/profile${path}`, {
            ...options,
            headers: app().authHeaders(options.headers || {}),
        });
        const data = app().parseJsonResponse
            ? await app().parseJsonResponse(res)
            : await res.json();
        if (!res.ok || data.success === false) {
            throw new Error(data.message || `HTTP ${res.status}`);
        }
        return data;
    }

    function mergeUserToCache(user) {
        if (!user?.email) return;
        const email = user.email;
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
        } catch {
            list = [];
        }
        const idx = list.findIndex((u) => (u.email || '').toLowerCase() === email.toLowerCase());
        const merged = {
            ...(idx >= 0 ? list[idx] : {}),
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status,
            balance: user.balance,
            totalDeposited: user.totalDeposited,
            joinDate: user.joinDate || user.registeredAt,
            registeredAt: user.registeredAt,
            avatar: user.avatar,
            twoFactorEnabled: user.twoFactorEnabled,
            notifyNewLogin: user.notifyNewLogin,
            lastNameChange: user.lastNameChange,
            logs: user.logs || [],
        };
        if (idx >= 0) list[idx] = merged;
        else list.push(merged);
        localStorage.setItem('votri_sys_users', JSON.stringify(list));
        if (typeof window.users !== 'undefined') {
            const gi = window.users.findIndex((u) => u.email === email);
            if (gi >= 0) window.users[gi] = merged;
            else window.users.push(merged);
        }
        return merged;
    }

    window.ProfileApi = {
        get: () => request('/'),
        updateName: (name) => request('/', { method: 'PATCH', body: JSON.stringify({ name }) }),
        updateSettings: (notifyNewLogin) =>
            request('/settings', { method: 'PATCH', body: JSON.stringify({ notifyNewLogin }) }),
        updateAvatar: (avatar) =>
            request('/avatar', { method: 'POST', body: JSON.stringify({ avatar }) }),
        changePassword: (oldPassword, newPassword) =>
            request('/password', {
                method: 'POST',
                body: JSON.stringify({ oldPassword, newPassword }),
            }),
        setup2fa: () => request('/2fa/setup', { method: 'POST', body: '{}' }),
        enable2fa: (setupToken, code) =>
            request('/2fa/enable', { method: 'POST', body: JSON.stringify({ setupToken, code }) }),
        disable2fa: (code, password) =>
            request('/2fa/disable', { method: 'POST', body: JSON.stringify({ code, password }) }),
        mergeUserToCache,
    };
})();
