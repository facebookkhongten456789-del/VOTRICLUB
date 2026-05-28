
/**
 * Đặt đơn SMM có khóa balance — chống quantity âm và race condition.
 */
async function placeSmmOrderWithLock(db, dbQuery, { userId, serviceId, link, quantity, comments }) {
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, status: 400, message: 'Số lượng phải là số nguyên dương.' };
    }

    // #region agent log
    fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H1',location:'lib/smm-order.js:placeSmmOrderWithLock:qty-validated',message:'Start placeSmmOrderWithLock',data:{userId,serviceId,qty,hasComments:Boolean(comments),linkLen:String(link||'').length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log

    const apiUrl = process.env.BYTEMART_API_URL;
    const apiKey = process.env.BYTEMART_API_KEY;

    // 1. Tìm API active cho action 'services' trong DB để lấy cấu hình
    const serviceApis = await dbQuery(
        "SELECT * FROM smm_apis WHERE action_type = 'services' AND status = 'Active' LIMIT 1"
    );

    let servicesData = null;
    if (serviceApis.length) {
        const api = serviceApis[0];
        let endpoint = api.endpoint;
        let method = api.method || 'POST';
        let headers = {};
        if (api.headers) {
            try { headers = JSON.parse(api.headers); } catch (e) { headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
        } else {
            headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }
        let rawParams = api.params || '';
        
        const fetchOptions = { method, headers };
        const isJsonHeader = Object.keys(headers).some(k => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json'));

        if (method === 'POST') {
            if (isJsonHeader) {
                fetchOptions.body = rawParams;
            } else {
                let paramsObj = {};
                try { paramsObj = JSON.parse(rawParams); } catch (e) {
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

        try {
            const res = await fetch(endpoint, fetchOptions);
            const text = await res.text();
            
            await dbQuery(
                `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [api.id, api.name, endpoint, method, rawParams, text.slice(0, 5000), res.status]
            );

            servicesData = JSON.parse(text);
        } catch (e) {
            console.error('[GATEWAY SERVICES ERROR]', e);
        }
    }

    // Fallback Bytemart nếu không có hoặc lỗi
    if (!servicesData || !Array.isArray(servicesData)) {
        if (!apiUrl || !apiKey) {
            return { ok: false, status: 500, message: 'SMM API chưa cấu hình.' };
        }

        const getServicesResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: apiKey, action: 'services' }),
        });
        if (!getServicesResponse.ok) {
            return { ok: false, status: 502, message: `SMM API status: ${getServicesResponse.status}` };
        }
        servicesData = await getServicesResponse.json();
    }

    const service = servicesData.find((s) => String(s.service) === String(serviceId));
    if (!service) {
        return { ok: false, status: 400, message: 'Dịch vụ không tồn tại.' };
    }

    const min = parseInt(service.min, 10);
    const max = parseInt(service.max, 10);
    if (Number.isFinite(min) && qty < min) {
        return { ok: false, status: 400, message: `Số lượng tối thiểu: ${min}.` };
    }
    if (Number.isFinite(max) && qty > max) {
        return { ok: false, status: 400, message: `Số lượng tối đa: ${max}.` };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [userRows] = await conn.execute(
            'SELECT id, email, balance, role FROM users WHERE id = ? FOR UPDATE',
            [userId],
        );
        if (!userRows.length) {
            await conn.rollback();
            return { ok: false, status: 404, message: 'Không tìm thấy user.' };
        }

        const user = userRows[0];
        const userBalance = parseFloat(user.balance);

        const { normalizeUserRole } = require('./user-roles');
        const userRole = normalizeUserRole(user.role);

        const baseCost = parseFloat(service.rate) || 0;

        // Load markup from pricing_config DB
        let markupPercent = 50; // default fallback
        try {
            const pricingRows = await dbQuery(
                'SELECT markup_percent FROM pricing_config WHERE role = ? LIMIT 1',
                [userRole]
            );
            if (pricingRows.length) {
                markupPercent = parseFloat(pricingRows[0].markup_percent) || 0;
            } else {
                // Fallback to env if role not found in DB
                markupPercent = parseFloat(process.env.SMM_PROFIT_PERCENT) || 40;
            }
        } catch (e) {
            console.warn('[PRICING CONFIG] Fallback to env:', e.message);
            if (userRole === 'distributor' || userRole === 'admin') {
                markupPercent = userRole === 'admin' ? 0 : 20;
            } else {
                markupPercent = parseFloat(process.env.SMM_PROFIT_PERCENT) || 40;
            }
        }

        const finalRate = Math.ceil(baseCost * (1 + markupPercent / 100));

        const chargedPrice = (qty / 1000) * finalRate;

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H2',location:'lib/smm-order.js:placeSmmOrderWithLock:pricing',message:'Computed pricing from base rate + markup',data:{userId,serviceId,userRole,baseCost,markupPercent,finalRate,qty,chargedPrice},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        if (chargedPrice <= 0 || !Number.isFinite(chargedPrice)) {
            await conn.rollback();
            return { ok: false, status: 400, message: 'Giá đơn hàng không hợp lệ.' };
        }

        if (userBalance < chargedPrice) {
            await conn.rollback();
            return {
                ok: false,
                status: 400,
                message: `Số dư không đủ. Cần: ${chargedPrice.toFixed(0)} VND, Hiện có: ${userBalance.toFixed(0)} VND`,
            };
        }

        const newBalance = userBalance - chargedPrice;
        await conn.execute('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

        const [orderResult] = await conn.execute(
            'INSERT INTO orders (user_id, service_id, service_name, link, quantity, charge, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, serviceId, service.name || '', link, qty, chargedPrice, 'Pending'],
        );
        const orderId = orderResult.insertId;

        await conn.commit();

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H3',location:'lib/smm-order.js:placeSmmOrderWithLock:deducted',message:'Deducted balance and created pending order (before provider API call)',data:{userId,orderId,serviceId,qty,chargedPrice,newBalance},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        // 2. Tìm API active cho action 'order' trong DB để gửi đơn
        const orderApis = await dbQuery(
            "SELECT * FROM smm_apis WHERE action_type = 'order' AND status = 'Active' LIMIT 1"
        );

        let addOrderResult = null;
        if (orderApis.length) {
            const api = orderApis[0];
            let endpoint = api.endpoint;
            let method = api.method || 'POST';
            let headers = {};
            if (api.headers) {
                try { headers = JSON.parse(api.headers); } catch (e) { headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
            } else {
                headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }

            // Thay thế placeholders động
            let rawParams = api.params || '';
            const placeholders = {
                serviceId: String(serviceId),
                link: String(link),
                quantity: String(qty),
                comments: String(comments || '')
            };

            for (const [key, val] of Object.entries(placeholders)) {
                const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
                rawParams = rawParams.replace(regex, val);
                endpoint = endpoint.replace(regex, val);
            }

            const fetchOptions = { method, headers };
            const isJsonHeader = Object.keys(headers).some(k => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json'));

            if (method === 'POST') {
                if (isJsonHeader) {
                    fetchOptions.body = rawParams;
                } else {
                    let paramsObj = {};
                    try { paramsObj = JSON.parse(rawParams); } catch (e) {
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

            try {
                const res = await fetch(endpoint, fetchOptions);
                const text = await res.text();

                await dbQuery(
                    `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [api.id, api.name, endpoint, method, rawParams, text.slice(0, 5000), res.status]
                );

                addOrderResult = JSON.parse(text);
            } catch (e) {
                console.error('[GATEWAY ORDER ERROR]', e);
            }
        }

        // Fallback Bytemart order
        if (!addOrderResult) {
            if (!apiUrl || !apiKey) {
                await dbQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [chargedPrice, userId]);
                await dbQuery('UPDATE orders SET status = ? WHERE id = ?', ['Failed', orderId]);
                return { ok: false, status: 500, message: 'SMM API chưa cấu hình.' };
            }

            const params = new URLSearchParams({
                key: apiKey,
                action: 'add',
                service: serviceId,
                link,
                quantity: String(qty),
            });
            if (comments) {
                params.append('comments', comments);
            }

            const addOrderResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
            });
            addOrderResult = await addOrderResponse.json();
        }

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H4',location:'lib/smm-order.js:placeSmmOrderWithLock:provider-result',message:'Provider add order result received',data:{userId,orderId,serviceId,hasOrder:Boolean(addOrderResult&&addOrderResult.order),hasError:Boolean(addOrderResult&&addOrderResult.error),errorSample:typeof (addOrderResult&&addOrderResult.error)==='string'?addOrderResult.error.slice(0,120):null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        if (addOrderResult.order) {
            await dbQuery(
                'UPDATE orders SET status = ?, external_order_id = ? WHERE id = ?',
                ['Processing', String(addOrderResult.order), orderId],
            );
            return {
                ok: true,
                order: {
                    id: orderId,
                    externalOrderId: addOrderResult.order,
                    serviceId,
                    serviceName: service.name || '',
                    quantity: qty,
                    link,
                    charge: chargedPrice,
                    status: 'Processing',
                    newBalance,
                },
            };
        }

        const isInsufficientBalance = addOrderResult && addOrderResult.error && (typeof addOrderResult.error === 'string') && (
            addOrderResult.error.toLowerCase().includes('insufficient') || 
            addOrderResult.error.toLowerCase().includes('balance') || 
            addOrderResult.error.toLowerCase().includes('not enough funds') || 
            addOrderResult.error.toLowerCase().includes('funds')
        );

        if (isInsufficientBalance) {
            // Giữ trạng thái Pending (Chờ xử lý / Xếp hàng khi nhà cung cấp hết tiền)
            // Không hoàn tiền lại cho user vì đơn hàng vẫn hợp lệ, chỉ là chờ nạp tiền API
            await dbQuery(
                'UPDATE orders SET status = ? WHERE id = ?',
                ['Pending', orderId]
            );

            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H5',location:'lib/smm-order.js:placeSmmOrderWithLock:queued',message:'Provider insufficient balance; order kept Pending and not refunded',data:{userId,orderId,serviceId,qty,chargedPrice},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log

            return {
                ok: true,
                order: {
                    id: orderId,
                    externalOrderId: null,
                    serviceId,
                    serviceName: service.name || '',
                    quantity: qty,
                    link,
                    charge: chargedPrice,
                    status: 'Pending',
                    newBalance,
                    isQueuedForBalance: true
                },
            };
        }

        await dbQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [chargedPrice, userId]);
        await dbQuery('UPDATE orders SET status = ? WHERE id = ?', ['Failed', orderId]);

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H6',location:'lib/smm-order.js:placeSmmOrderWithLock:refunded',message:'Provider error not-insufficient; refunded and marked Failed',data:{userId,orderId,serviceId,qty,chargedPrice,errType:typeof (addOrderResult&&addOrderResult.error)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        return {
            ok: false,
            status: 400,
            message: addOrderResult.error || 'Lỗi khi xử lý đơn SMM.',
            bytemartError: addOrderResult,
        };
    } catch (err) {
        try {
            await conn.rollback();
        } catch (_) {
            /* */
        }
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Thử lại đặt đơn SMM bị giữ do hết số dư (insufficient balance)
 */
async function retryPendingSmmOrder(db, dbQuery, order) {
    const apiUrl = process.env.BYTEMART_API_URL;
    const apiKey = process.env.BYTEMART_API_KEY;

    // 1. Tìm API active cho action 'order' trong DB để gửi đơn
    const orderApis = await dbQuery(
        "SELECT * FROM smm_apis WHERE action_type = 'order' AND status = 'Active' LIMIT 1"
    );

    let addOrderResult = null;
    if (orderApis.length) {
        const api = orderApis[0];
        let endpoint = api.endpoint;
        let method = api.method || 'POST';
        let headers = {};
        if (api.headers) {
            try { headers = JSON.parse(api.headers); } catch (e) { headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
        } else {
            headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }

        // Thay thế placeholders động
        let rawParams = api.params || '';
        const placeholders = {
            serviceId: String(order.service_id),
            link: String(order.link),
            quantity: String(order.quantity),
            comments: ''
        };

        for (const [key, val] of Object.entries(placeholders)) {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            rawParams = rawParams.replace(regex, val);
            endpoint = endpoint.replace(regex, val);
        }

        const fetchOptions = { method, headers };
        const isJsonHeader = Object.keys(headers).some(k => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json'));

        if (method === 'POST') {
            if (isJsonHeader) {
                fetchOptions.body = rawParams;
            } else {
                let paramsObj = {};
                try { paramsObj = JSON.parse(rawParams); } catch (e) {
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

        try {
            const res = await fetch(endpoint, fetchOptions);
            const text = await res.text();

            await dbQuery(
                `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [api.id, api.name, endpoint, method, rawParams, text.slice(0, 5000), res.status]
            );

            addOrderResult = JSON.parse(text);
        } catch (e) {
            console.error('[GATEWAY RETRY ORDER ERROR]', e);
        }
    }

    // Fallback Bytemart order
    if (!addOrderResult) {
        if (!apiUrl || !apiKey) {
            return;
        }

        const params = new URLSearchParams({
            key: apiKey,
            action: 'add',
            service: String(order.service_id),
            link: order.link,
            quantity: String(order.quantity),
        });

        try {
            const addOrderResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
            });
            addOrderResult = await addOrderResponse.json();
        } catch (e) {
            console.error('[FALLBACK RETRY ORDER FETCH ERROR]', e);
            return;
        }
    }

    if (addOrderResult && addOrderResult.order) {
        await dbQuery(
            'UPDATE orders SET status = ?, external_order_id = ? WHERE id = ?',
            ['Processing', String(addOrderResult.order), order.id],
        );
        console.log(`[SMM AUTO RETRY SUCCESS] Order ID ${order.id} sent successfully. External ID: ${addOrderResult.order}`);
        return;
    }

    const isInsufficientBalance = addOrderResult && addOrderResult.error && (typeof addOrderResult.error === 'string') && (
        addOrderResult.error.toLowerCase().includes('insufficient') || 
        addOrderResult.error.toLowerCase().includes('balance') || 
        addOrderResult.error.toLowerCase().includes('not enough funds') || 
        addOrderResult.error.toLowerCase().includes('funds')
    );

    if (isInsufficientBalance) {
        console.log(`[SMM AUTO RETRY HOLD] Order ID ${order.id} still waiting due to insufficient API balance.`);
        return;
    }

    // Lỗi khác không phải do số dư (ví dụ: link lỗi, dịch vụ tắt, ...) -> Hoàn tiền và đánh dấu thất bại
    const errorMsg = (addOrderResult && addOrderResult.error) ? addOrderResult.error : 'Lỗi không xác định';
    console.log(`[SMM AUTO RETRY FAILED] Order ID ${order.id} failed: ${errorMsg}. Refunding user.`);
    await dbQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [order.charge, order.user_id]);
    await dbQuery('UPDATE orders SET status = ? WHERE id = ?', ['Failed', order.id]);
}

module.exports = { placeSmmOrderWithLock, retryPendingSmmOrder };
