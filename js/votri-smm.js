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
    let pricingFeatureAuditLogged = false;
    let smmServicePickerBound = false;
    let smmServiceOptions = [];

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
            max: parseInt(s.max, 10) || 100000,
            refill: s.refill === true || s.refill === 'true' || s.refill === 1 || s.refill === '1',
            cancel: s.cancel === true || s.cancel === 'true' || s.cancel === 1 || s.cancel === '1',
            dripfeed: s.dripfeed === true || s.dripfeed === 'true' || s.dripfeed === 1 || s.dripfeed === '1'
        };
    }

    function renderFeatureBadge({ icon, label, color, title }) {
        return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}66;font-size:0.7rem;padding:2px 6px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;" title="${title}"><i data-lucide="${icon}" style="width:11px;height:11px;"></i>${label}</span>`;
    }

    function renderSmmFeatures(s, opts = {}) {
        const compact = !!opts.compact;
        const badges = [];
        if (s.refill) {
            badges.push(renderFeatureBadge({ icon: 'shield-check', label: 'Bảo hành', color: '#10b981', title: 'Hỗ trợ bảo hành/Refill' }));
        }
        if (s.cancel) {
            badges.push(renderFeatureBadge({ icon: 'x-circle', label: 'Hỗ trợ hủy', color: '#3b82f6', title: 'Cho phép hủy đơn' }));
        }
        if (s.dripfeed) {
            badges.push(renderFeatureBadge({ icon: 'timer', label: 'Chạy chậm', color: '#f59e0b', title: 'Hỗ trợ Dripfeed/Chạy nhỏ giọt' }));
        }
        const html = badges.join(' ');
        if (!html) return '';
        if (compact) return html;
        return `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">${html}</div>`;
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
        const featRow = document.getElementById('smm-detail-features-row');
        if (featRow) featRow.style.display = 'none';
        const featEl = document.getElementById('smm-detail-features');
        if (featEl) featEl.innerHTML = '';
        const trigger = document.getElementById('smm-service-trigger');
        if (trigger) trigger.textContent = 'Vui lòng chọn dịch vụ';
    }

    function bindSmmServicePicker() {
        if (smmServicePickerBound) return;
        const trigger = document.getElementById('smm-service-trigger');
        const menu = document.getElementById('smm-service-menu');
        const search = document.getElementById('smm-service-search');
        if (!trigger || !menu || !search) return;
        smmServicePickerBound = true;

        trigger.addEventListener('click', () => {
            menu.classList.toggle('hidden');
            if (!menu.classList.contains('hidden')) {
                search.value = '';
                renderSmmServicePickerList('');
                search.focus();
            }
        });
        search.addEventListener('input', () => renderSmmServicePickerList(search.value || ''));
        document.addEventListener('click', (e) => {
            const wrap = document.getElementById('smm-service-picker');
            if (!wrap || !menu || menu.classList.contains('hidden')) return;
            if (!wrap.contains(e.target)) menu.classList.add('hidden');
        });
    }

    function renderSmmServicePickerList(keyword = '') {
        const listEl = document.getElementById('smm-service-list');
        const menu = document.getElementById('smm-service-menu');
        if (!listEl) return;
        const q = String(keyword).toLowerCase().trim();
        const rows = smmServiceOptions.filter((s) => {
            if (!q) return true;
            return String(s.service).includes(q) || String(s.name || '').toLowerCase().includes(q);
        });
        if (!rows.length) {
            listEl.innerHTML = '<div style="padding:10px;color:var(--text-dim);font-size:12px;">Không có dịch vụ phù hợp.</div>';
            return;
        }
        listEl.innerHTML = rows.map((s) => `
            <button type="button" class="smm-service-item" data-service-id="${s.service}" style="display:block;width:100%;text-align:left;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:#fff;cursor:pointer;">
                <div style="font-weight:600;">#${s.service} - ${esc(s.name)}</div>
                <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">${renderSmmFeatures(s, { compact: true })}</div>
            </button>
        `).join('');
        if (window.lucide) window.lucide.createIcons();
        listEl.querySelectorAll('.smm-service-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const sid = parseInt(btn.getAttribute('data-service-id'), 10);
                const service = smmServiceOptions.find((x) => x.service === sid);
                if (!service) return;
                const select = document.getElementById('smm-service');
                const trigger = document.getElementById('smm-service-trigger');
                if (select) select.value = String(sid);
                if (trigger) trigger.textContent = `#${sid} - ${service.name}`;
                if (menu) menu.classList.add('hidden');
                updateSmmDetails(sid);
                // #region agent log
                fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H15',location:'js/votri-smm.js:renderSmmServicePickerList:select',message:'Selected service via custom picker with badge-enabled items',data:{serviceId:sid,refill:service.refill,cancel:service.cancel,dripfeed:service.dripfeed},timestamp:Date.now()})}).catch(()=>{});
                // #endregion agent log
            });
        });
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

        const featRow = document.getElementById('smm-detail-features-row');
        const featEl = document.getElementById('smm-detail-features');
        if (featRow && featEl) {
            const featuresHtml = renderSmmFeatures(service, { compact: true });
            featRow.style.display = 'flex';
            featEl.innerHTML = featuresHtml;
            if (window.lucide) window.lucide.createIcons();
        }

        const tier = getCurrentUserSmmTier();
        let finalRate = parseFloat(service.rate);
        let tierBadge = '';
        if (tier === 'VIP') {
            finalRate = parseFloat(service.distributorRate) || parseFloat(service.vipRate) || Math.ceil((finalRate / 1.5) * 1.2);
            tierBadge = ' <span class="badge badge-neon-yellow" style="font-size:0.7rem;color:#000;font-weight:700;padding:2px 6px;">NPP Ưu đãi</span>';
        } else if (tier === 'Collaborator') {
            finalRate = parseFloat(service.collaboratorRate) || finalRate;
            tierBadge = ' <span class="badge badge-neon-cyan" style="font-size:0.7rem;font-weight:700;padding:2px 6px;">CTV</span>';
        } else {
            finalRate = parseFloat(service.memberRate) || finalRate;
            tierBadge = ' <span class="badge" style="background:rgba(255,255,255,0.08);font-size:0.7rem;font-weight:700;padding:2px 6px;color:var(--text-secondary);">Thành viên</span>';
        }

        document.getElementById('smm-detail-rate').innerHTML =
            `${finalRate.toLocaleString('vi-VN')}đ${tierBadge}`;
        document.getElementById('smm-detail-desc').textContent =
            service.desc || 'Không có mô tả chi tiết.';

        const commentsGroup = document.getElementById('smm-comments-group');
        const commentsInput = document.getElementById('smm-comments');
        if (commentsGroup) {
            if (service.type && service.type.toLowerCase().includes('comment')) {
                commentsGroup.classList.remove('hidden');
                if (qtyInput) {
                    qtyInput.readOnly = true;
                    qtyInput.style.opacity = '0.7';
                    qtyInput.style.cursor = 'not-allowed';
                    const lines = (commentsInput && commentsInput.value) ? commentsInput.value.split('\n').filter(l => l.trim()).length : 0;
                    qtyInput.value = Math.max(lines, 0);
                }
                if (commentsInput) {
                    commentsInput.oninput = () => {
                        if (qtyInput) {
                            const lines = commentsInput.value.split('\n').filter(l => l.trim()).length;
                            qtyInput.value = lines;
                        }
                        calculateSmmPrice(finalRate);
                    };
                }
            } else {
                commentsGroup.classList.add('hidden');
                if (qtyInput) {
                    qtyInput.readOnly = false;
                    qtyInput.style.opacity = '1';
                    qtyInput.style.cursor = 'text';
                }
                if (commentsInput) {
                    commentsInput.oninput = null;
                }
            }
        }

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
        bindSmmServicePicker();

        const services = smmServicesRaw.filter(
            (s) => s.platform === platform && s.category === category,
        );
        smmServiceOptions = services;
        serviceSelect.innerHTML = '<option value="" disabled selected>Chọn dịch vụ...</option>';
        services.forEach((s) => {
            const option = document.createElement('option');
            option.value = String(s.service);
            const suffixParts = [];
            if (s.refill) suffixParts.push('🛡️ Bảo hành');
            if (s.cancel) suffixParts.push('⏏️ Hỗ trợ hủy');
            if (s.dripfeed) suffixParts.push('🕓 Chạy chậm');
            const suffix = suffixParts.length ? `[${suffixParts.join(' • ')}]` : '';
            option.textContent = `#${s.service} - ${s.name} ${suffix} | ${s.rate}đ/1K`;
            option.style.background = '#111';
            serviceSelect.appendChild(option);
        });
        renderSmmServicePickerList('');
        const trigger = document.getElementById('smm-service-trigger');
        if (trigger) trigger.textContent = services.length ? 'Chọn dịch vụ...' : 'Không có dịch vụ';

        const pickId = opts.serviceId != null ? opts.serviceId : pendingServiceSelection;
        if (pickId != null && [...serviceSelect.options].some((o) => o.value === String(pickId))) {
            serviceSelect.value = String(pickId);
            const svc = services.find((x) => x.service === parseInt(pickId, 10));
            if (trigger && svc) trigger.textContent = `#${svc.service} - ${svc.name}`;
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
        smmServiceOptions = [];
        renderSmmServicePickerList('');

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

        if (!pricingFeatureAuditLogged && pageItems.length) {
            pricingFeatureAuditLogged = true;
            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H13',location:'js/votri-smm.js:renderPricingTable',message:'Pricing table rendered with feature badges (ON/OFF)',data:{itemsOnFirstRender:pageItems.length,sample:pageItems.slice(0,3).map(x=>({service:x.service,refill:x.refill,cancel:x.cancel,dripfeed:x.dripfeed}))},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log
        }

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
                const memberRate = parseFloat(s.memberRate) || parseFloat(s.rate);
                const collaboratorRate = parseFloat(s.collaboratorRate) || memberRate;
                const distributorRate = parseFloat(s.distributorRate) || parseFloat(s.vipRate) || Math.ceil((memberRate / 1.5) * 1.2);
                return `
            <tr>
                <td style="font-weight:600;color:var(--text-dim);text-align:center;vertical-align:middle;">#${s.service}</td>
                <td style="vertical-align:middle;">
                    <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">${esc(s.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-dim);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span class="badge" style="background:rgba(255,255,255,0.05);font-size:0.7rem;padding:1px 6px;">${esc(s.platform)}</span>
                        <span>${esc(s.category)}</span>
                        ${renderSmmFeatures(s)}
                    </div>
                </td>
                <td style="font-size:0.85rem;color:var(--text-secondary);font-family:monospace;text-align:center;vertical-align:middle;">
                    ${s.min.toLocaleString('en-US')} - ${parseInt(s.max, 10).toLocaleString('en-US')}
                </td>
                <td style="font-weight:600;color:var(--text-secondary);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${memberRate.toLocaleString('vi-VN')}đ
                </td>
                <td style="font-weight:700;color:var(--neon-cyan);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${collaboratorRate.toLocaleString('vi-VN')}đ
                </td>
                <td style="font-weight:700;color:var(--neon-yellow);font-size:0.95rem;text-align:center;vertical-align:middle;">
                    ${distributorRate.toLocaleString('vi-VN')}đ
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
            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H14',location:'js/votri-smm.js:fetchServices:feature-display-mode',message:'Feature badge mode set to true-only labels',data:{mode:'true-only',labels:['Bảo hành','Hỗ trợ hủy','Chạy chậm'],sample:smmServicesRaw.slice(0,3).map(x=>({service:x.service,refill:x.refill,cancel:x.cancel,dripfeed:x.dripfeed}))},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log
            // #region agent log
            fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4b9f03'},body:JSON.stringify({sessionId:'4b9f03',runId:'pre-fix',hypothesisId:'H12',location:'js/votri-smm.js:fetchServices',message:'Loaded and normalized service feature flags',data:{count:smmServicesRaw.length,featureCounts:smmServicesRaw.reduce((acc,x)=>{if(x.refill) acc.refillOn++; if(x.cancel) acc.cancelOn++; if(x.dripfeed) acc.dripfeedOn++; return acc;},{refillOn:0,cancelOn:0,dripfeedOn:0}),sample:smmServicesRaw.slice(0,3).map(x=>({service:x.service,refill:x.refill,cancel:x.cancel,dripfeed:x.dripfeed}))},timestamp:Date.now()})}).catch(()=>{});
            // #endregion agent log
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

        const commentsGroup = document.getElementById('smm-comments-group');
        let comments = undefined;
        if (commentsGroup && !commentsGroup.classList.contains('hidden')) {
            comments = document.getElementById('smm-comments')?.value?.trim();
            if (!comments) return toast('Vui lòng nhập bình luận.', 'error');
        }

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
                    quantity,
                    comments
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
                const trigger = document.getElementById('smm-service-trigger');
                if (trigger) trigger.textContent = 'Vui lòng chọn phân loại trước';
                document.getElementById('smm-link').value = '';
                const cEl = document.getElementById('smm-comments');
                if (cEl) cEl.value = '';
                document.getElementById('smm-quantity').value = '100';
                resetSmmDetails();
            } else {
                let errText = result.message || 'Đặt hàng thất bại';
                if (result.bytemartError) {
                    const raw = result.bytemartError;
                    // Bóc tách lỗi chi tiết từ JSON đối tác (hỗ trợ nhiều định dạng từ các API khác nhau)
                    const detail = raw.error || raw.message || raw.msg || raw.err || (typeof raw === 'string' ? raw : null);
                    if (detail) {
                        errText += ` (${detail})`;
                    } else if (raw.cancel && raw.cancel.error) {
                        errText += ` (${raw.cancel.error})`;
                    } else {
                        errText += ` (${JSON.stringify(raw)})`;
                    }
                }
                toast(errText, 'error');
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
                    <span style="font-size:11px;color:#888;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
                        <span>${esc(s.platform)} · ${esc(s.category)}</span>
                        ${renderSmmFeatures(s, { compact: true })}
                    </span>
                </button>`,
                )
                .join('');
            results.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
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

        const btnOpenBulk = document.getElementById('btn-open-bulk-modal');
        if (btnOpenBulk) {
            btnOpenBulk.addEventListener('click', (e) => {
                e.preventDefault();
                openBulkOrderModal();
            });
        }
    }

    let bulkSelectedService = null;

    function initBulkModalHtml() {
        if (document.getElementById('bulk-order-modal')) return;
        const html = `
            <div class="bulk-modal-backdrop" id="bulk-order-modal">
                <div class="bulk-modal-wrapper glass-card">
                    <div class="bulk-modal-header">
                        <h3 class="bulk-modal-title">MUA NHIỀU ĐƠN HÀNG HÀNG LOẠT</h3>
                        <button class="bulk-modal-close" id="bulk-modal-close-btn">&times;</button>
                    </div>
                    <div class="bulk-modal-body">
                        <div class="selected-service-info">
                            <div class="selected-service-title" id="bulk-svc-title">-</div>
                            <div class="selected-service-meta">
                                <span>Mã gói: <strong id="bulk-svc-id">-</strong></span>
                                <span>Giá mỗi 1.000: <strong id="bulk-svc-rate">-</strong></span>
                                <span>Tối thiểu: <strong id="bulk-svc-min">-</strong></span>
                                <span>Tối đa: <strong id="bulk-svc-max">-</strong></span>
                            </div>
                        </div>
                        
                        <!-- Main View for Buy Now -->
                        <div class="bulk-grid" id="bulk-modal-main-grid">
                            <!-- Left: Config & Action -->
                            <div class="bulk-left">
                                <div class="bulk-form-group">
                                    <label for="bulk-links">Danh sách liên kết (Mỗi dòng 1 liên kết) *</label>
                                    <textarea class="bulk-textarea" id="bulk-links" rows="8" placeholder="Nhập mỗi liên kết trên một dòng&#10;https://facebook.com/page1&#10;https://facebook.com/page2"></textarea>
                                    <span class="bulk-help-text" id="bulk-links-count">Tổng cộng: 0 liên kết</span>
                                </div>

                                <div class="bulk-form-group hidden" id="bulk-comments-group" style="margin-bottom: 16px;">
                                    <label for="bulk-comments">Bình luận (Mỗi dòng 1 bình luận)</label>
                                    <textarea class="bulk-textarea" id="bulk-comments" rows="5" placeholder="Nhập mỗi bình luận trên một dòng..." style="resize: vertical;"></textarea>
                                </div>
                                
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                    <div class="bulk-form-group">
                                        <label for="bulk-qty">Số lượng mỗi đơn *</label>
                                        <input type="number" class="bulk-input" id="bulk-qty" value="100" min="1">
                                        <span class="bulk-help-text" id="bulk-qty-hint">Tối thiểu: 100 - Tối đa: 100.000</span>
                                    </div>
                                    <div class="bulk-form-group" id="bulk-delay-group">
                                        <label for="bulk-delay">Thời gian chờ giữa đơn (giây) *</label>
                                        <input type="number" class="bulk-input" id="bulk-delay" value="2" min="0" max="30">
                                        <span class="bulk-help-text">Tránh bị chặn hệ thống</span>
                                    </div>
                                </div>
                                
                                <div class="bulk-calc-panel">
                                    <div class="bulk-calc-row">
                                        <span>Giá gốc / 1.000:</span>
                                        <span id="bulk-calc-rate">0đ</span>
                                    </div>
                                    <div class="bulk-calc-row">
                                        <span>Tổng số đơn:</span>
                                        <span id="bulk-calc-orders">0</span>
                                    </div>
                                    <div class="bulk-calc-row total">
                                        <span>Tổng tiền cần thanh toán:</span>
                                        <span id="bulk-calc-total">0đ</span>
                                    </div>
                                </div>
                                
                                <button class="btn btn-primary" id="bulk-submit-btn" style="width: 100%; justify-content: center; gap: 8px;">
                                    <i data-lucide="play" style="width:16px;"></i> <span id="bulk-submit-btn-text">Bắt đầu mua đơn</span>
                                </button>
                                
                                <div class="bulk-warning-box" id="bulk-warning-container">
                                    <i data-lucide="alert-triangle" style="width: 16px; flex-shrink:0; margin-top: 2px;"></i>
                                    <span>Vui lòng KHÔNG đóng trang hoặc tab này trong quá trình mua nhiều đơn hàng. Việc đóng trang có thể làm gián đoạn quá trình.</span>
                                </div>
                            </div>
                            
                            <!-- Right: Order Progress status list -->
                            <div class="bulk-right">
                                <div class="bulk-status-container">
                                    <div class="bulk-status-header">
                                        <span class="bulk-status-title">Trạng thái mua đơn</span>
                                        <span class="bulk-status-progress-text" id="bulk-progress-text">Tiến trình: 0 / 0</span>
                                    </div>
                                    <div class="bulk-progress-bar-container">
                                        <div class="bulk-progress-bar-fill" id="bulk-progress-bar-fill"></div>
                                    </div>
                                    <div class="bulk-status-list" id="bulk-status-list">
                                        <div class="bulk-status-empty">
                                            <i data-lucide="shopping-cart" style="width: 48px; height: 48px;"></i>
                                            <span>Vui lòng nhập danh sách liên kết</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);

        // Bind events
        document.getElementById('bulk-modal-close-btn').onclick = closeBulkOrderModal;
        document.getElementById('bulk-order-modal').onclick = (e) => {
            if (e.target.id === 'bulk-order-modal') closeBulkOrderModal();
        };

        // Inputs calc triggers
        document.getElementById('bulk-links').oninput = onBulkInputChanged;
        document.getElementById('bulk-qty').oninput = onBulkInputChanged;
        document.getElementById('bulk-comments').oninput = () => {
            const commentsInput = document.getElementById('bulk-comments');
            const qtyInput = document.getElementById('bulk-qty');
            if (commentsInput && qtyInput && bulkSelectedService && bulkSelectedService.type && bulkSelectedService.type.toLowerCase().includes('comment')) {
                const lines = commentsInput.value.split('\n').filter(l => l.trim()).length;
                qtyInput.value = lines;
            }
            onBulkInputChanged();
        };

        // Submit action
        document.getElementById('bulk-submit-btn').onclick = submitBulkAction;
    }

    function openBulkOrderModal() {
        const serviceSelect = document.getElementById('smm-service');
        if (!serviceSelect || !serviceSelect.value) {
            return toast('Vui lòng chọn một gói dịch vụ trước.', 'error');
        }

        const serviceId = parseInt(serviceSelect.value, 10);
        const service = smmServicesRaw.find((s) => s.service === serviceId);
        if (!service) {
            return toast('Không tìm thấy thông tin gói dịch vụ.', 'error');
        }

        // Initialize HTML
        initBulkModalHtml();
        
        bulkSelectedService = service;
        
        const tier = getCurrentUserSmmTier();
        let finalRate = parseFloat(service.rate);
        if (tier === 'VIP') {
            finalRate = parseFloat(service.vipRate) || Math.ceil((finalRate / 1.4) * 1.01);
        } else if (tier === 'Collaborator') {
            finalRate = parseFloat(service.collaboratorRate) || Math.ceil((finalRate / 1.4) * 1.05);
        }
        
        document.getElementById('bulk-svc-title').textContent = service.name;
        document.getElementById('bulk-svc-id').textContent = `#${service.service}`;
        document.getElementById('bulk-svc-rate').textContent = `${finalRate.toLocaleString('vi-VN')}đ`;
        document.getElementById('bulk-svc-min').textContent = service.min.toLocaleString('en-US');
        document.getElementById('bulk-svc-max').textContent = service.max.toLocaleString('en-US');

        const qtyInput = document.getElementById('bulk-qty');
        if (qtyInput) {
            qtyInput.min = service.min;
            qtyInput.max = service.max;
            document.getElementById('bulk-qty-hint').textContent = `Tối thiểu: ${service.min} - Tối đa: ${service.max.toLocaleString('en-US')}`;
        }
        
        // Populate inputs with create order values if present
        const mainLink = document.getElementById('smm-link')?.value?.trim();
        const mainQty = document.getElementById('smm-quantity')?.value || '100';
        
        if (mainLink) document.getElementById('bulk-links').value = mainLink;
        if (qtyInput) {
            qtyInput.value = mainQty;
        }

        const commentsGroup = document.getElementById('bulk-comments-group');
        const commentsInput = document.getElementById('bulk-comments');
        if (commentsGroup && commentsInput) {
            if (service.type && service.type.toLowerCase().includes('comment')) {
                commentsGroup.classList.remove('hidden');
                if (qtyInput) {
                    qtyInput.readOnly = true;
                    qtyInput.style.opacity = '0.7';
                    qtyInput.style.cursor = 'not-allowed';
                }
                const mainComments = document.getElementById('smm-comments')?.value || '';
                commentsInput.value = mainComments;
                
                const lines = mainComments.split('\n').filter(l => l.trim()).length;
                if (qtyInput) qtyInput.value = lines;
            } else {
                commentsGroup.classList.add('hidden');
                commentsInput.value = '';
                if (qtyInput) {
                    qtyInput.readOnly = false;
                    qtyInput.style.opacity = '1';
                    qtyInput.style.cursor = 'text';
                }
            }
        }

        // Reset right progress side
        resetBulkProgressPanel();

        onBulkInputChanged();

        // Show modal
        const modal = document.getElementById('bulk-order-modal');
        modal.classList.add('active');
        if (window.lucide) window.lucide.createIcons();
    }

    function closeBulkOrderModal() {
        const modal = document.getElementById('bulk-order-modal');
        if (modal) modal.classList.remove('active');
    }

    function parseBulkLinks() {
        const text = document.getElementById('bulk-links')?.value || '';
        return text.split('\n').map(l => l.trim()).filter(Boolean);
    }

    function parseBulkItems() {
        const text = document.getElementById('bulk-links')?.value || '';
        const defaultQty = parseInt(document.getElementById('bulk-qty')?.value, 10) || 0;
        return text.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return null;
            const parts = trimmed.split('|');
            const link = parts[0].trim();
            let quantity = defaultQty;
            if (parts.length > 1) {
                const parsedQty = parseInt(parts[1].trim(), 10);
                if (!isNaN(parsedQty) && parsedQty > 0) {
                    quantity = parsedQty;
                }
            }
            return { link, quantity };
        }).filter(Boolean);
    }

    function getBulkRate() {
        if (!bulkSelectedService) return 0;
        const tier = getCurrentUserSmmTier();
        let rate = parseFloat(bulkSelectedService.rate);
        if (tier === 'VIP') {
            rate = parseFloat(bulkSelectedService.vipRate) || Math.ceil((rate / 1.4) * 1.01);
        } else if (tier === 'Collaborator') {
            rate = parseFloat(bulkSelectedService.collaboratorRate) || Math.ceil((rate / 1.4) * 1.05);
        }
        return rate;
    }

    function onBulkInputChanged() {
        const items = parseBulkItems();
        const rate = getBulkRate();
        
        // Update counts
        const linksCountEl = document.getElementById('bulk-links-count');
        const calcOrdersEl = document.getElementById('bulk-calc-orders');
        if (linksCountEl) linksCountEl.textContent = `Tổng cộng: ${items.length} liên kết`;
        if (calcOrdersEl) calcOrdersEl.textContent = items.length.toLocaleString('vi-VN');
        
        // Calculate price
        const pricePerUnit = rate / 1000;
        const totalCost = items.reduce((sum, item) => sum + (item.quantity * pricePerUnit), 0);
        
        const calcRateEl = document.getElementById('bulk-calc-rate');
        const calcTotalEl = document.getElementById('bulk-calc-total');
        if (calcRateEl) calcRateEl.textContent = `${rate.toLocaleString('vi-VN')}đ`;
        if (calcTotalEl) calcTotalEl.textContent = `${totalCost.toLocaleString('vi-VN')}đ`;
        
        const listContainer = document.getElementById('bulk-status-list');
        if (!listContainer) return;
        if (items.length === 0) {
            listContainer.innerHTML = `
                <div class="bulk-status-empty">
                    <i data-lucide="shopping-cart" style="width: 48px; height: 48px;"></i>
                    <span>Vui lòng nhập danh sách liên kết</span>
                </div>
            `;
            document.getElementById('bulk-progress-text').textContent = 'Tiến trình: 0 / 0';
            document.getElementById('bulk-progress-bar-fill').style.width = '0%';
            if (window.lucide) window.lucide.createIcons();
        } else {
            listContainer.innerHTML = items.map((item, idx) => `
                <div class="bulk-status-item" id="bulk-item-${idx}">
                    <span class="bulk-status-link" title="${esc(item.link)}">${esc(item.link)} <small style="color:var(--text-muted)">(${item.quantity.toLocaleString()} qty)</small></span>
                    <span class="bulk-status-badge pending" id="bulk-badge-${idx}">PENDING</span>
                </div>
            `).join('');
            document.getElementById('bulk-progress-text').textContent = `Tiến trình: 0 / ${items.length}`;
            document.getElementById('bulk-progress-bar-fill').style.width = '0%';
        }
    }

    function resetBulkProgressPanel() {
        const progressTextEl = document.getElementById('bulk-progress-text');
        const progressFillEl = document.getElementById('bulk-progress-bar-fill');
        const statusListEl = document.getElementById('bulk-status-list');
        if (progressTextEl) progressTextEl.textContent = 'Tiến trình: 0 / 0';
        if (progressFillEl) progressFillEl.style.width = '0%';
        if (statusListEl) {
            statusListEl.innerHTML = `
                <div class="bulk-status-empty">
                    <i data-lucide="shopping-cart" style="width: 48px; height: 48px;"></i>
                    <span>Vui lòng nhập danh sách liên kết</span>
                </div>
            `;
        }
    }

    let bulkConfirmCallback = null;

    function initBulkConfirmModalHtml() {
        if (document.getElementById('bulk-confirm-modal')) return;
        const html = `
            <div class="bulk-modal-backdrop" id="bulk-confirm-modal" style="display: none; z-index: 100005 !important; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); align-items: center; justify-content: center;">
                <div class="bulk-modal-wrapper glass-card" style="max-width: 450px; padding: 24px; text-align: center; background: rgba(20, 20, 30, 0.95); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <div style="margin-bottom: 20px;">
                        <i data-lucide="help-circle" style="width: 48px; height: 48px; color: var(--neon-cyan); margin: 0 auto 12px; display: block;"></i>
                        <h3 style="margin: 0; color: #fff; font-size: 1.2rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">XÁC NHẬN ĐƠN HÀNG HÀNG LOẠT</h3>
                    </div>
                    
                    <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 16px; text-align: left; margin-bottom: 24px; font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary);">
                        <div style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px; color: #fff; font-weight: 600;" id="bulk-conf-service-name">-</div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Tổng số đơn (links):</span>
                            <strong id="bulk-conf-links-count" style="color: #fff;">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Số lượng mỗi đơn:</span>
                            <strong id="bulk-conf-qty" style="color: #fff;">0</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 10px; font-size: 1rem;">
                            <span style="font-weight: 600; color: var(--text-primary);">Tổng thanh toán:</span>
                            <strong id="bulk-conf-total" style="color: var(--neon-cyan); font-weight: 700;">0đ</strong>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <button class="btn btn-secondary" id="bulk-conf-btn-cancel" style="border: 1px solid rgba(255,255,255,0.15); background: transparent; color: #fff; width: 100%; justify-content: center; height: 42px; cursor: pointer; border-radius: 8px;">Hủy</button>
                        <button class="btn btn-primary" id="bulk-conf-btn-ok" style="background: linear-gradient(135deg, var(--neon-cyan), #0077ff); color: #000; font-weight: 700; width: 100%; justify-content: center; height: 42px; border: none; cursor: pointer; border-radius: 8px; box-shadow: 0 4px 15px rgba(0, 243, 255, 0.25);">Đồng ý mua</button>
                    </div>
                </div>
            </div>
        `;
        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);

        document.getElementById('bulk-conf-btn-cancel').onclick = () => {
            closeBulkConfirmModal();
            if (bulkConfirmCallback) bulkConfirmCallback(false);
        };
        document.getElementById('bulk-conf-btn-ok').onclick = () => {
            closeBulkConfirmModal();
            if (bulkConfirmCallback) bulkConfirmCallback(true);
        };
        document.getElementById('bulk-confirm-modal').onclick = (e) => {
            if (e.target.id === 'bulk-confirm-modal') {
                closeBulkConfirmModal();
                if (bulkConfirmCallback) bulkConfirmCallback(false);
            }
        };
    }

    function showBulkConfirmModal(details, callback) {
        initBulkConfirmModalHtml();
        
        document.getElementById('bulk-conf-service-name').textContent = details.serviceName;
        document.getElementById('bulk-conf-links-count').textContent = details.linksCount;
        
        const uniqQties = [...new Set(details.items.map(i => i.quantity))];
        const qtyText = uniqQties.length === 1 ? uniqQties[0].toLocaleString('vi-VN') : 'Đa dạng (Multi)';
        document.getElementById('bulk-conf-qty').textContent = qtyText;
        
        document.getElementById('bulk-conf-total').textContent = `${details.totalCost.toLocaleString('vi-VN')}đ`;
        
        bulkConfirmCallback = callback;
        const modal = document.getElementById('bulk-confirm-modal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            if (window.lucide) window.lucide.createIcons();
        }
    }

    function closeBulkConfirmModal() {
        const modal = document.getElementById('bulk-confirm-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }
    }

    async function submitBulkAction() {
        if (!bulkSelectedService) return toast('Lỗi: Chưa chọn gói dịch vụ.', 'error');
        
        const items = parseBulkItems();
        if (items.length === 0) return toast('Vui lòng nhập ít nhất một liên kết.', 'error');

        let comments = undefined;
        if (bulkSelectedService.type && bulkSelectedService.type.toLowerCase().includes('comment')) {
            comments = document.getElementById('bulk-comments')?.value?.trim();
            if (!comments) {
                return toast('Vui lòng nhập nội dung bình luận.', 'error');
            }
        }
        
        // Validate từng item quantity
        for (const item of items) {
            if (!item.quantity || item.quantity < bulkSelectedService.min) {
                return toast(`Số lượng đơn [${item.link}] tối thiểu là ${bulkSelectedService.min.toLocaleString('en-US')}`, 'error');
            }
            if (item.quantity > bulkSelectedService.max) {
                return toast(`Số lượng đơn [${item.link}] tối đa là ${bulkSelectedService.max.toLocaleString('en-US')}`, 'error');
            }
        }

        const rate = getBulkRate();
        const pricePerUnit = rate / 1000;
        const totalCost = items.reduce((sum, item) => sum + (item.quantity * pricePerUnit), 0);

        showBulkConfirmModal({
            serviceName: bulkSelectedService.name,
            linksCount: items.length,
            items: items,
            totalCost: totalCost
        }, async (confirmed) => {
            if (!confirmed) return;
            
            const token = app().getSessionToken?.() || sessionStorage.getItem('votri_sys_token');
            if (!token) return toast('Vui lòng đăng nhập lại.', 'error');

            const delay = parseInt(document.getElementById('bulk-delay').value, 10) || 2;
            const submitBtn = document.getElementById('bulk-submit-btn');
            
            try {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Đang chạy...';
                
                // Show initial status
                items.forEach((_, idx) => {
                    const badge = document.getElementById(`bulk-badge-${idx}`);
                    const itemEl = document.getElementById(`bulk-item-${idx}`);
                    if (badge && itemEl) {
                        badge.className = 'bulk-status-badge pending';
                        badge.textContent = 'PENDING';
                        itemEl.className = 'bulk-status-item';
                    }
                });

                const res = await fetch(`${app().API_BASE}/api/smm/bulk-order`, {
                    method: 'POST',
                    headers: app().authHeaders ? app().authHeaders() : {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        serviceId: bulkSelectedService.service,
                        items: items,
                        delay,
                        comments
                    })
                });

                const result = app().parseJsonResponse ? await app().parseJsonResponse(res) : await res.json();
                
                if (result.success) {
                    toast(result.message || 'Hoàn tất mua nhiều đơn!', 'success');
                    
                    let completed = 0;
                    if (Array.isArray(result.results)) {
                        result.results.forEach((r, idx) => {
                            const badge = document.getElementById(`bulk-badge-${idx}`);
                            const itemEl = document.getElementById(`bulk-item-${idx}`);
                            if (badge && itemEl) {
                                if (r.success) {
                                    badge.className = 'bulk-status-badge success';
                                    badge.textContent = 'SUCCESS';
                                    itemEl.className = 'bulk-status-item success';
                                    completed++;
                                } else {
                                    badge.className = 'bulk-status-badge failed';
                                    badge.textContent = 'FAILED';
                                    itemEl.className = 'bulk-status-item failed';
                                    itemEl.title = r.error || 'Thất bại';
                                }
                            }
                        });
                        
                        document.getElementById('bulk-progress-text').textContent = `Tiến trình: ${completed} / ${items.length}`;
                        document.getElementById('bulk-progress-bar-fill').style.width = '100%';
                    }
                    
                    if (result.newBalance != null) {
                        const bal = document.getElementById('stat-balance');
                        if (bal) bal.textContent = result.newBalance.toLocaleString('vi-VN');
                    }
                    
                    if (app().syncDatabaseData) await app().syncDatabaseData();
                    if (window.OrdersPage) window.OrdersPage.refresh();
                } else {
                    toast(result.message || 'Lỗi khi mua hàng loạt.', 'error');
                }
            } catch (err) {
                console.error('[BULK SUBMIT ERROR]', err);
                toast('Lỗi kết nối server.', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i data-lucide="play" style="width:16px;"></i> Bắt đầu mua đơn';
                if (window.lucide) window.lucide.createIcons();
            }
        });
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
        applyPendingSmmOrderSelections,
        openBulkOrderModal,
        closeBulkOrderModal
    };
})();
