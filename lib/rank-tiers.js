/**
 * Ngưỡng nâng hạng theo tổng tiền đã nạp (VND) — đồng bộ với js/rank-progress.js
 */
const { normalizeUserRole, roleLabelVi } = require('./user-roles');

const RANK_STEPS = [
    { role: 'member', label: 'Thành viên', minDeposit: 0 },
    { role: 'collaborator', label: 'Cộng tác viên', minDeposit: 1_000_000 },
    { role: 'distributor', label: 'Nhà phân phối', minDeposit: 5_000_000 },
];

function computeRoleFromDeposit(totalDeposited) {
    const amount = Number(totalDeposited) || 0;
    let role = 'member';
    for (const step of RANK_STEPS) {
        if (amount >= step.minDeposit) role = step.role;
    }
    return role;
}

function getRankProgress(totalDeposited, currentRole) {
    const deposited = Number(totalDeposited) || 0;
    const role = normalizeUserRole(currentRole);

    if (role === 'admin') {
        return {
            currentRole: role,
            currentLabel: roleLabelVi('admin'),
            maxRank: true,
            message: 'Quản trị viên — không áp dụng tiến trình hạng.',
        };
    }

    const currentIdx = RANK_STEPS.findIndex((s) => s.role === role);
    const idx = currentIdx >= 0 ? currentIdx : 0;
    const current = RANK_STEPS[idx];

    if (role === 'distributor' || idx >= RANK_STEPS.length - 1) {
        return {
            currentRole: role,
            currentLabel: roleLabelVi(role),
            maxRank: true,
            deposited,
            message: 'Bạn đã đạt hạng cao nhất (Nhà phân phối).',
            percent: 100,
        };
    }

    const next = RANK_STEPS[idx + 1];
    const span = next.minDeposit - current.minDeposit;
    const progress = Math.min(span, Math.max(0, deposited - current.minDeposit));
    const percent = span > 0 ? Math.min(100, Math.round((progress / span) * 100)) : 0;
    const remaining = Math.max(0, next.minDeposit - deposited);

    return {
        currentRole: role,
        currentLabel: current.label,
        nextRole: next.role,
        nextLabel: next.label,
        maxRank: false,
        deposited,
        nextThreshold: next.minDeposit,
        remaining,
        percent,
        message: remaining > 0
            ? `Cần nạp thêm ${remaining.toLocaleString('vi-VN')}đ để lên ${next.label}.`
            : `Đủ điều kiện nâng lên ${next.label}.`,
    };
}

async function applyAutoRankFromDeposit(dbQuery, userId, logFn = null) {
    const rows = await dbQuery('SELECT id, email, role, total_deposited FROM users WHERE id = ?', [userId]);
    if (!rows.length) return null;
    const u = rows[0];
    const current = normalizeUserRole(u.role);
    if (current === 'admin') return null;

    const earned = computeRoleFromDeposit(u.total_deposited);
    const order = ['member', 'collaborator', 'distributor'];
    
    // Safety check: only allow auto-ranking to whitelisted roles (preventing role injection/privilege escalation)
    if (!order.includes(earned)) {
        return null;
    }

    if (order.indexOf(earned) <= order.indexOf(current)) return null;

    await dbQuery('UPDATE users SET role = ? WHERE id = ?', [earned, userId]);
    if (typeof logFn === 'function') {
        await logFn(dbQuery, userId, `Tự động nâng hạng → ${roleLabelVi(earned)}`, 'Thành công');
    }
    return earned;
}

module.exports = {
    RANK_STEPS,
    computeRoleFromDeposit,
    getRankProgress,
    applyAutoRankFromDeposit,
};
