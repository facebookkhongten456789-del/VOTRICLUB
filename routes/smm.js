/**
 * API SMM (dịch vụ + đặt hàng + đặt lịch) — tách riêng khỏi server.js
 * GET  /api/smm/services
 * POST /api/smm/order
 * POST /api/smm/bulk-order
 * POST /api/smm/schedule
 * GET  /api/smm/schedules
 * DELETE /api/smm/schedule/:id
 * POST /api/smm/status
 */

const express = require('express');
const { isAdminRole } = require('../lib/user-roles');
const {
    ensureSmmSchedulesSchema,
    ensureSmmApisSchema,
    ensurePricingConfigSchema,
} = require('../lib/smm-scheduler');
const { placeSmmOrderWithLock } = require('../lib/smm-order');

function createSmmRouter({ db, dbQuery, requireAuth, smmServicesLimiter, smmOrderLimiter }) {
    const router = express.Router();

    ensureSmmSchedulesSchema(dbQuery);
    ensureSmmApisSchema(dbQuery);
    ensurePricingConfigSchema(dbQuery);

    // ==========================================
    // SMM API GATEWAY HELPER (CORE LOGIC)
    // ==========================================
    async function callSmmApiGateway(actionType, placeholderData = {}, fallbackFn, provider = null) {
        try {
            // Tìm cấu hình API đang hoạt động của action này
            let apis = [];
            const queryApi = async (type) => {
                if (provider) {
                    return await dbQuery(
                        "SELECT * FROM smm_apis WHERE action_type = ? AND provider = ? AND status = 'Active' LIMIT 1",
                        [type, provider]
                    );
                } else {
                    return await dbQuery(
                        "SELECT * FROM smm_apis WHERE action_type = ? AND status = 'Active' LIMIT 1",
                        [type]
                    );
                }
            };

            apis = await queryApi(actionType);

            // Fallback to basic action types if batch action is not explicitly configured
            if (!apis.length) {
                if (actionType === 'multiple_orders_status') {
                    apis = await queryApi('status');
                } else if (actionType === 'create_multiple_refill') {
                    apis = await queryApi('refill');
                } else if (actionType === 'multiple_refill_status') {
                    apis = await queryApi('refill_status');
                }
            }

            if (!apis.length) {
                // Không cấu hình hoặc inactive -> fallback gọi API Bytemart cứng
                return await fallbackFn();
            }

            const api = apis[0];
            let endpoint = api.endpoint;
            let method = api.method || 'POST';
            
            // Parse headers
            let headers = {};
            if (api.headers) {
                try {
                    headers = JSON.parse(api.headers);
                } catch (e) {
                    headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
                }
            } else {
                headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }

            // Thay thế placeholders trong params và endpoint
            let rawParams = api.params || '';
            for (const [key, val] of Object.entries(placeholderData)) {
                const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
                rawParams = rawParams.replace(regex, String(val ?? ''));
                endpoint = endpoint.replace(regex, String(val ?? ''));
            }

            const fetchOptions = {
                method,
                headers
            };

            const isJsonHeader = Object.keys(headers).some(
                k => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json')
            );

            if (method === 'POST') {
                if (isJsonHeader) {
                    fetchOptions.body = rawParams;
                } else {
                    // Urlencoded
                    let paramsObj = {};
                    try {
                        paramsObj = JSON.parse(rawParams);
                    } catch (e) {
                        try {
                            const searchParams = new URLSearchParams(rawParams);
                            paramsObj = Object.fromEntries(searchParams.entries());
                        } catch (_) {}
                    }

                    if (Object.keys(paramsObj).length > 0) {
                        fetchOptions.body = new URLSearchParams(paramsObj);
                    } else {
                        fetchOptions.body = rawParams;
                    }
                }
            } else { // GET
                let paramsObj = {};
                try {
                    paramsObj = JSON.parse(rawParams);
                } catch (e) {}
                if (Object.keys(paramsObj).length > 0) {
                    const searchParams = new URLSearchParams(paramsObj);
                    endpoint += (endpoint.includes('?') ? '&' : '?') + searchParams.toString();
                }
            }

            let responseBodyText = '';
            let httpStatus = 200;
            let response;

            try {
                response = await fetch(endpoint, fetchOptions);
                httpStatus = response.status;
                responseBodyText = await response.text();
            } catch (err) {
                // Log mạng vào DB
                await dbQuery(
                    `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [api.id, api.name, endpoint, method, rawParams, `[GATEWAY NETWORK ERROR] ${err.message}`, 500]
                );
                throw err;
            }

            // Ghi log cuộc gọi thành công vào DB
            await dbQuery(
                `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [api.id, api.name, endpoint, method, rawParams, responseBodyText.slice(0, 5000), httpStatus]
            );

            let responseJson;
            try {
                responseJson = JSON.parse(responseBodyText);
            } catch (e) {
                responseJson = { raw: responseBodyText };
            }

            return {
                ok: response.ok,
                status: response.status,
                data: responseJson,
                apiConfig: api
            };
        } catch (err) {
            console.error(`[API GATEWAY ERROR][${actionType}]`, err);
            return {
                ok: false,
                status: 500,
                message: `Gateway Error: ${err.message}`,
                data: { error: err.message }
            };
        }
    }

    // ==========================================
    // USER SERVICES & ORDER WITH GATEWAY
    // ==========================================
    router.get('/services', requireAuth, smmServicesLimiter, async (req, res) => {
        try {
            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('services', {}, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: apiKey, action: 'services' }),
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return {
                    ok: true,
                    status: 200,
                    data: await response.json()
                };
            });

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 502).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi lấy dịch vụ SMM.'
                });
            }

            let data = gatewayResult.data;
            if (!Array.isArray(data)) {
                const msg = (data && (data.error || data.message)) || 'SMM API trả về dữ liệu không hợp lệ.'
                return res.status(502).json({ success: false, message: String(msg) });
            }

            // Load markup percentages from DB
            let markups = { member: 50, collaborator: 50, distributor: 20, admin: 0 };
            try {
                const pricingRows = await dbQuery('SELECT role, markup_percent FROM pricing_config');
                for (const row of pricingRows) {
                    markups[row.role] = parseFloat(row.markup_percent) || 0;
                }
            } catch (e) {
                console.warn('[PRICING CONFIG] Fallback to env SMM_PROFIT_PERCENT:', e.message);
                const envProfit = parseFloat(process.env.SMM_PROFIT_PERCENT) || 40;
                markups = { member: envProfit, collaborator: envProfit, distributor: 1, admin: 0 };
            }

            data = data.map((s) => {
                if (s.rate) {
                    const r = parseFloat(s.rate);
                    s.memberRate = Math.ceil(r * (1 + markups.member / 100)).toString();
                    s.collaboratorRate = Math.ceil(r * (1 + markups.collaborator / 100)).toString();
                    s.distributorRate = Math.ceil(r * (1 + markups.distributor / 100)).toString();
                    s.adminRate = Math.ceil(r * (1 + markups.admin / 100)).toString();
                    // Default rate = member rate (for backward compat)
                    s.rate = s.memberRate;
                    // Keep vipRate = distributor rate (backward compat)
                    s.vipRate = s.distributorRate;
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
            const { serviceId, link, quantity, comments } = req.body;
            const userId = req.user.id;

            if (!serviceId || !link || quantity === undefined || quantity === null || quantity === '') {
                return res.status(400).json({ success: false, message: 'Thiếu serviceId, link, hoặc quantity.' });
            }

            const result = await placeSmmOrderWithLock(db, dbQuery, {
                userId,
                serviceId,
                link,
                quantity,
                comments,
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

    router.post('/bulk-order', requireAuth, async (req, res) => {
        try {
            const { serviceId, links, quantity, delay, comments, items } = req.body;
            
            // Hỗ trợ cả multi-quantity (items) và đơn lượng truyền thống (links + quantity)
            let orderItems = [];
            if (items && Array.isArray(items) && items.length > 0) {
                orderItems = items;
            } else if (links && Array.isArray(links) && links.length > 0) {
                const qty = parseInt(quantity, 10);
                orderItems = links.map(l => ({ link: l, quantity: qty }));
            }

            if (!serviceId || orderItems.length === 0) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin mua đơn hàng loạt.' });
            }

            const delaySec = parseInt(delay, 10) || 0;
            const userId = req.user.id;

            const results = [];
            let successCount = 0;

            for (const item of orderItems) {
                try {
                    const result = await placeSmmOrderWithLock(db, dbQuery, {
                        userId,
                        serviceId,
                        link: item.link,
                        quantity: parseInt(item.quantity, 10),
                        comments,
                    });

                    if (result.ok) {
                        results.push({ success: true, orderId: result.order.id });
                        successCount++;
                    } else {
                        results.push({ success: false, error: result.message });
                    }
                } catch (err) {
                    results.push({ success: false, error: err.message });
                }

                if (delaySec > 0 && orderItems.indexOf(item) < orderItems.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
                }
            }

            const uRows = await dbQuery('SELECT balance FROM users WHERE id = ?', [userId]);
            const newBalance = uRows.length ? parseFloat(uRows[0].balance) : 0;

            return res.json({
                success: true,
                message: `Đã xử lý xong: Thành công ${successCount}/${orderItems.length} đơn.`,
                results,
                newBalance
            });
        } catch (err) {
            console.error('[BULK ORDER ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi đặt đơn hàng loạt.' });
        }
    });

    router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
        try {
            let orderId = req.params.id;
            if (typeof orderId === 'string' && orderId.startsWith('ORD-')) {
                orderId = orderId.replace('ORD-', '');
            }
            
            const userId = req.user.id;
            const isAdmin = isAdminRole(req.user.role);

            // 1. Lấy đơn hàng từ DB
            const orders = await dbQuery("SELECT * FROM orders WHERE id = ?", [orderId]);
            if (orders.length === 0) {
                return res.status(404).json({ success: false, message: `Không tìm thấy đơn hàng #${orderId}.` });
            }

            const order = orders[0];

            // Kiểm tra quyền sở hữu (người dùng chỉ được hủy đơn của mình, admin hủy được tất cả)
            if (order.user_id !== userId && !isAdmin) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền hủy đơn hàng này.' });
            }

            // 2. Nếu đơn hàng vẫn ở trạng thái Pending và chưa gửi lên API đối tác (bị kẹt do hết tiền đối tác)
            if (order.status === 'Pending' && !order.external_order_id) {
                // Thực hiện hủy đơn trong hệ thống & hoàn tiền cho khách hàng
                const conn = await db.getConnection();
                try {
                    await conn.beginTransaction();

                    // Hoàn tiền cho user
                    await conn.execute("UPDATE users SET balance = balance + ? WHERE id = ?", [order.charge, order.user_id]);
                    // Cập nhật trạng thái đơn hàng thành Canceled
                    await conn.execute("UPDATE orders SET status = 'Canceled' WHERE id = ?", [orderId]);

                    await conn.commit();


                    return res.json({ 
                        success: true, 
                        message: 'Hủy đơn hàng chờ thành công và đã hoàn lại tiền vào tài khoản!' 
                    });
                } catch (err) {
                    await conn.rollback();
                    throw err;
                } finally {
                    conn.release();
                }
            }

            // 3. Nếu đơn hàng đã gửi lên API đối tác (external_order_id có giá trị)
            if (order.external_order_id) {
                // Chỉ Admin mới được quyền yêu cầu hủy đơn đã gửi sang đối tác
                if (!isAdmin) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Đơn hàng đã được gửi đi và đang xử lý, bạn không thể tự hủy. Vui lòng liên hệ Admin.' 
                    });
                }

                // Hãy thử hủy qua API của nhà cung cấp
                const apiUrl = process.env.BYTEMART_API_URL;
                const apiKey = process.env.BYTEMART_API_KEY;

                const gatewayResult = await callSmmApiGateway('cancel', { orders: String(order.external_order_id) }, async () => {
                    if (!apiUrl || !apiKey) {
                        throw new Error('SMM API chưa cấu hình.');
                    }
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            key: apiKey,
                            action: 'cancel',
                            orders: String(order.external_order_id)
                        })
                    });
                    if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                    return { ok: true, status: 200, data: await response.json() };
                });

                if (!gatewayResult.ok) {
                    return res.status(400).json({
                        success: false,
                        message: 'Không thể hủy đơn hàng này do đã được gửi sang nhà cung cấp.'
                    });
                }

                const data = gatewayResult.data;
                let cancelSuccess = false;
                let errorMsg = 'Incorrect order ID hoặc không hỗ trợ hủy từ API gốc';

                if (Array.isArray(data)) {
                    const item = data[0];
                    if (item && (item.cancel === 1 || item.cancel === '1' || item.cancel === true || item.cancel === 'success')) {
                        cancelSuccess = true;
                    } else if (item && item.cancel && item.cancel.error) {
                        errorMsg = item.cancel.error;
                    }
                } else if (data && typeof data === 'object') {
                    if (data.cancel === 1 || data.cancel === '1' || data.cancel === true || data.cancel === 'success') {
                        cancelSuccess = true;
                    } else if (data.cancel && data.cancel.error) {
                        errorMsg = data.cancel.error;
                    }
                }

                if (cancelSuccess) {
                    // Thực hiện hủy đơn trong hệ thống & hoàn tiền cho khách hàng
                    const conn = await db.getConnection();
                    try {
                        await conn.beginTransaction();

                        // Hoàn tiền cho user
                        await conn.execute("UPDATE users SET balance = balance + ? WHERE id = ?", [order.charge, order.user_id]);
                        // Cập nhật trạng thái đơn hàng thành Canceled
                        await conn.execute("UPDATE orders SET status = 'Canceled' WHERE id = ?", [orderId]);

                        await conn.commit();



                        return res.json({ 
                            success: true, 
                            message: 'Hủy đơn hàng thành công thông qua API đối tác và đã hoàn lại tiền!' 
                        });
                    } catch (err) {
                        await conn.rollback();
                        throw err;
                    } finally {
                        conn.release();
                    }
                } else {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Hủy đơn hàng thất bại từ API đối tác gốc: ${errorMsg}` 
                    });
                }
            }

            // Nếu đơn hàng ở các trạng thái khác (Completed, Canceled, Failed)
            return res.status(400).json({ 
                success: false, 
                message: `Đơn hàng ở trạng thái [${order.status}], không thể hủy.` 
            });
        } catch (err) {
            console.error('[CANCEL ORDER ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi hủy đơn hàng.' });
        }
    });

    router.post('/schedule', requireAuth, async (req, res) => {
        try {
            const { serviceId, serviceName, links, quantity, scheduledTime, repeatType } = req.body;
            if (!serviceId || !serviceName || !links || !Array.isArray(links) || links.length === 0 || !quantity || !scheduledTime) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin đặt lịch.' });
            }

            const qty = parseInt(quantity, 10);
            if (!qty || qty <= 0) {
                return res.status(400).json({ success: false, message: 'Số lượng không hợp lệ.' });
            }

            const timeStr = String(scheduledTime).trim().replace('T', ' ');
            if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(timeStr)) {
                return res.status(400).json({ success: false, message: 'Thời gian đặt lịch không hợp lệ.' });
            }

            const repeat = repeatType === 'daily' ? 'daily' : 'once';

            await dbQuery(
                `INSERT INTO smm_schedules 
                 (user_id, service_id, service_name, links, quantity, scheduled_time, repeat_type, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [req.user.id, serviceId, serviceName, JSON.stringify(links), qty, timeStr, repeat]
            );

            return res.json({ success: true, message: 'Đặt lịch chạy đơn hàng thành công!' });
        } catch (err) {
            console.error('[POST SCHEDULE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi tạo lịch chạy.' });
        }
    });

    router.get('/schedules', requireAuth, async (req, res) => {
        try {
            const rows = await dbQuery(
                'SELECT * FROM smm_schedules WHERE user_id = ? ORDER BY created_at DESC',
                [req.user.id]
            );
            const schedules = rows.map(r => {
                let linksCount = 0;
                try {
                    linksCount = JSON.parse(r.links).length;
                } catch (_) {
                    linksCount = r.links.split(/[\n,]+/).map(l => l.trim()).filter(Boolean).length;
                }
                let result = null;
                if (r.result) {
                    try {
                        result = JSON.parse(r.result);
                    } catch (_) {}
                }
                return {
                     id: r.id,
                     serviceId: r.service_id,
                     serviceName: r.service_name,
                     linksCount,
                     quantity: r.quantity,
                     scheduledTime: r.scheduled_time,
                     repeatType: r.repeat_type,
                     status: r.status,
                     result
                };
            });
            return res.json({ success: true, schedules });
        } catch (err) {
            console.error('[GET SCHEDULES]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lấy danh sách lịch chạy.' });
        }
    });

    router.delete('/schedule/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const schedId = parseInt(id, 10);
            if (!schedId) {
                return res.status(400).json({ success: false, message: 'Mã lịch không hợp lệ.' });
            }

            const rows = await dbQuery('SELECT user_id, status FROM smm_schedules WHERE id = ?', [schedId]);
            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch.' });
            }

            const sched = rows[0];
            if (sched.user_id !== req.user.id && !isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền hủy lịch này.' });
            }

            if (sched.status === 'running') {
                return res.status(400).json({ success: false, message: 'Lịch đang chạy, không thể hủy.' });
            }

            await dbQuery('DELETE FROM smm_schedules WHERE id = ?', [schedId]);

            return res.json({ success: true, message: 'Đã hủy và xóa lịch chạy thành công.' });
        } catch (err) {
            console.error('[DELETE SCHEDULE]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi hủy lịch chạy.' });
        }
    });

    // ==========================================
    // GET ORDER STATUS (REALTIME SYNC FROM GATEWAY)
    // ==========================================
    router.post('/status', requireAuth, async (req, res) => {
        try {
            const { orderId } = req.body;
            if (!orderId) {
                return res.status(400).json({ success: false, message: 'Thiếu orderId.' });
            }

            const numericId = parseInt(String(orderId).replace('ORD-', ''), 10);
            if (!numericId) {
                return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
            }

            const orders = await dbQuery('SELECT * FROM orders WHERE id = ?', [numericId]);
            if (!orders.length) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
            }

            const order = orders[0];
            const isAdmin = isAdminRole(req.user.role);
            if (order.user_id !== req.user.id && !isAdmin) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }

            const externalOrderId = order.external_order_id;
            if (!externalOrderId) {
                return res.json({ success: true, data: { status: order.status, startCount: 0, remains: 0 } });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            // Gọi Gateway với action status
            const gatewayResult = await callSmmApiGateway('status', { orders: String(externalOrderId) }, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'status',
                        orders: String(externalOrderId)
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return {
                    ok: true,
                    status: 200,
                    data: await response.json()
                };
            });

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi lấy trạng thái đơn từ SMM.'
                });
            }

            const data = gatewayResult.data;
            const orderInfo = data[externalOrderId] || data;
            if (!orderInfo || orderInfo.error) {
                const errorMsg = orderInfo?.error || 'Lỗi từ SMM API';
                return res.json({ success: false, message: errorMsg });
            }

            let status = orderInfo.status || 'Processing';
            const startCount = parseInt(orderInfo.start_count, 10) || 0;
            const remains = parseInt(orderInfo.remains, 10) || 0;

            // Đồng bộ trạng thái realtime qua mapping động
            if (gatewayResult.apiConfig?.status_mapping) {
                try {
                    const mapping = JSON.parse(gatewayResult.apiConfig.status_mapping);
                    for (const [apiVal, sysVal] of Object.entries(mapping)) {
                        if (String(status).toLowerCase().trim() === String(apiVal).toLowerCase().trim()) {
                            status = sysVal;
                            break;
                        }
                    }
                } catch (e) {}
            }

            await dbQuery(
                'UPDATE orders SET status = ?, start_count = ?, remains = ? WHERE id = ?',
                [status, startCount, remains, numericId]
            );

            return res.json({
                success: true,
                data: {
                    status,
                    startCount,
                    remains
                }
            });

        } catch (err) {
            console.error('[SMM STATUS ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi lấy trạng thái đơn hàng SMM.' });
        }
    });

    // ==========================================
    // ADMIN ONLY - DYNAMIC API CONFIGS CRUD
    // ==========================================
    router.get('/admin/apis', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const rows = await dbQuery('SELECT * FROM smm_apis ORDER BY action_type ASC, id DESC');
            return res.json({ success: true, apis: rows });
        } catch (err) {
            console.error('[GET SMM APIS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lấy cấu hình API.' });
        }
    });

    router.post('/admin/apis', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { name, provider, action_type, endpoint, method, headers, params, status_mapping, status } = req.body;
            if (!name || !endpoint || !action_type) {
                return res.status(400).json({ success: false, message: 'Thiếu Tên, Endpoint hoặc Phân loại action.' });
            }

            await dbQuery(
                `INSERT INTO smm_apis (name, provider, action_type, endpoint, method, headers, params, status_mapping, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, provider || 'Bytemart', action_type, endpoint, method || 'POST', headers || '{}', params || '{}', status_mapping || '{}', status || 'Active']
            );

            return res.json({ success: true, message: 'Đã thêm cấu hình API SMM thành công!' });
        } catch (err) {
            console.error('[POST SMM APIS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi thêm cấu hình API.' });
        }
    });

    router.put('/admin/apis/:id', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { id } = req.params;
            const { name, provider, action_type, endpoint, method, headers, params, status_mapping, status } = req.body;

            await dbQuery(
                `UPDATE smm_apis 
                 SET name = ?, provider = ?, action_type = ?, endpoint = ?, method = ?, headers = ?, params = ?, status_mapping = ?, status = ? 
                 WHERE id = ?`,
                [name, provider, action_type, endpoint, method, headers, params, status_mapping, status, id]
            );

            return res.json({ success: true, message: 'Cập nhật cấu hình API thành công!' });
        } catch (err) {
            console.error('[PUT SMM APIS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật cấu hình API.' });
        }
    });

    router.delete('/admin/apis/:id', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { id } = req.params;
            await dbQuery('DELETE FROM smm_apis WHERE id = ?', [id]);
            return res.json({ success: true, message: 'Đã xóa cấu hình API thành công!' });
        } catch (err) {
            console.error('[DELETE SMM APIS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi xóa cấu hình API.' });
        }
    });

    router.post('/admin/apis/:id/toggle', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { id } = req.params;
            const rows = await dbQuery('SELECT status FROM smm_apis WHERE id = ?', [id]);
            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy API.' });
            }

            const newStatus = rows[0].status === 'Active' ? 'Inactive' : 'Active';
            await dbQuery('UPDATE smm_apis SET status = ? WHERE id = ?', [newStatus, id]);

            return res.json({ success: true, message: `Đã đổi trạng thái sang: ${newStatus}`, newStatus });
        } catch (err) {
            console.error('[TOGGLE SMM API]', err);
            return res.status(500).json({ success: false, message: 'Lỗi server khi đổi trạng thái API.' });
        }
    });

    router.get('/admin/apis/logs', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const rows = await dbQuery('SELECT * FROM smm_api_logs ORDER BY id DESC LIMIT 50');
            return res.json({ success: true, logs: rows });
        } catch (err) {
            console.error('[GET SMM API LOGS]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lấy nhật ký API.' });
        }
    });

    // ==========================================
    // TEST API DYNAMIC GATEWAY (PROXIED TEST CALL)
    // ==========================================
    router.post('/admin/apis/:id/test', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }

            const { id } = req.params;
            const { customParams } = req.body;

            const rows = await dbQuery('SELECT * FROM smm_apis WHERE id = ?', [id]);
            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy API cần test.' });
            }

            const api = rows[0];
            let endpoint = api.endpoint;
            let method = api.method || 'POST';
            
            let headers = {};
            if (api.headers) {
                try { headers = JSON.parse(api.headers); } catch (e) { headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
            } else {
                headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }

            // Dùng params custom do Admin nhập hoặc params gốc
            let rawParams = customParams || api.params || '';
            const fetchOptions = { method, headers };

            const isJsonHeader = Object.keys(headers).some(
                k => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json')
            );

            if (method === 'POST') {
                if (isJsonHeader) {
                    fetchOptions.body = rawParams;
                } else {
                    let paramsObj = {};
                    try {
                        paramsObj = JSON.parse(rawParams);
                    } catch (e) {
                        try {
                            const searchParams = new URLSearchParams(rawParams);
                            paramsObj = Object.fromEntries(searchParams.entries());
                        } catch (_) {}
                    }

                    if (Object.keys(paramsObj).length > 0) {
                        fetchOptions.body = new URLSearchParams(paramsObj);
                    } else {
                        fetchOptions.body = rawParams;
                    }
                }
            } else {
                let paramsObj = {};
                try { paramsObj = JSON.parse(rawParams); } catch (e) {}
                if (Object.keys(paramsObj).length > 0) {
                    const searchParams = new URLSearchParams(paramsObj);
                    endpoint += (endpoint.includes('?') ? '&' : '?') + searchParams.toString();
                }
            }

            let responseBodyText = '';
            let httpStatus = 200;
            let startTime = Date.now();

            try {
                const response = await fetch(endpoint, fetchOptions);
                httpStatus = response.status;
                responseBodyText = await response.text();
            } catch (err) {
                await dbQuery(
                    `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [api.id, api.name + ' (TEST)', endpoint, method, rawParams, `[TEST GATEWAY NETWORK ERROR] ${err.message}`, 500]
                );
                return res.json({
                    success: false,
                    message: `Lỗi kết nối: ${err.message}`,
                    httpStatus: 500,
                    rawResponse: err.message
                });
            }

            let duration = Date.now() - startTime;

            // Lưu log test
            await dbQuery(
                `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [api.id, api.name + ' (TEST)', endpoint, method, rawParams, responseBodyText.slice(0, 5000), httpStatus]
            );

            let responseJson;
            try {
                responseJson = JSON.parse(responseBodyText);
            } catch (e) {
                responseJson = { raw: responseBodyText };
            }

            return res.json({
                success: true,
                message: 'Test API hoàn tất!',
                httpStatus,
                duration: `${duration}ms`,
                endpoint,
                method,
                requestBody: rawParams,
                response: responseJson
            });

        } catch (err) {
            console.error('[TEST SMM API ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi server test API: ${err.message}` });
        }
    });

    // ==========================================
    // ADMIN LEGACY APIS (ROUTED DYNAMICALLY)
    // ==========================================
    router.post('/admin/services', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { provider } = req.body;
            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('services', {}, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: apiKey, action: 'services' })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi lấy dịch vụ từ API.'
                });
            }
            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM SERVICES ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/add-order', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { serviceId, link, quantity, comments } = req.body;
            if (!serviceId || !link || !quantity) {
                return res.status(400).json({ success: false, message: 'Thiếu serviceId, link hoặc quantity.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('order', {
                serviceId: String(serviceId).trim(),
                link: String(link).trim(),
                quantity: String(quantity).trim(),
                comments: String(comments || '').trim()
            }, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'add',
                        service: String(serviceId).trim(),
                        link: String(link).trim(),
                        quantity: String(quantity).trim(),
                        comments: String(comments || '').trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            });

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi đặt hàng từ API.'
                });
            }
            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM ADD ORDER ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/order-status', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { order, provider } = req.body;
            if (!order) {
                return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('status', {
                orders: String(order).trim()
            }, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'status',
                        orders: String(order).trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi tra cứu đơn hàng từ API.'
                });
            }
            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM ORDER STATUS ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/multiple-orders-status', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { orders, provider } = req.body;
            if (!orders) {
                return res.status(400).json({ success: false, message: 'Thiếu danh sách mã đơn hàng.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('status', {
                orders: String(orders).trim()
            }, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'status',
                        orders: String(orders).trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi tra cứu đơn hàng loạt từ API.'
                });
            }
            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM MULTI ORDER STATUS ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/create-multiple-refill', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { orders, provider } = req.body;
            if (!orders) {
                return res.status(400).json({ success: false, message: 'Thiếu danh sách mã đơn hàng để bảo hành.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('refill', {
                orders: String(orders).trim(),
                order: String(orders).trim()
            }, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'refill',
                        orders: String(orders).trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi bảo hành hàng loạt từ API.'
                });
            }
            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM MULTI REFILL ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/multiple-refill-status', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { refills, provider } = req.body;
            if (!refills) {
                return res.status(400).json({ success: false, message: 'Thiếu danh sách mã bảo hành.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('refill_status', {
                refills: String(refills).trim()
            }, async () => {
                if (!apiUrl || !apiKey) throw new Error('SMM API chưa cấu hình.');
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'refill_status',
                        refills: String(refills).trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi tra cứu trạng thái bảo hành hàng loạt.'
                });
            }

            const data = gatewayResult.data;
            let successCount = 0;
            let failCount = 0;
            let failReasons = [];

            if (data && typeof data === 'object' && data.error) {
                return res.status(400).json({ success: false, message: `Lỗi API: ${data.error}`, data });
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.refill) {
                        let isSuccess = true;
                        let errorMsg = '';

                        if (item.status && typeof item.status === 'object') {
                            if (item.status.error) {
                                isSuccess = false;
                                errorMsg = item.status.error;
                            }
                        } else if (typeof item.status === 'string') {
                            const lowercaseStatus = item.status.toLowerCase();
                            if (lowercaseStatus.includes('error') || lowercaseStatus.includes('incorrect') || lowercaseStatus.includes('fail') || lowercaseStatus.includes('invalid')) {
                                isSuccess = false;
                                errorMsg = item.status;
                            }
                        }

                        if (isSuccess) {
                            successCount++;
                        } else {
                            failCount++;
                            failReasons.push(`Refill ${item.refill}: ${errorMsg}`);
                        }
                    }
                }
            }

            if (successCount === 0 && failCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Kiểm tra trạng thái bảo hành hàng loạt thất bại: ${failReasons.join('; ')}`,
                    data
                });
            } else if (successCount > 0 && failCount > 0) {
                return res.json({
                    success: true,
                    message: `Kiểm tra xong. Thành công ${successCount} đơn. Thất bại ${failCount} đơn (${failReasons.join('; ')})`,
                    data
                });
            } else {
                return res.json({
                    success: true,
                    message: 'Kiểm tra trạng thái bảo hành hàng loạt hoàn tất!',
                    data
                });
            }
        } catch (err) {
            console.error('[ADMIN SMM MULTI REFILL STATUS ERROR]', err);
            return res.status(500).json({ success: false, message: `Lỗi: ${err.message}` });
        }
    });

    router.post('/admin/balance', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { provider } = req.body;
            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('balance', {}, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: apiKey, action: 'balance' })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi lấy số dư từ API.'
                });
            }

            return res.json({ success: true, data: gatewayResult.data });
        } catch (err) {
            console.error('[ADMIN SMM BALANCE ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi lấy số dư API gốc.' });
        }
    });

    router.post('/admin/cancel', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }

            const { orders, provider } = req.body;
            if (!orders) {
                return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng.' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const gatewayResult = await callSmmApiGateway('cancel', { orders: String(orders).trim() }, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        key: apiKey,
                        action: 'cancel',
                        orders: String(orders).trim()
                    })
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi hủy đơn tại API.'
                });
            }

            const data = gatewayResult.data;

            // Đồng bộ trạng thái đơn Canceled trong hệ thống
            const updateStatus = async (extId) => {
                let statusVal = 'Canceled';
                // Áp dụng status mapping
                if (gatewayResult.apiConfig?.status_mapping) {
                    try {
                        const mapping = JSON.parse(gatewayResult.apiConfig.status_mapping);
                        for (const [apiVal, sysVal] of Object.entries(mapping)) {
                            if (sysVal === 'Canceled') {
                                statusVal = sysVal;
                                break;
                            }
                        }
                    } catch (e) {}
                }
                await dbQuery(
                    "UPDATE orders SET status = ? WHERE external_order_id = ?",
                    [statusVal, String(extId)]
                );
            };

            let successCount = 0;
            let failCount = 0;
            let failReasons = [];

            if (data && typeof data === 'object' && data.error) {
                return res.status(400).json({ success: false, message: `Lỗi API: ${data.error}`, data });
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.order) {
                        let isSuccess = false;
                        let errorMsg = '';
                        
                        // Hủy thành công khi cancel = 1 hoặc true hoặc "1"
                        if (item.cancel === 1 || item.cancel === '1' || item.cancel === true || item.cancel === 'success') {
                            isSuccess = true;
                        } else if (item.cancel && typeof item.cancel === 'object') {
                            if (item.cancel.error) {
                                errorMsg = item.cancel.error;
                            } else {
                                isSuccess = true;
                            }
                        } else if (typeof item.cancel === 'string') {
                            errorMsg = item.cancel;
                        } else {
                            errorMsg = 'Incorrect order ID hoặc không thể hủy';
                        }

                        if (isSuccess && !errorMsg) {
                            successCount++;
                            await updateStatus(item.order);
                        } else {
                            failCount++;
                            failReasons.push(`Đơn ${item.order}: ${errorMsg}`);
                        }
                    }
                }
            } else if (data && typeof data === 'object') {
                if (data.order) {
                    let isSuccess = false;
                    let errorMsg = '';
                    
                    if (data.cancel === 1 || data.cancel === '1' || data.cancel === true || data.cancel === 'success') {
                        isSuccess = true;
                    } else if (data.cancel && typeof data.cancel === 'object') {
                        if (data.cancel.error) {
                            errorMsg = data.cancel.error;
                        } else {
                            isSuccess = true;
                        }
                    } else if (typeof data.cancel === 'string') {
                        errorMsg = data.cancel;
                    } else {
                        errorMsg = 'Incorrect order ID hoặc không thể hủy';
                    }

                    if (isSuccess && !errorMsg) {
                        successCount++;
                        await updateStatus(data.order);
                    } else {
                        failCount++;
                        failReasons.push(`Đơn ${data.order}: ${errorMsg}`);
                    }
                }
            }

            if (successCount === 0 && failCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Hủy đơn hàng thất bại: ${failReasons.join('; ')}`,
                    data
                });
            } else if (successCount > 0 && failCount > 0) {
                return res.json({
                    success: true,
                    message: `Hủy thành công ${successCount} đơn. Thất bại ${failCount} đơn (${failReasons.join('; ')})`,
                    data
                });
            } else if (successCount > 0 && failCount === 0) {
                return res.json({
                    success: true,
                    message: `Hủy đơn hàng loạt thành công (${successCount} đơn)!`,
                    data
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'API đối tác không trả về trạng thái hủy đơn hợp lệ.',
                    data
                });
            }
        } catch (err) {
            console.error('[ADMIN SMM CANCEL ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi hủy đơn hàng tại API gốc.' });
        }
    });

    router.post('/admin/refill', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }

            const { orders, order, provider } = req.body;
            const targetOrders = orders || order;
            if (!targetOrders) {
                return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng để bảo hành (refill).' });
            }

            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            const isMultiple = String(targetOrders).includes(',');

            // Gọi Gateway
            const gatewayResult = await callSmmApiGateway('refill', { 
                order: String(targetOrders).trim(), 
                orders: String(targetOrders).trim() 
            }, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const bodyParams = { key: apiKey, action: 'refill' };
                if (isMultiple) {
                    bodyParams.orders = String(targetOrders).trim();
                } else {
                    bodyParams.order = String(targetOrders).trim();
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(bodyParams)
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi yêu cầu bảo hành từ API.'
                });
            }

            const data = gatewayResult.data;

            const updateLocalStatus = async (extId) => {
                let statusVal = 'Refilling';
                if (gatewayResult.apiConfig?.status_mapping) {
                    try {
                        const mapping = JSON.parse(gatewayResult.apiConfig.status_mapping);
                        for (const [apiVal, sysVal] of Object.entries(mapping)) {
                            if (sysVal === 'Refilling') {
                                statusVal = sysVal;
                                break;
                            }
                        }
                    } catch (e) {}
                }
                await dbQuery(
                    "UPDATE orders SET status = ? WHERE external_order_id = ?",
                    [statusVal, String(extId)]
                );
            };

            let successCount = 0;
            let failCount = 0;
            let failReasons = [];

            if (data && typeof data === 'object' && data.error) {
                return res.status(400).json({ success: false, message: `Lỗi API: ${data.error}`, data });
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.order) {
                        let isSuccess = false;
                        let errorMsg = '';

                        // Refill thành công khi có refill ID (thường là số) hoặc refill = 1 hoặc status thành công
                        if (item.refill && (typeof item.refill === 'number' || /^\d+$/.test(String(item.refill)) || item.refill === 1 || item.refill === '1' || item.refill === 'success')) {
                            isSuccess = true;
                        } else if (item.refill && typeof item.refill === 'object') {
                            if (item.refill.error) {
                                errorMsg = item.refill.error;
                            } else {
                                isSuccess = true;
                            }
                        } else if (typeof item.refill === 'string') {
                            errorMsg = item.refill;
                        } else {
                            errorMsg = 'Incorrect order ID hoặc từ chối bảo hành';
                        }

                        if (isSuccess && !errorMsg) {
                            successCount++;
                            await updateLocalStatus(item.order);
                        } else {
                            failCount++;
                            failReasons.push(`Đơn ${item.order}: ${errorMsg}`);
                        }
                    }
                }
            } else if (data && typeof data === 'object') {
                if (data.order || targetOrders) {
                    const orderId = data.order || targetOrders;
                    let isSuccess = false;
                    let errorMsg = '';

                    if (data.refill && (typeof data.refill === 'number' || /^\d+$/.test(String(data.refill)) || data.refill === 1 || data.refill === '1' || data.refill === 'success')) {
                        isSuccess = true;
                    } else if (data.refill && typeof data.refill === 'object') {
                        if (data.refill.error) {
                            errorMsg = data.refill.error;
                        } else {
                            isSuccess = true;
                        }
                    } else if (typeof data.refill === 'string') {
                        errorMsg = data.refill;
                    } else {
                        errorMsg = 'Incorrect order ID hoặc từ chối bảo hành';
                    }

                    if (isSuccess && !errorMsg) {
                        successCount++;
                        await updateLocalStatus(orderId);
                    } else {
                        failCount++;
                        failReasons.push(`Đơn ${orderId}: ${errorMsg}`);
                    }
                }
            }

            if (successCount === 0 && failCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Yêu cầu bảo hành thất bại: ${failReasons.join('; ')}`,
                    data
                });
            } else if (successCount > 0 && failCount > 0) {
                return res.json({
                    success: true,
                    message: `Bảo hành thành công ${successCount} đơn. Thất bại ${failCount} đơn (${failReasons.join('; ')})`,
                    data
                });
            } else if (successCount > 0 && failCount === 0) {
                return res.json({
                    success: true,
                    message: `Gửi yêu cầu bảo hành thành công (${successCount} đơn)!`,
                    data
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'API đối tác không trả về trạng thái bảo hành hợp lệ.',
                    data
                });
            }
        } catch (err) {
            console.error('[ADMIN SMM REFILL ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi yêu cầu bảo hành tại API gốc.' });
        }
    });

    router.post('/admin/refill-status', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }

            const { refills, orders, type, provider } = req.body;
            const apiUrl = process.env.BYTEMART_API_URL;
            const apiKey = process.env.BYTEMART_API_KEY;

            // Gọi Gateway
            const gatewayResult = await callSmmApiGateway('refill_status', { 
                refills: String(refills || '').trim(), 
                orders: String(orders || '').trim() 
            }, async () => {
                if (!apiUrl || !apiKey) {
                    throw new Error('SMM API chưa cấu hình.');
                }
                const params = { key: apiKey };
                if (type === 'refill_status_by_order') {
                    if (!orders) throw new Error('Thiếu mã đơn hàng.');
                    params.action = 'refill';
                    params.orders = String(orders).trim();
                } else {
                    if (!refills) throw new Error('Thiếu mã bảo hành.');
                    params.action = 'refill_status';
                    params.refills = String(refills).trim();
                }
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(params)
                });
                if (!response.ok) throw new Error(`SMM API status: ${response.status}`);
                return { ok: true, status: 200, data: await response.json() };
            }, provider);

            if (!gatewayResult.ok) {
                return res.status(gatewayResult.status || 500).json({
                    success: false,
                    message: gatewayResult.message || 'Lỗi kiểm tra trạng thái bảo hành.'
                });
            }

            const data = gatewayResult.data;
            let successCount = 0;
            let failCount = 0;
            let failReasons = [];

            if (data && typeof data === 'object' && data.error) {
                return res.status(400).json({ success: false, message: `Lỗi API: ${data.error}`, data });
            }

            if (Array.isArray(data)) {
                for (const item of data) {
                    if (item.refill) {
                        let isSuccess = true;
                        let errorMsg = '';

                        if (item.status && typeof item.status === 'object') {
                            if (item.status.error) {
                                isSuccess = false;
                                errorMsg = item.status.error;
                            }
                        } else if (typeof item.status === 'string') {
                            const lowercaseStatus = item.status.toLowerCase();
                            if (lowercaseStatus.includes('error') || lowercaseStatus.includes('incorrect') || lowercaseStatus.includes('fail') || lowercaseStatus.includes('invalid')) {
                                isSuccess = false;
                                errorMsg = item.status;
                            }
                        }

                        if (isSuccess) {
                            successCount++;
                        } else {
                            failCount++;
                            failReasons.push(`Refill ${item.refill}: ${errorMsg}`);
                        }
                    }
                }
            } else if (data && typeof data === 'object') {
                if (data.refill) {
                    let isSuccess = true;
                    let errorMsg = '';

                    if (data.status && typeof data.status === 'object') {
                        if (data.status.error) {
                            isSuccess = false;
                            errorMsg = data.status.error;
                        }
                    } else if (typeof data.status === 'string') {
                        const lowercaseStatus = data.status.toLowerCase();
                        if (lowercaseStatus.includes('error') || lowercaseStatus.includes('incorrect') || lowercaseStatus.includes('fail') || lowercaseStatus.includes('invalid')) {
                            isSuccess = false;
                            errorMsg = data.status;
                        }
                    }

                    if (isSuccess) {
                        successCount++;
                    } else {
                        failCount++;
                        failReasons.push(`Refill ${data.refill}: ${errorMsg}`);
                    }
                }
            }

            if (successCount === 0 && failCount > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Kiểm tra trạng thái bảo hành thất bại: ${failReasons.join('; ')}`,
                    data
                });
            } else if (successCount > 0 && failCount > 0) {
                return res.json({
                    success: true,
                    message: `Kiểm tra xong. Thành công ${successCount} đơn. Thất bại ${failCount} đơn (${failReasons.join('; ')})`,
                    data
                });
            } else {
                return res.json({
                    success: true,
                    message: 'Kiểm tra trạng thái bảo hành hoàn tất!',
                    data
                });
            }
        } catch (err) {
            console.error('[ADMIN SMM REFILL STATUS ERROR]', err);
            return res.status(500).json({ success: false, message: 'Lỗi khi kiểm tra trạng thái bảo hành.' });
        }
    });

    // ==========================================
    // ADMIN PRICING CONFIGURATION
    // ==========================================
    router.get('/admin/pricing', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const rows = await dbQuery('SELECT * FROM pricing_config ORDER BY FIELD(role, "member", "collaborator", "distributor", "admin")');
            return res.json({ success: true, pricing: rows });
        } catch (err) {
            console.error('[GET PRICING CONFIG]', err);
            return res.status(500).json({ success: false, message: 'Lỗi lấy cấu hình giá.' });
        }
    });

    router.put('/admin/pricing', requireAuth, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) {
                return res.status(403).json({ success: false, message: 'Không có quyền truy cập.' });
            }
            const { configs } = req.body;
            if (!Array.isArray(configs) || configs.length === 0) {
                return res.status(400).json({ success: false, message: 'Thiếu dữ liệu cấu hình giá.' });
            }

            const allowedRoles = ['member', 'collaborator', 'distributor', 'admin'];
            for (const cfg of configs) {
                if (!allowedRoles.includes(cfg.role)) continue;
                const markup = parseFloat(cfg.markup_percent);
                if (isNaN(markup) || markup < 0 || markup > 999) {
                    return res.status(400).json({ success: false, message: `Markup không hợp lệ cho ${cfg.role}: ${cfg.markup_percent}%` });
                }
                await dbQuery(
                    'UPDATE pricing_config SET markup_percent = ?, description = ? WHERE role = ?',
                    [markup, cfg.description || null, cfg.role]
                );
            }

            return res.json({ success: true, message: 'Đã cập nhật cấu hình giá thành công!' });
        } catch (err) {
            console.error('[PUT PRICING CONFIG]', err);
            return res.status(500).json({ success: false, message: 'Lỗi cập nhật cấu hình giá.' });
        }
    });


    return router;
}

module.exports = { createSmmRouter };
