/**
 * POST /api/check-page — kiểm tra Fanpage qua Graph API
 */

const express = require('express');
const { derivePageStatus } = require('../lib/facebook-page-status');

async function assertPageRecordAccess(dbQuery, parsePageId, pageRecordId, user) {
    if (!pageRecordId || !dbQuery || !parsePageId) return;
    const pid = parsePageId(pageRecordId);
    if (!pid) {
        const err = new Error('ID Fanpage không hợp lệ.');
        err.status = 400;
        throw err;
    }
    const rows = await dbQuery('SELECT user_id FROM fanpages WHERE id = ?', [pid]);
    if (!rows.length) {
        const err = new Error('Fanpage không tồn tại trong hệ thống.');
        err.status = 404;
        throw err;
    }
    if (user.role !== 'admin' && rows[0].user_id !== user.id) {
        const err = new Error('Không có quyền kiểm tra Fanpage này.');
        err.status = 403;
        throw err;
    }
}

function createFacebookCheckRouter(deps) {
    const {
        runFacebookPageChecks,
        resolveTargetPageId,
        extractPageIdentifier,
        fbGraphGet,
        resolveFollowerCount,
        buildReadSummary,
        buildCheckSummary,
        humanizeFbError,
        debugLog,
        requireAuth,
        checkPageLimiter,
        dbQuery,
        parsePageId,
    } = deps;

    const router = express.Router();
    const checkLimit = checkPageLimiter || ((req, res, next) => next());

    router.post('/check-page', requireAuth, checkLimit, async (req, res) => {
        try {
            const { accessToken, pageId, url, identifier, pageName, pageRecordId } = req.body;

            if (!pageRecordId) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu pageRecordId. Chỉ kiểm tra Fanpage đã lưu trong hệ thống.',
                });
            }
            await assertPageRecordAccess(dbQuery, parsePageId, pageRecordId, req.user);
            const token = accessToken || process.env.FACEBOOK_ACCESS_TOKEN;
            const meProbe = await fbGraphGet('me', token, { fields: 'id' }).catch(() => null);
            const userId = meProbe?.id;
            const fromUrl = extractPageIdentifier(null, url);
            const targetPageId = resolveTargetPageId(pageId, identifier, url, userId);

            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu Access Token. Cấu hình trong Cài đặt (Graph API Explorer).',
                });
            }

            if (!targetPageId && !pageName) {
                return res.status(400).json({
                    success: false,
                    message: 'Thêm URL Fanpage (profile.php?id=...) hoặc tên page khớp BM.',
                });
            }

            if (debugLog) {
                debugLog('routes/facebook-check.js', 'request', {
                    targetPageId,
                    fromUrl,
                    pageName: pageName || null,
                    pageRecordId: pageRecordId || null,
                    userId: req.user?.id,
                }, 'C');
            }

            const report = await runFacebookPageChecks(token, targetPageId, url, pageName);
            const statusInfo = derivePageStatus(report);

            if (debugLog) {
                debugLog('routes/facebook-check.js', 'result', {
                    status: statusInfo.status,
                    pageId: report.pageContext?.pageId || report.alive?.id || null,
                    isPublished: statusInfo.isPublished,
                }, 'A');
            }

            const readSummary = buildReadSummary(report);
            const followers = report.alive ? resolveFollowerCount(report.alive, report.engagement) : null;

            const pagePayload = {
                fbPageId: report.pageContext?.pageId || report.alive?.id || null,
                name: report.pageContext?.pageName || report.alive?.name || pageName || null,
                followers,
                status: statusInfo.status,
                isPublished: statusInfo.isPublished,
                verificationStatus: report.alive?.verification_status ?? null,
                lastCheck: new Date().toISOString(),
            };

            if (!report.alive) {
                return res.json({
                    success: true,
                    message: statusInfo.reason,
                    readSummary: readSummary || statusInfo.reason,
                    readFields: report.readFields || [],
                    skippedFields: report.skippedFields || [],
                    page: pagePayload,
                    report,
                    statusInfo,
                    managedPages: report.pageContext?.managedPages || [],
                });
            }

            return res.json({
                success: true,
                message: buildCheckSummary(report, statusInfo),
                readSummary,
                readFields: report.readFields,
                skippedFields: report.skippedFields,
                page: pagePayload,
                report,
                statusInfo,
            });
        } catch (err) {
            console.error('[FB Check]', err);
            const status = err.status || 500;
            return res.status(status).json({
                success: false,
                message: status < 500
                    ? err.message
                    : (humanizeFbError(err.message) || 'Lỗi kiểm tra Facebook Graph API'),
            });
        }
    });

    return router;
}

module.exports = { createFacebookCheckRouter };
