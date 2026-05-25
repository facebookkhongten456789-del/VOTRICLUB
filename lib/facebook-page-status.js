/**
 * Trạng thái Fanpage từ Facebook Graph API
 *
 * LIVE (Hoạt động):     is_published === true  + có id
 * Ngủ đông:             is_published === false
 * DIE:                  lỗi #100 hoặc không đọc được id/page
 */

const PAGE_STATUS = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    DIE: 'Die',
};

/** Lỗi #100 chỉ khi không đọc được page gốc (context/resolve), không tính insights/posts */
function isFatalPageError(report) {
    const fatalSteps = new Set(['context', 'resolve']);
    return (report?.errors || []).some((e) => {
        const code = Number(e.code ?? e.fbError?.code);
        return fatalSteps.has(e.step) && code === 100;
    });
}

/**
 * @param {object} report - kết quả runFacebookPageChecks
 * @returns {{ status: string, reason: string, isPublished: boolean|null }}
 */
function derivePageStatus(report) {
    const alive = report?.alive;
    const hasId = alive?.id != null && String(alive.id).trim() !== '';

    // #region agent log
    try {
        const fs = require('fs');
        const path = require('path');
        fs.appendFileSync(
            path.join(__dirname, '..', 'debug-d15afd.log'),
            `${JSON.stringify({
                sessionId: 'd15afd',
                location: 'lib/facebook-page-status.js:derivePageStatus',
                message: 'status input',
                data: {
                    hasId,
                    aliveId: alive?.id || null,
                    isPublished: alive?.is_published,
                    followers: alive?.followers_count ?? alive?.fan_count ?? null,
                    fatal100: isFatalPageError(report),
                    errorSteps: (report?.errors || []).map((e) => e.step),
                },
                hypothesisId: 'A',
                timestamp: Date.now(),
            })}\n`,
        );
    } catch (_) { /* ignore */ }
    // #endregion

    // Đã có id + tên/followers → page tồn tại; lỗi #100 từ insights/posts bỏ qua
    if (hasId) {
        if (alive.is_published === false) {
            return {
                status: PAGE_STATUS.INACTIVE,
                reason: 'Không hoạt động — is_published=false (admin ẩn page)',
                isPublished: false,
            };
        }
        if (alive.is_published === true) {
            return {
                status: PAGE_STATUS.ACTIVE,
                reason: 'Hoạt động — is_published=true (công khai, chạy ads)',
                isPublished: true,
            };
        }
        return {
            status: PAGE_STATUS.ACTIVE,
            reason: 'Hoạt động — đọc được id, tên, followers',
            isPublished: alive.is_published ?? null,
        };
    }

    if (!alive || isFatalPageError(report)) {
        return {
            status: PAGE_STATUS.DIE,
            reason: isFatalPageError(report)
                ? 'DIE — FB lỗi #100 khi truy cập page'
                : 'DIE — không đọc được page (thiếu id)',
            isPublished: null,
        };
    }

    return {
        status: PAGE_STATUS.DIE,
        reason: 'DIE — không xác định được page',
        isPublished: null,
    };
}

module.exports = {
    PAGE_STATUS,
    derivePageStatus,
    isFatalPageError,
};
