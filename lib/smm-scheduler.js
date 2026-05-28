/**
 * SMM background scheduler + schema helpers.
 * - Creates `smm_schedules`, `smm_apis`, `smm_api_logs` tables if missing
 * - Periodically:
 *   + processes due schedules (Asia/Ho_Chi_Minh timezone)
 *   + retries stuck "Pending" SMM orders without external_order_id
 *   + syncs statuses of in-progress SMM orders from Bytemart API
 */

const { placeSmmOrderWithLock, retryPendingSmmOrder } = require('./smm-order');

async function ensurePricingConfigSchema(dbQuery) {
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS \`pricing_config\` (
                \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
                \`role\`            VARCHAR(50) NOT NULL UNIQUE,
                \`markup_percent\`  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
                \`description\`     VARCHAR(255) DEFAULT NULL,
                \`updated_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);

        // Seed defaults if empty
        const rows = await dbQuery('SELECT COUNT(*) as count FROM pricing_config');
        if (rows[0].count === 0) {
            await dbQuery(`
                INSERT INTO pricing_config (role, markup_percent, description) VALUES
                ('member', 50.00, 'Thành viên - Giá chuẩn'),
                ('collaborator', 50.00, 'Cộng tác viên - Đồng giá với Thành viên'),
                ('distributor', 20.00, 'Nhà phân phối - Giá ưu đãi'),
                ('admin', 0.00, 'Quản trị viên - Giá gốc API')
            `);
            console.log('[PRICING CONFIG] Seeded default pricing config successfully.');
        }
    } catch (err) {
        console.error('[PRICING CONFIG SCHEMA ERROR]', err);
    }
}

async function ensureSmmSchedulesSchema(dbQuery) {
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS \`smm_schedules\` (
                \`id\`             INT AUTO_INCREMENT PRIMARY KEY,
                \`user_id\`        INT NOT NULL,
                \`service_id\`     INT NOT NULL,
                \`service_name\`   VARCHAR(255) NOT NULL,
                \`links\`          TEXT NOT NULL COMMENT 'JSON array of links',
                \`quantity\`       INT NOT NULL,
                \`scheduled_time\` DATETIME NOT NULL,
                \`repeat_type\`    ENUM('once', 'daily') NOT NULL DEFAULT 'once',
                \`status\`         ENUM('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
                \`result\`         TEXT DEFAULT NULL,
                \`created_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
                INDEX \`idx_user_schedules\` (\`user_id\`),
                INDEX \`idx_schedule_status\` (\`status\`)
            ) ENGINE=InnoDB;
        `);
    } catch (err) {
        console.error('[SMM SCHEDULER SCHEMA ERROR]', err);
    }
}

async function ensureSmmApisSchema(dbQuery) {
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS \`smm_apis\` (
                \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
                \`name\`            VARCHAR(255) NOT NULL,
                \`provider\`        VARCHAR(100) NOT NULL DEFAULT 'Bytemart',
                \`action_type\`     VARCHAR(100) NOT NULL DEFAULT 'custom',
                \`endpoint\`        TEXT NOT NULL,
                \`method\`          ENUM('GET', 'POST') NOT NULL DEFAULT 'POST',
                \`headers\`         TEXT NULL COMMENT 'JSON key-value',
                \`params\`          TEXT NULL COMMENT 'JSON key-value or raw string',
                \`status_mapping\`  TEXT NULL COMMENT 'JSON key-value mapping from API status to System status',
                \`status\`          ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
                \`created_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX \`idx_action_status\` (\`action_type\`(50), \`status\`)
            ) ENGINE=InnoDB;
        `);

        // Migration query to alter existing table from ENUM to VARCHAR(100)
        try {
            await dbQuery("ALTER TABLE \`smm_apis\` MODIFY COLUMN \`action_type\` VARCHAR(100) NOT NULL DEFAULT 'custom'");
        } catch (alterErr) {
            console.log('[SMM API ALTER TABLE WARNING - MIGHT ALREADY BE VARCHAR]', alterErr.message);
        }

        await dbQuery(`
            CREATE TABLE IF NOT EXISTS \`smm_api_logs\` (
                \`id\`              INT AUTO_INCREMENT PRIMARY KEY,
                \`api_id\`          INT NULL,
                \`api_name\`        VARCHAR(255) NULL,
                \`endpoint\`        TEXT NULL,
                \`method\`          VARCHAR(10) NULL,
                \`request_body\`    TEXT NULL,
                \`response_body\`   TEXT NULL,
                \`http_status\`     INT NULL,
                \`created_at\`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (\`api_id\`) REFERENCES \`smm_apis\`(\`id\`) ON DELETE SET NULL
            ) ENGINE=InnoDB;
        `);

        // Seed default Bytemart SMM APIs if none exists
        const rows = await dbQuery('SELECT COUNT(*) as count FROM smm_apis');
        if (rows[0].count === 0) {
            const defaultApis = [
                {
                    name: 'Bytemart - Lấy danh sách dịch vụ',
                    provider: 'Bytemart',
                    action_type: 'services',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({ key: '20ae9********', action: 'services' }),
                    status_mapping: '{}',
                },
                {
                    name: 'Bytemart - Tạo đơn hàng mới',
                    provider: 'Bytemart',
                    action_type: 'order',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({
                        key: '20ae9********',
                        action: 'add',
                        service: '{{serviceId}}',
                        link: '{{link}}',
                        quantity: '{{quantity}}',
                        comments: '{{comments}}',
                    }),
                    status_mapping: '{}',
                },
                {
                    name: 'Bytemart - Tra cứu trạng thái đơn hàng',
                    provider: 'Bytemart',
                    action_type: 'status',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({
                        key: '20ae9********',
                        action: 'status',
                        orders: '{{orders}}',
                    }),
                    status_mapping: JSON.stringify({
                        Completed: 'Completed',
                        Processing: 'Processing',
                        Pending: 'Pending',
                        'In progress': 'In progress',
                        Canceled: 'Canceled',
                        Partial: 'Partial',
                    }),
                },
                {
                    name: 'Bytemart - Kiểm tra số dư tài khoản',
                    provider: 'Bytemart',
                    action_type: 'balance',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({ key: '20ae9********', action: 'balance' }),
                    status_mapping: '{}',
                },
                {
                    name: 'Bytemart - Yêu cầu hủy đơn hàng',
                    provider: 'Bytemart',
                    action_type: 'cancel',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({
                        key: '20ae9********',
                        action: 'cancel',
                        orders: '{{orders}}',
                    }),
                    status_mapping: JSON.stringify({ 1: 'Canceled' }),
                },
                {
                    name: 'Bytemart - Yêu cầu bảo hành (Refill)',
                    provider: 'Bytemart',
                    action_type: 'refill',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({
                        key: '20ae9********',
                        action: 'refill',
                        order: '{{order}}',
                    }),
                    status_mapping: JSON.stringify({ 1: 'Refilling' }),
                },
                {
                    name: 'Bytemart - Tra cứu trạng thái bảo hành',
                    provider: 'Bytemart',
                    action_type: 'refill_status',
                    endpoint: 'https://smm.bytemart.io.vn/api/v2',
                    method: 'POST',
                    headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    params: JSON.stringify({
                        key: '20ae9********',
                        action: 'refill_status',
                        refills: '{{refills}}',
                    }),
                    status_mapping: JSON.stringify({
                        Completed: 'Completed',
                        Rejected: 'Rejected',
                        Pending: 'Pending',
                    }),
                },
            ];

            for (const api of defaultApis) {
                if (process.env.BYTEMART_API_KEY) {
                    api.params = api.params.replace('20ae9********', process.env.BYTEMART_API_KEY);
                }
                if (process.env.BYTEMART_API_URL) {
                    api.endpoint = process.env.BYTEMART_API_URL;
                }
                await dbQuery(
                    `INSERT INTO smm_apis (name, provider, action_type, endpoint, method, headers, params, status_mapping, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
                    [
                        api.name,
                        api.provider,
                        api.action_type,
                        api.endpoint,
                        api.method,
                        api.headers,
                        api.params,
                        api.status_mapping,
                    ],
                );
            }
            console.log('[SMM API SEED] Seeded default Bytemart SMM APIs successfully.');
        }
    } catch (err) {
        console.error('[SMM APIS SCHEMA/SEED ERROR]', err);
    }
}

function getVNTime(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    return formatter.format(date).replace('T', ' ');
}

let isSchedulerRunning = false;

async function processSchedules(db, dbQuery) {
    if (isSchedulerRunning) return;
    isSchedulerRunning = true;

    try {
        const nowStr = getVNTime();
        const pendingSchedules = await dbQuery(
            `SELECT * FROM smm_schedules
             WHERE status = 'pending' AND scheduled_time <= ?`,
            [nowStr],
        );

        for (const sched of pendingSchedules) {
            await dbQuery('UPDATE smm_schedules SET status = "running" WHERE id = ?', [sched.id]);

            const serviceId = sched.service_id;
            const quantity = sched.quantity;
            const userId = sched.user_id;
            const repeatType = sched.repeat_type;
            const delay = 2; // Default delay 2 seconds

            let links = [];
            try {
                links = JSON.parse(sched.links);
            } catch (e) {
                links = String(sched.links || '')
                    .split(/[\n,]+/)
                    .map((l) => l.trim())
                    .filter(Boolean);
            }

            const results = [];
            let successCount = 0;

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                try {
                    const res = await placeSmmOrderWithLock(db, dbQuery, {
                        userId,
                        serviceId,
                        link,
                        quantity,
                    });
                    if (res.ok) {
                        results.push({ link, success: true, orderId: res.order.id });
                        successCount++;
                    } else {
                        results.push({ link, success: false, error: res.message });
                    }
                } catch (err) {
                    results.push({ link, success: false, error: err.message });
                }

                if (delay > 0 && i < links.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
                }
            }

            const resultSummary = {
                total: links.length,
                success: successCount,
                details: results,
            };

            let finalStatus = 'completed';
            if (successCount === 0) {
                finalStatus = 'failed';
            }

            if (repeatType === 'daily') {
                let nextTime = new Date(sched.scheduled_time);
                const now = new Date();
                while (nextTime <= now) {
                    nextTime.setDate(nextTime.getDate() + 1);
                }
                const nextTimeStr = getVNTime(nextTime);

                await dbQuery(
                    `UPDATE smm_schedules
                     SET status = 'pending', scheduled_time = ?, result = ?
                     WHERE id = ?`,
                    [nextTimeStr, JSON.stringify(resultSummary), sched.id],
                );
            } else {
                await dbQuery(
                    `UPDATE smm_schedules
                     SET status = ?, result = ?
                     WHERE id = ?`,
                    [finalStatus, JSON.stringify(resultSummary), sched.id],
                );
            }
        }
    } catch (err) {
        console.error('[SMM SCHEDULER PROCESS ERROR]', err);
    } finally {
        isSchedulerRunning = false;
    }
}

let isRetryingPendingOrders = false;

async function retryPendingOrders(db, dbQuery) {
    if (isRetryingPendingOrders) return;
    isRetryingPendingOrders = true;

    try {
        const pendingOrders = await dbQuery(
            "SELECT * FROM orders WHERE status = 'Pending' AND external_order_id IS NULL",
        );

        if (pendingOrders.length > 0) {
            console.log(
                `[SMM AUTO RETRY] Phát hiện ${pendingOrders.length} đơn hàng chờ xử lý do số dư nhà cung cấp hết. Đang thử gửi lại...`,
            );
            for (const order of pendingOrders) {
                await retryPendingSmmOrder(db, dbQuery, order);
            }
        }
    } catch (err) {
        console.error('[SMM AUTO RETRY ERROR]', err);
    } finally {
        isRetryingPendingOrders = false;
    }
}

let isSyncingOrderStatuses = false;

async function syncProcessingOrderStatuses(dbQuery) {
    if (isSyncingOrderStatuses) return;
    isSyncingOrderStatuses = true;

    try {
        const activeOrders = await dbQuery(
            `SELECT * FROM orders
             WHERE status IN ('Processing', 'In progress', 'Partial')
             AND external_order_id IS NOT NULL
             AND external_order_id != ''
             LIMIT 200`,
        );

        if (activeOrders.length === 0) return;

        console.log(`[SMM STATUS SYNC] Đang kiểm tra ${activeOrders.length} đơn hàng...`);

        const statusApis = await dbQuery(
            "SELECT * FROM smm_apis WHERE action_type = 'status' AND status = 'Active' LIMIT 1",
        );

        const apiUrl = process.env.BYTEMART_API_URL;
        const apiKey = process.env.BYTEMART_API_KEY;

        const orderIds = activeOrders.map((o) => o.external_order_id).join(',');

        let statusData = null;

        if (statusApis.length) {
            const api = statusApis[0];
            let endpoint = api.endpoint;
            const method = api.method || 'POST';
            let headers = {};
            try {
                headers = JSON.parse(api.headers || '{}');
            } catch (e) {
                headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            }

            let rawParams = api.params || '';
            rawParams = rawParams.replace(/{{\s*orders?\s*}}/g, orderIds);
            endpoint = endpoint.replace(/{{\s*orders?\s*}}/g, orderIds);

            const fetchOptions = { method, headers };
            const isJson = Object.keys(headers).some(
                (k) => k.toLowerCase() === 'content-type' && headers[k].toLowerCase().includes('json'),
            );

            if (method === 'POST') {
                if (isJson) {
                    fetchOptions.body = rawParams;
                } else {
                    let paramsObj = {};
                    try {
                        paramsObj = JSON.parse(rawParams);
                    } catch (e) {
                        try {
                            paramsObj = Object.fromEntries(new URLSearchParams(rawParams).entries());
                        } catch (_) {
                            paramsObj = {};
                        }
                    }
                    fetchOptions.body =
                        Object.keys(paramsObj).length > 0 ? new URLSearchParams(paramsObj) : rawParams;
                }
            } else {
                let paramsObj = {};
                try {
                    paramsObj = JSON.parse(rawParams);
                } catch (e) {
                    paramsObj = {};
                }
                if (Object.keys(paramsObj).length > 0) {
                    endpoint +=
                        (endpoint.includes('?') ? '&' : '?') + new URLSearchParams(paramsObj).toString();
                }
            }

            try {
                const res = await fetch(endpoint, fetchOptions);
                const text = await res.text();
                statusData = JSON.parse(text);

                await dbQuery(
                    `INSERT INTO smm_api_logs (api_id, api_name, endpoint, method, request_body, response_body, http_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [api.id, `${api.name} (SYNC)`, endpoint, method, orderIds, text.slice(0, 5000), res.status],
                ).catch(() => {});
            } catch (e) {
                console.error('[SMM STATUS SYNC GATEWAY ERROR]', e);
            }
        }

        if (!statusData && apiUrl && apiKey) {
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: apiKey, action: 'status', orders: orderIds }),
                });
                const text = await res.text();
                statusData = JSON.parse(text);
            } catch (e) {
                console.error('[SMM STATUS SYNC FALLBACK ERROR]', e);
            }
        }

        if (!statusData || typeof statusData !== 'object') {
            console.warn('[SMM STATUS SYNC] Không nhận được dữ liệu status hợp lệ.');
            return;
        }

        let statusMapping = null;
        if (statusApis.length && statusApis[0].status_mapping) {
            try {
                statusMapping = JSON.parse(statusApis[0].status_mapping);
            } catch (e) {
                statusMapping = null;
            }
        }

        const mapStatus = (rawStatus) => {
            if (!rawStatus) return null;
            if (statusMapping) {
                const key = Object.keys(statusMapping).find(
                    (k) => k.toLowerCase() === String(rawStatus).toLowerCase(),
                );
                if (key) return statusMapping[key];
            }
            const s = String(rawStatus).toLowerCase();
            if (s === 'completed') return 'Completed';
            if (s === 'partial') return 'Partial';
            if (s === 'canceled' || s === 'cancelled') return 'Canceled';
            if (s === 'processing' || s === 'in progress') return 'Processing';
            if (s === 'pending') return 'Pending';
            return rawStatus;
        };

        for (const order of activeOrders) {
            const extId = String(order.external_order_id);
            const apiInfo = statusData[extId];

            if (!apiInfo || apiInfo.error) {
                if (apiInfo && apiInfo.error) {
                    console.warn(
                        `[SMM STATUS SYNC] Đơn ${extId} lỗi từ API: ${apiInfo.error}`,
                    );
                }
                continue;
            }

            const newStatus = mapStatus(apiInfo.status);
            if (!newStatus || newStatus === order.status) continue;

            await dbQuery(
                `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
                [newStatus, order.id],
            );

            console.log(
                `[SMM STATUS SYNC] Đơn #${order.id} (ext: ${extId}): ${order.status} → ${newStatus}`,
            );
        }

        console.log(`[SMM STATUS SYNC] Hoàn tất đồng bộ ${activeOrders.length} đơn.`);
    } catch (err) {
        console.error('[SMM STATUS SYNC ERROR]', err);
    } finally {
        isSyncingOrderStatuses = false;
    }
}

function startSmmScheduler(db, dbQuery) {
    ensureSmmSchedulesSchema(dbQuery);
    ensureSmmApisSchema(dbQuery);
    ensurePricingConfigSchema(dbQuery);

    processSchedules(db, dbQuery).catch((err) =>
        console.error('[SCHEDULER RUN ERROR]', err),
    );
    retryPendingOrders(db, dbQuery).catch((err) =>
        console.error('[RETRY RUN ERROR]', err),
    );
    syncProcessingOrderStatuses(dbQuery).catch((err) =>
        console.error('[STATUS SYNC RUN ERROR]', err),
    );

    setInterval(() => {
        processSchedules(db, dbQuery).catch((err) =>
            console.error('[SCHEDULER INTERVAL ERROR]', err),
        );
        retryPendingOrders(db, dbQuery).catch((err) =>
            console.error('[RETRY INTERVAL ERROR]', err),
        );
    }, 30000);

    setInterval(() => {
        syncProcessingOrderStatuses(dbQuery).catch((err) =>
            console.error('[STATUS SYNC INTERVAL ERROR]', err),
        );
    }, 2 * 60 * 1000);
}

module.exports = {
    ensureSmmSchedulesSchema,
    ensureSmmApisSchema,
    ensurePricingConfigSchema,
    startSmmScheduler,
    processSchedules,
    retryPendingOrders,
    syncProcessingOrderStatuses,
};

