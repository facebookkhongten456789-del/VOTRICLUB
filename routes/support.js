/**
 * API Support Tickets — quyền nghiêm ngặt
 * Pending → Admin duyệt → Open (user mới nhắn)
 * Chỉ Admin đóng/mở lại ticket
 */

const express = require('express');

const TICKET_STATUS = {
    PENDING: 'Pending',
    OPEN: 'Open',
    REPLIED: 'Replied',
    CLOSED: 'Closed',
};

async function ensureTicketStatusEnum(dbQuery) {
    try {
        await dbQuery(
            `ALTER TABLE support_tickets 
             MODIFY status ENUM('Pending','Open','Replied','Closed') NOT NULL DEFAULT 'Pending'`,
        );
    } catch (_) {
        /* đã có cột hoặc DB cũ — bỏ qua */
    }
}

function parseTicketId(raw) {
    return parseInt(String(raw || '').replace('TK-', ''), 10);
}

async function loadTicket(dbQuery, tid) {
    const rows = await dbQuery(
        'SELECT id, user_id, status, title FROM support_tickets WHERE id = ?',
        [tid],
    );
    return rows[0] || null;
}

function createSupportRouter({ dbQuery, requireAuth, requireAdmin, supportTicketLimiter, supportReplyLimiter }) {
    const router = express.Router();
    let enumReady = false;

    router.use(async (req, res, next) => {
        if (!enumReady) {
            await ensureTicketStatusEnum(dbQuery);
            enumReady = true;
        }
        next();
    });

    /** POST /api/support/create-ticket */
    router.post('/create-ticket', requireAuth, supportTicketLimiter, async (req, res) => {
        try {
            const { title, topic, orderId, message, content } = req.body;
            const finalMessage = (message || content || '').trim();
            const finalTitle = (title || '').trim();

            if (!finalTitle || !finalMessage) {
                return res.status(400).json({ success: false, message: 'Thiếu tiêu đề hoặc nội dung.' });
            }

            const userId = req.user.id;
            const result = await dbQuery(
                'INSERT INTO support_tickets (user_id,title,topic,order_id,status) VALUES (?,?,?,?,?)',
                [userId, finalTitle, topic || 'Khác', orderId || null, TICKET_STATUS.PENDING],
            );
            const ticketId = result.insertId;

            await dbQuery(
                'INSERT INTO ticket_messages (ticket_id,sender_id,content) VALUES (?,?,?)',
                [ticketId, userId, finalMessage],
            );

            return res.json({
                success: true,
                message: 'Đã gửi ticket. Chờ Admin duyệt trước khi nhắn tiếp.',
                ticketId: 'TK-' + ticketId,
                status: TICKET_STATUS.PENDING,
            });
        } catch (err) {
            console.error('[CREATE-TICKET ERROR]:', err);
            return res.status(500).json({ success: false, message: 'Lỗi server.' });
        }
    });

    /** POST /api/support/approve-ticket — Admin duyệt Pending → Open */
    router.post('/approve-ticket', requireAuth, requireAdmin, async (req, res) => {
        try {
            const tid = parseTicketId(req.body.ticketId);
            if (!tid) return res.status(400).json({ success: false, message: 'Ticket ID không hợp lệ.' });

            const ticket = await loadTicket(dbQuery, tid);
            if (!ticket) return res.status(404).json({ success: false, message: 'Ticket không tồn tại.' });

            if (ticket.status !== TICKET_STATUS.PENDING) {
                return res.status(400).json({
                    success: false,
                    message: `Ticket không ở trạng thái chờ duyệt (hiện: ${ticket.status}).`,
                });
            }

            await dbQuery(
                'UPDATE support_tickets SET status=?, updated_at=NOW() WHERE id=?',
                [TICKET_STATUS.OPEN, tid],
            );

            return res.json({
                success: true,
                status: TICKET_STATUS.OPEN,
                message: 'Đã duyệt ticket. User có thể nhắn tin.',
            });
        } catch (err) {
            console.error('[APPROVE-TICKET ERROR]:', err);
            return res.status(500).json({ success: false, message: 'Lỗi server.' });
        }
    });

    /** POST /api/support/reply-ticket */
    router.post('/reply-ticket', requireAuth, supportReplyLimiter, async (req, res) => {
        try {
            const { ticketId, message, content } = req.body;
            const finalMessage = (message || content || '').trim();
            const tid = parseTicketId(ticketId);

            if (!tid || !finalMessage) {
                return res.status(400).json({ success: false, message: 'Thiếu ticket hoặc nội dung.' });
            }

            const ticket = await loadTicket(dbQuery, tid);
            if (!ticket) return res.status(404).json({ success: false, message: 'Ticket không tồn tại.' });

            const isAdmin = req.user.role === 'admin';

            if (!isAdmin && ticket.user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Không có quyền trên ticket này.' });
            }

            if (ticket.status === TICKET_STATUS.CLOSED) {
                return res.status(403).json({ success: false, message: 'Ticket đã đóng.' });
            }

            if (!isAdmin) {
                if (ticket.status === TICKET_STATUS.PENDING) {
                    return res.status(403).json({
                        success: false,
                        message: 'Ticket chưa được Admin duyệt. Vui lòng chờ duyệt trước khi nhắn tin.',
                    });
                }
                if (ticket.status !== TICKET_STATUS.OPEN && ticket.status !== TICKET_STATUS.REPLIED) {
                    return res.status(403).json({ success: false, message: 'Không thể nhắn tin lúc này.' });
                }
            }

            let nextStatus = ticket.status;
            if (isAdmin) {
                if (ticket.status === TICKET_STATUS.PENDING) {
                    nextStatus = TICKET_STATUS.OPEN;
                }
                nextStatus = TICKET_STATUS.REPLIED;
            } else {
                nextStatus = TICKET_STATUS.OPEN;
            }

            await dbQuery(
                'INSERT INTO ticket_messages (ticket_id,sender_id,content) VALUES (?,?,?)',
                [tid, req.user.id, finalMessage],
            );
            await dbQuery(
                'UPDATE support_tickets SET status=?, updated_at=NOW() WHERE id=?',
                [nextStatus, tid],
            );

            return res.json({ success: true, message: 'Đã gửi phản hồi.', status: nextStatus });
        } catch (err) {
            console.error('[REPLY-TICKET ERROR]:', err);
            return res.status(500).json({ success: false, message: 'Lỗi server.' });
        }
    });

    /** POST /api/support/toggle-ticket — chỉ Admin */
    router.post('/toggle-ticket', requireAuth, requireAdmin, async (req, res) => {
        try {
            const tid = parseTicketId(req.body.ticketId);
            const { newStatus } = req.body;

            if (!tid) return res.status(400).json({ success: false, message: 'Ticket ID không hợp lệ.' });

            const ticket = await loadTicket(dbQuery, tid);
            if (!ticket) return res.status(404).json({ success: false, message: 'Ticket không tồn tại.' });

            let targetStatus = newStatus;
            if (!targetStatus) {
                targetStatus = ticket.status === TICKET_STATUS.CLOSED
                    ? TICKET_STATUS.OPEN
                    : TICKET_STATUS.CLOSED;
            }

            const allowed = [TICKET_STATUS.OPEN, TICKET_STATUS.CLOSED, TICKET_STATUS.REPLIED, TICKET_STATUS.PENDING];
            if (!allowed.includes(targetStatus)) {
                return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
            }

            await dbQuery(
                'UPDATE support_tickets SET status=?, updated_at=NOW() WHERE id=?',
                [targetStatus, tid],
            );

            return res.json({
                success: true,
                status: targetStatus,
                message: targetStatus === TICKET_STATUS.CLOSED
                    ? 'Đã đóng ticket.'
                    : 'Đã cập nhật trạng thái ticket.',
            });
        } catch (err) {
            console.error('[TOGGLE-TICKET ERROR]:', err);
            return res.status(500).json({ success: false, message: 'Lỗi server.' });
        }
    });

    return router;
}

module.exports = { createSupportRouter, TICKET_STATUS };
