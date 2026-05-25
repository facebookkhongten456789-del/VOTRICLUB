/**
 * Admin — quản lý tài khoản (đồng bộ MySQL, chặn theo hành vi)
 */
(function () {
    const API_BASE = () => window.VotriApp?.API_BASE || '';
    const authHeaders = () => window.VotriApp?.authHeaders?.() || { 'Content-Type': 'application/json' };
    const escapeHTML = (s) => window.VotriApp?.escapeHTML?.(s) ?? String(s ?? '');
    const showToast = (m, t) => window.VotriApp?.showToast?.(m, t || 'info');

    let allUsers = [];
    let blockTargetUserId = null;
    let filtersBound = false;

    const BEHAVIOR_LABEL = 'Chặn (hành vi)';

    function statusLabel(status) {
        if (status === 'Blocked') return BEHAVIOR_LABEL;
        if (status === 'Verified') return 'Đang hoạt động';
        if (status === 'Pending') return 'Chờ xác minh';
        return status || '—';
    }

    function roles() {
        return window.VotriRoles || {
            normalize: (r) => String(r || 'member').toLowerCase(),
            label: (r) => String(r || 'member'),
            pillClass: () => 'accounts-role-member',
            optionsHtml: () => '',
            isAdmin: (r) => String(r).toLowerCase() === 'admin',
        };
    }

    function roleLabel(role) {
        return roles().label(role);
    }

    function getFilteredUsers() {
        const q = (document.getElementById('accounts-filter-search')?.value || '').trim().toLowerCase();
        const statusF = document.getElementById('accounts-filter-status')?.value || '';
        const roleF = document.getElementById('accounts-filter-role')?.value || '';

        return allUsers.filter((u) => {
            if (statusF && u.status !== statusF) return false;
            if (roleF && roles().normalize(u.role) !== roles().normalize(roleF)) return false;
            if (!q) return true;
            const hay = [u.name, u.email, u.ip, u.userAgent, u.blockReason]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }

    function updateStats(list) {
        const total = list.length;
        const verified = list.filter((u) => u.status === 'Verified').length;
        const blocked = list.filter((u) => u.status === 'Blocked').length;
        const countRole = (r) =>
            list.filter((u) => roles().normalize(u.role) === r).length;
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(v);
        };
        set('accounts-stat-total', total);
        set('accounts-stat-member', countRole('member'));
        set('accounts-stat-collaborator', countRole('collaborator'));
        set('accounts-stat-distributor', countRole('distributor'));
        void verified;
        void blocked;
    }

    function renderTable(usersList) {
        allUsers = Array.isArray(usersList) ? usersList : [];
        const tableBody = document.getElementById('accounts-table-body');
        if (!tableBody) return;

        const filtered = getFilteredUsers();
        updateStats(allUsers);

        const emptyHint = document.getElementById('accounts-table-empty');
        if (emptyHint) emptyHint.hidden = filtered.length > 0;

        const activeEmail = (sessionStorage.getItem('votri_sys_user_email') || '').toLowerCase();
        tableBody.innerHTML = '';

        filtered.forEach((user) => {
            const tr = document.createElement('tr');
            const isSelf = user.email?.toLowerCase() === activeEmail;
            const isRootAdmin = user.email?.toLowerCase() === 'admin@votri.club';
            const isBlocked = user.status === 'Blocked';
            const statusClass = isBlocked
                ? 'status-badge-blocked'
                : user.status === 'Pending'
                  ? 'status-badge-pending'
                  : 'status-badge-verified';

            const dateStr = user.registeredAt
                ? new Date(user.registeredAt).toLocaleString('vi-VN')
                : '—';
            const balanceStr = (user.balance || 0).toLocaleString('vi-VN') + 'đ';
            const shortUa = user.userAgent
                ? user.userAgent.length > 36
                    ? user.userAgent.slice(0, 36) + '…'
                    : user.userAgent
                : 'Chưa ghi nhận';

            const blockNote = isBlocked && user.blockReason
                ? `<div class="accounts-block-reason" title="${escapeHTML(user.blockReason)}">${escapeHTML(user.blockReason)}</div>`
                : '';

            let actionsHtml = '';
            if (isSelf) {
                actionsHtml = '<span class="accounts-self-tag">Phiên của bạn</span>';
            } else {
                const blockBtn = isBlocked
                    ? `<button type="button" class="btn-action btn-unblock-user" data-user-id="${escapeHTML(user.id)}" title="Mở khóa tài khoản"><i data-lucide="unlock"></i></button>`
                    : `<button type="button" class="btn-action btn-open-block-modal" data-user-id="${escapeHTML(user.id)}" data-email="${escapeHTML(user.email)}" title="Chặn theo hành vi"><i data-lucide="ban"></i></button>`;

                actionsHtml = `
                    <div class="actions-flex accounts-actions">
                        <button type="button" class="btn-action btn-adjust-balance" data-user-id="${escapeHTML(user.id)}" data-email="${escapeHTML(user.email)}" title="Cộng/trừ số dư">
                            <i data-lucide="wallet"></i>
                        </button>
                        ${blockBtn}
                        ${isRootAdmin ? '' : `<button type="button" class="btn-action btn-delete-user" data-user-id="${escapeHTML(user.id)}" data-email="${escapeHTML(user.email)}" title="Xóa tài khoản"><i data-lucide="user-x"></i></button>`}
                    </div>`;
            }

            const normRole = roles().normalize(user.role);
            const roleClass = roles().pillClass(normRole);
            const canEditRole = !isSelf && !isRootAdmin;
            const roleCell = canEditRole
                ? `<select class="accounts-admin-select accounts-role-select" data-user-id="${escapeHTML(user.id)}" data-prev-role="${escapeHTML(normRole)}" title="Đổi vai trò (lưu MySQL)">${roles().optionsHtml(normRole, { includeAdmin: true })}</select>`
                : `<span class="accounts-role-pill ${roleClass}">${escapeHTML(roleLabel(user.role))}</span>`;

            tr.innerHTML = `
                <td>
                    <div class="accounts-user-cell">
                        <strong>${escapeHTML(user.name || '—')}</strong>
                        <span class="accounts-email">${escapeHTML(user.email)}</span>
                    </div>
                </td>
                <td class="accounts-role-cell">${roleCell}</td>
                <td style="text-align: right;"><strong class="text-neon-cyan">${escapeHTML(balanceStr)}</strong></td>
                <td>
                    <span class="status-badge ${statusClass}">${escapeHTML(statusLabel(user.status))}</span>
                    ${blockNote}
                </td>
                <td><span class="timestamp">${escapeHTML(dateStr)}</span></td>
                <td>
                    <div class="metadata-log">
                        <span class="metadata-ip" title="IP truy cập gần nhất">${escapeHTML(user.ip || '—')}</span>
                        <span class="text-dim accounts-ua" title="${escapeHTML(user.userAgent || '')}">${escapeHTML(shortUa)}</span>
                    </div>
                </td>
                <td style="text-align: center;">${actionsHtml}</td>`;
            tableBody.appendChild(tr);
        });

        if (window.lucide) window.lucide.createIcons();
        bindRowActions();
        bindRoleSelects();
    }

    async function changeUserRole(userId, newRole, prevRole, selectEl) {
        const body = { userId, role: newRole };
        if (roles().normalize(newRole) === 'admin' && roles().normalize(prevRole) !== 'admin') {
            if (
                !confirm(
                    'Cấp quyền Quản trị viên cho tài khoản này? Họ sẽ truy cập được toàn bộ mục Admin.',
                )
            ) {
                if (selectEl) selectEl.value = prevRole;
                return;
            }
            body.confirmAdmin = true;
        }

        try {
            const result = await postJson('/api/admin/users/update-role', body);
            if (result.success) {
                showToast(result.message || 'Đã cập nhật vai trò.', 'success');
                await refreshFromServer();
            } else {
                showToast(result.message || 'Không đổi được vai trò.', 'error');
                if (selectEl) selectEl.value = prevRole;
            }
        } catch (e) {
            console.error(e);
            showToast('Lỗi kết nối.', 'error');
            if (selectEl) selectEl.value = prevRole;
        }
    }

    function bindRoleSelects() {
        document.querySelectorAll('.accounts-role-select').forEach((sel) => {
            sel.onchange = () => {
                const userId = sel.getAttribute('data-user-id');
                const prev = sel.getAttribute('data-prev-role') || 'member';
                const next = sel.value;
                if (roles().normalize(next) === roles().normalize(prev)) return;
                changeUserRole(userId, next, prev, sel);
            };
        });
    }

    async function refreshFromServer() {
        const sync = window.VotriApp?.syncDatabaseData;
        if (typeof sync !== 'function') {
            showToast('Không tải được dữ liệu.', 'error');
            return;
        }
        const btn = document.getElementById('btn-accounts-refresh');
        if (btn) btn.disabled = true;
        try {
            const result = await sync();
            if (result?.success) {
                const raw = localStorage.getItem('votri_sys_users');
                const list = raw ? JSON.parse(raw) : [];
                renderTable(list);
                showToast('Đã đồng bộ danh sách từ MySQL.', 'success');
            } else {
                showToast('Đồng bộ thất bại. Thử đăng nhập lại.', 'error');
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function openBlockModal(userId, email) {
        blockTargetUserId = userId;
        const modal = document.getElementById('accounts-block-modal');
        const target = document.getElementById('accounts-block-target-email');
        if (target) target.textContent = email || userId;
        const preset = document.getElementById('accounts-block-reason-preset');
        const detail = document.getElementById('accounts-block-reason-detail');
        if (preset) preset.value = preset.options[0]?.value || '';
        if (detail) detail.value = '';
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
        if (window.lucide) window.lucide.createIcons();
    }

    function closeBlockModal() {
        blockTargetUserId = null;
        const modal = document.getElementById('accounts-block-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function buildBlockReason() {
        const preset = document.getElementById('accounts-block-reason-preset')?.value || '';
        const detail = (document.getElementById('accounts-block-reason-detail')?.value || '').trim();
        if (preset === '__custom__') return detail;
        if (detail) return `${preset}: ${detail}`;
        return preset;
    }

    async function postJson(url, body) {
        const res = await fetch(`${API_BASE()}${url}`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(body),
        });
        return res.json();
    }

    function bindRowActions() {
        document.querySelectorAll('.btn-adjust-balance').forEach((btn) => {
            btn.onclick = async () => {
                const userId = btn.getAttribute('data-user-id');
                const email = btn.getAttribute('data-email');
                const amountStr = prompt(
                    `Nhập số tiền cộng/trừ cho ${email}\nVD: 50000 (cộng), -20000 (trừ):`,
                );
                if (amountStr === null) return;
                const amount = parseFloat(amountStr);
                if (Number.isNaN(amount)) {
                    showToast('Số tiền không hợp lệ.', 'error');
                    return;
                }
                try {
                    const result = await postJson('/api/admin/update-balance', {
                        userId,
                        adjustment: amount,
                        note: `Admin điều chỉnh ${amount > 0 ? '+' : ''}${amount}`,
                    });
                    if (result.success) {
                        showToast(result.message || 'Đã cập nhật số dư.', 'success');
                        await refreshFromServer();
                    } else {
                        showToast(result.message || 'Lỗi cập nhật số dư.', 'error');
                    }
                } catch (e) {
                    console.error(e);
                    showToast('Lỗi kết nối máy chủ.', 'error');
                }
            };
        });

        document.querySelectorAll('.btn-open-block-modal').forEach((btn) => {
            btn.onclick = () => {
                openBlockModal(btn.getAttribute('data-user-id'), btn.getAttribute('data-email'));
            };
        });

        document.querySelectorAll('.btn-unblock-user').forEach((btn) => {
            btn.onclick = async () => {
                const userId = btn.getAttribute('data-user-id');
                if (!confirm('Mở khóa tài khoản này? Thành viên có thể đăng nhập lại.')) return;
                try {
                    const result = await postJson('/api/admin/users/update-status', {
                        userId,
                        newStatus: 'Verified',
                    });
                    if (result.success) {
                        showToast(result.message || 'Đã mở khóa.', 'success');
                        await refreshFromServer();
                    } else {
                        showToast(result.message || 'Lỗi.', 'error');
                    }
                } catch (e) {
                    console.error(e);
                    showToast('Lỗi kết nối.', 'error');
                }
            };
        });

        document.querySelectorAll('.btn-delete-user').forEach((btn) => {
            btn.onclick = async () => {
                const email = btn.getAttribute('data-email');
                const userId = btn.getAttribute('data-user-id');
                if (!confirm(`Xóa vĩnh viễn tài khoản ${email}? Không hoàn tác.`)) return;
                try {
                    const result = await postJson('/api/admin/users/delete', { userId });
                    if (result.success) {
                        showToast(result.message || 'Đã xóa.', 'success');
                        await refreshFromServer();
                    } else {
                        showToast(result.message || 'Không xóa được.', 'error');
                    }
                } catch (e) {
                    console.error(e);
                    showToast('Lỗi kết nối.', 'error');
                }
            };
        });
    }

    function bindFiltersOnce() {
        if (filtersBound) return;
        filtersBound = true;

        ['accounts-filter-search', 'accounts-filter-status', 'accounts-filter-role'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = id === 'accounts-filter-search' ? 'input' : 'change';
            el.addEventListener(evt, () => renderTable(allUsers));
        });

        document.getElementById('btn-accounts-refresh')?.addEventListener('click', refreshFromServer);

        document.querySelectorAll('[data-close-block-modal]').forEach((el) => {
            el.addEventListener('click', closeBlockModal);
        });

        document.getElementById('btn-accounts-block-confirm')?.addEventListener('click', async () => {
            if (!blockTargetUserId) return;
            const reason = buildBlockReason();
            if (!reason || reason.length < 4) {
                showToast('Vui lòng mô tả hành vi vi phạm (ít nhất vài ký tự).', 'error');
                return;
            }
            try {
                const result = await postJson('/api/admin/users/update-status', {
                    userId: blockTargetUserId,
                    newStatus: 'Blocked',
                    blockReason: reason,
                });
                if (result.success) {
                    showToast(result.message || 'Đã chặn tài khoản.', 'success');
                    closeBlockModal();
                    await refreshFromServer();
                } else {
                    showToast(result.message || 'Không chặn được.', 'error');
                }
            } catch (e) {
                console.error(e);
                showToast('Lỗi kết nối.', 'error');
            }
        });
    }

    function onTabVisible() {
        bindFiltersOnce();
        const raw = localStorage.getItem('votri_sys_users');
        const list = raw ? JSON.parse(raw) : [];
        renderTable(list);
    }

    window.VotriAccountsAdmin = {
        renderTable,
        onTabVisible,
        refreshFromServer,
    };
})();
