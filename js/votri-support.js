/**
 * Support Tickets UI
 * API: routes/support.js
 */
(function () {
    const ITEMS_PER_PAGE = 10;
    let ticketsList = [];
    let currentPage = 1;
    let activeTicketId = null;

    function core() { return window.VotriApp; }
    function apiBase() { return core().API_BASE; }
    function escapeHTML(s) { return core().escapeHTML(s); }
    function showToast(m, t) { return core().showToast(m, t); }
    function authHeaders() { return core().authHeaders(); }
    function normalizeEmail(e) { return core().normalizeEmail(e); }
    function isAdmin() { return core().isCurrentUserAdmin(); }

    async function syncData() {
        if (typeof core().syncDatabaseData === 'function') {
            await core().syncDatabaseData();
        }
    }

    function roleLabel(role) {
        if (window.VotriRoles) return window.VotriRoles.label(role);
        return String(role || '').toLowerCase() === 'admin' ? 'Quản trị viên' : 'Thành viên';
    }

    function statusBadgeHtml(status) {
        if (status === 'Pending') {
            return '<span class="badge" style="background:rgba(255,215,0,0.1);color:var(--neon-yellow);border:1px solid rgba(255,215,0,0.25);padding:4px 8px;border-radius:6px;">Chờ duyệt</span>';
        }
        if (status === 'Open') {
            return '<span class="badge" style="background:rgba(0,243,255,0.1);color:var(--neon-cyan);border:1px solid rgba(0,243,255,0.2);padding:4px 8px;border-radius:6px;">Đang mở</span>';
        }
        if (status === 'Replied') {
            return '<span class="badge" style="background:rgba(57,255,20,0.1);color:#39FF14;border:1px solid rgba(57,255,20,0.2);padding:4px 8px;border-radius:6px;">Đã trả lời</span>';
        }
        return '<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text-dim);border:1px solid rgba(255,255,255,0.1);padding:4px 8px;border-radius:6px;">Đã đóng</span>';
    }

    function loadTickets() {
        try {
            const raw = localStorage.getItem('votri_sys_tickets');
            ticketsList = raw ? JSON.parse(raw) : [];
        } catch {
            ticketsList = [];
        }
    }

    function updateStats(filtered) {
        const elTotal = document.getElementById('support-stat-total');
        const elOpen = document.getElementById('support-stat-open');
        const elPending = document.getElementById('support-stat-pending');
        const elReplied = document.getElementById('support-stat-replied');
        if (elTotal) elTotal.textContent = filtered.length;
        if (elOpen) elOpen.textContent = filtered.filter((t) => t.status === 'Open').length;
        if (elPending) elPending.textContent = filtered.filter((t) => t.status === 'Pending').length;
        if (elReplied) elReplied.textContent = filtered.filter((t) => t.status === 'Replied').length;
    }

    function renderTicketsTable() {
        const tableBody = document.getElementById('support-table-body');
        const infoEl = document.getElementById('support-pagination-info');
        const paginationControls = document.getElementById('support-pagination-controls');
        const thUser = document.getElementById('th-support-user');
        if (!tableBody) return;

        loadTickets();
        const email = normalizeEmail(sessionStorage.getItem('votri_sys_user_email'));
        const admin = isAdmin();

        if (thUser) thUser.style.display = admin ? 'table-cell' : 'none';

        let filtered = ticketsList;
        if (!admin) filtered = filtered.filter((t) => normalizeEmail(t.userEmail) === email);

        const searchVal = document.getElementById('support-filter-search')?.value.toLowerCase().trim() || '';
        const statusFilter = document.getElementById('support-filter-status')?.value || 'ALL';
        const topicFilter = document.getElementById('support-filter-topic')?.value || 'ALL';

        if (searchVal) {
            filtered = filtered.filter((t) =>
                t.id.toLowerCase().includes(searchVal)
                || t.title.toLowerCase().includes(searchVal)
                || (t.orderId && t.orderId.toLowerCase().includes(searchVal))
                || (admin && t.userEmail.toLowerCase().includes(searchVal)));
        }
        if (statusFilter !== 'ALL') filtered = filtered.filter((t) => t.status === statusFilter);
        if (topicFilter !== 'ALL') filtered = filtered.filter((t) => t.topic === topicFilter);

        updateStats(filtered);

        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        const end = Math.min(start + ITEMS_PER_PAGE, totalItems);
        const pageItems = filtered.slice(start, end);

        if (infoEl) {
            infoEl.textContent = totalItems > 0
                ? `Hiển thị ${start + 1} - ${end} của ${totalItems} tickets`
                : 'Hiển thị 0 - 0 của 0 tickets';
        }

        if (!pageItems.length) {
            tableBody.innerHTML = `<tr><td colspan="${admin ? 9 : 8}" class="text-center text-dim" style="padding:40px;">Không tìm thấy ticket nào.</td></tr>`;
            if (paginationControls) paginationControls.innerHTML = '';
            return;
        }

        tableBody.innerHTML = pageItems.map((t) => {
            const createdAtStr = new Date(t.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
            const updatedAtStr = new Date(t.updatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
            return `
            <tr>
                <td style="font-weight:600;color:var(--text-dim);text-align:center;vertical-align:middle;">${t.id}</td>
                ${admin ? `<td style="vertical-align:middle;font-size:0.85rem;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(t.userEmail)}</td>` : ''}
                <td style="vertical-align:middle;font-weight:600;color:var(--text-primary);cursor:pointer;" class="support-ticket-row-title" data-id="${t.id}">${escapeHTML(t.title)}</td>
                <td style="vertical-align:middle;color:var(--text-secondary);font-family:monospace;">${t.orderId && t.orderId !== 'N/A' ? `#${escapeHTML(t.orderId)}` : '<span style="color:var(--text-dim);">N/A</span>'}</td>
                <td style="vertical-align:middle;"><span class="badge" style="background:rgba(255,255,255,0.05);padding:2px 6px;font-size:0.75rem;">${escapeHTML(t.topic)}</span></td>
                <td style="vertical-align:middle;text-align:center;">${statusBadgeHtml(t.status)}</td>
                <td style="vertical-align:middle;font-size:0.8rem;color:var(--text-dim);">${createdAtStr}</td>
                <td style="vertical-align:middle;font-size:0.8rem;color:var(--text-dim);">${updatedAtStr}</td>
                <td style="text-align:right;vertical-align:middle;padding-right:16px;">
                    <button class="btn btn-secondary btn-sm btn-view-ticket-detail" data-id="${t.id}" style="border:1px solid var(--neon-cyan);color:var(--neon-cyan);font-size:0.75rem;padding:4px 10px;border-radius:6px;cursor:pointer;background:transparent;">Xem</button>
                </td>
            </tr>`;
        }).join('');

        tableBody.querySelectorAll('.support-ticket-row-title, .btn-view-ticket-detail').forEach((el) => {
            el.onclick = (e) => {
                e.preventDefault();
                openTicketDetails(el.getAttribute('data-id'));
            };
        });

        if (paginationControls && totalPages > 1) {
            let html = `<button class="btn btn-secondary btn-sm support-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} style="padding:4px 10px;border-radius:6px;font-size:0.8rem;margin-right:4px;">Trước</button>`;
            const range = 2;
            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= currentPage - range && i <= currentPage + range)) {
                    html += `<button class="btn btn-sm support-page-btn" data-page="${i}" style="padding:4px 10px;border-radius:6px;font-size:0.8rem;margin:0 2px;background:${i === currentPage ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.05)'};color:${i === currentPage ? '#000' : '#fff'};border:1px solid ${i === currentPage ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.1)'};">${i}</button>`;
                } else if (i === currentPage - range - 1 || i === currentPage + range + 1) {
                    html += '<span style="color:var(--text-dim);padding:0 4px;">...</span>';
                }
            }
            html += `<button class="btn btn-secondary btn-sm support-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} style="padding:4px 10px;border-radius:6px;font-size:0.8rem;margin-left:4px;">Sau</button>`;
            paginationControls.innerHTML = html;
            paginationControls.querySelectorAll('.support-page-btn').forEach((btn) => {
                if (btn.hasAttribute('disabled')) return;
                btn.onclick = (e) => {
                    e.preventDefault();
                    currentPage = parseInt(btn.getAttribute('data-page'), 10);
                    renderTicketsTable();
                };
            });
        } else if (paginationControls) {
            paginationControls.innerHTML = '';
        }

        if (window.lucide) lucide.createIcons();
    }

    function openTicketDetails(ticketId) {
        activeTicketId = ticketId;
        loadTickets();
        const ticket = ticketsList.find((t) => t.id === ticketId);
        if (!ticket) {
            showToast('Ticket không tồn tại hoặc đã bị xóa.', 'error');
            return;
        }

        const email = sessionStorage.getItem('votri_sys_user_email') || '';
        const admin = isAdmin();

        const titleEl = document.getElementById('ticket-detail-title-id');
        const topicEl = document.getElementById('ticket-detail-topic');
        const orderIdEl = document.getElementById('ticket-detail-orderid');
        const statusBadgeEl = document.getElementById('ticket-detail-status-badge');
        const closeBtn = document.getElementById('btn-close-ticket-status');
        const approveBtn = document.getElementById('btn-approve-ticket');

        if (titleEl) titleEl.textContent = `[${ticket.id}] ${ticket.title}`;
        if (topicEl) topicEl.textContent = `Chủ đề: ${ticket.topic}`;
        if (orderIdEl) {
            const wrap = document.getElementById('ticket-detail-order-wrapper');
            if (ticket.orderId && ticket.orderId !== 'N/A') {
                orderIdEl.textContent = `#${ticket.orderId}`;
                if (wrap) wrap.style.display = 'inline';
            } else if (wrap) wrap.style.display = 'none';
        }

        const statusMap = {
            Pending: ['Chờ Admin duyệt', 'var(--neon-yellow)'],
            Open: ['Đang mở', 'var(--neon-cyan)'],
            Replied: ['Đã trả lời', '#39FF14'],
            Closed: ['Đã đóng', 'var(--text-dim)'],
        };
        const [statusText, statusColor] = statusMap[ticket.status] || statusMap.Closed;
        if (statusBadgeEl) {
            statusBadgeEl.innerHTML = `Trạng thái: <span style="color:${statusColor};font-weight:700;">${statusText}</span>`;
        }

        if (approveBtn) approveBtn.style.display = (admin && ticket.status === 'Pending') ? 'inline-block' : 'none';
        if (closeBtn) {
            if (!admin) {
                closeBtn.style.display = 'none';
            } else {
                closeBtn.style.display = 'inline-block';
                closeBtn.textContent = ticket.status === 'Closed' ? 'Mở lại Ticket' : 'Đóng Ticket';
            }
        }

        const messagesContainer = document.getElementById('ticket-messages-container');
        if (messagesContainer) {
            messagesContainer.innerHTML = (ticket.messages || []).map((m) => {
                const isMe = m.sender === email;
                const timeStr = new Date(m.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
                const label = roleLabel(m.senderRole);
                const bubbleBg = isMe ? 'rgba(0, 243, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)';
                const bubbleBorder = isMe ? '1px solid rgba(0, 243, 255, 0.15)' : '1px solid rgba(255, 255, 255, 0.08)';
                const nameColor = label === 'Quản trị viên' ? 'var(--neon-pink)' : (isMe ? 'var(--neon-cyan)' : 'var(--text-primary)');
                return `
                <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};width:100%;">
                    <div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:4px;display:flex;gap:6px;align-items:center;">
                        <span style="font-weight:600;color:${nameColor};">${escapeHTML(m.senderName)} (${label})</span>
                        <span>·</span><span>${timeStr}</span>
                    </div>
                    <div class="glass-card" style="padding:12px 16px;border-radius:12px;max-width:80%;background:${bubbleBg};border:${bubbleBorder};color:#fff;font-size:0.9rem;line-height:1.4;white-space:pre-wrap;">${escapeHTML(m.content)}</div>
                </div>`;
            }).join('');
            setTimeout(() => { messagesContainer.scrollTop = messagesContainer.scrollHeight; }, 30);
        }

        const replyInput = document.getElementById('ticket-reply-content');
        const replyForm = document.getElementById('form-reply-ticket');
        if (replyInput && replyForm) {
            const submitBtn = replyForm.querySelector('button[type="submit"]');
            let blocked = false;
            let placeholder = 'Nhập câu trả lời / phản hồi của bạn...';
            if (ticket.status === 'Closed') {
                blocked = true;
                placeholder = 'Ticket đã đóng. Chỉ Admin có thể mở lại.';
            } else if (!admin && ticket.status === 'Pending') {
                blocked = true;
                placeholder = 'Chờ Admin duyệt ticket trước khi nhắn tin.';
            }
            replyInput.disabled = blocked;
            replyInput.placeholder = placeholder;
            if (submitBtn) submitBtn.disabled = blocked;
        }

        document.getElementById('modal-ticket-details')?.classList.add('active');
        if (window.lucide) lucide.createIcons();
    }

    async function submitNewTicket(e) {
        e.preventDefault();
        const topic = document.getElementById('ticket-field-topic')?.value;
        const orderId = document.getElementById('ticket-field-orderid')?.value.trim() || 'N/A';
        const title = document.getElementById('ticket-field-title')?.value.trim();
        const content = document.getElementById('ticket-field-content')?.value.trim();
        if (!title || !content) {
            showToast('Vui lòng nhập đầy đủ thông tin yêu cầu.', 'error');
            return;
        }
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('ticket_create');
            if (!gate.ok) {
                showToast(gate.reason, 'info');
                return;
            }
        }
        try {
            const res = await fetch(`${apiBase()}/api/support/create-ticket`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ title, topic, orderId, content }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Lỗi khi gửi ticket.', 'error');
                return;
            }
            showToast(data.message || `Gửi thành công. Mã: ${data.ticketId}`, 'success');
            document.getElementById('form-create-ticket')?.reset();
            document.getElementById('modal-create-ticket')?.classList.remove('active');
            await syncData();
            renderTicketsTable();
        } catch (err) {
            console.error('[Create Ticket]', err);
            showToast('Không thể kết nối server.', 'error');
        }
    }

    async function submitTicketReply(e) {
        e.preventDefault();
        if (!activeTicketId) return;
        const replyInput = document.getElementById('ticket-reply-content');
        const content = replyInput?.value.trim();
        if (!content) return;
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('ticket_reply');
            if (!gate.ok) {
                showToast(gate.reason, 'info');
                return;
            }
        }
        try {
            const res = await fetch(`${apiBase()}/api/support/reply-ticket`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ ticketId: activeTicketId, content }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Lỗi khi gửi phản hồi.', 'error');
                return;
            }
            replyInput.value = '';
            await syncData();
            openTicketDetails(activeTicketId);
            renderTicketsTable();
        } catch (err) {
            console.error('[Reply Ticket]', err);
            showToast('Không thể kết nối server.', 'error');
        }
    }

    async function approveTicket() {
        if (!activeTicketId || !isAdmin()) return;
        try {
            const res = await fetch(`${apiBase()}/api/support/approve-ticket`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ ticketId: activeTicketId }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Không duyệt được.', 'error');
                return;
            }
            showToast(data.message || 'Đã duyệt ticket.', 'success');
            await syncData();
            openTicketDetails(activeTicketId);
            renderTicketsTable();
        } catch (err) {
            console.error('[Approve Ticket]', err);
            showToast('Không thể kết nối server.', 'error');
        }
    }

    async function toggleTicketStatus() {
        if (!activeTicketId || !isAdmin()) {
            showToast('Chỉ Admin mới được đóng hoặc mở lại ticket.', 'error');
            return;
        }
        try {
            const res = await fetch(`${apiBase()}/api/support/toggle-ticket`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ ticketId: activeTicketId }),
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Lỗi đổi trạng thái.', 'error');
                return;
            }
            showToast(data.status === 'Closed' ? 'Đã đóng ticket.' : 'Đã mở lại ticket.', 'info');
            await syncData();
            openTicketDetails(activeTicketId);
            renderTicketsTable();
        } catch (err) {
            console.error('[Toggle Ticket]', err);
            showToast('Không thể kết nối server.', 'error');
        }
    }

    function init() {
        const btnCreate = document.getElementById('btn-create-ticket');
        const modalCreate = document.getElementById('modal-create-ticket');
        const modalDetails = document.getElementById('modal-ticket-details');
        if (!btnCreate) return;

        btnCreate.onclick = (e) => { e.preventDefault(); modalCreate?.classList.add('active'); };
        document.getElementById('btn-close-create-ticket')?.addEventListener('click', () => modalCreate?.classList.remove('active'));
        document.getElementById('btn-cancel-create-ticket')?.addEventListener('click', () => modalCreate?.classList.remove('active'));
        document.getElementById('form-create-ticket')?.addEventListener('submit', submitNewTicket);

        document.getElementById('btn-close-ticket-details')?.addEventListener('click', () => {
            modalDetails?.classList.remove('active');
            activeTicketId = null;
        });
        document.getElementById('form-reply-ticket')?.addEventListener('submit', submitTicketReply);
        document.getElementById('btn-close-ticket-status')?.addEventListener('click', toggleTicketStatus);
        document.getElementById('btn-approve-ticket')?.addEventListener('click', approveTicket);

        const applyFilter = () => { currentPage = 1; renderTicketsTable(); };
        document.getElementById('btn-support-filter-apply')?.addEventListener('click', (e) => { e.preventDefault(); applyFilter(); });
        document.getElementById('btn-support-filter-reset')?.addEventListener('click', (e) => {
            e.preventDefault();
            const s = document.getElementById('support-filter-search');
            const st = document.getElementById('support-filter-status');
            const tp = document.getElementById('support-filter-topic');
            if (s) s.value = '';
            if (st) st.value = 'ALL';
            if (tp) tp.value = 'ALL';
            applyFilter();
        });
        document.getElementById('support-filter-search')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyFilter(); }
        });

        renderTicketsTable();
    }

    window.VotriSupport = { init, renderTicketsTable, openTicketDetails };
})();
