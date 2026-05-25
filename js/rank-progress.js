/**
 * Tiến trình nâng hạng (Thành viên → Cộng tác viên → Nhà phân phối)
 * Ngưỡng VND — giữ khớp lib/rank-tiers.js
 */
(function () {
    const RANK_STEPS = [
        { role: 'member', label: 'Thành viên', minDeposit: 0 },
        { role: 'collaborator', label: 'Cộng tác viên', minDeposit: 1_000_000 },
        { role: 'distributor', label: 'Nhà phân phối', minDeposit: 5_000_000 },
    ];

    function normalizeRole(role) {
        return window.VotriRoles ? window.VotriRoles.normalize(role) : String(role || 'member').toLowerCase();
    }

    function roleLabel(role) {
        return window.VotriRoles ? window.VotriRoles.label(role) : role;
    }

    function formatMoney(n) {
        return Number(n || 0).toLocaleString('vi-VN') + 'đ';
    }

    function compute(user) {
        const deposited = Number(user?.totalDeposited || 0);
        const role = normalizeRole(user?.role || 'member');

        if (role === 'admin') {
            return {
                currentLabel: roleLabel('admin'),
                maxRank: true,
                message: 'Quản trị viên — không áp dụng tiến trình hạng.',
                percent: 100,
            };
        }

        let idx = RANK_STEPS.findIndex((s) => s.role === role);
        if (idx < 0) idx = 0;

        if (role === 'distributor' || idx >= RANK_STEPS.length - 1) {
            return {
                currentLabel: roleLabel('distributor'),
                maxRank: true,
                deposited,
                message: 'Bạn đã đạt hạng cao nhất (Nhà phân phối).',
                percent: 100,
            };
        }

        const current = RANK_STEPS[idx];
        const next = RANK_STEPS[idx + 1];
        const span = next.minDeposit - current.minDeposit;
        const progress = Math.min(span, Math.max(0, deposited - current.minDeposit));
        const percent = span > 0 ? Math.min(100, Math.round((progress / span) * 100)) : 0;
        const remaining = Math.max(0, next.minDeposit - deposited);

        return {
            currentLabel: current.label,
            nextLabel: next.label,
            maxRank: false,
            deposited,
            remaining,
            percent,
            message:
                remaining > 0
                    ? `Cần nạp thêm ${formatMoney(remaining)} để lên ${next.label}.`
                    : `Đủ điều kiện nâng lên ${next.label}.`,
        };
    }

    function render(containerId) {
        const root = document.getElementById(containerId);
        if (!root) return;

        const email = sessionStorage.getItem('votri_sys_user_email');
        if (!email) {
            root.hidden = true;
            return;
        }

        let user = null;
        try {
            const list = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
            user = list.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
        } catch (_) {
            root.hidden = true;
            return;
        }

        if (!user) {
            root.hidden = true;
            return;
        }

        const p = compute(user);
        root.hidden = false;

        const curEl = root.querySelector('[data-rank-current]');
        const nextEl = root.querySelector('[data-rank-next]');
        const barEl = root.querySelector('[data-rank-bar]');
        const pctEl = root.querySelector('[data-rank-percent]');
        const msgEl = root.querySelector('[data-rank-message]');
        const depEl = root.querySelector('[data-rank-deposited]');

        if (curEl) curEl.textContent = p.currentLabel || '—';
        if (depEl) depEl.textContent = formatMoney(p.deposited);

        if (p.maxRank) {
            if (nextEl) nextEl.textContent = '—';
            if (barEl) barEl.style.width = '100%';
            if (pctEl) pctEl.textContent = '100%';
            if (msgEl) msgEl.textContent = p.message || '';
        } else {
            if (nextEl) nextEl.textContent = p.nextLabel || '—';
            if (barEl) barEl.style.width = `${p.percent || 0}%`;
            if (pctEl) pctEl.textContent = `${p.percent || 0}%`;
            if (msgEl) msgEl.textContent = p.message || '';
        }
    }

    function renderAll() {
        render('rank-progress-profile');
    }

    window.VotriRankProgress = { compute, render, renderAll, RANK_STEPS };
})();
