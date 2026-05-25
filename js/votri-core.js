/** Core: API, auth helpers, toast */
(function () {
    const API_SERVER_PORT = '3000';
    const API_BASE = (() => {
        const { protocol, hostname, port } = window.location;
        if (protocol === 'file:') return `http://localhost:${API_SERVER_PORT}`;
        if (port === API_SERVER_PORT) return window.location.origin;
        const host = hostname === '0.0.0.0' ? 'localhost' : hostname;
        return `${protocol}//${host}:${API_SERVER_PORT}`;
    })();

    function getSessionToken() {
        return sessionStorage.getItem('votri_sys_token');
    }

    function authHeaders(extra = {}) {
        const headers = { 'Content-Type': 'application/json', ...extra };
        const t = getSessionToken();
        if (t) headers.Authorization = `Bearer ${t}`;
        return headers;
    }

    function normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
    }

    async function parseJsonResponse(response) {
        const text = await response.text();
        if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
            throw new Error('Server trả HTML — mở http://localhost:3000 và chạy node server.js');
        }
        try {
            return JSON.parse(text);
        } catch {
            throw new Error('Phản hồi không phải JSON.');
        }
    }

    function escapeHTML(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const short = String(message).split('·')[0].trim();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'info'}"></i><span>${escapeHTML(short)}</span>`;
        container.appendChild(toast);
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
            toast.style.animation = 'toastIn 0.3s reverse forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    function resolveFacebookPageKey(page) {
        if (page.fbPageId && /^\d+$/.test(String(page.fbPageId))) return String(page.fbPageId);
        if (!page.url) return null;
        try {
            const url = new URL(page.url.trim().startsWith('http') ? page.url.trim() : `https://${page.url.trim()}`);
            const q = url.searchParams.get('id');
            if (q && /^\d+$/.test(q)) return q;
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] === 'pages' && parts.length >= 2) {
                const last = parts[parts.length - 1];
                return /^\d+$/.test(last) ? last : parts[1];
            }
            const last = parts[parts.length - 1];
            if (last && !['profile.php', 'people', 'watch'].includes(last)) return last;
        } catch (_) { /* */ }
        return null;
    }

    function getFacebookPagePictureUrl(page) {
        const key = resolveFacebookPageKey(page);
        if (!key) return null;
        return `https://graph.facebook.com/${encodeURIComponent(key)}/picture?type=small`;
    }

    const FB_LOGO_SVG =
        '<svg class="page-avatar-fb-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>' +
        '</svg>';

    function renderPageAvatarInner(page) {
        const pictureUrl = getFacebookPagePictureUrl(page);
        const fbLogo = `<span class="page-avatar-fb">${FB_LOGO_SVG}</span>`;
        if (!pictureUrl) return fbLogo;
        const safeUrl = escapeHTML(pictureUrl);
        return (
            `<img class="page-avatar-img" src="${safeUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" ` +
            `onerror="this.remove();this.parentElement.querySelector('.page-avatar-fb')?.classList.remove('is-hidden')">` +
            `<span class="page-avatar-fb is-hidden">${FB_LOGO_SVG}</span>`
        );
    }

    function normalizeRole(role) {
        if (window.VotriRoles) return window.VotriRoles.normalize(role);
        const r = String(role || 'member').toLowerCase();
        return r === 'admin' ? 'admin' : r;
    }

    function roleLabelVi(role) {
        if (window.VotriRoles) return window.VotriRoles.label(role);
        const r = normalizeRole(role);
        const map = {
            admin: 'Quản trị viên',
            member: 'Thành viên',
            collaborator: 'Cộng tác viên',
            distributor: 'Nhà phân phối',
        };
        return map[r] || map.member;
    }

    /** Cập nhật tên + vai trò sidebar (đồng bộ sau sync / đổi role) */
    function updateSidebarUserProfile(optionalUser) {
        const email = normalizeEmail(sessionStorage.getItem('votri_sys_user_email'));
        if (!email) return;

        let user = optionalUser;
        if (!user) {
            try {
                const list = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
                user = list.find((u) => normalizeEmail(u.email) === email);
            } catch (_) {
                return;
            }
        }
        if (!user) return;

        const normRole = normalizeRole(user.role);
        sessionStorage.setItem('votri_sys_user_role', normRole);

        const nameEl = document.querySelector('.user-profile .username');
        const roleEl = document.querySelector('.user-profile .user-role');
        if (nameEl) nameEl.textContent = user.name || 'Người dùng';
        if (roleEl) roleEl.textContent = roleLabelVi(normRole);

        const isAdmin =
            normRole === 'admin' || email === normalizeEmail('admin@votri.club');
        document.querySelectorAll('.admin-only').forEach((el) => {
            if (isAdmin) {
                el.classList.remove('hidden');
                if (el.tagName === 'A') el.style.display = 'flex';
                else el.style.display = 'block';
            } else {
                el.classList.add('hidden');
                el.style.display = 'none';
            }
        });
    }

    let publicIpInflight = null;

    /** IP công khai (giống ip8.com) — dùng khi dev localhost */
    async function fetchClientPublicIp() {
        const cached = sessionStorage.getItem('votri_client_public_ip');
        const cachedAt = parseInt(sessionStorage.getItem('votri_client_public_ip_at') || '0', 10);
        if (cached && Date.now() - cachedAt < 15 * 60 * 1000) return cached;

        if (!publicIpInflight) {
            publicIpInflight = (async () => {
                const tryJson = async (url) => {
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 8000);
                    try {
                        const res = await fetch(url, { signal: ctrl.signal });
                        if (!res.ok) return null;
                        const data = await res.json();
                        return data.ip || data.query || null;
                    } finally {
                        clearTimeout(timer);
                    }
                };
                const tryText = async (url) => {
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 8000);
                    try {
                        const res = await fetch(url, { signal: ctrl.signal });
                        if (!res.ok) return null;
                        const text = (await res.text()).trim();
                        return /^[\d.]+$/.test(text) ? text : null;
                    } finally {
                        clearTimeout(timer);
                    }
                };
                const urls = [
                    'https://api.ipify.org?format=json',
                    'https://api64.ipify.org?format=json',
                ];
                for (const url of urls) {
                    try {
                        const ip = await tryJson(url);
                        if (ip && /^[\d.]+$/.test(ip)) return ip;
                    } catch (_) { /* next */ }
                }
                try {
                    return await tryText('https://ifconfig.me/ip');
                } catch (_) {
                    return null;
                }
            })();
        }

        try {
            const ip = await publicIpInflight;
            if (ip) {
                sessionStorage.setItem('votri_client_public_ip', ip);
                sessionStorage.setItem('votri_client_public_ip_at', String(Date.now()));
            }
            return ip;
        } finally {
            publicIpInflight = null;
        }
    }

    async function withPublicIp(payload = {}) {
        const publicIp = await fetchClientPublicIp();
        return publicIp ? { ...payload, publicIp } : payload;
    }

    window.VotriApp = {
        get API_BASE() { return API_BASE; },
        authHeaders,
        parseJsonResponse,
        escapeHTML,
        showToast,
        resolveFacebookPageKey,
        getFacebookPagePictureUrl,
        renderPageAvatarInner,
        getSessionToken,
        normalizeEmail,
        fetchClientPublicIp,
        withPublicIp,
        updateSidebarUserProfile,
        roleLabelVi,
        normalizeRole,
        isCurrentUserAdmin() {
            const role = normalizeRole(sessionStorage.getItem('votri_sys_user_role'));
            if (role === 'admin') return true;
            const email = normalizeEmail(sessionStorage.getItem('votri_sys_user_email'));
            if (email === normalizeEmail('admin@votri.club')) return true;
            const list = window.users || [];
            const u = list.find((x) => normalizeEmail(x.email) === email);
            return !!(u && normalizeRole(u.role) === 'admin');
        },
    };
})();
