/**
 * Trang Đơn hàng đã mua — module riêng
 * API: GET /api/orders/list
 */
(function () {
    let currentPage = 1;
    const perPage = 10;
    let ordersCache = [];

    function app() {
        return window.VotriApp || {};
    }

    function esc(s) {
        const fn = app().escapeHTML;
        return fn ? fn(s) : String(s ?? '');
    }

    function isAdmin() {
        const fn = app().isCurrentUserAdmin;
        return fn ? fn() : false;
    }

    async function fetchOrders() {
        const { API_BASE, authHeaders, parseJsonResponse, showToast } = app();
        if (!API_BASE) throw new Error('VotriApp chưa sẵn sàng');

        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('orders_list');
            if (!gate.ok) {
                showToast(gate.reason, 'info');
                return ordersCache;
            }
        }

        const token = sessionStorage.getItem('votri_sys_token');
        if (!token) throw new Error('Chưa đăng nhập');

        const res = await fetch(`${API_BASE}/api/orders/list`, {
            method: 'GET',
            headers: authHeaders()
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) {
            throw new Error(
                'API đơn hàng trả về không phải JSON (Content-Type: ' + (ct || 'unknown') +
                '). Mở http://localhost:3000, đăng nhập, rồi thử lại.'
            );
        }
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.success) {
            throw new Error(data.message || 'Không tải được đơn hàng');
        }
        ordersCache = data.orders || [];
        localStorage.setItem('votri_sys_orders', JSON.stringify(ordersCache));
        return ordersCache;
    }

    function statusBadge(status) {
        const s = (status || '').toLowerCase();
        if (s === 'processing' || s === 'pending') {
            return '<span class="badge" style="background:rgba(255,215,0,0.1);color:var(--neon-yellow);padding:4px 8px;border-radius:6px;">Đang xử lý</span>';
        }
        if (s === 'completed') {
            return '<span class="badge" style="background:rgba(57,255,20,0.1);color:#39FF14;padding:4px 8px;border-radius:6px;">Hoàn thành</span>';
        }
        if (s === 'failed') {
            return '<span class="badge" style="background:rgba(255,75,75,0.1);color:#ff4b4b;padding:4px 8px;border-radius:6px;">Thất bại</span>';
        }
        return `<span class="badge" style="padding:4px 8px;border-radius:6px;">${esc(status)}</span>`;
    }

    function render() {
        const tableBody = document.getElementById('orders-table-body');
        if (!tableBody) return;

        const admin = isAdmin();
        const thUser = document.getElementById('th-orders-user');
        if (thUser) thUser.style.display = admin ? 'table-cell' : 'none';

        let list = ordersCache.length ? ordersCache : [];
        if (!list.length) {
            try {
                const raw = localStorage.getItem('votri_sys_orders');
                list = raw ? JSON.parse(raw) : [];
            } catch (_) { list = []; }
        }

        const search = (document.getElementById('orders-filter-search')?.value || '').toLowerCase().trim();
        const statusF = document.getElementById('orders-filter-status')?.value || 'ALL';

        let filtered = list;
        if (search) {
            filtered = filtered.filter((o) =>
                (o.id && o.id.toLowerCase().includes(search)) ||
                (o.serviceName && o.serviceName.toLowerCase().includes(search)) ||
                (o.link && o.link.toLowerCase().includes(search)) ||
                (o.externalOrderId && String(o.externalOrderId).includes(search)) ||
                (admin && o.userEmail && o.userEmail.toLowerCase().includes(search))
            );
        }
        if (statusF !== 'ALL') {
            const sf = statusF.toLowerCase();
            filtered = filtered.filter((o) => {
                const s = (o.status || '').toLowerCase();
                if (sf === 'processing') return s === 'processing' || s === 'pending';
                return s === sf;
            });
        }

        const statTotal = document.getElementById('orders-stat-total');
        const statProc = document.getElementById('orders-stat-processing');
        const statDone = document.getElementById('orders-stat-completed');
        const statFail = document.getElementById('orders-stat-failed');
        if (statTotal) statTotal.textContent = list.length;
        if (statProc) statProc.textContent = list.filter((o) => /processing|pending/i.test(o.status)).length;
        if (statDone) statDone.textContent = list.filter((o) => /completed/i.test(o.status)).length;
        if (statFail) statFail.textContent = list.filter((o) => /failed/i.test(o.status)).length;

        const total = filtered.length;
        const pages = Math.ceil(total / perPage) || 1;
        if (currentPage > pages) currentPage = pages;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * perPage;
        const pageItems = filtered.slice(start, start + perPage);

        const info = document.getElementById('orders-pagination-info');
        if (info) {
            info.textContent = total
                ? `Hiển thị ${start + 1} - ${Math.min(start + perPage, total)} của ${total} đơn hàng`
                : 'Hiển thị 0 - 0 của 0 đơn hàng';
        }

        if (!pageItems.length) {
            tableBody.innerHTML = `<tr><td colspan="${admin ? 8 : 7}" class="text-center text-dim" style="padding:40px;">Không có đơn hàng nào.</td></tr>`;
            const pg = document.getElementById('orders-pagination-controls');
            if (pg) pg.innerHTML = '';
            return;
        }

        tableBody.innerHTML = pageItems.map((o) => {
            const dateStr = o.createdAt
                ? new Date(o.createdAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '-';
            const linkShort = o.link && o.link.length > 40 ? o.link.slice(0, 40) + '...' : (o.link || '');
            const ext = o.externalOrderId ? `<div style="font-size:0.7rem;color:var(--text-dim);">SMM #${esc(String(o.externalOrderId))}</div>` : '';
            return `<tr>
                <td style="font-weight:600;text-align:center;">${esc(o.id)}${ext}</td>
                ${admin ? `<td style="font-size:0.8rem;">${esc(o.userEmail || '')}</td>` : ''}
                <td title="${esc(o.serviceName || '')}">${esc(o.serviceName || 'N/A')}<div style="font-size:0.7rem;color:var(--text-dim);">ID ${esc(String(o.serviceId || ''))}</div></td>
                <td><a href="${esc(o.link || '#')}" target="_blank" style="color:var(--neon-cyan);font-size:0.8rem;">${esc(linkShort)}</a></td>
                <td style="text-align:center;font-weight:600;">${(o.quantity || 0).toLocaleString()}</td>
                <td style="text-align:right;color:var(--neon-pink);font-weight:600;">${(o.charge || 0).toLocaleString('vi-VN')}đ</td>
                <td style="text-align:center;">${statusBadge(o.status)}</td>
                <td style="font-size:0.8rem;color:var(--text-dim);">${dateStr}</td>
            </tr>`;
        }).join('');

        const controls = document.getElementById('orders-pagination-controls');
        if (!controls || pages <= 1) {
            if (controls) controls.innerHTML = '';
            return;
        }
        let html = '';
        for (let i = 1; i <= pages; i++) {
            html += `<button type="button" class="btn btn-sm orders-page-btn" data-page="${i}" style="padding:4px 10px;margin:0 2px;border-radius:6px;cursor:pointer;background:${i === currentPage ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.05)'};color:${i === currentPage ? '#000' : '#fff'};border:1px solid rgba(255,255,255,0.1);">${i}</button>`;
        }
        controls.innerHTML = html;
        controls.querySelectorAll('.orders-page-btn').forEach((btn) => {
            btn.onclick = (e) => {
                e.preventDefault();
                currentPage = parseInt(btn.getAttribute('data-page'), 10);
                render();
            };
        });
    }

    async function loadAndRender() {
        const tableBody = document.getElementById('orders-table-body');
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-dim" style="padding:40px;">Đang tải...</td></tr>';
        }
        try {
            await fetchOrders();
            render();
        } catch (e) {
            console.error('[OrdersPage]', e);
            // #region agent log
            if (typeof window.__votriDbg === 'function') {
                window.__votriDbg('orders-page.js:loadAndRender', 'error', { msg: String(e.message) }, 'E');
            }
            // #endregion
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-dim" style="padding:40px;">${esc(e.message)}</td></tr>`;
            }
            const toast = app().showToast;
            if (toast) toast(e.message || 'Lỗi tải đơn hàng', 'error');
        }
    }

    function bindFilters() {
        const apply = document.getElementById('btn-orders-filter-apply');
        const reset = document.getElementById('btn-orders-filter-reset');
        const refresh = document.getElementById('btn-orders-refresh');
        const search = document.getElementById('orders-filter-search');

        if (apply) apply.onclick = (e) => { e.preventDefault(); currentPage = 1; render(); };
        if (reset) reset.onclick = (e) => {
            e.preventDefault();
            if (search) search.value = '';
            const st = document.getElementById('orders-filter-status');
            if (st) st.value = 'ALL';
            currentPage = 1;
            render();
        };
        if (refresh) refresh.onclick = (e) => { e.preventDefault(); loadAndRender(); };
        if (search) {
            search.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); currentPage = 1; render(); }
            };
        }
    }

    function init() {
        bindFilters();
    }

    window.OrdersPage = {
        init,
        render,
        loadAndRender,
        refresh: loadAndRender
    };
})();
