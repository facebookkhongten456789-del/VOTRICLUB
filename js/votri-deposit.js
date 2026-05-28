/**
 * Nạp tiền PayOS (VietQR) + Lịch sử nạp tiền
 * - User: xem lịch sử nạp tiền CỦA MÌNH (chỉ đọc, không retry)
 * - Admin: xem TẤT CẢ giao dịch nạp tiền, có thể check/retry trên PayOS
 *
 * API: POST /api/payos/create-payment
 *      POST /api/payos/check-deposit (admin only)
 *      POST /api/sync/data → deposits[]
 */
(function () {
    function core() { return window.VotriApp; }

    /* ── Pagination ── */
    const PAGE_SIZE = 10;
    let currentPage = 1;
    let filteredDeposits = [];

    /* ── Helpers ── */
    function formatVND(amount) {
        return Number(amount || 0).toLocaleString('vi-VN') + 'đ';
    }

    function formatDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function statusPill(status) {
        const map = {
            pending:   { label: 'Đang chờ',   cls: 'deposit-status-pending' },
            completed: { label: 'Thành công',  cls: 'deposit-status-completed' },
            failed:    { label: 'Thất bại',    cls: 'deposit-status-failed' },
            cancelled: { label: 'Đã hủy',     cls: 'deposit-status-cancelled' },
        };
        const info = map[status] || { label: status || '?', cls: 'deposit-status-pending' };
        return `<span class="deposit-status-pill ${info.cls}">${info.label}</span>`;
    }

    function getDeposits() {
        try {
            return JSON.parse(localStorage.getItem('votri_sys_deposits') || '[]');
        } catch { return []; }
    }

    function isAdmin() {
        return core()?.isCurrentUserAdmin?.() || false;
    }

    /* ── Update header/subtitle based on role ── */
    function updateHeaderForRole() {
        const admin = isAdmin();
        const titleEl = document.getElementById('deposit-history-title-text');
        const subtitleEl = document.getElementById('deposit-history-subtitle');
        const searchEl = document.getElementById('deposit-filter-search');

        if (titleEl) {
            titleEl.textContent = admin
                ? 'Quản lý nạp tiền — Tất cả thành viên'
                : 'Lịch sử nạp tiền của bạn';
        }
        if (subtitleEl) {
            subtitleEl.textContent = admin
                ? 'Theo dõi và xử lý tất cả giao dịch nạp tiền. Kiểm tra webhook và cộng tiền thủ công khi cần.'
                : 'Các giao dịch nạp tiền vào tài khoản của bạn';
        }
        if (searchEl) {
            searchEl.placeholder = admin
                ? 'Mã giao dịch, ghi chú, email user...'
                : 'Mã giao dịch, ghi chú...';
        }
    }

    /* ── Stat cards ── */
    function updateStats(deposits) {
        const elTotal     = document.getElementById('deposit-stat-total');
        const elPending   = document.getElementById('deposit-stat-pending');
        const elCompleted = document.getElementById('deposit-stat-completed');
        const elFailed    = document.getElementById('deposit-stat-failed');
        const elAmount    = document.getElementById('deposit-stat-amount');
        if (!elTotal) return;

        const total     = deposits.length;
        const pending   = deposits.filter(d => d.status === 'pending').length;
        const completed = deposits.filter(d => d.status === 'completed').length;
        const failed    = deposits.filter(d => d.status === 'failed' || d.status === 'cancelled').length;
        const sumCompleted = deposits
            .filter(d => d.status === 'completed')
            .reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

        elTotal.textContent     = total;
        elPending.textContent   = pending;
        elCompleted.textContent = completed;
        elFailed.textContent    = failed;
        elAmount.textContent    = formatVND(sumCompleted);
    }

    /* ── Filter & Search ── */
    function applyFilters() {
        const deposits = getDeposits();
        const searchEl = document.getElementById('deposit-filter-search');
        const statusEl = document.getElementById('deposit-filter-status');
        const query  = (searchEl?.value || '').trim().toLowerCase();
        const status = statusEl?.value || 'ALL';

        filteredDeposits = deposits.filter(d => {
            if (status !== 'ALL' && d.status !== status) return false;
            if (query) {
                const haystack = [
                    d.transactionId, d.note, d.userEmail,
                    String(d.amount), d.method, d.status
                ].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        });

        updateStats(deposits);
        currentPage = 1;
        renderTable();
    }

    /* ── Render Table ── */
    function renderTable() {
        const tbody = document.getElementById('deposit-history-body');
        if (!tbody) return;

        const admin = isAdmin();
        const thUser = document.getElementById('th-deposit-user');
        if (thUser) thUser.style.display = admin ? '' : 'none';

        const colCount = admin ? 9 : 8;

        if (!filteredDeposits.length) {
            const emptyMsg = admin
                ? 'Chưa có giao dịch nạp tiền nào trong hệ thống'
                : 'Bạn chưa có giao dịch nạp tiền nào';
            tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-center text-dim" style="padding: 40px;">
                <i data-lucide="inbox" style="width: 32px; margin-bottom: 8px; opacity: 0.3; display: block; margin-left: auto; margin-right: auto;"></i>
                ${emptyMsg}
            </td></tr>`;
            updatePagination();
            if (window.lucide) lucide.createIcons();
            return;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const page  = filteredDeposits.slice(start, start + PAGE_SIZE);

        let html = '';
        page.forEach((d, i) => {
            const idx = start + i + 1;
            const isPending = d.status === 'pending';
            const isFailed  = d.status === 'failed';
            const txId = d.transactionId || '—';

            // Admin: nút retry (kiểm tra PayOS) cho pending/failed
            // User: chỉ xem, KHÔNG có nút retry (phải liên hệ admin nếu lỗi)
            const showRetry = admin && (isPending || isFailed);

            html += `<tr style="animation: fadeInRow 0.3s ease ${i * 0.04}s both;">
                <td style="color: var(--text-dim); font-size: 0.8rem;">${idx}</td>
                ${admin ? `<td style="font-size: 0.8rem; color: var(--text-secondary);">${core().escapeHTML(d.userEmail || '—')}</td>` : ''}
                <td>
                    <code style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; font-size: 0.82rem; color: var(--neon-cyan); letter-spacing: 0.3px;">${core().escapeHTML(txId)}</code>
                </td>
                <td style="text-align: right; font-weight: 600; font-family: 'JetBrains Mono', monospace; color: #39FF14;">${formatVND(d.amount)}</td>
                <td>
                    <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.85rem;">
                        <i data-lucide="credit-card" style="width: 14px; color: #60a5fa;"></i>
                        ${core().escapeHTML(d.method || 'PayOS')}
                    </span>
                </td>
                <td style="text-align: center;">${statusPill(d.status)}</td>
                <td style="font-size: 0.82rem; color: var(--text-dim); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${core().escapeHTML(d.note || '')}">${core().escapeHTML(d.note || '—')}</td>
                <td style="font-size: 0.82rem; color: var(--text-secondary); white-space: nowrap;">${formatDate(d.createdAt)}</td>
                <td style="text-align: center;">
                    ${showRetry ? `<button class="deposit-action-btn deposit-retry-btn" data-txid="${core().escapeHTML(txId)}" title="Kiểm tra trên PayOS & xử lý lại">
                        <i data-lucide="refresh-cw" style="width: 14px;"></i>
                    </button>` : ''}
                    <button class="deposit-action-btn deposit-detail-btn" data-id="${d.id}" data-txid="${core().escapeHTML(txId)}" data-amount="${d.amount}" data-status="${d.status}" data-method="${core().escapeHTML(d.method || '')}" data-note="${core().escapeHTML(d.note || '')}" data-date="${d.createdAt || ''}" data-email="${core().escapeHTML(d.userEmail || '')}" title="Chi tiết giao dịch">
                        <i data-lucide="eye" style="width: 14px;"></i>
                    </button>
                </td>
            </tr>`;
        });

        tbody.innerHTML = html;
        updatePagination();
        bindRowActions();
        if (window.lucide) lucide.createIcons();
    }

    /* ── Pagination ── */
    function updatePagination() {
        const infoEl = document.getElementById('deposit-pagination-info');
        const ctrlEl = document.getElementById('deposit-pagination-controls');
        if (!infoEl || !ctrlEl) return;

        const total = filteredDeposits.length;
        const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
        const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, total);

        infoEl.textContent = `Hiển thị ${start} - ${end} của ${total} giao dịch`;

        let btns = '';
        if (totalPages > 1) {
            btns += `<button class="dep-page-btn${currentPage === 1 ? ' disabled' : ''}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
            for (let p = 1; p <= totalPages; p++) {
                if (totalPages > 7 && p > 2 && p < totalPages - 1 && Math.abs(p - currentPage) > 1) {
                    if (p === 3 || p === totalPages - 2) btns += `<span class="dep-page-ellipsis">…</span>`;
                    continue;
                }
                btns += `<button class="dep-page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
            }
            btns += `<button class="dep-page-btn${currentPage === totalPages ? ' disabled' : ''}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
        }
        ctrlEl.innerHTML = btns;

        ctrlEl.querySelectorAll('.dep-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = parseInt(btn.dataset.page, 10);
                if (p >= 1 && p <= totalPages) {
                    currentPage = p;
                    renderTable();
                }
            });
        });
    }

    /* ── Row Actions: Retry (Admin only) & Detail ── */
    function bindRowActions() {
        // Retry buttons: chỉ admin mới thấy (đã filter ở renderTable)
        document.querySelectorAll('.deposit-retry-btn').forEach(btn => {
            btn.addEventListener('click', () => retryDeposit(btn.dataset.txid));
        });
        document.querySelectorAll('.deposit-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => showDepositDetail(btn.dataset));
        });
    }

    /* Admin: gọi PayOS API kiểm tra + tự động cộng tiền nếu đã thanh toán */
    async function retryDeposit(txId) {
        if (!txId || txId === '—') {
            core()?.showToast?.('Mã giao dịch không hợp lệ.', 'info');
            return;
        }
        core()?.showToast?.(`Đang kiểm tra giao dịch ${txId} trên PayOS...`, 'info');

        try {
            const res = await fetch(`${core().API_BASE}/api/payos/check-deposit`, {
                method: 'POST',
                headers: core().authHeaders(),
                body: JSON.stringify({ transactionId: txId }),
            });
            const result = await res.json();

            if (result.success) {
                if (result.credited) {
                    core()?.showToast?.(result.message, 'success');
                } else {
                    core()?.showToast?.(result.message, 'info');
                }
            } else {
                core()?.showToast?.(result.message || 'Không kiểm tra được giao dịch.', 'info');
            }
        } catch (err) {
            console.error('[DEPOSIT CHECK]', err);
            core()?.showToast?.('Lỗi kết nối server khi kiểm tra giao dịch.', 'info');
        }

        // Sync lại data sau khi check
        if (window.VotriApp?.syncDatabaseData) {
            await window.VotriApp.syncDatabaseData();
        }
        applyFilters();
    }

    function showDepositDetail(data) {
        const existing = document.getElementById('deposit-detail-modal');
        if (existing) existing.remove();

        const admin = isAdmin();
        const overlay = document.createElement('div');
        overlay.id = 'deposit-detail-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);animation:fadeInRow 0.2s ease;';

        const canRetry = admin && (data.status === 'pending' || data.status === 'failed');

        overlay.innerHTML = `
            <div style="background: var(--bg-card, #0d1117); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5); position: relative;">
                <button id="deposit-detail-close" style="position: absolute; top: 12px; right: 16px; background: none; border: none; color: var(--text-dim); font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button>
                <h3 style="margin: 0 0 24px; font-size: 1.2rem; display: flex; align-items: center; gap: 10px; color: var(--neon-cyan);">
                    <i data-lucide="file-text" style="width: 20px;"></i>
                    Chi tiết giao dịch
                </h3>
                <div style="display: grid; gap: 14px;">
                    ${admin && data.email ? `<div class="dep-detail-row"><span class="dep-detail-label">Email</span><span class="dep-detail-value">${data.email}</span></div>` : ''}
                    <div class="dep-detail-row"><span class="dep-detail-label">Mã giao dịch</span><span class="dep-detail-value" style="font-family: 'JetBrains Mono', monospace; color: var(--neon-cyan);">${data.txid || '—'}</span></div>
                    <div class="dep-detail-row"><span class="dep-detail-label">Số tiền</span><span class="dep-detail-value" style="color: #39FF14; font-weight: 700; font-size: 1.1rem;">${formatVND(data.amount)}</span></div>
                    <div class="dep-detail-row"><span class="dep-detail-label">Phương thức</span><span class="dep-detail-value">${data.method || 'PayOS'}</span></div>
                    <div class="dep-detail-row"><span class="dep-detail-label">Trạng thái</span><span class="dep-detail-value">${statusPill(data.status)}</span></div>
                    <div class="dep-detail-row"><span class="dep-detail-label">Ghi chú</span><span class="dep-detail-value" style="word-break: break-word;">${data.note || '—'}</span></div>
                    <div class="dep-detail-row"><span class="dep-detail-label">Thời gian</span><span class="dep-detail-value">${formatDate(data.date)}</span></div>
                </div>
                ${canRetry ? `
                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06);">
                    <button id="deposit-detail-retry" class="btn" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #0066ff, #3385ff); border: none; border-radius: 8px; color: #fff; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <i data-lucide="refresh-cw" style="width: 16px;"></i>
                        Kiểm tra trên PayOS & xử lý lại
                    </button>
                </div>` : ''}
                ${!admin && (data.status === 'pending' || data.status === 'failed') ? `
                <div style="margin-top: 20px; padding: 12px 16px; background: rgba(250,204,21,0.06); border: 1px solid rgba(250,204,21,0.15); border-radius: 8px; font-size: 0.82rem; color: #facc15; display: flex; align-items: flex-start; gap: 8px;">
                    <i data-lucide="alert-triangle" style="width: 16px; flex-shrink: 0; margin-top: 1px;"></i>
                    <span>Nếu bạn đã chuyển khoản nhưng chưa được cộng tiền, vui lòng liên hệ admin qua mục <strong>Hỗ trợ</strong> để được xử lý.</span>
                </div>` : ''}
            </div>
        `;

        document.body.appendChild(overlay);
        if (window.lucide) lucide.createIcons();

        overlay.querySelector('#deposit-detail-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const retryBtn = overlay.querySelector('#deposit-detail-retry');
        if (retryBtn && data.txid) {
            retryBtn.addEventListener('click', async () => {
                retryBtn.disabled = true;
                retryBtn.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:16px;"></i> Đang kiểm tra PayOS...';
                if (window.lucide) lucide.createIcons();
                await retryDeposit(data.txid);
                overlay.remove();
            });
        }
    }

    /* ── Init ── */
    function init() {
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('deposit_init');
            if (!gate.ok) return;
        }

        // Update header text for role
        updateHeaderForRole();

        // Quick amount buttons
        const amountInput = document.getElementById('deposit-momo-amount');
        document.querySelectorAll('.dep-quick-amt').forEach(btn => {
            btn.addEventListener('click', () => {
                if (amountInput && btn.dataset.amount) {
                    amountInput.value = btn.dataset.amount;
                }
            });
        });

        // Payment button
        const btnPay = document.getElementById('btn-momo-pay');
        const errorDiv = document.getElementById('momo-pay-error');
        if (btnPay && amountInput) {
            btnPay.onclick = async () => {
                const amount = parseInt(amountInput.value, 10);
                if (!amount || amount < 2000) {
                    if (errorDiv) {
                        errorDiv.textContent = 'Số tiền nạp tối thiểu là 2,000đ';
                        errorDiv.style.display = 'block';
                    }
                    return;
                }
                if (!sessionStorage.getItem('votri_sys_user_email')) {
                    if (errorDiv) {
                        errorDiv.textContent = 'Vui lòng đăng nhập lại!';
                        errorDiv.style.display = 'block';
                    }
                    return;
                }

                if (window.VotriGuard) {
                    const gate = window.VotriGuard.allowApi('momo_create');
                    if (!gate.ok) {
                        if (errorDiv) {
                            errorDiv.textContent = gate.reason;
                            errorDiv.style.display = 'block';
                        }
                        return;
                    }
                }

                try {
                    btnPay.disabled = true;
                    btnPay.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:20px;"></i> Đang tạo mã VietQR...';
                    if (errorDiv) errorDiv.style.display = 'none';

                    const res = await fetch(`${core().API_BASE}/api/payos/create-payment`, {
                        method: 'POST',
                        headers: core().authHeaders(),
                        body: JSON.stringify({
                            amount,
                            userEmail: sessionStorage.getItem('votri_sys_user_email'),
                        }),
                    });
                    const result = await res.json();

                    if (result.success && result.checkoutUrl) {
                        window.location.href = result.checkoutUrl;
                        return;
                    }
                    if (errorDiv) {
                        errorDiv.textContent = result.message || 'Lỗi khi tạo giao dịch PayOS.';
                        errorDiv.style.display = 'block';
                    }
                } catch (e) {
                    console.error('[PayOS]', e);
                    if (errorDiv) {
                        errorDiv.textContent = 'Lỗi kết nối server.';
                        errorDiv.style.display = 'block';
                    }
                }
                btnPay.disabled = false;
                btnPay.innerHTML = 'Tạo mã VietQR Thanh toán <i data-lucide="qr-code" style="width:20px;"></i>';
                if (window.lucide) lucide.createIcons();
            };
        }

        // Deposit History
        applyFilters();

        // Filter buttons
        const btnFilter = document.getElementById('btn-deposit-filter');
        const btnReset  = document.getElementById('btn-deposit-reset-filter');
        const btnRefresh = document.getElementById('btn-deposit-refresh');
        const searchInput = document.getElementById('deposit-filter-search');

        if (btnFilter) btnFilter.addEventListener('click', applyFilters);
        if (btnReset) btnReset.addEventListener('click', () => {
            const searchEl = document.getElementById('deposit-filter-search');
            const statusEl = document.getElementById('deposit-filter-status');
            if (searchEl) searchEl.value = '';
            if (statusEl) statusEl.value = 'ALL';
            applyFilters();
        });
        if (btnRefresh) btnRefresh.addEventListener('click', async () => {
            btnRefresh.disabled = true;
            btnRefresh.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:14px;"></i> Đang tải...';
            if (window.lucide) lucide.createIcons();

            if (window.VotriApp?.syncDatabaseData) {
                await window.VotriApp.syncDatabaseData();
            }
            applyFilters();

            btnRefresh.disabled = false;
            btnRefresh.innerHTML = '<i data-lucide="refresh-cw" style="width:14px;"></i> Làm mới';
            if (window.lucide) lucide.createIcons();
            core()?.showToast?.('Đã cập nhật lịch sử nạp tiền.', 'success');
        });
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') applyFilters();
            });
        }
    }

    // --- Global PayOS Redirect Check ---
    // Runs immediately when script loads to catch ?orderCode=...
    // even if the user lands on the dashboard instead of the deposit view.
    setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const orderCode = urlParams.get('orderCode');
        const cancel = urlParams.get('cancel');

        if (orderCode) {
            // Remove params from URL to prevent checking again
            window.history.replaceState({}, document.title, window.location.pathname);
            
            if (cancel === 'true' || cancel === 'true') {
                core()?.showToast?.('Bạn đã hủy giao dịch nạp tiền.', 'info');
            } else {
                fetch(`${core().API_BASE}/api/payos/check-deposit`, {
                    method: 'POST',
                    headers: core().authHeaders(),
                    body: JSON.stringify({ transactionId: orderCode }),
                }).then(res => res.json()).then(async (result) => {
                    if (result.success && result.credited) {
                        core()?.showToast?.(`✅ ${result.message}`, 'success');
                    } else if (result.success && result.deposit?.status === 'completed') {
                        core()?.showToast?.(`✅ Giao dịch nạp tiền đã hoàn tất!`, 'success');
                    } else {
                        core()?.showToast?.('Đang chờ hệ thống ghi nhận thanh toán...', 'info');
                    }
                    if (window.VotriApp?.syncDatabaseData) {
                        await window.VotriApp.syncDatabaseData();
                    }
                    if (typeof applyFilters === 'function' && document.getElementById('deposit-history-body')) {
                        applyFilters();
                    }
                }).catch(() => {
                    core()?.showToast?.('Đã ghi nhận yêu cầu, đang xử lý...', 'info');
                });
            }
        }
    }, 800); // 800ms delay to ensure core() and UI are fully loaded

    window.VotriDeposit = { init };
})();
