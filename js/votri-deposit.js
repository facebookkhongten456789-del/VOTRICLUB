/**
 * Nạp tiền MoMo
 * API: server.js POST /api/momo/create-payment
 */
(function () {
    function core() { return window.VotriApp; }

    function init() {
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('deposit_init');
            if (!gate.ok) return;
        }
        const btnPay = document.getElementById('btn-momo-pay');
        const amountInput = document.getElementById('deposit-momo-amount');
        const errorDiv = document.getElementById('momo-pay-error');
        if (!btnPay || !amountInput) return;

        btnPay.onclick = async () => {
            const amount = parseInt(amountInput.value, 10);
            if (!amount || amount < 10000) {
                if (errorDiv) {
                    errorDiv.textContent = 'Số tiền nạp tối thiểu là 10,000đ';
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
                btnPay.innerHTML = '<i data-lucide="loader-2" class="lucide-spin" style="width:20px;"></i> Đang kết nối MoMo...';
                if (errorDiv) errorDiv.style.display = 'none';

                const res = await fetch(`${core().API_BASE}/api/momo/create-payment`, {
                    method: 'POST',
                    headers: core().authHeaders(),
                    body: JSON.stringify({
                        amount,
                        userEmail: sessionStorage.getItem('votri_sys_user_email'),
                    }),
                });
                const result = await res.json();

                if (result.success && result.payUrl) {
                    window.location.href = result.payUrl;
                    return;
                }
                if (errorDiv) {
                    errorDiv.textContent = result.message || 'Lỗi khi tạo giao dịch MoMo.';
                    errorDiv.style.display = 'block';
                }
            } catch (e) {
                console.error('[MoMo]', e);
                if (errorDiv) {
                    errorDiv.textContent = 'Lỗi kết nối server.';
                    errorDiv.style.display = 'block';
                }
            }
            btnPay.disabled = false;
            btnPay.innerHTML = 'Thanh toán qua MoMo <i data-lucide="arrow-right" style="width:20px;"></i>';
            if (window.lucide) lucide.createIcons();
        };
    }

    window.VotriDeposit = { init };
})();
