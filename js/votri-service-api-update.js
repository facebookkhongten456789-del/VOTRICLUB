// Admin SMM Provider API Gateway Control Panel JS
(function () {
    // App elements cache (let variables to assign when init)
    let apiListTbody, testApiSelect, testApiParams, testTerminalPre, testInfoElement, logsContainer;
    
    let allApisList = [];
    let activeTestResponseRaw = '';
    let activeLegacyResponseRaw = '';
    let pricingConfigData = [];
    let pricingPreviewServices = [];
    let selectedPricingServiceId = '';
    let initialized = false;

    // ==========================================
    // UTILITIES & AUTH HEADERS
    // ==========================================
    function app() {
        return window.VotriApp || {};
    }

    function esc(s) {
        const fn = app().escapeHTML;
        return fn ? fn(s) : String(s ?? '');
    }

    function toast(msg, type) {
        if (app().showToast) {
            app().showToast(msg, type || 'info');
        } else {
            alert(msg);
        }
    }

    function sanitizeServiceLabel(raw) {
        // Keep readable text only: remove control chars and collapse spaces/newlines.
        return String(raw ?? '')
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getAuthHeaders() {
        const token = app().getSessionToken?.() || sessionStorage.getItem('votri_sys_token');
        if (!token) {
            toast('Vui lòng đăng nhập để tiếp tục.', 'error');
            return null;
        }
        return app().authHeaders ? app().authHeaders() : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        };
    }

    // ==========================================
    // INITIALIZATION & EVENT BINDINGS
    // ==========================================
    function init() {
        if (initialized) return;
        initialized = true;

        // Elements caching
        const navTabButtons = document.querySelectorAll('.smm-nav-tabs button');
        const tabContents = document.querySelectorAll('.smm-tab-content');
        
        apiListTbody = document.getElementById('smm-api-list-tbody');
        testApiSelect = document.getElementById('test-api-select');
        testApiParams = document.getElementById('test-api-params');
        testTerminalPre = document.getElementById('smm-test-terminal-pre');
        testInfoElement = document.getElementById('smm-test-info');
        logsContainer = document.getElementById('smm-logs-container');

        // ==========================================
        // NAV TABS SWITCHING
        // ==========================================
        navTabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                
                navTabButtons.forEach(b => b.classList.remove('active-tab-btn'));
                btn.classList.add('active-tab-btn');

                tabContents.forEach(content => {
                    if (content.id === `smm-tab-${targetTab}`) {
                        content.classList.remove('hidden');
                    } else {
                        content.classList.add('hidden');
                    }
                });

                if (targetTab === 'list') {
                    fetchSmmApis();
                } else if (targetTab === 'test') {
                    fetchSmmApisForTest();
                    fetchSmmApiLogs();
                } else if (targetTab === 'pricing') {
                    fetchPricingConfig();
                }
            });
        });

        // Test API selection change
        if (testApiSelect) {
            testApiSelect.addEventListener('change', () => {
                const selectedId = testApiSelect.value;
                const api = allApisList.find(a => String(a.id) === String(selectedId));
                if (api && testApiParams) {
                    testApiParams.value = api.params;
                }
            });
        }

        // Run Test API Listener
        const btnRunTest = document.getElementById('btn-smm-run-test');
        if (btnRunTest) {
            btnRunTest.addEventListener('click', async () => {
                const apiId = testApiSelect.value;
                if (!apiId) return toast('Vui lòng chọn cấu hình API cần test.', 'error');

                const headers = getAuthHeaders();
                if (!headers) return;

                const customParams = testApiParams.value.trim();

                if (testTerminalPre) {
                    testTerminalPre.style.color = '#39ff14';
                    testTerminalPre.textContent = `[GATEWAY TEST CLI] Đang gửi yêu cầu test đến API Gateway...\nĐang kết nối đến API gốc...\n\nRequest params:\n${customParams}`;
                }
                if (testInfoElement) testInfoElement.textContent = 'Đang gọi test API...';

                try {
                    const res = await fetch(`${app().API_BASE}/api/smm/admin/apis/${apiId}/test`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ customParams })
                    });
                    const result = await res.json();

                    if (testTerminalPre) {
                        if (result.success) {
                            testTerminalPre.style.color = '#39ff14';
                            testTerminalPre.textContent = `[SUCCESS] ${result.message}\nHTTP Status: ${result.httpStatus} | Duration: ${result.duration}\nEndpoint: [${result.method}] ${result.endpoint}\n\n[RESPONSE RAW JSON]:\n${JSON.stringify(result.response, null, 2)}`;
                            activeTestResponseRaw = JSON.stringify(result.response, null, 2);
                            if (testInfoElement) testInfoElement.textContent = `Thành công lúc ${new Date().toLocaleTimeString('vi-VN')}`;
                            toast('Test API hoàn tất!', 'success');
                        } else {
                            testTerminalPre.style.color = 'var(--neon-red)';
                            testTerminalPre.textContent = `[ERROR] Gọi API thất bại!\n\n${result.message || 'Lỗi không xác định'}\n\nResponse:\n${JSON.stringify(result, null, 2)}`;
                            activeTestResponseRaw = JSON.stringify(result, null, 2);
                            if (testInfoElement) testInfoElement.textContent = 'Test API thất bại!';
                            toast('Test API thất bại.', 'error');
                        }
                    }
                    
                    fetchSmmApiLogs(); 
                } catch (err) {
                    console.error(err);
                    if (testTerminalPre) {
                        testTerminalPre.style.color = 'var(--neon-red)';
                        testTerminalPre.textContent = `[GATEWAY NETWORK ERROR] Không thể kết nối đến Gateway:\n${err.message}`;
                    }
                    if (testInfoElement) testInfoElement.textContent = 'Lỗi kết nối mạng';
                    toast('Lỗi kết nối mạng.', 'error');
                }
            });
        }

        const btnRefreshLogs = document.getElementById('btn-refresh-smm-logs');
        if (btnRefreshLogs) {
            btnRefreshLogs.addEventListener('click', () => fetchSmmApiLogs());
        }

        const btnCopyTest = document.getElementById('btn-smm-copy-test-res');
        if (btnCopyTest) {
            btnCopyTest.addEventListener('click', () => {
                if (!activeTestResponseRaw) return toast('Không có dữ liệu để sao chép.', 'error');
                navigator.clipboard.writeText(activeTestResponseRaw)
                    .then(() => toast('Đã sao chép phản hồi vào clipboard.', 'success'))
                    .catch(() => toast('Không thể sao chép.', 'error'));
            });
        }

        // ==========================================
        // TAB 3: LEGACY RAPID ACTIONS BINDINGS
        // ==========================================
        const tabsLegacy = document.querySelectorAll('.smm-admin-tabs button');
        const panelsLegacy = document.querySelectorAll('.smm-admin-form-panel');

        tabsLegacy.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetAction = tab.getAttribute('data-action');
                
                tabsLegacy.forEach(t => t.classList.remove('active-tab-btn'));
                tab.classList.add('active-tab-btn');

                panelsLegacy.forEach(panel => {
                    if (panel.id === `smm-form-${targetAction}`) {
                        panel.classList.remove('hidden');
                    } else {
                        panel.classList.add('hidden');
                    }
                });
            });
        });

        // 1. Bind Services Button
        const btnServices = document.getElementById('btn-smm-admin-services');
        if (btnServices) {
            btnServices.addEventListener('click', () => {
                runApiRequestLegacy('services', {}, 'Lấy danh sách dịch vụ');
            });
        }

        // 2. Bind Order Status Button
        const btnOrderStatus = document.getElementById('btn-smm-admin-order-status');
        if (btnOrderStatus) {
            btnOrderStatus.addEventListener('click', () => {
                const order = document.getElementById('smm-status-order-id')?.value?.trim();
                if (!order) {
                    return toast('Vui lòng nhập Mã Đơn Hàng.', 'error');
                }
                runApiRequestLegacy('order-status', { order }, 'Kiểm tra trạng thái đơn');
            });
        }

        // 3. Bind Multiple Orders Status Button
        const btnMultiOrdersStatus = document.getElementById('btn-smm-admin-multiple-orders-status');
        if (btnMultiOrdersStatus) {
            btnMultiOrdersStatus.addEventListener('click', () => {
                const orders = document.getElementById('smm-status-multiple-order-ids')?.value?.trim();
                if (!orders) {
                    return toast('Vui lòng nhập danh sách mã đơn.', 'error');
                }
                runApiRequestLegacy('multiple-orders-status', { orders }, 'Kiểm tra trạng thái hàng loạt');
            });
        }

        // 4. Bind Cancel Button Legacy (create_cancel)
        const btnCancel = document.getElementById('btn-smm-admin-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                const ordersVal = document.getElementById('smm-cancel-orders')?.value?.trim();
                if (!ordersVal) {
                    return toast('Vui lòng nhập danh sách mã đơn hàng.', 'error');
                }
                runApiRequestLegacy('cancel', { orders: ordersVal }, 'Hủy đơn hàng loạt');
            });
        }

        // 5. Bind Balance Button Legacy (balance)
        const btnBalance = document.getElementById('btn-smm-admin-balance');
        if (btnBalance) {
            btnBalance.addEventListener('click', () => {
                runApiRequestLegacy('balance', {}, 'Kiểm tra số dư');
            });
        }

        // 6. Bind Refill Button Legacy (create_refill)
        const btnRefill = document.getElementById('btn-smm-admin-refill');
        if (btnRefill) {
            btnRefill.addEventListener('click', () => {
                const ordersVal = document.getElementById('smm-refill-orders')?.value?.trim();
                if (!ordersVal) {
                    return toast('Vui lòng nhập danh sách mã đơn hàng.', 'error');
                }
                runApiRequestLegacy('refill', { orders: ordersVal }, 'Yêu cầu bảo hành (Refill)');
            });
        }

        // 7. Bind Create Multiple Refill Button
        const btnCreateMultiRefill = document.getElementById('btn-smm-admin-create-multiple-refill');
        if (btnCreateMultiRefill) {
            btnCreateMultiRefill.addEventListener('click', () => {
                const orders = document.getElementById('smm-multiple-refill-orders')?.value?.trim();
                if (!orders) {
                    return toast('Vui lòng nhập danh sách mã đơn.', 'error');
                }
                runApiRequestLegacy('create-multiple-refill', { orders }, 'Yêu cầu bảo hành hàng loạt');
            });
        }

        // 8. Bind Refill Status Button Legacy (refill_status)
        const btnRefillStatusLegacy = document.getElementById('btn-smm-admin-refill-status');
        if (btnRefillStatusLegacy) {
            btnRefillStatusLegacy.addEventListener('click', () => {
                const idsVal = document.getElementById('smm-refill-status-ids-legacy')?.value?.trim();
                if (!idsVal) {
                    return toast('Vui lòng nhập mã bảo hành (Refill ID).', 'error');
                }
                runApiRequestLegacy('refill-status', { refills: idsVal }, 'Kiểm tra trạng thái bảo hành');
            });
        }

        // 9. Bind Multiple Refill Status Button
        const btnMultiRefillStatus = document.getElementById('btn-smm-admin-multiple-refill-status');
        if (btnMultiRefillStatus) {
            btnMultiRefillStatus.addEventListener('click', () => {
                const refills = document.getElementById('smm-multiple-refill-status-ids')?.value?.trim();
                if (!refills) {
                    return toast('Vui lòng nhập danh sách mã bảo hành.', 'error');
                }
                runApiRequestLegacy('multiple-refill-status', { refills }, 'Kiểm tra trạng thái bảo hành hàng loạt');
            });
        }

        // Copy button action legacy
        const btnCopyLegacy = document.getElementById('btn-smm-admin-copy-response');
        if (btnCopyLegacy) {
            btnCopyLegacy.addEventListener('click', () => {
                if (!activeLegacyResponseRaw) return toast('Không có dữ liệu để sao chép.', 'error');
                navigator.clipboard.writeText(activeLegacyResponseRaw)
                    .then(() => toast('Đã sao chép phản hồi vào clipboard.', 'success'))
                    .catch(() => toast('Không thể sao chép.', 'error'));
            });
        }

        // ==========================================
        // TAB 4: PRICING CONFIG BINDINGS
        // ==========================================
        const btnSavePricing = document.getElementById('btn-save-pricing-config');
        if (btnSavePricing) {
            btnSavePricing.addEventListener('click', savePricingConfig);
        }

        const previewRateInput = document.getElementById('pricing-preview-rate');
        if (previewRateInput) previewRateInput.setAttribute('readonly', 'readonly');

        bindPricingServicePickerEvents();
    }

    // ==========================================
    // TAB 1 CORE LOGIC - CRUD SMM APIS
    // ==========================================
    async function fetchSmmApis() {
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/apis`, { headers });
            const result = await res.json();
            
            if (res.ok && result.success) {
                allApisList = result.apis || [];
                renderApiList(allApisList);
            } else {
                toast(result.message || 'Lỗi lấy cấu hình API.', 'error');
            }
        } catch (err) {
            console.error(err);
            toast('Lỗi mạng không thể tải danh sách API.', 'error');
        }
    }

    function renderApiList(apis) {
        if (!apiListTbody) return;

        if (apis.length === 0) {
            apiListTbody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">
                        Chưa cấu hình API động nào.
                    </td>
                </tr>
            `;
            return;
        }

        apiListTbody.innerHTML = apis.map(api => {
            const statusBadge = api.status === 'Active' 
                ? `<span class="api-status-badge api-status-active">Active</span>`
                : `<span class="api-status-badge api-status-inactive">Inactive</span>`;
            
            const methodBadge = `<span class="api-method-badge method-${api.method.toLowerCase()}">${api.method}</span>`;

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); hover:background: rgba(255,255,255,0.02)">
                    <td style="padding: 12px 8px; font-weight: 600;">
                        <div>${api.name}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${api.provider || 'Bytemart'}</div>
                    </td>
                    <td style="padding: 12px 8px; font-family: monospace; color: var(--theme-color); font-weight: 700;">
                        ${api.action_type}
                    </td>
                    <td style="padding: 12px 8px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; color: var(--text-muted);">
                        ${api.endpoint}
                    </td>
                    <td style="padding: 12px 8px;">
                        ${methodBadge}
                    </td>
                    <td style="padding: 12px 8px;">
                        ${statusBadge}
                    </td>
                    <td style="padding: 12px 8px; text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="btn btn-secondary btn-smm-toggle" data-id="${api.id}" style="padding: 4px 8px; font-size: 11px; height: 26px;">
                            ${api.status === 'Active' ? 'Tắt' : 'Bật'}
                        </button>
                        <button class="btn btn-secondary btn-smm-delete" data-id="${api.id}" style="padding: 4px 8px; font-size: 11px; height: 26px; border-color: var(--neon-red); color: var(--neon-red);">
                            Xóa
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Bind Actions
        document.querySelectorAll('.btn-smm-toggle').forEach(btn => {
            btn.addEventListener('click', () => toggleApiStatus(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.btn-smm-delete').forEach(btn => {
            btn.addEventListener('click', () => deleteApiConfig(btn.getAttribute('data-id')));
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    async function toggleApiStatus(id) {
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/apis/${id}/toggle`, {
                method: 'POST',
                headers
            });
            const result = await res.json();
            if (res.ok && result.success) {
                toast(result.message, 'success');
                fetchSmmApis();
            } else {
                toast(result.message || 'Không thể đổi trạng thái.', 'error');
            }
        } catch (err) {
            console.error(err);
            toast('Lỗi kết nối mạng.', 'error');
        }
    }

    async function deleteApiConfig(id) {
        if (!confirm('Bạn có chắc chắn muốn xóa cấu hình API này? Thao tác này không thể hoàn tác.')) return;
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/apis/${id}`, {
                method: 'DELETE',
                headers
            });
            const result = await res.json();
            if (res.ok && result.success) {
                toast(result.message, 'success');
                fetchSmmApis();
            } else {
                toast(result.message || 'Không thể xóa cấu hình API.', 'error');
            }
        } catch (err) {
            console.error(err);
            toast('Lỗi kết nối mạng.', 'error');
        }
    }

    // ==========================================
    // TAB 2 CORE LOGIC - TEST GATEWAY & LOGS
    // ==========================================
    async function fetchSmmApisForTest() {
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/apis`, { headers });
            const result = await res.json();
            if (res.ok && result.success) {
                const apis = result.apis || [];
                allApisList = apis;
                
                if (testApiSelect) {
                    testApiSelect.innerHTML = apis.map(api => 
                        `<option value="${api.id}">[${api.action_type.toUpperCase()}] ${api.name}</option>`
                    ).join('');
                    
                    if (apis.length > 0) {
                        testApiParams.value = apis[0].params;
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function fetchSmmApiLogs() {
        if (!logsContainer) return;
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/apis/logs`, { headers });
            const result = await res.json();
            if (res.ok && result.success) {
                const logs = result.logs || [];
                if (logs.length === 0) {
                    logsContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">Chưa có lịch sử cuộc gọi nào.</div>`;
                    return;
                }

                logsContainer.innerHTML = logs.map(log => {
                    const isSuccess = log.http_status >= 200 && log.http_status < 300;
                    const statusColor = isSuccess ? '#39ff14' : 'var(--neon-red)';
                    
                    return `
                        <div class="smm-log-item" data-log-id="${log.id}">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                                <span style="font-weight: 700; color: var(--theme-color);">[${log.method}] ${log.api_name}</span>
                                <span style="color: ${statusColor}; font-weight: 800;">${log.http_status}</span>
                            </div>
                            <div style="font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${log.endpoint}
                            </div>
                        </div>
                    `;
                }).join('');

                // Bind Log Click to display response on Terminal
                document.querySelectorAll('.smm-log-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const logId = item.getAttribute('data-log-id');
                        const log = logs.find(l => String(l.id) === String(logId));
                        if (log && testTerminalPre) {
                            testTerminalPre.style.color = log.http_status >= 200 && log.http_status < 300 ? '#39ff14' : 'var(--neon-red)';
                            testTerminalPre.textContent = `[HISTORY DEBUGR CLI] Chi tiết cuộc gọi ngày ${log.created_at}\nEndpoint: [${log.method}] ${log.endpoint}\nHTTP Status: ${log.http_status}\n\n[REQUEST PARAMS]:\n${log.request_body}\n\n[RESPONSE RAW]:\n${log.response_body}`;
                            activeTestResponseRaw = log.response_body;
                            if (testInfoElement) testInfoElement.textContent = `Đang xem log cuộc gọi #${log.id}`;
                        }
                    });
                });
            }
        } catch (err) {
            console.error(err);
        }
    }

    // ==========================================
    // TAB 3 CORE LOGIC - LEGACY RAPID ACTIONS
    // ==========================================
    const preElement = () => document.getElementById('smm-admin-response-pre');
    const infoElement = () => document.getElementById('smm-admin-log-info');

    function logToTerminalLegacy(message, isError = false) {
        const pre = preElement();
        if (!pre) return;
        pre.style.color = isError ? 'var(--neon-red)' : '#39ff14';
        pre.textContent = message;
        activeLegacyResponseRaw = message;
    }

    function setLogInfoLegacy(info) {
        const infoEl = infoElement();
        if (infoEl) {
            infoEl.textContent = info;
        }
    }

    async function runApiRequestLegacy(endpoint, payload, actionName) {
        const headers = getAuthHeaders();
        if (!headers) return;

        const providerSelect = document.getElementById('smm-rapid-provider-select');
        if (providerSelect && providerSelect.value) {
            payload.provider = providerSelect.value;
        }

        logToTerminalLegacy(`[API CLI] Gửi yêu cầu ${actionName}...\nĐang kết nối đến server qua API Gateway...`);
        setLogInfoLegacy(`Đang thực thi ${actionName}...`);

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/${endpoint}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            
            if (res.ok && result.success) {
                const data = result.data;
                let hasRealError = false;
                let errMessage = '';
                
                if (endpoint === 'cancel') {
                    if (data && typeof data === 'object' && data.error) {
                        hasRealError = true;
                        errMessage = data.error;
                    } else if (Array.isArray(data)) {
                        const fails = data.filter(item => {
                            if (item.cancel && typeof item.cancel === 'object' && item.cancel.error) return true;
                            if (typeof item.cancel === 'string' && !['1', 'true', 'success'].includes(item.cancel)) return true;
                            return false;
                        });
                        if (fails.length === data.length) {
                            hasRealError = true;
                            errMessage = fails.map(f => {
                                const errStr = typeof f.cancel === 'object' ? f.cancel.error : (f.cancel || 'Không thể hủy');
                                return `Đơn ${f.order}: ${errStr}`;
                            }).join(', ');
                        } else if (fails.length > 0) {
                            errMessage = `Hủy thành công ${data.length - fails.length} đơn. Lỗi ${fails.length} đơn (${fails.map(f => {
                                const errStr = typeof f.cancel === 'object' ? f.cancel.error : (f.cancel || 'Không thể hủy');
                                return `Đơn ${f.order}: ${errStr}`;
                            }).join(', ')})`;
                        }
                    } else if (data && typeof data === 'object') {
                        if (data.cancel && typeof data.cancel === 'object' && data.cancel.error) {
                            hasRealError = true;
                            errMessage = data.cancel.error;
                        } else if (typeof data.cancel === 'string' && !['1', 'true', 'success'].includes(data.cancel)) {
                            hasRealError = true;
                            errMessage = data.cancel;
                        }
                    }
                } else if (endpoint === 'refill' || endpoint === 'create-multiple-refill') {
                    if (data && typeof data === 'object' && data.error) {
                        hasRealError = true;
                        errMessage = data.error;
                    } else if (Array.isArray(data)) {
                        const fails = data.filter(item => {
                            if (item.refill && typeof item.refill === 'object' && item.refill.error) return true;
                            if (typeof item.refill === 'string' && !/^\d+$/.test(item.refill) && !['1', 'true', 'success'].includes(item.refill)) return true;
                            return false;
                        });
                        if (fails.length === data.length) {
                            hasRealError = true;
                            errMessage = fails.map(f => {
                                const errStr = typeof f.refill === 'object' ? f.refill.error : (f.refill || 'Từ chối bảo hành');
                                return `Đơn ${f.order}: ${errStr}`;
                            }).join(', ');
                        } else if (fails.length > 0) {
                            errMessage = `Bảo hành thành công ${data.length - fails.length} đơn. Lỗi ${fails.length} đơn (${fails.map(f => {
                                const errStr = typeof f.refill === 'object' ? f.refill.error : (f.refill || 'Từ chối bảo hành');
                                return `Đơn ${f.order}: ${errStr}`;
                            }).join(', ')})`;
                        }
                    } else if (data && typeof data === 'object') {
                        if (data.refill && typeof data.refill === 'object' && data.refill.error) {
                            hasRealError = true;
                            errMessage = data.refill.error;
                        } else if (typeof data.refill === 'string' && !/^\d+$/.test(data.refill) && !['1', 'true', 'success'].includes(data.refill)) {
                            hasRealError = true;
                            errMessage = data.refill;
                        }
                    }
                } else if (endpoint === 'refill-status' || endpoint === 'multiple-refill-status') {
                    if (data && typeof data === 'object' && data.error) {
                        hasRealError = true;
                        errMessage = data.error;
                    } else if (Array.isArray(data)) {
                        const fails = data.filter(item => {
                            if (item.status && typeof item.status === 'object' && item.status.error) return true;
                            if (typeof item.status === 'string') {
                                const lowercaseStatus = item.status.toLowerCase();
                                return lowercaseStatus.includes('error') || lowercaseStatus.includes('incorrect') || lowercaseStatus.includes('fail') || lowercaseStatus.includes('invalid');
                            }
                            return false;
                        });
                        if (fails.length === data.length) {
                            hasRealError = true;
                            errMessage = fails.map(f => {
                                const errStr = typeof f.status === 'object' ? f.status.error : f.status;
                                return `Refill ${f.refill}: ${errStr}`;
                            }).join(', ');
                        } else if (fails.length > 0) {
                            errMessage = `Kiểm tra xong ${data.length - fails.length} đơn. Lỗi ${fails.length} đơn (${fails.map(f => {
                                const errStr = typeof f.status === 'object' ? f.status.error : f.status;
                                return `Refill ${f.refill}: ${errStr}`;
                            }).join(', ')})`;
                        }
                    } else if (data && typeof data === 'object') {
                        if (data.status && typeof data.status === 'object' && data.status.error) {
                            hasRealError = true;
                            errMessage = data.status.error;
                        } else if (typeof data.status === 'string') {
                            const lowercaseStatus = data.status.toLowerCase();
                            if (lowercaseStatus.includes('error') || lowercaseStatus.includes('incorrect') || lowercaseStatus.includes('fail') || lowercaseStatus.includes('invalid')) {
                                hasRealError = true;
                                errMessage = data.status;
                            }
                        }
                    }
                } else if (endpoint === 'add-order' || endpoint === 'order-status' || endpoint === 'balance') {
                    if (data && typeof data === 'object' && data.error) {
                        hasRealError = true;
                        errMessage = data.error;
                    }
                } else if (endpoint === 'multiple-orders-status') {
                    if (data && typeof data === 'object' && data.error) {
                        hasRealError = true;
                        errMessage = data.error;
                    } else if (data && typeof data === 'object') {
                        const entries = Object.entries(data);
                        if (entries.length > 0) {
                            const fails = entries.filter(([id, val]) => val && (val.error || (typeof val === 'string' && val.toLowerCase().includes('error'))));
                            if (fails.length === entries.length) {
                                hasRealError = true;
                                errMessage = fails.map(([id, val]) => {
                                    const errStr = typeof val === 'object' ? val.error : val;
                                    return `Đơn ${id}: ${errStr}`;
                                }).join(', ');
                            } else if (fails.length > 0) {
                                errMessage = `Tra cứu xong ${entries.length - fails.length} đơn. Lỗi ${fails.length} đơn (${fails.map(([id, val]) => {
                                    const errStr = typeof val === 'object' ? val.error : val;
                                    return `Đơn ${id}: ${errStr}`;
                                }).join(', ')})`;
                            }
                        }
                    }
                }

                if (hasRealError) {
                    logToTerminalLegacy(`[ERROR] API gốc báo lỗi:\n${errMessage}\n\nChi tiết phản hồi:\n${JSON.stringify(result, null, 2)}`, true);
                    setLogInfoLegacy(`Lỗi khi thực thi ${actionName}`);
                    toast(errMessage || `${actionName} thất bại.`, 'error');
                } else {
                    logToTerminalLegacy(JSON.stringify(result.data, null, 2));
                    setLogInfoLegacy(`Thực thi thành công lúc ${new Date().toLocaleTimeString('vi-VN')}`);
                    if (errMessage) {
                        toast(errMessage, 'warning');
                    } else {
                        toast(`${actionName} thành công!`, 'success');
                    }
                }
            } else {
                logToTerminalLegacy(`[ERROR] ${result.message || 'Lỗi không xác định từ API'}\n\nChi tiết phản hồi:\n${JSON.stringify(result, null, 2)}`, true);
                setLogInfoLegacy(`Lỗi khi thực thi ${actionName}`);
                toast(result.message || `${actionName} thất bại.`, 'error');
            }
        } catch (err) {
            console.error(err);
            logToTerminalLegacy(`[CONNECTION ERROR] Không thể kết nối đến server:\n${err.message}`, true);
            setLogInfoLegacy(`Lỗi mạng/kết nối`);
            toast('Lỗi kết nối đến server.', 'error');
        }
    }

    // ==========================================
    // TAB 4: PRICING CONFIG MANAGEMENT
    // ==========================================
    const ROLE_META = {
        member: { label: 'Thành viên', icon: 'user', color: '#a0aec0', glow: 'rgba(160, 174, 192, 0.2)' },
        collaborator: { label: 'Cộng tác viên', icon: 'sparkles', color: '#00f0ff', glow: 'rgba(0, 240, 255, 0.3)' },
        distributor: { label: 'Nhà phân phối', icon: 'crown', color: '#ffd700', glow: 'rgba(255, 215, 0, 0.3)' },
        admin: { label: 'Quản trị viên', icon: 'shield', color: '#bd00ff', glow: 'rgba(189, 0, 255, 0.3)' },
    };

    async function fetchPricingConfig() {
        const headers = getAuthHeaders();
        if (!headers) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/admin/pricing`, { headers });
            const result = await res.json();
            if (res.ok && result.success) {
                pricingConfigData = result.pricing || [];
                renderPricingCards(pricingConfigData);
                await fetchPricingPreviewServices();
                updatePricingPreview();
            } else {
                toast(result.message || 'Lỗi lấy cấu hình giá.', 'error');
            }
        } catch (err) {
            console.error(err);
            toast('Lỗi mạng khi tải cấu hình giá.', 'error');
        }
    }

    function renderPricingCards(configs) {
        const container = document.getElementById('pricing-config-cards');
        if (!container) return;

        if (!configs.length) {
            container.innerHTML = `
                <div class="pricing-card" style="padding: 40px; text-align: center; grid-column: 1 / -1; --role-color: var(--theme-color); --role-glow: var(--theme-color-glow);">
                    <div class="text-dim">Chưa có cấu hình giá. Hãy khởi động lại server.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = configs.map(cfg => {
            const meta = ROLE_META[cfg.role] || { label: cfg.role, icon: 'circle', color: '#888', glow: 'rgba(136, 136, 136, 0.2)' };
            const markupPercent = parseFloat(cfg.markup_percent) || 0;
            return `
                <div class="pricing-card" style="--role-color: ${meta.color}; --role-glow: ${meta.glow};">
                    <div style="position: absolute; right: -8px; top: -12px; font-size: 3.5rem; opacity: 0.05; font-weight: 800; color: ${meta.color}; pointer-events: none; font-family: var(--font-mono); text-transform: uppercase;">${meta.label.charAt(0)}</div>
                    
                    <!-- Header with Icon & Role Label -->
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: ${meta.color}15; padding: 10px; border-radius: 10px; display: flex; border: 1px solid ${meta.color}25; box-shadow: 0 0 10px ${meta.glow};">
                                <i data-lucide="${meta.icon}" style="color: ${meta.color}; width: 18px; height: 18px;"></i>
                            </div>
                            <div>
                                <h4 style="color: #fff; margin: 0; font-size: 14px; font-weight: 700; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.5px;">${meta.label}</h4>
                                <span style="font-size: 10px; color: ${meta.color}; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${cfg.role}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Markup Input Panel -->
                    <div class="form-group" style="margin: 0; background: rgba(0,0,0,0.2); padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.03);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label style="font-size: 11px; color: var(--text-secondary); margin: 0;">Tỷ lệ Markup (%)</label>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <input type="number" class="pricing-markup-input" data-role="${cfg.role}" value="${markupPercent}" min="0" max="999" step="0.5" style="height: 28px; width: 65px; font-size: 14px; font-weight: 700; text-align: center; color: ${meta.color}; background: rgba(0,0,0,0.3); border: 1px solid ${meta.color}35; border-radius: 6px; padding: 0;">
                                <span style="font-size: 13px; font-weight: 700; color: ${meta.color};">%</span>
                            </div>
                        </div>
                        
                        <!-- Range slider for interactive manipulation (max slider value: 150%) -->
                        <input type="range" class="pricing-markup-slider" data-role="${cfg.role}" value="${Math.min(150, markupPercent)}" min="0" max="150" step="0.5" style="--slider-color: ${meta.color}; --slider-glow: ${meta.glow};">
                        
                        <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); margin-top: -4px;">
                            <span>0% (Gốc)</span>
                            <span>150% (Max kéo)</span>
                        </div>
                    </div>

                    <!-- Description Input -->
                    <div class="form-group" style="margin: 0;">
                        <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 6px;">Mô tả cấp bậc</label>
                        <input type="text" class="pricing-desc-input" data-role="${cfg.role}" value="${esc(cfg.description || '')}" placeholder="Mô tả ngắn cho cấp bậc..." style="height: 36px; font-size: 12px; border-radius: 8px; background: rgba(0,0,0,0.3); border-color: rgba(255,255,255,0.06);">
                    </div>
                </div>
            `;
        }).join('');

        // Bind interactive events and bidirectionally sync inputs
        container.querySelectorAll('.pricing-markup-slider').forEach(slider => {
            const role = slider.dataset.role;
            const numInput = container.querySelector(`.pricing-markup-input[data-role="${role}"]`);
            
            slider.addEventListener('input', (e) => {
                numInput.value = e.target.value;
                updatePricingPreview();
            });
            
            numInput.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                    slider.value = Math.min(150, Math.max(0, val));
                }
                updatePricingPreview();
            });
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function updatePricingPreview() {
        const previewContainer = document.getElementById('pricing-preview-results');
        const rateInput = document.getElementById('pricing-preview-rate');
        if (!previewContainer || !rateInput) return;

        const baseRate = parseFloat(rateInput.value) || 100;
        const inputs = document.querySelectorAll('.pricing-markup-input');

        if (!inputs.length) {
            previewContainer.innerHTML = '<span class="text-dim" style="font-size: 12px; grid-column: 1 / -1; text-align: center; padding: 20px;">Chưa có dữ liệu</span>';
            return;
        }

        let html = '';
        inputs.forEach(input => {
            const role = input.dataset.role;
            const markup = parseFloat(input.value) || 0;
            const finalRate = Math.ceil(baseRate * (1 + markup / 100));
            const profit = finalRate - baseRate;
            const meta = ROLE_META[role] || { label: role, color: '#888', glow: 'rgba(136, 136, 136, 0.2)' };

            html += `
                <div style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.04) 100%); border: 1px solid ${meta.color}25; border-top: 3px solid ${meta.color}; border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); position: relative; overflow: hidden;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 11px; color: ${meta.color}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${meta.label}</span>
                        <span style="font-size: 9px; background: ${meta.color}15; color: ${meta.color}; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-family: var(--font-mono);">+${markup}%</span>
                    </div>
                    <div style="display: flex; align-items: baseline; gap: 4px; margin-top: 4px;">
                        <span style="font-size: 22px; font-weight: 800; color: #fff; font-family: var(--font-mono); text-shadow: 0 0 10px ${meta.glow};">${finalRate.toLocaleString('vi-VN')}</span>
                        <span style="font-size: 11px; color: var(--text-secondary);">đ/1K</span>
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); display: flex; justify-content: space-between; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 6px; margin-top: 2px;">
                        <span>Lợi nhuận/1K:</span>
                        <span style="color: #39ff14; font-weight: 600; font-family: var(--font-mono); text-shadow: 0 0 4px rgba(57, 255, 20, 0.1);">+${profit > 0 ? profit.toLocaleString('vi-VN') : 0}đ</span>
                    </div>
                </div>
            `;
        });

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H9',location:'js/votri-service-api-update.js:updatePricingPreview',message:'Rendered pricing preview using locked API base rate',data:{baseRate,cards:inputs.length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        previewContainer.innerHTML = html;
    }

    function onPricingPreviewServiceChange() {
        const rateInput = document.getElementById('pricing-preview-rate');
        const sourceEl = document.getElementById('pricing-preview-source');
        const hiddenSelect = document.getElementById('pricing-preview-service');
        const trigger = document.getElementById('pricing-preview-service-trigger');
        if (!rateInput) return;

        const selected = pricingPreviewServices.find(s => String(s.service) === String(selectedPricingServiceId));
        if (!selected) return;

        const apiRate = Math.ceil(parseFloat(selected.rate) || 0);
        rateInput.value = apiRate > 0 ? String(apiRate) : '1';
        if (hiddenSelect) hiddenSelect.value = String(selected.service);
        if (trigger) {
            const cleanName = sanitizeServiceLabel(selected.name || '');
            trigger.textContent = `#${selected.service} - ${cleanName.slice(0, 70)}`;
        }
        if (sourceEl) {
            sourceEl.textContent = `Nguồn dữ liệu: API dịch vụ #${selected.service} - ${selected.name || 'Không tên'} (rate=${apiRate}đ/1K)`;
        }

        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H7',location:'js/votri-service-api-update.js:onPricingPreviewServiceChange',message:'API rate auto-filled and kept read-only after service selection',data:{serviceId:String(selected.service),apiRate},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log

        updatePricingPreview();
    }

    function bindPricingServicePickerEvents() {
        const trigger = document.getElementById('pricing-preview-service-trigger');
        const menu = document.getElementById('pricing-preview-service-menu');
        const search = document.getElementById('pricing-preview-service-search');
        if (!trigger || !menu || !search) return;

        trigger.addEventListener('click', () => {
            menu.classList.toggle('hidden');
            if (!menu.classList.contains('hidden')) {
                search.value = '';
                renderPricingServiceList('');
                search.focus();
            }
        });

        search.addEventListener('input', () => {
            renderPricingServiceList(search.value || '');
        });

        document.addEventListener('click', (evt) => {
            if (!menu.classList.contains('hidden')) {
                const picker = trigger.closest('.pricing-service-picker');
                if (picker && !picker.contains(evt.target)) {
                    menu.classList.add('hidden');
                }
            }
        });
    }

    function renderPricingServiceList(keyword) {
        const list = document.getElementById('pricing-preview-service-list');
        if (!list) return;

        const term = String(keyword || '').trim().toLowerCase();
        const filtered = pricingPreviewServices.filter(s => {
            const id = String(s.service || '').toLowerCase();
            const name = sanitizeServiceLabel(s.name || '').toLowerCase();
            return !term || id.includes(term) || name.includes(term);
        }).slice(0, 200);

        if (!filtered.length) {
            list.innerHTML = '<div class="text-dim" style="padding: 10px; font-size: 12px;">Không có dịch vụ phù hợp.</div>';
            return;
        }

        list.innerHTML = filtered.map(s => {
            const id = String(s.service);
            const cleanName = sanitizeServiceLabel(s.name || '').slice(0, 80);
            const isActive = id === String(selectedPricingServiceId);
            return `<button type="button" class="pricing-service-item${isActive ? ' active' : ''}" data-service-id="${esc(id)}">#${esc(id)} - ${esc(cleanName)}</button>`;
        }).join('');

        list.querySelectorAll('.pricing-service-item').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedPricingServiceId = btn.getAttribute('data-service-id') || '';
                const menu = document.getElementById('pricing-preview-service-menu');
                if (menu) menu.classList.add('hidden');
                onPricingPreviewServiceChange();
            });
        });
    }

    async function fetchPricingPreviewServices() {
        const headers = getAuthHeaders();
        const serviceSelect = document.getElementById('pricing-preview-service');
        const sourceEl = document.getElementById('pricing-preview-source');
        if (!headers || !serviceSelect) return;

        try {
            const res = await fetch(`${app().API_BASE}/api/smm/services`, { headers });
            const result = await res.json();
            if (!res.ok || !result.success || !Array.isArray(result.data)) {
                serviceSelect.innerHTML = '<option value="">Không tải được dịch vụ</option>';
                if (sourceEl) sourceEl.textContent = 'Nguồn dữ liệu: lỗi tải API dịch vụ.';
                return;
            }

            pricingPreviewServices = result.data.filter(s => {
                const rate = parseFloat(s.rate);
                return s && s.service !== undefined && Number.isFinite(rate) && rate > 0;
            });

            if (!pricingPreviewServices.length) {
                serviceSelect.innerHTML = '<option value="">Không có dịch vụ hợp lệ</option>';
                if (sourceEl) sourceEl.textContent = 'Nguồn dữ liệu: API không trả dịch vụ hợp lệ.';
                return;
            }

            serviceSelect.innerHTML = pricingPreviewServices.slice(0, 300).map(s => {
                const cleanName = sanitizeServiceLabel(s.name || '');
                const name = esc(cleanName.slice(0, 72));
                return `<option value="${esc(String(s.service))}">#${esc(String(s.service))} - ${name}</option>`;
            }).join('');

            selectedPricingServiceId = String(pricingPreviewServices[0].service);
            serviceSelect.value = selectedPricingServiceId;
            renderPricingServiceList('');

            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H8',location:'js/votri-service-api-update.js:fetchPricingPreviewServices',message:'Loaded pricing preview services from API',data:{count:pricingPreviewServices.length,firstServiceId:String(pricingPreviewServices[0].service)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log

            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H10',location:'js/votri-service-api-update.js:fetchPricingPreviewServices:label-audit',message:'Audited service labels for control chars/newlines',data:{sample:pricingPreviewServices.slice(0,5).map(s=>({serviceId:String(s.service),rawLen:String(s.name||'').length,cleanLen:sanitizeServiceLabel(s.name||'').length,hasControl:/[\u0000-\u001F\u007F-\u009F]/.test(String(s.name||'')),hasNewline:/\n|\r/.test(String(s.name||''))}))},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log

            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H11',location:'js/votri-service-api-update.js:fetchPricingPreviewServices:picker-mode',message:'Using custom service picker instead of native select dropdown',data:{servicesRendered:Math.min(200,pricingPreviewServices.length)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log

            onPricingPreviewServiceChange();
        } catch (err) {
            serviceSelect.innerHTML = '<option value="">Lỗi mạng khi tải dịch vụ</option>';
            if (sourceEl) sourceEl.textContent = 'Nguồn dữ liệu: lỗi mạng khi lấy dịch vụ API.';
        }
    }

    async function savePricingConfig() {
        const headers = getAuthHeaders();
        if (!headers) return;

        const inputs = document.querySelectorAll('.pricing-markup-input');
        const descInputs = document.querySelectorAll('.pricing-desc-input');
        if (!inputs.length) return toast('Không có dữ liệu để lưu.', 'error');

        const configs = [];
        const descMap = {};
        descInputs.forEach(d => { descMap[d.dataset.role] = d.value.trim(); });

        inputs.forEach(input => {
            const role = input.dataset.role;
            const markup = parseFloat(input.value);
            if (isNaN(markup) || markup < 0) {
                toast(`Markup không hợp lệ cho ${role}.`, 'error');
                return;
            }
            configs.push({
                role,
                markup_percent: markup,
                description: descMap[role] || null
            });
        });

        if (configs.length === 0) return;

        const btn = document.getElementById('btn-save-pricing-config');
        try {
            if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px;height:16px;"></i> Đang lưu...'; }

            const res = await fetch(`${app().API_BASE}/api/smm/admin/pricing`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ configs })
            });
            const result = await res.json();
            if (res.ok && result.success) {
                toast(result.message || 'Cập nhật cấu hình thành công!', 'success');
                fetchPricingConfig();
            } else {
                toast(result.message || 'Lỗi cập nhật cấu hình.', 'error');
            }
        } catch (err) {
            console.error(err);
            toast('Lỗi mạng khi lưu cấu hình giá.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:16px;height:16px;"></i> Lưu cấu hình'; }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    // ==========================================
    // TAB VISIBILITY TRIGGER & EXPORT MODULE
    // ==========================================
    function onTabVisible() {
        init();
        fetchSmmApis();
    }

    window.VotriServiceApiUpdate = {
        init,
        onTabVisible,
        fetchSmmApis
    };

    document.addEventListener('DOMContentLoaded', () => {
        init();
    });
})();
