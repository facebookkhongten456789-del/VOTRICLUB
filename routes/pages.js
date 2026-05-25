/**
 * API Fanpage — MySQL
 * GET    /api/pages/list
 * POST   /api/pages
 * PUT    /api/pages/:id
 * DELETE /api/pages/:id
 */

const express = require('express');
const { isAdminRole } = require('../lib/user-roles');

async function ensureFanpagesTable(dbQuery) {
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS fanpages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            niche VARCHAR(100) DEFAULT NULL,
            tier VARCHAR(50) NOT NULL DEFAULT 'Tier 3',
            status VARCHAR(50) NOT NULL DEFAULT 'Active',
            followers INT NOT NULL DEFAULT 0,
            url TEXT DEFAULT NULL,
            fb_page_id VARCHAR(80) DEFAULT NULL,
            last_check DATETIME DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

function parsePageId(param) {
    const s = String(param || '');
    if (s.startsWith('fb-')) return parseInt(s.slice(3), 10);
    return parseInt(s, 10);
}

function mapRow(r) {
    return {
        id: 'fb-' + r.id,
        name: r.name,
        niche: r.niche || '',
        tier: r.tier || 'Tier 3',
        status: r.status || 'Active',
        followers: parseInt(r.followers, 10) || 0,
        url: r.url || '',
        fbPageId: r.fb_page_id || null,
        lastCheck: r.last_check ? new Date(r.last_check).toISOString() : null,
        userEmail: r.user_email || null
    };
}

async function fetchPagesForUser(dbQuery, userId, isAdmin) {
    if (isAdmin) {
        const rows = await dbQuery(
            `SELECT f.*, u.email AS user_email FROM fanpages f
             JOIN users u ON f.user_id = u.id ORDER BY f.updated_at DESC`
        );
        return rows.map(mapRow);
    }
    const rows = await dbQuery(
        'SELECT * FROM fanpages WHERE user_id = ? ORDER BY updated_at DESC',
        [userId]
    );
    return rows.map(mapRow);
}

function createPagesRouter({ dbQuery, requireAuth, pagesListLimiter, pagesWriteLimiter }) {
    const router = express.Router();
    let tableReady = false;

    async function ready() {
        if (!tableReady) {
            await ensureFanpagesTable(dbQuery);
            tableReady = true;
        }
    }

    router.get('/list', requireAuth, pagesListLimiter, async (req, res) => {
        try {
            await ready();
            const isAdmin = isAdminRole(req.user.role);
            const pages = await fetchPagesForUser(dbQuery, req.user.id, isAdmin);
            return res.json({ success: true, pages });
        } catch (err) {
            console.error('[PAGES LIST]', err);
            return res.status(500).json({ success: false, message: 'Lỗi tải danh sách Fanpage.' });
        }
    });

    router.post('/', requireAuth, pagesWriteLimiter, async (req, res) => {
        try {
            await ready();
            const { name, niche, tier, status, followers, url, fbPageId } = req.body;
            if (!name) return res.status(400).json({ success: false, message: 'Thiếu tên Fanpage.' });

            const result = await dbQuery(
                `INSERT INTO fanpages (user_id,name,niche,tier,status,followers,url,fb_page_id,last_check)
                 VALUES (?,?,?,?,?,?,?,?,NOW())`,
                [
                    req.user.id,
                    name,
                    niche || '',
                    tier || 'Tier 3',
                    status || 'Active',
                    parseInt(followers, 10) || 0,
                    url || null,
                    fbPageId || null
                ]
            );
            const rows = await dbQuery('SELECT * FROM fanpages WHERE id = ?', [result.insertId]);
            return res.json({ success: true, page: mapRow(rows[0]) });
        } catch (err) {
            console.error('[PAGES CREATE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lưu Fanpage.' });
        }
    });

    /** Chỉ cập nhật kết quả kiểm tra Graph API — không cho sửa niche/tier qua endpoint này */
    router.patch('/:id/check-sync', requireAuth, pagesWriteLimiter, async (req, res) => {
        try {
            await ready();
            const pid = parsePageId(req.params.id);
            if (!pid) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

            const existing = await dbQuery('SELECT * FROM fanpages WHERE id = ?', [pid]);
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy Fanpage.' });
            }
            if (req.user.role !== 'admin' && existing[0].user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Không có quyền cập nhật Fanpage này.' });
            }

            const { name, status, followers, fbPageId } = req.body;
            const allowed = new Set(['Active', 'Inactive', 'DIE', 'Restricted', 'Die']);
            if (!status || !allowed.has(status)) {
                return res.status(400).json({ success: false, message: 'Trạng thái kiểm tra không hợp lệ.' });
            }
            const normalizedStatus = status === 'Die' ? 'DIE' : status;
            const followerCount = Math.max(0, parseInt(followers, 10) || 0);

            await dbQuery(
                `UPDATE fanpages SET
                    name = COALESCE(?, name),
                    status = ?,
                    followers = ?,
                    fb_page_id = COALESCE(?, fb_page_id),
                    last_check = NOW()
                 WHERE id = ?`,
                [
                    name ? String(name).trim() : null,
                    normalizedStatus,
                    followerCount,
                    fbPageId != null && fbPageId !== '' ? String(fbPageId) : null,
                    pid
                ]
            );
            const rows = await dbQuery(
                `SELECT f.*, u.email AS user_email FROM fanpages f
                 LEFT JOIN users u ON f.user_id = u.id WHERE f.id = ?`,
                [pid]
            );
            return res.json({ success: true, page: mapRow(rows[0]) });
        } catch (err) {
            console.error('[PAGES CHECK-SYNC]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lưu kết quả kiểm tra Fanpage.' });
        }
    });

    router.put('/:id', requireAuth, pagesWriteLimiter, async (req, res) => {
        try {
            await ready();
            const pid = parsePageId(req.params.id);
            if (!pid) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });

            const existing = await dbQuery('SELECT * FROM fanpages WHERE id = ?', [pid]);
            if (!existing.length) return res.status(404).json({ success: false, message: 'Không tìm thấy Fanpage.' });
            if (req.user.role !== 'admin' && existing[0].user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Không có quyền sửa.' });
            }

            const { name, niche, tier, status, followers, url, fbPageId } = req.body;
            await dbQuery(
                `UPDATE fanpages SET name=?, niche=?, tier=?, status=?, followers=?, url=?, fb_page_id=?, last_check=NOW()
                 WHERE id=?`,
                [
                    name ?? existing[0].name,
                    niche ?? existing[0].niche,
                    tier ?? existing[0].tier,
                    status ?? existing[0].status,
                    followers != null ? parseInt(followers, 10) : existing[0].followers,
                    url ?? existing[0].url,
                    fbPageId !== undefined ? fbPageId : existing[0].fb_page_id,
                    pid
                ]
            );
            const rows = await dbQuery('SELECT * FROM fanpages WHERE id = ?', [pid]);
            return res.json({ success: true, page: mapRow(rows[0]) });
        } catch (err) {
            console.error('[PAGES UPDATE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi cập nhật Fanpage.' });
        }
    });

    router.delete('/:id', requireAuth, pagesWriteLimiter, async (req, res) => {
        try {
            await ready();
            const pid = parsePageId(req.params.id);
            const existing = await dbQuery('SELECT user_id FROM fanpages WHERE id = ?', [pid]);
            if (!existing.length) return res.status(404).json({ success: false, message: 'Không tìm thấy Fanpage.' });
            if (req.user.role !== 'admin' && existing[0].user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Không có quyền xóa.' });
            }
            await dbQuery('DELETE FROM fanpages WHERE id = ?', [pid]);
            return res.json({ success: true, message: 'Đã xóa Fanpage.' });
        } catch (err) {
            console.error('[PAGES DELETE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi xóa Fanpage.' });
        }
    });

    return router;
}

module.exports = { createPagesRouter, fetchPagesForUser, ensureFanpagesTable, parsePageId };
