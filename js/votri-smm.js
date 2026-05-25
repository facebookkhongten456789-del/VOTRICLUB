/**
 * SMM: bảng giá, tạo đơn, Mua ngay — API routes/smm.js
 */
(function () {
    const app = () => window.VotriApp || {};
    const esc = (s) => (app().escapeHTML ? app().escapeHTML(s) : String(s ?? ''));
    const toast = (m, t) => app().showToast && app().showToast(m, t);

    let smmServicesRaw = [];
    let smmServicesLoadState = 'idle';
    let pendingPlatformSelection = null;
    let pendingCategorySelection = null;
    let pendingServiceSelection = null;
    let currentPricingPlatform = 'ALL';
    let currentPricingSearch = '';
    let currentPricingPage = 1;
    const pricingItemsPerPage = 10;

    function inferSmmPlatform(service) {
        if (service.platform) return service.platform;
        const text = `${service.category || ''} ${service.name || ''}`;
        if (/facebook|\bfb\b/i.test(text)) return 'Dịch vụ Facebook';
        if (/instagram|insta/i.test(text)) return 'Instagram';
        if (/tiktok/i.test(text)) return 'TikTok';
        if (/youtube/i.test(text)) return 'YouTube';
        return 'Khác';
    }

    function normalizeSmmService(s) {
        return {
            ...s,
            service: parseInt(s.service, 10),
            platform: inferSmmPlatform(s),
            rate: String(s.rate ?? '0'),
            min: parseInt(s.min, 10) || 1,
            max: parseInt(s.max, 10) || 100000
        };
    }

    function setSmmPlatformMessage(message, isError = false) {
        const platformSelect = document.getElementById('smm-platform');
        if (!platformSelect) return;
        platformSelect.innerHTML = `<option value="" disabled selected>${message}</option>`;
        if (isError) platformSelect.dataset.loadError = '1';
        else delete platformSelect.dataset.loadError;
    }

    function getCurrentUserSmmTier() {
        const email = sessionStorage.getItem('votri_sys_user_email');
        if (!email) return 'Member';
        try {
            const usersList = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
            const currentUser = usersList.find((u) => u.email === email);
            if (!currentUser) return 'Member';
            const balance = currentUser.balance || 0;
            const totalDeposited = currentUser.totalDeposited || 0;
            if (totalDeposited >= 5000000 || balance >= 1000000) return 'VIP';
            if (totalDeposited >= 1000000 || balance >= 200000) return 'Collaborator';
        } catch (_) { /* */ }
        return 'Member';
    }

    function resetSmmDetails() {
        const idEl = document.getElementById('smm-detail-id');
        if (!idEl) return;
        idEl.textContent = '-';
        document.getElementById('smm-detail-name').textContent = '-';
        document.getElementById('smm-detail-type').textContent = '-';
        document.getElementById('smm-detail-limit').textContent = '-';
        document.getElementById('smm-detail-rate').textContent = '-';
        document.getElementById('smm-detail-desc').textContent = '-';
        document.getElementById('smm-total-price').textContent = '0đ';
    }

    function calculateSmmPrice(rate) {
        const qty = parseInt(document.getElementById('smm-quantity')?.value, 10) || 0;
        const price = (qty / 1000) * parseFloat(rate);
        const el = document.getElementById('smm-total-price');
        if (el) el.textContent = `${price.toLocaleString('vi-VN')}đ`;
    }

    function updateSmmDetails(serviceId) {
        const service = smmServicesRaw.find((s) => s.service === serviceId);
        if (!service) return;

        const limitHint = document.getElementById('smm-quantity-limit');
        const qtyInput = document.getElementById('smm-quantity');

        document.getElementById('smm-detail-id').textContent = service.service;
        document.getElementById('smm-detail-name').textContent = service.name;
        document.getElementById('smm-detail-type').textContent = service.type;
        document.getElementById('smm-detail-limit').textContent =
            `${service.min} - ${parseInt(service.max, 10).toLocaleString('en-US')}`;

        const tier = getCurrentUserSmmTier();
        let finalRate = parseFloat(service.rate);
        let tierBadge = '';
        if (tier === 'VIP') {
            finalRate = parseFloat(service.vipRate) || Math.ceil((finalRate / 1.4) * 1.01);
            tierBadge = ' <span class="badge badge-neon-yellow" style="font-size:0.7rem;color:#000;font-weight:700;padding:2px 6px;">NPP +1%</span>';
        } else if (tier === 'Collaborator') {
            tierBadge = ' <span class="badge badge-neon-cyan" style="font-size:0.7rem;font-weight:700;padding:2px 6px;">CTV</span>';
        } else {
            tierBadge = ' <span class="badge" style="background:rgba(255,255,255,0.08);font-size:0.7rem;font-weight:700;padding:2px 6px;color:var(--text-secondary);">Thành viên</span>';
        }

        document.getElementById('smm-detail-rate').innerHTML =
            `${finalRate.toLocaleString('vi-VN')}đ${tierBadge}`;
        document.getElementById('smm-detail-desc').textContent =
            service.desc || 'Không có mô tả chi tiết.';

        if (qtyInput) {
            qtyInput.min = service.min;
            qtyInput.max = service.max;
            qtyInput.value = service.min;
        }
        if (limitHint) {
            limitHint.textContent =
                `Tối thiểu: ${service.min} - Tối đa: ${parseInt(service.max, 10).toLocaleString('en-US')}`;
        }
        if (qtyInput) qtyInput.oninput = () => calculateSmmPrice(finalRate);
        calculateSmmPrice(finalRate);
    }

    let smmFormDelegationBound = false;

    function bindSmmFormDelegation() {
        const root = document.getElementById('view-create-order');
        if (!root || smmFormDelegationBound) return;
        smmFormDelegationBound = true;
        root.addEventListener('change', (e) => {
            if (e.target.id === 'smm-platform') {
                populateSmmCategories(e.target.value);
            }
            if (e.target.id === 'smm-category') {
                const plat = document.getElementById('smm-platform')?.value;
                if (plat) populateSmmServices(plat, e.target.value);
            }
            if (e.target.id === 'smm-service') {
                const sid = parseInt(e.target.value, 10);
                if (sid) updateSmmDetails(sid);
            }
        });
    }

    function resolvePlatformOption(platform) {
        const platformSelect = document.getElementById('smm-platform');
        if (!platformSelect || !platform) return platform;
        const values = [...platformSelect.options].map((o) => o.value).filter(Boolean);
        if (values.includes(platform)) return platform;
        const q = String(platform).toLowerCase();
        return (
            values.find(
                (v) =>
                    v.toLowerCase() === q ||
                    v.toLowerCase().includes(q) ||
                    q.includes(v.toLowerCase()),
            ) || platform
        );
    }

    function searchSmmServices(query) {
        const q = String(query || '').toLowerCase().trim();
        if (!q || !smmServicesRaw.length) return [];
        const idNum = /^\d+$/.test(q) ? parseInt(q, 10) : null;
        return smmServicesRaw
            .filter((s) => {
                if (idNum != null && s.service === idNum) return true;
                if (String(s.service).includes(q)) return true;
                return (
                    (s.name && s.name.toLowerCase().includes(q)) ||
                    (s.category && s.category.toLowerCase().includes(q)) ||
                    (s.platform && s.platform.toLowerCase().includes(q))
                );
            })
            .slice(0, 15);
    }

    /** Chọn đủ nền tảng / phân loại / dịch vụ từ một bản ghi API */
    function selectServiceForOrder(svc) {
        if (!svc || !smmServicesRaw.length) return false;

        pendingPlatformSelection = null;
        pendingCategorySelection = null;
        pendingServiceSelection = null;

        const platformSelect = document.getElementById('smm-platform');
        const categorySelect = document.getElementById('smm-category');
        if (!platformSelect || !categorySelect) return false;

        if (platformSelect.options.length <= 1) populateSmmPlatforms();

        const plat = resolvePlatformOption(svc.platform);
        const platValues = [...platformSelect.options].map((o) => o.value).filter(Boolean);
        if (!platValues.includes(plat)) return false;

        platformSelect.value = plat;
        populateSmmCategories(plat);

        const catValues = [...categorySelect.options].map((o) => o.value);
        if (!catValues.includes(svc.category)) return false;

        categorySelect.value = svc.category;
        populateSmmServices(plat, svc.category, { serviceId: svc.service });

        pendingPlatformSelection = null;
        pendingCategorySelection = null;
        pendingServiceSelection = null;
        return true;
    }

    function populateSmmServices(platform, category, opts = {}) {
        const serviceSelect = document.getElementById('smm-service');
        if (!serviceSelect) return;

        const services = smmServicesRaw.filter(
            (s) => s.platform === platform && s.category === category,
        );
        serviceSelect.innerHTML = '<option value="" disabled selected>Chọn dịch vụ...</option>';
        services.forEach((s) => {
            const option = document.createElement('option');
            option.value = String(s.service);
            option.textContent = `#${s.service} - ${s.name} | ${s.rate}đ/1K`;
            option.style.background = '#111';
            serviceSelect.appendChild(option);
        });

        const pickId = opts.serviceId != null ? opts.serviceId : pendingServiceSelection;
        if (pickId != null && [...serviceSelect.options].some((o) => o.value === String(pickId))) {
            serviceSelect.value = String(pickId);
            updateSmmDetails(parseInt(pickId, 10));
            pendingServiceSelection = null;
        } else {
            resetSmmDetails();
        }
    }

    function populateSmmCategories(platform) {
        const categorySelect = document.getElementById('smm-category');
        const serviceSelect = document.getElementById('smm-service');
        if (!categorySelect) return;

        const servicesInPlatform = smmServicesRaw.filter((s) => s.platform === platform);
        const categories = [...new Set(servicesInPlatform.map((s) => s.category))];

        categorySelect.innerHTML = '<option value="" disabled selected>Chọn phân loại...</option>';
        categories.forEach((cat) => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            option.style.background = '#111';
            categorySelect.appendChild(option);
        });

        if (serviceSelect) {
            serviceSelect.innerHTML =
                '<option value="" disabled selected>Vui lòng chọn phân loại trước</option>';
        }

        if (pendingCategorySelection) {
            const cat = pendingCategorySelection;
            if ([...categorySelect.options].some((o) => o.value === cat)) {
                categorySelect.value = cat;
                populateSmmServices(platform, cat);
            }
            pendingCategorySelection = null;
        } else {
            resetSmmDetails();
        }
    }

    function applyPendingSmmOrderSelections() {
        if (!smmServicesRaw.length) return false;

        if (pendingServiceSelection != null) {
            const svc = smmServicesRaw.find(
                (s) => s.service === parseInt(pendingServiceSelection, 10),
            );
            if (svc && selectServiceForOrder(svc)) {
                window.__votriDbg?.('votri-smm.js:applyPending', 'by-service-id', {
                    service: svc.service,
                    platform: svc.platform,
                }, 'I');
                return true;
            }
        }

        const platformSelect = document.getElementById('smm-platform');
        if (!platformSelect) return false;

        if (platformSelect.options.length <= 1) populateSmmPlatforms();

        let platform = pendingPlatformSelection;
        if (platform) platform = resolvePlatformOption(platform);
        const platformValues = [...platformSelect.options].map((o) => o.value).filter(Boolean);

        if (platform && platformValues.includes(platform)) {
            platformSelect.value = platform;
            populateSmmCategories(platform);
            pendingPlatformSelection = null;
        } else if (pendingPlatformSelection) {
            return false;
        }

        const categorySelect = document.getElementById('smm-category');
        const plat = platformSelect.value;
        if (pendingCategorySelection && categorySelect && plat) {
            const cat = pendingCategorySelection;
            if ([...categorySelect.options].map((o) => o.value).includes(cat)) {
                categorySelect.value = cat;
                populateSmmServices(plat, cat);
            }
            pendingCategorySelection = null;
        }

        const serviceSelect = document.getElementById('smm-service');
        if (pendingServiceSelection != null && serviceSelect) {
            const sid = String(pendingServiceSelection);
            if ([...serviceSelect.options].some((o) => o.value === sid)) {
                serviceSelect.value = sid;
                updateSmmDetails(parseInt(sid, 10));
            }
            pendingServiceSelection = null;
        }

        window.__votriDbg?.('votri-smm.js:applyPending', 'done', {
            platform: platformSelect.value,
            category: categorySelect?.value,
            service: serviceSelect?.value,
        }, 'I');
        return !!platformSelect.value;
    }

    function populateSmmPlatforms() {
        const platformSelect = document.getElementById('smm-platform');
        if (!platformSelect) return;

        const platforms = [...new Set(smmServicesRaw.map((s) => s.platform))];
        const prev = platformSelect.value;
        platformSelect.innerHTML = '<option value="" disabled selected>Chọn nền tảng...</option>';
        platforms.forEach((p) => {
            const option = document.createElement('option');
            option.value = p;
            option.textContent = p;
            option.style.background = '#111';
            platformSelect.appendChild(option);
        });

        if (prev && [...platformSelect.options].some((o) => o.value === prev)) {
            platformSelect.value = prev;
        }

        bindSmmFormDelegation();

        if (pendingPlatformSelection || pendingCategorySelection || pendingServiceSelection) {
            applyPendingSmmOrderSelections();
        }
    }

    function renderPricingTable() {
        const tableBody = document.getElementById('pricing-table-body');
        const infoEl = document.getElementById('pricing-pagination-info');
        const paginationControls = document.getElementById('pricing-pagination-controls');
        if (!tableBody) return;

        let filtered = smmServicesRaw;
        if (currentPricingPlatform !== 'ALL') {
            filtered = filtered.filter((s) => s.platform === currentPricingPlatform);
        }
        if (currentPricingSearch) {
            filtered = filtered.filter(
                (s) =>
                    s.service.toString().includes(currentPricingSearch) ||
                    s.name.toLowerCase().includes(currentPricingSearch) ||
                    s.category.toLowerCase().includes(currentPricingSearch)
            );
        }

        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / pricingItemsPerPage) || 1;
        if (currentPricingPage > totalPages) currentPricingPage = totalPages;
        if (currentPricingPage < 1) currentPricingPage = 1;

        const startIndex = (currentPricingPage - 1) * pricingItemsPerPage;
        const endIndex = Math.min(startIndex + pricingItemsPerPage, totalItems);
        const pageItems = filtered.slice(startIndex, endIndex);

        if (infoEl) {
            infoEl.textContent = totalItems
                ? `Hiển thị ${startIndex + 1} - ${endIndex} của ${totalItems} dịch vụ`
                : 'Hiển thị 0 - 0 của 0 dịch vụ';
        }

        if (!pageItems.length) {
            tableBody.innerHTML =
                '<tr><td colspan="7" class="text-center text-dim" style="padding:40px;text-align:center;">Không tìm thấy dịch vụ nào phù hợp.</td></tr>';
            if (paginationControls) paginationControls.innerHTML = '';
            return;
        }

        tableBody.innerHTML = pageItems
            .map((s) => {
                const rate = parseFloat(s.rate);
                const vipRate = parseFloat(s.vipRate) || Math.ceil((rate / 1.4) * 1.01);
                return `
            <tr>
                <td style="font-weight:600;color:var(--text-dim);text-align:center;vertical-align:middle;">#${s.service}</td>
                <td style="vertical-align:middle;">
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">${esc(s.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);display:flex;align-items:center;gap:6px;">
                        <span class="badge" style="background:rgba(255,255,255,0.05);font-size:0.7rem;padding:1px 6px;">${esc(s.platform)}</span>
                        <span>${esc(s.category)}</span>
                    </div>
                </td>
                <td style="font-size:0.85rem;color:var(--text-secondary);font-family:monospace;text-align:center;vertical-align:middle;">
                    ${s.min.toLocaleString('en-US')} - ${parseInt(s.max, 10).toLocaleString('en-US')}
                </td>
                <td style="font-weight:600;color:var(--text-secondary);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${rate.toLocaleString('vi-VN')}đ
                </td>
                <td style="font-weight:700;color:var(--neon-cyan);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${rate.toLocaleString('vi-VN')}đ
                </td>
                <td style="font-weight:700;color:var(--neon-yellow);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${vipRate.toLocaleString('vi-VN')}đ
                </td>
                <td style="text-align:right;vertical-align:middle;padding-right:20px;">
                    <button type="button" class="btn btn-secondary btn-sm pricing-buy-btn"
                        data-service="${s.service}"
                        style="border:1px solid var(--neon-cyan);color:var(--neon-cyan);font-size:0.75rem;padding:4px 10px;border-radius:6px;cursor:pointer;background:transparent;">
                        Mua ngay
                    </button>
                </td>
            </tr>`;
            })
            .join('');

        tableBody.querySelectorAll('.pricing-buy-btn').forEach((btn) => {
            btn.onclick = (e) => {
                e.preventDefault();
                const sid = parseInt(btn.getAttribute('data-service'), 10);
                const svc = smmServicesRaw.find((s) => s.service === sid);
                if (svc) {
                    switchToServiceOrder(svc.platform, svc.category, svc.service);
                }
            };
        });

        if (paginationControls && totalPages > 1) {
            let controlsHtml = '';
            controlsHtml += `<button type="button" class="btn btn-sm pricing-page-btn" data-page="${currentPricingPage - 1}" ${currentPricingPage === 1 ? 'disabled' : ''}>Trước</button>`;
            for (let i = 1; i <= totalPages; i++) {
                if (
                    i === 1 ||
                    i === totalPages ||
                    (i >= currentPricingPage - 2 && i <= currentPricingPage + 2)
                ) {
                    controlsHtml += `<button type="button" class="btn btn-sm pricing-page-btn" data-page="${i}">${i}</button>`;
                }
            }
            controlsHtml += `<button type="button" class="btn btn-sm pricing-page-btn" data-page="${currentPricingPage + 1}" ${currentPricingPage === totalPages ? 'disabled' : ''}>Sau</button>`;
            paginationControls.innerHTML = controlsHtml;
            paginationControls.querySelectorAll('.pricing-page-btn').forEach((b) => {
                if (b.hasAttribute('disabled')) return;
                b.onclick = (ev) => {
                    ev.preventDefault();
                    currentPricingPage = parseInt(b.getAttribute('data-page'), 10);
                    renderPricingTable();
                };
            });
        } else if (paginationControls) {
            paginationControls.innerHTML = '';
        }

        if (window.lucide) lucide.createIcons();
    }

    function initPricingPage() {
        const tabsContainer = document.getElementById('pricing-platform-tabs');
        const searchInput = document.getElementById('pricing-search-input');
        if (!tabsContainer || !smmServicesRaw.length) return;

        const platforms = [...new Set(smmServicesRaw.map((s) => s.platform))];
        let tabsHtml = `<button type="button" class="btn btn-secondary pricing-tab-btn ${currentPricingPlatform === 'ALL' ? 'active' : ''}" data-platform="ALL">Tất cả</button>`;
        platforms.forEach((p) => {
            tabsHtml += `<button type="button" class="btn btn-secondary pricing-tab-btn ${currentPricingPlatform === p ? 'active' : ''}" data-platform="${esc(p)}">${esc(p)}</button>`;
        });
        tabsContainer.innerHTML = tabsHtml;
        tabsContainer.querySelectorAll('.pricing-tab-btn').forEach((btn) => {
            btn.onclick = (e) => {
                e.preventDefault();
                tabsContainer.querySelectorAll('.pricing-tab-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                currentPricingPlatform = btn.getAttribute('data-platform');
                currentPricingPage = 1;
                renderPricingTable();
            };
        });
        if (searchInput) {
            searchInput.value = currentPricingSearch;
            searchInput.oninput = (e) => {
                currentPricingSearch = e.target.value.toLowerCase().trim();
                currentPricingPage = 1;
                renderPricingTable();
            };
        }
        renderPricingTable();
    }

    async function fetchServices(force = false) {
        if (smmServicesLoadState === 'loading') return;
        if (!force && smmServicesLoadState === 'ready' && smmServicesRaw.length > 0) {
            populateSmmPlatforms();
            initPricingPage();
            if (pendingPlatformSelection || pendingCategorySelection || pendingServiceSelection) {
                applyPendingSmmOrderSelections();
            }
            return;
        }
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('smm_fetch');
            if (!gate.ok) {
                toast(gate.reason, 'info');
                return;
            }
        }
        smmServicesLoadState = 'loading';
        setSmmPlatformMessage('Đang tải dữ liệu...');

        try {
            const base = app().API_BASE;
            const headers = app().authHeaders ? app().authHeaders() : {};
            const res = await fetch(`${base}/api/smm/services`, { headers });
            const result = app().parseJsonResponse
                ? await app().parseJsonResponse(res)
                : await res.json();

            if (!res.ok || result.success === false) {
                throw new Error(result.message || `HTTP ${res.status}`);
            }

            const services = Array.isArray(result.data) ? result.data : [];
            if (!services.length) throw new Error('Danh sách dịch vụ trống.');

            smmServicesRaw = services.map(normalizeSmmService);
            smmServicesLoadState = 'ready';
            populateSmmPlatforms();
            initPricingPage();
            if (pendingPlatformSelection || pendingCategorySelection || pendingServiceSelection) {
                applyPendingSmmOrderSelections();
            }
            window.__votriDbg?.('votri-smm.js:fetchServices', 'ok', { count: smmServicesRaw.length }, 'D');
        } catch (e) {
            smmServicesLoadState = 'error';
            console.error('[SMM]', e);
            setSmmPlatformMessage('Lỗi tải dịch vụ — vui lòng tải lại trang hoặc thử sau', true);
            toast(e.message || 'Không tải danh sách dịch vụ SMM.', 'error');
        }
    }

    function ensureLoaded() {
        if (!document.getElementById('smm-platform')) return;
        if (smmServicesRaw.length > 0) {
            populateSmmPlatforms();
            if (pendingPlatformSelection || pendingCategorySelection || pendingServiceSelection) {
                applyPendingSmmOrderSelections();
            }
            return;
        }
        if (smmServicesLoadState !== 'loading') fetchServices();
    }

    async function placeSmmOrder() {
        const token = app().getSessionToken?.() || sessionStorage.getItem('votri_sys_token');
        const serviceId = document.getElementById('smm-service')?.value;
        const link = document.getElementById('smm-link')?.value?.trim();
        const quantity = parseInt(document.getElementById('smm-quantity')?.value, 10);

        if (!serviceId) return toast('Vui lòng chọn dịch vụ.', 'error');
        if (!link) return toast('Vui lòng nhập liên kết cần tăng.', 'error');
        if (!quantity || quantity <= 0) return toast('Số lượng không hợp lệ.', 'error');
        if (!token) return toast('Vui lòng đăng nhập lại.', 'error');
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('smm_order');
            if (!gate.ok) return toast(gate.reason, 'info');
        }

        const placeBtn = document.getElementById('btn-place-order');
        try {
            if (placeBtn) {
                placeBtn.disabled = true;
                placeBtn.textContent = 'Đang xử lý...';
            }

            const res = await fetch(`${app().API_BASE}/api/smm/order`, {
                method: 'POST',
                headers: app().authHeaders ? app().authHeaders() : {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    serviceId: parseInt(serviceId, 10),
                    link,
                    quantity
                })
            });

            const result = app().parseJsonResponse
                ? await app().parseJsonResponse(res)
                : await res.json();

            if (result.success) {
                toast(result.message || 'Đặt hàng thành công', 'success');
                if (result.order?.newBalance != null) {
                    const bal = document.getElementById('stat-balance');
                    if (bal) bal.textContent = result.order.newBalance.toLocaleString('vi-VN');
                }
                if (app().syncDatabaseData) await app().syncDatabaseData();
                if (window.OrdersPage) window.OrdersPage.refresh();

                const platformEl = document.getElementById('smm-platform');
                if (platformEl) platformEl.value = '';
                document.getElementById('smm-category').innerHTML =
                    '<option value="" disabled selected>Vui lòng chọn nền tảng trước</option>';
                document.getElementById('smm-service').innerHTML =
                    '<option value="" disabled selected>Vui lòng chọn phân loại trước</option>';
                document.getElementById('smm-link').value = '';
                document.getElementById('smm-quantity').value = '100';
                resetSmmDetails();
            } else {
                toast(result.message || 'Đặt hàng thất bại', 'error');
            }
        } catch (err) {
            console.error('[PLACE ORDER]', err);
            toast('Lỗi khi đặt hàng. Thử lại sau.', 'error');
        } finally {
            if (placeBtn) {
                placeBtn.disabled = false;
                placeBtn.textContent = 'ĐẶT HÀNG NGAY';
            }
        }
    }

    function bindQuickSearch() {
        const input = document.getElementById('smm-quick-search');
        const results = document.getElementById('smm-quick-search-results');
        if (!input || !results) return;

        const hideResults = () => results.classList.add('hidden');

        const renderResults = () => {
            if (!smmServicesRaw.length) {
                results.innerHTML =
                    '<div style="padding:12px;color:#888;font-size:12px;">Đang tải danh sách dịch vụ…</div>';
                results.classList.remove('hidden');
                return;
            }
            const items = searchSmmServices(input.value);
            if (!input.value.trim()) {
                hideResults();
                return;
            }
            if (!items.length) {
                results.innerHTML =
                    '<div style="padding:12px;color:#888;font-size:12px;">Không tìm thấy dịch vụ.</div>';
                results.classList.remove('hidden');
                return;
            }
            results.innerHTML = items
                .map(
                    (s) => `
                <button type="button" class="smm-quick-search-item" data-service-id="${s.service}"
                    style="display:block;width:100%;text-align:left;padding:10px 12px;border:none;background:transparent;color:#fff;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <strong style="color:var(--neon-cyan);">#${s.service}</strong> ${esc(s.name)}<br>
                    <span style="font-size:11px;color:#888;">${esc(s.platform)} · ${esc(s.category)}</span>
                </button>`,
                )
                .join('');
            results.classList.remove('hidden');
            results.querySelectorAll('.smm-quick-search-item').forEach((btn) => {
                btn.onmousedown = (ev) => ev.preventDefault();
                btn.onclick = () => {
                    const sid = parseInt(btn.getAttribute('data-service-id'), 10);
                    const svc = smmServicesRaw.find((x) => x.service === sid);
                    if (svc && selectServiceForOrder(svc)) {
                        input.value = `#${svc.service} - ${svc.name}`;
                        hideResults();
                        toast('Đã chọn dịch vụ.', 'success');
                    }
                };
            });
        };

        input.addEventListener('input', renderResults);
        input.addEventListener('focus', renderResults);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideResults();
        });
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !results.contains(e.target)) hideResults();
        });
    }

    function bindOrderForm() {
        bindSmmFormDelegation();
        bindQuickSearch();

        const btnPlaceOrder = document.getElementById('btn-place-order');
        if (btnPlaceOrder) btnPlaceOrder.addEventListener('click', placeSmmOrder);

        const qtyInput = document.getElementById('smm-quantity');
        if (qtyInput) {
            qtyInput.addEventListener('input', () => {
                const sid = parseInt(document.getElementById('smm-service')?.value, 10);
                const svc = smmServicesRaw.find((s) => s.service === sid);
                if (svc) calculateSmmPrice(parseFloat(svc.rate));
            });
        }
    }

    function switchToPlatformOrder(platform, options = {}) {
        if (window.VotriGuard && !window.VotriGuard.isLoggedIn()) {
            toast('Vui lòng đăng nhập.', 'info');
            return;
        }
        pendingPlatformSelection = platform;
        pendingCategorySelection = null;
        pendingServiceSelection = null;
        if (!options.skipNavigate) {
            if (window.VotriGuard) {
                window.VotriGuard.navigate('create-order', { skipThrottle: true });
            } else if (window.VotriNav) {
                window.VotriNav.showMainTab('create-order', { skipGuard: true });
            }
        }
        ensureLoaded();
        if (smmServicesRaw.length > 0) applyPendingSmmOrderSelections();
        if (typeof renderAllViews === 'function') renderAllViews();
    }

    function switchToServiceOrder(platform, category, serviceId, options = {}) {
        if (window.VotriGuard && !window.VotriGuard.isLoggedIn()) {
            toast('Vui lòng đăng nhập.', 'info');
            return;
        }
        pendingPlatformSelection = platform;
        pendingCategorySelection = category;
        pendingServiceSelection = serviceId;

        window.__votriDbg?.('votri-smm.js:switchToServiceOrder', 'start', { platform, category, serviceId }, 'I');

        if (!options.skipNavigate) {
            if (window.VotriGuard) {
                window.VotriGuard.navigate('create-order', { skipThrottle: true });
            } else if (window.VotriNav) {
                window.VotriNav.showMainTab('create-order', { skipGuard: true });
            }
        }

        ensureLoaded();
        const sid = parseInt(serviceId, 10);
        const applyNow = () => {
            const svc = smmServicesRaw.find((s) => s.service === sid);
            if (svc && selectServiceForOrder(svc)) return true;
            return applyPendingSmmOrderSelections();
        };
        if (smmServicesRaw.length > 0) {
            if (!applyNow()) {
                toast('Không áp dụng được dịch vụ. Thử lại sau khi tải xong.', 'info');
            }
        }
        if (typeof renderAllViews === 'function') renderAllViews();
    }

    window.VotriSmm = {
        fetchServices,
        ensureLoaded,
        switchToPlatformOrder,
        switchToServiceOrder,
        calculateSmmPrice,
        bindOrderForm,
        applyPendingSmmOrderSelections
    };
})();
