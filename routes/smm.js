/**
 * API SMM (dịch vụ + đặt hàng) — tách riêng khỏi server.js
 * GET  /api/smm/services
 * POST /api/smm/order
 */

const express = require('express');
const { placeSmmOrderWithLock } = require('../lib/smm-order');

function createSmmRouter({ db, dbQuery, requireAuth, smmServicesLimiter, smmOrderLimiter }) {
    const router = express.Router();

    router.get('/services', requireAuth, smmServicesLimiter, async (req, res) => {
        try {
            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;
            if (!apiUrl || !apiKey) {
                return res.status(500).json({ success: false, message: 'SMM API chưa cấu hình.' });
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ key: apiKey, action: 'services' }),
            });
            if (!response.ok) throw new Error(`SMM API status: ${response.status}`);

            let data = await response.json();
            if (!Array.isArray(data)) {
                const msg = (data && (data.error || data.message)) || 'SMM API trả về dữ liệu không hợp lệ.';
                return res.status(502).json({ success: false, message: String(msg) });
            }

            const profitPercent = parseFloat(process.env.SMM_PROFIT_PERCENT) || 0;
            data = data.map((s) => {
                if (s.rate) {
                    const r = parseFloat(s.rate);
                    s.vipRate = Math.ceil(r * 1.01).toString();
                    s.rate = Math.ceil(r * (1 + profitPercent / 100)).toString();
                }
                if (!s.platform) {
                    const cat = String(s.category || s.name || '');
                    if (/facebook|fb/i.test(cat)) s.platform = 'Dịch vụ Facebook';
                    else if (/instagram|insta/i.test(cat)) s.platform = 'Instagram';
                    else if (/tiktok/i.test(cat)) s.platform = 'TikTok';
                    else if (/youtube/i.test(cat)) s.platform = 'YouTube';
                    else s.platform = 'Khác';
                }
                return s;
            });
            return res.json({ success: true, data });
        } catch (err) {
            console.error('[SMM SERVICES]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lấy dịch vụ SMM.' });
        }
    });

    router.post('/order', requireAuth, smmOrderLimiter, async (req, res) => {
        try {
            const { serviceId, link, quantity } = req.body;
            const userId = req.user.id;

            if (!serviceId || !link || quantity === undefined || quantity === null || quantity === '') {
                return res.status(400).json({ success: false, message: 'Thiếu serviceId, link, hoặc quantity.' });
            }

            const result = await placeSmmOrderWithLock(db, dbQuery, {
                userId,
                serviceId,
                link,
                quantity,
            });

            if (!result.ok) {
                return res.status(result.status || 400).json({
                    success: false,
                    message: result.message,
                    bytemartError: result.bytemartError,
                });
            }

            return res.json({
                success: true,
                message: 'Đơn hàng đã được tạo thành công!',
                order: result.order,
            });
        } catch (err) {
            console.error('[SMM ORDER]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi tạo đơn hàng SMM.' });
        }
    });

    return router;
}

module.exports = { createSmmRouter };
