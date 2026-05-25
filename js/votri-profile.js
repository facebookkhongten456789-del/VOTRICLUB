/**
 * Hồ sơ cá nhân — UI + gọi API MySQL
 */
(function () {
    const app = () => window.VotriApp || {};
    const toast = (m, t) => app().showToast?.(m, t);

    let setupToken = null;
    let setupSecret = null;

    async function refreshFromServer() {
        if (!window.ProfileApi) return null;
        if (window.VotriGuard) {
            const gate = window.VotriGuard.allowApi('profile_load');
            if (!gate.ok) {
                toast(gate.reason, 'info');
                return null;
            }
        }
        const data = await window.ProfileApi.get();
        if (data.user) {
            window.ProfileApi.mergeUserToCache(data.user);
            window.VotriApp?.updateSidebarUserProfile?.(data.user);
            window.VotriRankProgress?.renderAll?.();
        }
        if (typeof renderProfileView === 'function') renderProfileView();
        if (typeof renderAllViews === 'function') renderAllViews();
        return data.user;
    }

    function bindToggles(user) {
        const notifyToggle = document.getElementById('profile-notify-login-toggle');
        const tfaToggle = document.getElementById('profile-2fa-toggle');
        const tfaStatus = document.getElementById('profile-2fa-status');
        const tfaPanel = document.getElementById('profile-2fa-setup-panel');

        if (notifyToggle) {
            notifyToggle.checked = user?.notifyNewLogin !== false;
            notifyToggle.onchange = async () => {
                try {
                    const data = await window.ProfileApi.updateSettings(notifyToggle.checked);
                    window.ProfileApi.mergeUserToCache(data.user);
                    toast(data.message || 'Đã lưu', 'success');
                    renderProfileView();
                } catch (e) {
                    notifyToggle.checked = !notifyToggle.checked;
                    toast(e.message, 'error');
                }
            };
        }

        if (tfaToggle) {
            tfaToggle.checked = !!user?.twoFactorEnabled;
            if (tfaStatus) {
                tfaStatus.textContent = user?.twoFactorEnabled
                    ? 'Đang bật — cần mã Authenticator khi đăng nhập'
                    : 'Đang tắt';
            }
            if (tfaPanel) tfaPanel.classList.toggle('hidden', !!user?.twoFactorEnabled);

            tfaToggle.onchange = async () => {
                if (tfaToggle.checked) {
                    tfaToggle.checked = false;
                    await start2faSetup();
                } else {
                    tfaToggle.checked = true;
                    await disable2fa();
                }
            };
        }
    }

    function renderQrCode(qrCodeDataUrl) {
        const img = document.getElementById('profile-2fa-qr-img');
        if (!img) return;
        if (qrCodeDataUrl) {
            img.src = qrCodeDataUrl;
            img.style.display = 'inline-block';
        } else {
            img.style.display = 'none';
            img.removeAttribute('src');
        }
    }

    async function start2faSetup() {
        const panel = document.getElementById('profile-2fa-setup-panel');
        const secretEl = document.getElementById('profile-2fa-secret');
        const accountLabel = document.getElementById('profile-2fa-account-label');
        const codeInput = document.getElementById('profile-2fa-code');
        try {
            const data = await window.ProfileApi.setup2fa();
            setupToken = data.setupToken;
            setupSecret = data.secret;
            if (secretEl) secretEl.textContent = data.secret;
            if (accountLabel) {
                accountLabel.textContent = `Votri Club (${sessionStorage.getItem('votri_sys_user_email') || ''})`;
            }
            if (codeInput) codeInput.value = '';
            if (panel) panel.classList.remove('hidden');
            renderQrCode(data.qrCodeDataUrl);
            if (!data.qrCodeDataUrl) {
                toast('Không nhận được QR từ server. Dùng khóa thủ công bên dưới.', 'info');
            } else {
                toast('Quét mã QR bằng Google Authenticator, rồi nhập mã 6 số.', 'info');
            }
            if (window.lucide) lucide.createIcons();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function confirm2faEnable() {
        const code = document.getElementById('profile-2fa-code')?.value?.trim();
        if (!setupToken || !code) {
            toast('Thiếu mã xác nhận.', 'info');
            return;
        }
        try {
            const data = await window.ProfileApi.enable2fa(setupToken, code);
            window.ProfileApi.mergeUserToCache(data.user);
            setupToken = null;
            document.getElementById('profile-2fa-setup-panel')?.classList.add('hidden');
            toast(data.message || 'Đã bật 2FA', 'success');
            renderProfileView();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function disable2fa() {
        const code = prompt('Nhập mã 2FA (6 số) để tắt:');
        if (!code) return;
        const password = prompt('Nhập mật khẩu đăng nhập để xác nhận:');
        if (!password) return;
        try {
            const data = await window.ProfileApi.disable2fa(code.trim(), password);
            window.ProfileApi.mergeUserToCache(data.user);
            toast(data.message || 'Đã tắt 2FA', 'success');
            renderProfileView();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function bindProfileActions() {
        const btnUpdate = document.getElementById('btn-update-profile');
        if (btnUpdate) {
            btnUpdate.onclick = async () => {
                const name = document.getElementById('profile-name-input')?.value?.trim();
                if (!name) return toast('Tên không được trống.', 'info');
                try {
                    const data = await window.ProfileApi.updateName(name);
                    window.ProfileApi.mergeUserToCache(data.user);
                    window.VotriApp?.updateSidebarUserProfile?.({ ...data.user, name });
                    toast(data.message || 'Cập nhật thành công', 'success');
                    renderProfileView();
                } catch (e) {
                    toast(e.message, 'error');
                }
            };
        }

        const btnPass = document.getElementById('btn-change-password');
        if (btnPass) {
            btnPass.onclick = async () => {
                const oldPass = document.getElementById('profile-old-password')?.value;
                const newPass = document.getElementById('profile-new-password')?.value;
                const confirmPass = document.getElementById('profile-confirm-password')?.value;
                if (!oldPass || !newPass || !confirmPass) {
                    return toast('Vui lòng điền đầy đủ mật khẩu.', 'info');
                }
                if (newPass.length < 6) return toast('Mật khẩu mới tối thiểu 6 ký tự.', 'info');
                if (newPass !== confirmPass) return toast('Xác nhận mật khẩu không khớp.', 'info');
                try {
                    const data = await window.ProfileApi.changePassword(oldPass, newPass);
                    toast(data.message || 'Đổi mật khẩu thành công', 'success');
                    ['profile-old-password', 'profile-new-password', 'profile-confirm-password'].forEach((id) => {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });
                    await refreshFromServer();
                } catch (e) {
                    toast(e.message, 'error');
                }
            };
        }

        const btn2faConfirm = document.getElementById('btn-2fa-confirm-enable');
        if (btn2faConfirm) btn2faConfirm.onclick = () => confirm2faEnable();

        const avatarContainer = document.getElementById('profile-avatar-container');
        const avatarUpload = document.getElementById('profile-avatar-upload');
        if (avatarContainer && avatarUpload) {
            avatarContainer.onclick = () => avatarUpload.click();
            avatarUpload.onchange = (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.type.startsWith('image/')) return toast('Chỉ hỗ trợ ảnh.', 'info');
                if (file.size > 2 * 1024 * 1024) return toast('Ảnh dưới 2MB.', 'info');

                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = async () => {
                        const canvas = document.createElement('canvas');
                        const MAX = 150;
                        let w = img.width;
                        let h = img.height;
                        if (w > h && w > MAX) {
                            h *= MAX / w;
                            w = MAX;
                        } else if (h > MAX) {
                            w *= MAX / h;
                            h = MAX;
                        }
                        canvas.width = w;
                        canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        try {
                            const data = await window.ProfileApi.updateAvatar(dataUrl);
                            window.ProfileApi.mergeUserToCache(data.user);
                            toast(data.message || 'Đã lưu ảnh', 'success');
                            renderProfileView();
                        } catch (err) {
                            toast(err.message, 'error');
                        }
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            };
        }
    }

    function init() {
        bindProfileActions();
    }

    async function onTabVisible() {
        try {
            const user = await refreshFromServer();
            if (user) bindToggles(user);
        } catch (e) {
            console.warn('[Profile]', e.message);
            const email = sessionStorage.getItem('votri_sys_user_email');
            const local = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
            const user = local.find((u) => u.email === email);
            if (user) bindToggles(user);
        }
    }

    window.VotriProfile = { init, onTabVisible, refreshFromServer };
})();
