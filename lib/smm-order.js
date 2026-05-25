/**
 * Đặt đơn SMM có khóa balance — chống quantity âm và race condition.
 */
async function placeSmmOrderWithLock(db, dbQuery, { userId, serviceId, link, quantity }) {
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, status: 400, message: 'Số lượng phải là số nguyên dương.' };
    }

    const apiUrl = process.env.BYTEMART_API_URL;
    const apiKey = process.env.BYTEMART_API_KEY;
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

    const servicesData = await getServicesResponse.json();
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

    const baseCost = parseFloat(service.rate) || 0;
    const profitPercent = parseFloat(process.env.SMM_PROFIT_PERCENT) || 0;
    const rateWithProfit = Math.ceil(baseCost * (1 + profitPercent / 100));
    const chargedPrice = (qty / 1000) * rateWithProfit;

    if (chargedPrice <= 0 || !Number.isFinite(chargedPrice)) {
        return { ok: false, status: 400, message: 'Giá đơn hàng không hợp lệ.' };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [userRows] = await conn.execute(
            'SELECT id, email, balance FROM users WHERE id = ? FOR UPDATE',
            [userId],
        );
        if (!userRows.length) {
            await conn.rollback();
            return { ok: false, status: 404, message: 'Không tìm thấy user.' };
        }

        const user = userRows[0];
        const userBalance = parseFloat(user.balance);
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

        const addOrderResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                key: apiKey,
                action: 'add',
                service: serviceId,
                link,
                quantity: String(qty),
            }),
        });
        const addOrderResult = await addOrderResponse.json();

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

        await dbQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [chargedPrice, userId]);
        await dbQuery('UPDATE orders SET status = ? WHERE id = ?', ['Failed', orderId]);
        return {
            ok: false,
            status: 400,
            message: addOrderResult.error || 'Lỗi khi xử lý đơn hàng tại Bytemart',
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

module.exports = { placeSmmOrderWithLock };
