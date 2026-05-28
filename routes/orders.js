/**
 * API đơn hàng SMM — tách riêng khỏi server.js
 * GET /api/orders/list
 */

const express = require('express');
const { isAdminRole } = require('../lib/user-roles');

function mapOrderRow(o) {
    return {
        id: 'ORD-' + o.id,
        userEmail: o.user_email || null,
        serviceId: o.service_id,
        serviceName: o.service_name,
        link: o.link,
        quantity: o.quantity,
        charge: parseFloat(o.charge),
        externalOrderId: o.external_order_id,
        status: o.status,
        startCount: o.start_count,
        remains: o.remains,
        createdAt: o.created_at
    };
}

async function fetchOrdersForUser(dbQuery, userId, isAdmin) {
    if (isAdmin) {
        const rows = await dbQuery(
            `SELECT o.*, u.email AS user_email
             FROM orders o
             JOIN users u ON o.user_id = u.id
             ORDER BY o.created_at DESC`
        );
        return rows.map(mapOrderRow);
    }
    const rows = await dbQuery(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
    );
    return rows.map((o) => mapOrderRow({ ...o, user_email: null }));
}

function createOrdersRouter({ dbQuery, requireAuth, ordersListLimiter }) {
    const router = express.Router();

    router.get('/list', requireAuth, ordersListLimiter, async (req, res) => {
        try {
            const isAdmin = isAdminRole(req.user.role);
            const orders = await fetchOrdersForUser(dbQuery, req.user.id, isAdmin);
            return res.json({ success: true, orders });
        } catch (err) {
            console.error('[ORDERS LIST]', err);
            return res.status(500).json({ success: false, message: 'Lỗi tải danh sách đơn hàng.' });
        }
    });

    return router;
}

module.exports = { createOrdersRouter, fetchOrdersForUser, mapOrderRow };
