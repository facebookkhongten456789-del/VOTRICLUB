/**
 * Vai trò (client) — đồng bộ nhãn với lib/user-roles.js
 */
(function () {
    const LABELS = {
        member: 'Thành viên',
        collaborator: 'Cộng tác viên',
        distributor: 'Nhà phân phối',
        admin: 'Quản trị viên',
    };

    const ORDER = ['member', 'collaborator', 'distributor', 'admin'];

    function normalize(role) {
        const r = String(role || 'member').trim().toLowerCase();
        if (ORDER.includes(r)) return r;
        const map = {
            'thành viên': 'member',
            'cộng tác viên': 'collaborator',
            'nhà phân phối': 'distributor',
            'quản trị viên': 'admin',
            admin: 'admin',
        };
        return map[r] || 'member';
    }

    function label(role) {
        return LABELS[normalize(role)] || LABELS.member;
    }

    function isAdmin(role) {
        return normalize(role) === 'admin';
    }

    function pillClass(role) {
        const r = normalize(role);
        return `accounts-role-${r}`;
    }

    function optionsHtml(selected, { includeAdmin = true, excludeValues = [] } = {}) {
        const sel = normalize(selected);
        const skip = new Set(excludeValues.map(normalize));
        return ORDER.filter((r) => (includeAdmin || r !== 'admin') && !skip.has(r))
            .map(
                (r) =>
                    `<option value="${r}"${r === sel ? ' selected' : ''}>${label(r)}</option>`,
            )
            .join('');
    }

    window.VotriRoles = {
        ORDER,
        LABELS,
        normalize,
        label,
        isAdmin,
        pillClass,
        optionsHtml,
    };
})();
