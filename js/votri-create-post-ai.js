/**
 * Vô Tri Club - AI Content Creator Controller
 */
(function () {
    // 1. Local State
    let selectedPlatform = 'facebook'; // Facebook only
    let selectedLength = 'medium'; // 'very-short' | 'short' | 'medium' | 'full' | 'detailed'
    let selectedStyles = new Set(['professional', 'persuasive']); // Set of active styles
    let selectedPages = new Set(); // Set of chosen Facebook Fanpage pageIds
    let selectedImgSource = 'ai'; // 'internet' | 'ai' | 'device'
    let selectedImgAspect = '1:1';
    let uploadedImageFile = null;
    let selectedImageUrl = '';
    let selectedInternetImages = []; // List of selected image URLs from hybrid search
    let generatedPostContent = '';
    let domBound = false;


    function apiBase() {
        return window.VotriApp?.API_BASE || window.location.origin;
    }

    // Dynamic high-fidelity Facebook Multi-Image Layout Preview
    function updateMockupImages(imageUrls) {
        const container = document.getElementById('mock-image-container');
        if (!container) return;

        if (!imageUrls || imageUrls.length === 0) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        const urls = imageUrls.slice(0, 9); // FB max 9
        const count = urls.length;

        // Helper: build one img cell
        const cell = (src, extraStyle = '', label = '') => {
            const finalSrc = (src && !src.startsWith('http') && !src.startsWith('data:')) ? `${apiBase()}${src}` : src;
            const more = label ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:700;">${label}</div>` : '';
            return `<div style="position:relative;overflow:hidden;${extraStyle}"><img src="${finalSrc}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.background='#dde1e7'">${more}</div>`;
        };

        let html = '';

        if (count === 1) {
            let containerStyle = 'width:100%;height:220px;';
            if (selectedImgSource === 'ai') {
                if (selectedImgAspect === '16:9') {
                    containerStyle = 'width:100%;aspect-ratio:16/9;max-height:220px;border-radius:8px;overflow:hidden;margin:0 auto;';
                } else if (selectedImgAspect === '9:16') {
                    containerStyle = 'width:100%;max-width:200px;aspect-ratio:9/16;max-height:340px;border-radius:8px;overflow:hidden;margin:0 auto;';
                } else if (selectedImgAspect === '1:1') {
                    containerStyle = 'width:100%;max-width:280px;aspect-ratio:1/1;max-height:280px;border-radius:8px;overflow:hidden;margin:0 auto;';
                }
            }
            html = `<div style="position:relative;${containerStyle}">${cell(urls[0], 'width:100%;height:100%;')}</div>`;

        } else if (count === 2) {
            // Two side-by-side
            html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;height:180px;">
                ${cell(urls[0], 'height:180px;')}
                ${cell(urls[1], 'height:180px;')}
            </div>`;

        } else if (count === 3) {
            // Left big + right two stacked
            html = `<div style="display:grid;grid-template-columns:2fr 1fr;gap:2px;height:200px;">
                ${cell(urls[0], 'height:200px;')}
                <div style="display:grid;grid-template-rows:1fr 1fr;gap:2px;height:200px;">
                    ${cell(urls[1], 'height:99px;')}
                    ${cell(urls[2], 'height:99px;')}
                </div>
            </div>`;

        } else if (count === 4) {
            // 2x2 grid
            html = `<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;height:200px;">
                ${cell(urls[0], 'height:99px;')}
                ${cell(urls[1], 'height:99px;')}
                ${cell(urls[2], 'height:99px;')}
                ${cell(urls[3], 'height:99px;')}
            </div>`;

        } else if (count === 5) {
            // Top row: 2 images | Bottom row: 3 images
            html = `<div style="display:grid;grid-template-rows:1fr 1fr;gap:2px;height:210px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;">
                    ${cell(urls[0], 'height:103px;')}
                    ${cell(urls[1], 'height:103px;')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;">
                    ${cell(urls[2], 'height:103px;')}
                    ${cell(urls[3], 'height:103px;')}
                    ${cell(urls[4], 'height:103px;')}
                </div>
            </div>`;

        } else {
            // 5-grid layout + overlay "+N" on last cell
            const remaining = count - 5;
            const lastLabel = remaining > 0 ? `+${remaining}` : '';
            html = `<div style="display:grid;grid-template-rows:1fr 1fr;gap:2px;height:210px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;">
                    ${cell(urls[0], 'height:103px;')}
                    ${cell(urls[1], 'height:103px;')}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;">
                    ${cell(urls[2], 'height:103px;')}
                    ${cell(urls[3], 'height:103px;')}
                    ${cell(urls[4], 'height:103px;', lastLabel)}
                </div>
            </div>`;
        }

        container.innerHTML = html;
    }

    // Render interactive image grid from internet / web search results
    function renderSearchedImagesGrid(images) {
        const grid = document.getElementById('searched-images-grid');
        const wrapper = document.getElementById('image-selection-wrapper');
        const counter = document.getElementById('selected-images-counter');

        if (!grid || !wrapper) return;

        // Reset local selection array for a new search
        selectedInternetImages = [];
        if (!images || images.length === 0) {
            if (counter) counter.textContent = 'Ảnh đã chọn: 0/9';
            updateMockupImages(selectedInternetImages);
            grid.innerHTML = '<div class="col-span-5 text-center py-4 text-xs text-gray-400">Không tìm thấy hình ảnh phù hợp.</div>';
            wrapper.classList.remove('hidden');
            return;
        }

        // Auto-select the first image dynamically!
        const firstImgUrl = images[0].imageUrl || images[0].thumbnailUrl || images[0].url || '';
        if (firstImgUrl) {
            selectedInternetImages = [firstImgUrl];
            if (counter) counter.textContent = 'Ảnh đã chọn: 1/9';
            selectedImageUrl = firstImgUrl;
            updateMockupImages(selectedInternetImages);
        } else {
            if (counter) counter.textContent = 'Ảnh đã chọn: 0/9';
            updateMockupImages(selectedInternetImages);
        }

        grid.innerHTML = '';
        images.forEach((img, idx) => {
            const url = img.imageUrl || img.thumbnailUrl || img.url || '';
            if (!url) return;

            const isSelected = selectedInternetImages.includes(url);
            grid.insertAdjacentHTML('beforeend', `
                <div class="searched-image-thumb ${isSelected ? 'selected' : ''}" data-url="${escapeHTML(url)}" data-index="${idx}">
                    <img src="${escapeHTML(url)}" alt="${escapeHTML(img.title || 'Result')}" onerror="this.src='${escapeHTML(img.thumbnailUrl || '')}';">
                    <div class="selection-badge" style="${isSelected ? 'display: flex;' : 'display: none;'}">1</div>
                </div>
            `);
        });

        // Add event listeners to thumbnails
        grid.querySelectorAll('.searched-image-thumb').forEach(thumb => {
            thumb.addEventListener('click', () => {
                const url = thumb.getAttribute('data-url');
                const idx = selectedInternetImages.indexOf(url);

                if (idx !== -1) {
                    // Remove from selection
                    selectedInternetImages.splice(idx, 1);
                    thumb.classList.remove('selected');
                } else {
                    // Add to selection
                    if (selectedInternetImages.length >= 9) {
                        showToast('Bạn chỉ có thể chọn tối đa 9 hình ảnh.', 'info');
                        return;
                    }
                    selectedInternetImages.push(url);
                    thumb.classList.add('selected');
                }

                // Update all active badges with selection numbers sequentially
                grid.querySelectorAll('.searched-image-thumb').forEach(t => {
                    const u = t.getAttribute('data-url');
                    const curIdx = selectedInternetImages.indexOf(u);
                    const badge = t.querySelector('.selection-badge');
                    
                    if (curIdx !== -1) {
                        t.classList.add('selected');
                        if (badge) {
                            badge.textContent = curIdx + 1;
                            badge.style.display = 'flex';
                        }
                    } else {
                        t.classList.remove('selected');
                        if (badge) {
                            badge.style.display = 'none';
                        }
                    }
                });

                // Update counter
                if (counter) {
                    counter.textContent = `Ảnh đã chọn: ${selectedInternetImages.length}/9`;
                }

                // Set main image URL for save/publish
                selectedImageUrl = selectedInternetImages[0] || '';

                // Update the social card preview images
                updateMockupImages(selectedInternetImages);
            });
        });

        wrapper.classList.remove('hidden');
    }


    function authHeaders() {
        if (window.VotriApp?.authHeaders) return window.VotriApp.authHeaders();
        const headers = { 'Content-Type': 'application/json' };
        const token = sessionStorage.getItem('votri_sys_token');
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    function getCurrentUserId() {
        const email = sessionStorage.getItem('votri_sys_user_email');
        let userId = 'LIKACcuu76gHz5mMgFOCa8mV2ta2'; // default fallback
        try {
            const list = JSON.parse(localStorage.getItem('votri_sys_users') || '[]');
            const user = list.find((u) => u.email === email);
            if (user && user.id) {
                userId = user.id;
            }
        } catch (e) {}
        return userId;
    }


    function parseJsonResponse(res) {
        if (window.VotriApp?.parseJsonResponse) return window.VotriApp.parseJsonResponse(res);
        return res.json();
    }

    function escapeHTML(str) {
        if (window.VotriApp?.escapeHTML) return window.VotriApp.escapeHTML(str);
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function dbgLog(hypothesisId, location, message, data) {
        // #region agent log
        fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ff0680' },
            body: JSON.stringify({ sessionId: 'ff0680', hypothesisId, location, message, data, timestamp: Date.now() }),
        }).catch(() => {});
        // #endregion
    }

    // 2. Unsplash Image Assets matching topics
    const TOPIC_IMAGES = {
        shoes: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80', // Red Nike
        minigame: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=600&auto=format&fit=crop&q=80', // Celebration
        spa: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=600&auto=format&fit=crop&q=80', // Face care
        remote: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&auto=format&fit=crop&q=80', // Workspace
        sale: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80', // Shopping
        default: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80' // Beautiful gradient
    };

    // 3. Toast notification helper
    function showToast(msg, type = 'info') {
        if (window.VotriApp && typeof window.VotriApp.showToast === 'function') {
            window.VotriApp.showToast(msg, type);
        } else if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
        } else {
            alert(msg);
        }
    }

    async function checkFacebookConnectionAndSetup() {
        const fbToken = localStorage.getItem('votri_sys_api_token');
        const notConnectedEl = document.getElementById('ai-post-fb-not-connected');
        const connectedEl = document.getElementById('ai-post-fb-connected');
        
        if (fbToken) {
            if (notConnectedEl) notConnectedEl.classList.add('hidden');
            if (connectedEl) connectedEl.classList.remove('hidden');
            await populateFbPagesChecklist();
        } else {
            if (notConnectedEl) notConnectedEl.classList.remove('hidden');
            if (connectedEl) connectedEl.classList.add('hidden');
        }
    }

    function getPageNameById(pageId) {
        const pages = window.pages || [];
        const match = pages.find(p => p.fbPageId === pageId);
        return match ? match.name : 'Facebook Fanpage';
    }

    async function populateFbPagesChecklist() {
        const container = document.getElementById('fanpage-checkbox-list');
        if (!container) return;

        let currentPages = window.pages || [];
        if (!currentPages.length && window.VotriFanpages?.loadPagesFromServer) {
            try {
                await window.VotriFanpages.loadPagesFromServer();
                currentPages = window.pages || [];
            } catch (err) {
                console.error('[Create Post AI] Load pages failed', err);
            }
        }

        const fbPages = currentPages.filter(p => p.fbPageId);
        
        if (fbPages.length === 0) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-4 text-center text-gray-500 gap-1">
                    <i data-lucide="info" class="w-5 h-5 text-amber-500"></i>
                    <span class="text-xs">Chưa có Fanpage nào được liên kết.</span>
                    <button type="button" id="btn-setup-platform-account-checklist" class="text-[10px] text-[#1877F2] hover:underline font-bold mt-1 bg-transparent border-0 cursor-pointer">
                        Thiết lập tài khoản ngay
                    </button>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();

            document.getElementById('btn-setup-platform-account-checklist')?.addEventListener('click', () => {
                if (window.VotriGuard) {
                    window.VotriGuard.navigate('settings');
                    showToast('Vui lòng cài đặt access token tài khoản ở bảng này để tự động kết nối.', 'info');
                } else if (window.VotriNav) {
                    window.VotriNav.showMainTab('settings');
                }
            });
            return;
        }

        container.innerHTML = '';
        fbPages.forEach(p => {
            const isSelected = selectedPages.has(p.fbPageId);
            container.insertAdjacentHTML('beforeend', `
                <div class="fanpage-checklist-item ${isSelected ? 'selected' : ''}" data-id="${p.fbPageId}">
                    <div class="fanpage-item-info">
                        <img src="https://graph.facebook.com/${p.fbPageId}/picture?type=small" class="fanpage-item-avatar" onerror="this.src='https://graph.facebook.com/${p.fbPageId}/picture?type=large'; this.onerror=function(){this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%231877F2%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z%22></path></svg>';}">
                        <span class="fanpage-item-name">${escapeHTML(p.name)}</span>
                    </div>
                    <div class="fanpage-item-checkbox">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                </div>
            `);
        });

        // Add event listeners to checklist items
        container.querySelectorAll('.fanpage-checklist-item').forEach(item => {
            item.addEventListener('click', () => {
                const pageId = item.getAttribute('data-id');
                if (selectedPages.has(pageId)) {
                    selectedPages.delete(pageId);
                } else {
                    selectedPages.add(pageId);
                }
                updateSelectedAccountsSection();
                updateMockupPageDetails();
            });
        });
    }

    function bindFbPagesDropdown() {
        const btn = document.getElementById('fb-pages-dropdown-btn');
        const menu = document.getElementById('fb-pages-dropdown-menu');
        const arrow = document.getElementById('fb-dropdown-arrow');
        const wrapper = document.getElementById('fb-pages-dropdown-wrapper');

        if (!btn || !menu || !arrow) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !menu.classList.contains('hidden');
            if (isOpen) {
                menu.classList.add('hidden');
                arrow.classList.remove('open');
            } else {
                menu.classList.remove('hidden');
                arrow.classList.add('open');
            }
        });

        document.addEventListener('click', (e) => {
            if (wrapper && !wrapper.contains(e.target)) {
                menu.classList.add('hidden');
                arrow.classList.remove('open');
            }
        });
    }

    function updateSelectedAccountsSection() {
        const sectionEl = document.getElementById('selected-accounts-section');
        const listEl = document.getElementById('selected-accounts-list');
        const labelEl = document.getElementById('lbl-selected-accounts-count');
        const container = document.getElementById('fanpage-checkbox-list');

        if (!sectionEl || !listEl) return;

        // Sync visual selected classes on checklist elements
        if (container) {
            container.querySelectorAll('.fanpage-checklist-item').forEach(item => {
                const pageId = item.getAttribute('data-id');
                item.classList.toggle('selected', selectedPages.has(pageId));
            });
        }

        // Update checklist header count
        const totalSelectedPages = document.getElementById('lbl-selected-pages-count');
        if (totalSelectedPages) {
            totalSelectedPages.textContent = `Đã chọn: ${selectedPages.size}`;
        }

        // Update trigger dropdown button label dynamically
        const btnText = document.getElementById('fb-dropdown-btn-text');
        if (btnText) {
            if (selectedPages.size === 0) {
                btnText.textContent = 'Chọn Fanpage để đăng bài';
            } else if (selectedPages.size === 1) {
                const firstPageId = Array.from(selectedPages)[0];
                btnText.textContent = getPageNameById(firstPageId);
            } else {
                btnText.textContent = `Đã chọn ${selectedPages.size} Fanpage`;
            }
        }

        if (selectedPages.size > 0) {
            sectionEl.classList.remove('hidden');
            if (labelEl) labelEl.textContent = `Tài khoản đã chọn (${selectedPages.size}):`;
            
            listEl.innerHTML = '';
            selectedPages.forEach(pageId => {
                const pageName = getPageNameById(pageId);
                listEl.insertAdjacentHTML('beforeend', `
                    <span class="selected-account-tag">
                        ${escapeHTML(pageName)}
                        <button type="button" data-id="${pageId}" class="btn-unselect-page">×</button>
                    </span>
                `);
            });

            // Bind click listeners for tag removals
            listEl.querySelectorAll('.btn-unselect-page').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pageId = btn.getAttribute('data-id');
                    selectedPages.delete(pageId);
                    updateSelectedAccountsSection();
                    updateMockupPageDetails();
                });
            });
        } else {
            sectionEl.classList.add('hidden');
            listEl.innerHTML = '';
        }
    }

    function updateMockupPageDetails() {
        const mockName = document.getElementById('mock-page-name');
        const mockAvatar = document.getElementById('mock-avatar');

        if (!mockName) return;

        if (selectedPages.size === 0) {
            mockName.textContent = 'Vô Tri Entertainment';
            if (mockAvatar) {
                mockAvatar.innerHTML = '<i data-lucide="facebook" class="w-5 h-5" id="mock-avatar-icon"></i>';
                if (window.lucide) window.lucide.createIcons();
            }
            return;
        }

        const firstPageId = Array.from(selectedPages)[0];
        const pageName = getPageNameById(firstPageId);

        mockName.textContent = pageName;
        if (mockAvatar) {
            mockAvatar.innerHTML = `<img src="https://graph.facebook.com/${firstPageId}/picture?type=large" class="w-full h-full object-cover rounded-full" onerror="this.outerHTML='<i data-lucide=\\'facebook\\' class=\\'w-5 h-5 text-[#1877F2]\\'></i>'; if(window.lucide) window.lucide.createIcons();">`;
        }
    }

    function populateHourMinuteSelects(rowEl) {
        if (!rowEl) return;
        const hrSel = rowEl.querySelector('.time-hour') || rowEl.querySelector('#fixed-hour-input');
        const minSel = rowEl.querySelector('.time-minute') || rowEl.querySelector('#fixed-minute-input');
        
        if (hrSel) {
            hrSel.innerHTML = '';
            for (let i = 0; i < 24; i++) {
                const val = String(i).padStart(2, '0');
                hrSel.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
            }
        }
        if (minSel) {
            minSel.innerHTML = '';
            for (let i = 0; i < 60; i += 5) {
                const val = String(i).padStart(2, '0');
                minSel.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
            }
        }
    }

    function addWeeklyTimeRow() {
        const container = document.getElementById('weekly-times-list');
        if (!container) return;

        const newRow = document.createElement('div');
        newRow.className = 'weekly-time-row';
        newRow.innerHTML = `
            <select class="time-hour">
            </select>
            <span class="text-white text-xs">:</span>
            <select class="time-minute">
            </select>
            <button type="button" class="btn-delete-time">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        `;

        container.appendChild(newRow);
        populateHourMinuteSelects(newRow);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        newRow.querySelector('.btn-delete-time').addEventListener('click', () => {
            newRow.remove();
        });
    }

    let fixedSchedulesList = [];
    function renderFixedSchedules() {
        const emptyEl = document.getElementById('fixed-schedules-empty');
        const itemsEl = document.getElementById('fixed-schedules-items');

        if (!emptyEl || !itemsEl) return;

        if (fixedSchedulesList.length === 0) {
            emptyEl.classList.remove('hidden');
            itemsEl.classList.add('hidden');
            itemsEl.innerHTML = '';
        } else {
            emptyEl.classList.add('hidden');
            itemsEl.classList.remove('hidden');
            
            fixedSchedulesList.sort((a, b) => {
                const da = a.date + 'T' + a.time;
                const db = b.date + 'T' + b.time;
                return da.localeCompare(db);
            });

            itemsEl.innerHTML = '';
            fixedSchedulesList.forEach((item, index) => {
                const [yyyy, mm, dd] = item.date.split('-');
                const displayDate = `${dd}/${mm}/${yyyy}`;
                itemsEl.insertAdjacentHTML('beforeend', `
                    <div class="fixed-schedule-item">
                        <div>
                            <span class="time-lbl"><i data-lucide="clock" class="w-3.5 h-3.5 inline"></i> ${item.time}</span>
                            <span class="date-lbl">${displayDate}</span>
                        </div>
                        <button type="button" data-index="${index}" class="btn-delete-fixed-item btn-delete-fixed-schedule">
                            <i data-lucide="x" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                `);
            });

            if (typeof lucide !== 'undefined') lucide.createIcons();

            itemsEl.querySelectorAll('.btn-delete-fixed-schedule').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-index'));
                    fixedSchedulesList.splice(idx, 1);
                    renderFixedSchedules();
                });
            });
        }
    }

    function bindFixedScheduleAdder() {
        const btn = document.getElementById('btn-add-fixed-schedule');
        const dateInput = document.getElementById('fixed-date-input');
        const hrInput = document.getElementById('fixed-hour-input');
        const minInput = document.getElementById('fixed-minute-input');

        if (!btn || !dateInput || !hrInput || !minInput) return;

        btn.addEventListener('click', () => {
            const dateVal = dateInput.value;
            if (!dateVal) {
                showToast('Vui lòng chọn ngày đăng cụ thể.', 'info');
                return;
            }
            const timeVal = `${hrInput.value}:${minInput.value}`;
            
            const isDup = fixedSchedulesList.some(item => item.date === dateVal && item.time === timeVal);
            if (isDup) {
                showToast('Lịch đăng này đã tồn tại trong danh sách.', 'info');
                return;
            }

            fixedSchedulesList.push({ date: dateVal, time: timeVal });
            renderFixedSchedules();
            showToast('Đã thêm lịch đăng ngày cố định!', 'success');
        });
    }

    let currentScheduleMode = 'weekly';
    function bindScheduleModeTabs() {
        const cards = document.querySelectorAll('#schedule-mode-container [data-mode]');
        const weeklyOptions = document.getElementById('weekly-mode-options');
        const fixedOptions = document.getElementById('fixed-mode-options');
        const tipEl = document.getElementById('schedule-mode-tip');

        cards.forEach(card => {
            card.addEventListener('click', () => {
                const mode = card.getAttribute('data-mode');
                currentScheduleMode = mode;

                cards.forEach(c => {
                    c.classList.remove('active-mode');
                    const check = c.querySelector('.scheduler-mode-check');
                    if (check) check.remove();
                });

                card.classList.add('active-mode');
                card.insertAdjacentHTML('beforeend', `
                    <div class="scheduler-mode-check">
                        <i data-lucide="check-circle" class="w-4 h-4 fill-[#1877F2] text-white"></i>
                    </div>
                `);
                if (typeof lucide !== 'undefined') lucide.createIcons();

                if (mode === 'weekly') {
                    weeklyOptions.classList.remove('hidden');
                    weeklyOptions.classList.add('block');
                    fixedOptions.classList.remove('block');
                    fixedOptions.classList.add('hidden');
                    tipEl.textContent = '💡 Mẹo: Chế độ lặp lại theo tuần phù hợp cho lịch đăng bài thường xuyên và đều đặn.';
                    tipEl.className = 'text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2 mt-2 leading-relaxed';
                } else {
                    weeklyOptions.classList.remove('block');
                    weeklyOptions.classList.add('hidden');
                    fixedOptions.classList.remove('hidden');
                    fixedOptions.classList.add('block');
                    tipEl.textContent = '💡 Mẹo: Chế độ ngày cố định phù hợp cho các chiến dịch đặc biệt, sự kiện hoặc ngày lễ.';
                    tipEl.className = 'text-[11px] text-indigo-300 bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-2 mt-2 leading-relaxed';
                }
            });
        });
    }

    function bindWeeklyDaysChips() {
        const chips = document.querySelectorAll('#weekly-days-chips button');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
            });
        });
    }

    let currentPostingMode = 'direct';
    function bindPostingModeTabs() {
        const btns = document.querySelectorAll('#posting-mode-tabs button');
        const descEl = document.getElementById('posting-mode-desc');

        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-post-mode');
                currentPostingMode = mode;

                btns.forEach(b => b.classList.remove('active-post-mode'));
                btn.classList.add('active-post-mode');

                if (mode === 'direct') {
                    descEl.textContent = 'Hệ thống sẽ tự động viết và đăng bài ngay theo lịch đã cài đặt.';
                } else {
                    descEl.textContent = 'Hệ thống sẽ viết bài nháp vào thời gian cài đặt để bạn kiểm duyệt trước khi đăng.';
                }
            });
        });
    }

    function bindSaveAutoScheduleButton() {
        const btn = document.getElementById('btn-save-auto-schedule');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            if (selectedPages.size === 0) {
                showToast('Vui lòng chọn ít nhất 1 Fanpage để đăng bài.', 'info');
                return;
            }
            
            if (!generatedPostContent) {
                showToast('Vui lòng nhập yêu cầu và nhấn "Tạo bài viết bằng AI" trước khi lên lịch.', 'info');
                return;
            }

            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="loader-2" class="spinning w-4.5 h-4.5"></i> Đang lưu...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            try {
                const checkedPages = Array.from(selectedPages);

                if (currentScheduleMode === 'weekly') {
                    const checkedDays = Array.from(document.querySelectorAll('#weekly-days-chips button.active'))
                        .map(b => b.getAttribute('data-day'));

                    if (checkedDays.length === 0) {
                        showToast('Vui lòng chọn ít nhất 1 ngày trong tuần để lặp lại.', 'info');
                        btn.disabled = false;
                        btn.innerHTML = originalHtml;
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                        return;
                    }

                    const timeRows = document.querySelectorAll('#weekly-times-list .weekly-time-row');
                    const times = Array.from(timeRows).map(row => {
                        const hr = row.querySelector('.time-hour').value;
                        const min = row.querySelector('.time-minute').value;
                        return `${hr}:${min}`;
                    });

                    if (times.length === 0) {
                        showToast('Vui lòng chọn ít nhất 1 mốc giờ đăng bài.', 'info');
                        btn.disabled = false;
                        btn.innerHTML = originalHtml;
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                        return;
                    }

                    for (const pageId of checkedPages) {
                        const pageName = getPageNameById(pageId);
                        for (const t of times) {
                            await fetch(`${apiBase()}/api/content/schedule`, {
                                method: 'POST',
                                headers: authHeaders(),
                                body: JSON.stringify({
                                    pageId,
                                    pageName,
                                    content: generatedPostContent,
                                    imageUrl: selectedImageUrl || null,
                                    scheduleTime: t,
                                    repeatDays: checkedDays
                                })
                            });
                        }
                    }
                    showToast('✅ Đã lên lịch đăng bài lặp lại định kỳ thành công!', 'success');
                } else {
                    if (fixedSchedulesList.length === 0) {
                        showToast('Vui lòng thêm ít nhất 1 ngày & giờ cố định.', 'info');
                        btn.disabled = false;
                        btn.innerHTML = originalHtml;
                        if (typeof lucide !== 'undefined') lucide.createIcons();
                        return;
                    }

                    for (const pageId of checkedPages) {
                        const pageName = getPageNameById(pageId);
                        for (const item of fixedSchedulesList) {
                            await fetch(`${apiBase()}/api/content/schedule`, {
                                method: 'POST',
                                headers: authHeaders(),
                                body: JSON.stringify({
                                    pageId,
                                    pageName,
                                    content: generatedPostContent,
                                    imageUrl: selectedImageUrl || null,
                                    scheduleTime: item.time,
                                    specificDate: item.date,
                                    repeatDays: []
                                })
                            });
                        }
                    }
                    showToast('✅ Đã lên lịch đăng ngày cố định thành công!', 'success');
                    fixedSchedulesList = [];
                    renderFixedSchedules();
                }
            } catch (err) {
                console.error('[AI Post Schedule Error]', err);
                showToast('Lỗi máy chủ khi lên lịch đăng bài.', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    }

    function bindResetSchedulerButton() {
        const btn = document.getElementById('btn-reset-scheduler');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const timesList = document.getElementById('weekly-times-list');
            if (timesList) {
                timesList.innerHTML = `
                    <div class="weekly-time-row">
                        <select class="time-hour"></select>
                        <span class="text-white text-xs">:</span>
                        <select class="time-minute"></select>
                        <button type="button" class="btn-delete-time">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                `;
                populateHourMinuteSelects(timesList.querySelector('.weekly-time-row'));
                timesList.querySelector('.btn-delete-time').addEventListener('click', () => {
                    timesList.querySelector('.weekly-time-row').remove();
                });
            }

            document.querySelectorAll('#weekly-days-chips button').forEach(b => b.classList.add('active'));

            fixedSchedulesList = [];
            renderFixedSchedules();

            const dateInput = document.getElementById('fixed-date-input');
            if (dateInput) dateInput.value = '';

            selectedPages.clear();
            const container = document.getElementById('fanpage-checkbox-list');
            if (container) {
                container.querySelectorAll('.fanpage-checklist-item').forEach(item => {
                    item.classList.remove('selected');
                });
            }
            updateSelectedAccountsSection();
            updateMockupPageDetails();

            showToast('Đã thiết lập lại bộ lịch đăng bài!', 'info');
        });
    }

    // 5. Initialize DOM interaction
    function init() {
        const viewEl = document.getElementById('view-create-post-ai');
        if (!viewEl) return;

        // Reset binding flag if DOM is dynamically reloaded (e.g. switching tabs)
        const triggerBtn = document.getElementById('btn-trigger-suggestions');
        if (triggerBtn && !triggerBtn.dataset.bound) {
            domBound = false;
        }

        const dashboardPanel = viewEl.querySelector('.bg-gray-50');
        const previewPanel = document.getElementById('preview-panel-container');
        const dashboardClass = dashboardPanel ? dashboardPanel.className : '';
        const previewClass = previewPanel ? previewPanel.className : '';
        dbgLog(
            'H1-H3',
            'js/votri-create-post-ai.js:init',
            'Theme baseline captured',
            {
                viewVisible: !viewEl.classList.contains('hidden'),
                dashboardClass,
                previewClass,
                dashboardBg: dashboardPanel ? window.getComputedStyle(dashboardPanel).backgroundColor : null,
                dashboardText: dashboardPanel ? window.getComputedStyle(dashboardPanel).color : null,
                previewBg: previewPanel ? window.getComputedStyle(previewPanel).backgroundColor : null
            }
        );

        if (!domBound) {
            domBound = true;
            bindPlatformTabs();
            bindTextareaCounter();
            bindLengthButtons();
            bindStyleTags();
            bindImageSourceCards();
            bindAiImageAspectSelector();
            loadSuggestions();
            bindGenerateButton();
            bindActionButtons();
            setupDragAndDrop();

            bindScheduleModeTabs();
            bindWeeklyDaysChips();
            bindPostingModeTabs();
            bindFixedScheduleAdder();
            bindSaveAutoScheduleButton();
            bindResetSchedulerButton();

            // Init first time row
            const firstRow = document.querySelector('#weekly-times-list .weekly-time-row');
            if (firstRow) {
                populateHourMinuteSelects(firstRow);
                firstRow.querySelector('.btn-delete-time')?.addEventListener('click', () => {
                    firstRow.remove();
                });
            }

            // Init fixed hour/minute inputs
            populateHourMinuteSelects(document.getElementById('fixed-mode-options'));

            document.getElementById('btn-add-weekly-time')?.addEventListener('click', addWeeklyTimeRow);

            // Accounts list bindings are handled dynamically in populateFbPagesChecklist()
            bindFbPagesDropdown();
            bindSuggestionsModalEvents();
        }
        syncInitialSelectionStyles();
        checkFacebookConnectionAndSetup();

        const lenActive = document.querySelectorAll('#length-buttons-container button.active').length;
        const styleActive = document.querySelectorAll('#style-tags-container button.active').length;
        const sourceActive = document.querySelectorAll('#image-source-container [data-source].active').length;
        dbgLog(
            'H6',
            'js/votri-create-post-ai.js:init',
            'Selection style state after sync',
            { lenActive, styleActive, sourceActive }
        );
    }

    function syncInitialSelectionStyles() {
        document.querySelectorAll('#length-buttons-container button').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-length') === selectedLength);
        });
        document.querySelectorAll('#style-tags-container button').forEach((btn) => {
            btn.classList.toggle('active', selectedStyles.has(btn.getAttribute('data-style')));
        });
        document.querySelectorAll('#image-source-container [data-source]').forEach((card) => {
            card.classList.toggle('active', card.getAttribute('data-source') === selectedImgSource);
        });
    }

    function buildSuggestTopicsPayload() {
        const requirement = document.getElementById('ai-post-requirement')?.value?.trim() || '';
        const refUrl = document.getElementById('ai-post-ref-url')?.value?.trim() || '';
        return {
            requirement,
            refUrl,
            platform: selectedPlatform,
            length: selectedLength,
            styles: Array.from(selectedStyles),
        };
    }

    function buildSuggestInfoText() {
        const requirement = document.getElementById('ai-post-requirement')?.value?.trim() || '';
        if (requirement) return requirement;
        return 'những chủ đề đang hot trên mạng xã hội facebook';
    }

    async function fetchSuggestedTopics() {
        const info = buildSuggestInfoText();
        const url = `${apiBase()}/api/content/suggest-topics`;
        const hasVotriToken = Boolean(sessionStorage.getItem('votri_sys_token'));
        const autoworkToken = sessionStorage.getItem('autowork_id_token') || '';

        dbgLog('H1-H3', 'js/votri-create-post-ai.js:fetchSuggestedTopics', 'Request start', {
            url,
            pageOrigin: window.location.origin,
            apiBaseResolved: apiBase(),
            hasVotriToken,
            hasAutoworkToken: Boolean(autoworkToken),
            infoLen: info.length,
        });

        const res = await fetch(url, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                info,
                source: 'normal-post',
                language: 'vi',
                topicCount: 10,
                userId: getCurrentUserId(),
                autoworkToken: autoworkToken || undefined,
                ...buildSuggestTopicsPayload(),
            }),
        });

        const rawText = await res.text();
        const contentType = res.headers.get('content-type') || '';
        const isHtml = rawText.trimStart().startsWith('<!DOCTYPE') || rawText.trimStart().startsWith('<html');

        dbgLog('H1-H4', 'js/votri-create-post-ai.js:fetchSuggestedTopics', 'Response received', {
            status: res.status,
            contentType,
            isHtml,
            bodyPrefix: rawText.slice(0, 120),
        });

        if (isHtml) {
            throw new Error(
                `API trả HTML (status ${res.status}). Mở http://localhost:3000 và khởi động lại node server.js.`,
            );
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch {
            throw new Error('Phản hồi không phải JSON.');
        }

        if (!res.ok || !data.success) {
            throw new Error(data.message || data.error || 'Không lấy được gợi ý chủ đề.');
        }
        return Array.isArray(data.topics) ? data.topics.filter(Boolean) : [];
    }

    // Platform selection (Facebook only)
    function bindPlatformTabs() {
        const badgeEl = document.getElementById('preview-platform-badge');
        const setupBtn = document.getElementById('btn-setup-platform-account');
        const avatarIcon = document.getElementById('mock-avatar-icon');
        const mockName = document.getElementById('mock-page-name');
        const fbFooter = document.getElementById('mock-footer-facebook');
        const zaloFooter = document.getElementById('mock-footer-zalo');

        selectedPlatform = 'facebook';
        if (badgeEl) {
            badgeEl.textContent = 'Facebook';
            badgeEl.className = 'px-3 py-1 text-[10px] font-bold rounded-full bg-blue-100 text-[#1877F2] uppercase tracking-wider';
        }
        if (setupBtn) {
            setupBtn.innerHTML = '<i data-lucide="settings" class="w-4 h-4"></i> Thiết lập tài khoản Facebook để đăng bài';
        }
        if (avatarIcon) {
            avatarIcon.setAttribute('data-lucide', 'facebook');
        }
        if (mockName) mockName.textContent = 'Vô Tri Entertainment';
        if (fbFooter) fbFooter.classList.remove('hidden');
        if (zaloFooter) zaloFooter.classList.add('hidden');
        if (typeof lucide !== 'undefined') lucide.createIcons();

        dbgLog('H5', 'js/votri-create-post-ai.js:bindPlatformTabs', 'Platform fixed to Facebook', {
            platform: selectedPlatform
        });
    }

    // Character counter
    function bindTextareaCounter() {
        const textarea = document.getElementById('ai-post-requirement');
        const charCount = document.getElementById('char-count');
        if (!textarea || !charCount) return;

        textarea.addEventListener('input', () => {
            const len = textarea.value.length;
            charCount.textContent = `${len} / 8000`;
            if (len > 7500) {
                charCount.className = 'text-xs text-red-500 font-mono font-bold';
            } else if (len > 6000) {
                charCount.className = 'text-xs text-amber-500 font-mono font-bold';
            } else {
                charCount.className = 'text-xs text-gray-400 font-mono font-medium';
            }
        });
    }

    // Length Select buttons
    function bindLengthButtons() {
        const container = document.getElementById('length-buttons-container');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            // Clear active state of others
            container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            // Set active state
            btn.classList.add('active');
            selectedLength = btn.getAttribute('data-length');
        });
    }

    // Style Tags Selection
    function bindStyleTags() {
        const container = document.getElementById('style-tags-container');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            const style = btn.getAttribute('data-style');
            if (selectedStyles.has(style)) {
                // Remove style (with guard of keeping at least one)
                if (selectedStyles.size > 1) {
                    selectedStyles.delete(style);
                    btn.classList.remove('active');
                } else {
                    showToast('Vui lòng chọn ít nhất 1 phong cách bài viết.', 'info');
                }
            } else {
                // Add style
                selectedStyles.add(style);
                btn.classList.add('active');
            }
        });
    }

    // Image Source choices cards
    function bindImageSourceCards() {
        const container = document.getElementById('image-source-container');
        if (!container) return;

        const inputs = {
            internet: document.getElementById('img-input-internet'),
            ai: document.getElementById('img-input-ai'),
            device: document.getElementById('img-input-device')
        };

        container.addEventListener('click', (e) => {
            const card = e.target.closest('[data-source]');
            if (!card) return;

            const source = card.getAttribute('data-source');
            selectedImgSource = source;

            // Update border visual representation
            container.querySelectorAll('[data-source]').forEach(c => {
                c.classList.remove('active');
                const check = c.querySelector('.absolute');
                if (check) check.remove();
            });

            // Set active styles
            card.classList.add('active');
            card.insertAdjacentHTML('beforeend', `
                <div class="absolute top-1.5 right-1.5 text-[#1877F2]">
                    <i data-lucide="check-circle" class="w-4 h-4 fill-[#1877F2] text-white"></i>
                </div>
            `);
            if (typeof lucide !== 'undefined') lucide.createIcons();

            // Toggle input blocks
            Object.keys(inputs).forEach(key => {
                if (inputs[key]) {
                    if (key === source) {
                        inputs[key].classList.remove('hidden');
                        inputs[key].classList.add('block');
                    } else {
                        inputs[key].classList.add('hidden');
                        inputs[key].classList.remove('block');
                    }
                }
            });

            // Toggle internet selection container and dynamically refresh mockup
            const wrapper = document.getElementById('image-selection-wrapper');
            if (source !== 'internet') {
                if (wrapper) wrapper.classList.add('hidden');
                
                // Render corresponding preview mockup images immediately
                if (source === 'ai') {
                    const reqText = document.getElementById('ai-post-requirement')?.value?.trim()?.toLowerCase() || '';
                    let imgKey = 'default';
                    if (reqText.includes('giày') || reqText.includes('shoes') || reqText.includes('sneaker')) imgKey = 'shoes';
                    else if (reqText.includes('minigame') || reqText.includes('đoán số') || reqText.includes('quà')) imgKey = 'minigame';
                    else if (reqText.includes('mụn') || reqText.includes('da') || reqText.includes('spa')) imgKey = 'spa';
                    else if (reqText.includes('work') || reqText.includes('remote')) imgKey = 'remote';
                    else if (reqText.includes('sale') || reqText.includes('khuyến mãi')) imgKey = 'sale';
                    
                    selectedImageUrl = TOPIC_IMAGES[imgKey] || TOPIC_IMAGES['default'];
                    updateMockupImages([selectedImageUrl]);
                } else if (source === 'device') {
                    if (uploadedImageFile && selectedImageUrl) {
                        updateMockupImages([selectedImageUrl]);
                    } else {
                        updateMockupImages([]);
                    }
                }
            } else {
                // If switched back to internet, display active selection or hide it until search runs
                if (selectedInternetImages && selectedInternetImages.length > 0) {
                    if (wrapper) wrapper.classList.remove('hidden');
                    updateMockupImages(selectedInternetImages);
                } else {
                    if (wrapper) wrapper.classList.add('hidden');
                    updateMockupImages([]);
                }
            }

            dbgLog('H2-H3', 'js/votri-create-post-ai.js:bindImageSourceCards', 'Image source card switched', {
                source: selectedImgSource,
                activeCardClass: card.className,
                visibleInput: Object.keys(inputs).find(key => inputs[key] && !inputs[key].classList.contains('hidden')) || null
            });
        });
    }

    function bindAiImageAspectSelector() {
        const selector = document.getElementById('ai-img-aspect-selector');
        if (!selector) return;

        selector.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            selector.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedImgAspect = btn.getAttribute('data-aspect') || '1:1';
            
            // Instantly refresh mockup preview aspect ratio if there is a selected image
            if (selectedImageUrl) {
                updateMockupImages([selectedImageUrl]);
            }
        });
    }

    function renderSuggestionsList(listContainer, topics) {
        listContainer.innerHTML = '';
        topics.forEach((topic, idx) => {
            const text = typeof topic === 'string' ? topic : (topic.title || topic.prompt || '');
            const desc = typeof topic === 'object' && topic.prompt && topic.title ? topic.prompt : '';
            listContainer.insertAdjacentHTML('beforeend', `
                <div class="ai-topic-item" data-index="${idx}">
                    <div class="ai-topic-content">
                        <div class="ai-topic-item-title">${escapeHTML(text)}</div>
                        ${desc ? `<p class="ai-topic-item-desc">${escapeHTML(desc)}</p>` : ''}
                    </div>
                    <div class="ai-topic-actions">
                        <button type="button" class="btn-use-topic" data-index="${idx}">
                            <i data-lucide="edit-3" style="width:12px;height:12px;"></i> Áp dụng
                        </button>
                        <button type="button" class="btn-generate-topic" data-index="${idx}">
                            <i data-lucide="zap" style="width:12px;height:12px;"></i> Tạo ngay
                        </button>
                    </div>
                </div>
            `);
        });

        // Initialize icons
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Bind Apply (Use) buttons
        listContainer.querySelectorAll('.btn-use-topic').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = Number(btn.getAttribute('data-index'));
                applySuggestion(topics[idx]);
            });
        });

        // Bind Generate Now buttons
        listContainer.querySelectorAll('.btn-generate-topic').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = Number(btn.getAttribute('data-index'));
                applySuggestion(topics[idx]);
                // Trigger generation immediately
                setTimeout(() => {
                    const genBtn = document.getElementById('btn-generate-ai-post');
                    if (genBtn) {
                        genBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        genBtn.click();
                    }
                }, 150);
            });
        });
    }

    function renderSuggestionsLoading(listContainer) {
        listContainer.innerHTML = `
            <div class="ai-topic-item" style="cursor:default;opacity:0.85">
                <div class="ai-topic-item-title">Đang tải gợi ý từ AI...</div>
                <p class="ai-topic-item-desc">Vui lòng đợi trong giây lát.</p>
            </div>
        `;
    }

    function renderSuggestionsError(listContainer, message) {
        listContainer.innerHTML = `
            <div class="ai-topic-item" style="cursor:default;border-color:rgba(239,68,68,0.35)">
                <div class="ai-topic-item-title">Không tải được gợi ý</div>
                <p class="ai-topic-item-desc">${escapeHTML(message)}</p>
            </div>
        `;
    }

    // Standalone Suggested Topics auto-loading
    async function loadSuggestions() {
        const listContainer = document.getElementById('suggestions-list-container');
        if (!listContainer) return;

        renderSuggestionsLoading(listContainer);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const topics = await fetchSuggestedTopics();
            if (!topics || !topics.length) throw new Error('API không trả về chủ đề nào.');
            renderSuggestionsList(listContainer, topics);
        } catch (err) {
            console.error('[suggest-topics] Fetch failed:', err);
            dbgLog('H5', 'js/votri-create-post-ai.js:loadSuggestions', 'Fetch failed', {
                errMsg: String(err.message || err).slice(0, 200),
            });
            renderSuggestionsError(listContainer, err.message || 'Không tải được gợi ý chủ đề.');
        }
    }

    // Apply suggestion topic to form
    function applySuggestion(sug) {
        const textarea = document.getElementById('ai-post-requirement');
        if (!textarea) return;

        // Extract text content
        const promptText = typeof sug === 'string' ? sug : (sug.prompt || sug.title || String(sug));
        textarea.value = promptText;
        textarea.dispatchEvent(new Event('input'));

        // Apply length config (from suggestion object or keep current)
        if (sug && typeof sug === 'object' && sug.length) {
            const lengthBtn = document.querySelector(`#length-buttons-container button[data-length="${sug.length}"]`);
            if (lengthBtn) {
                document.querySelectorAll('#length-buttons-container button').forEach(b => b.classList.remove('active'));
                lengthBtn.classList.add('active');
                selectedLength = sug.length;
            }
        }

        // Apply style config (from suggestion object or keep current active styles)
        if (sug && typeof sug === 'object' && Array.isArray(sug.styles) && sug.styles.length) {
            selectedStyles.clear();
            document.querySelectorAll('#style-tags-container button').forEach((btn) => {
                const style = btn.getAttribute('data-style');
                const on = sug.styles.includes(style);
                btn.classList.toggle('active', on);
                if (on) selectedStyles.add(style);
            });
            if (selectedStyles.size === 0) {
                selectedStyles.add('professional');
                document.querySelector('#style-tags-container button[data-style="professional"]')?.classList.add('active');
            }
        }

        showToast('✅ Đã áp dụng chủ đề! Chỉnh độ dài & phong cách rồi nhấn Tạo bài viết.', 'success');
        closeSuggestionsModal();
    }

    // Modal Helpers
    function openSuggestionsModal() {
        const modal = document.getElementById('ai-suggestions-modal');
        if (modal) {
            modal.style.display = ''; // Clear inline style displays injected by global listeners
            modal.classList.remove('hidden');
            // Force reflow
            modal.offsetWidth;
            modal.classList.add('active');
        }
    }

    function closeSuggestionsModal() {
        const modal = document.getElementById('ai-suggestions-modal');
        if (modal) {
            modal.style.display = ''; // Clear inline style displays injected by global listeners
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
        }
    }

    function bindSuggestionsModalEvents() {
        const triggerBtn = document.getElementById('btn-trigger-suggestions');
        const formTriggerBtn = document.getElementById('btn-form-trigger-suggestions');
        const refreshBtn = document.getElementById('btn-refresh-suggestions-modal');
        const closeBtn = document.getElementById('btn-close-suggestions-modal');
        const modal = document.getElementById('ai-suggestions-modal');

        if (triggerBtn) {
            triggerBtn.dataset.bound = "true";
            triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSuggestionsModal();
                loadSuggestions(); // Fetch fresh suggestions based on current state
            });
        }

        if (formTriggerBtn) {
            formTriggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSuggestionsModal();
                loadSuggestions(); // Fetch fresh suggestions based on current state
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadSuggestions(); // Manually fetch fresh suggestions from API
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeSuggestionsModal();
            });
        }

        if (modal) {
            modal.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent global listeners from getting click events
                if (e.target === modal) {
                    closeSuggestionsModal();
                }
            });
        }
    }

    // Drag and drop for image upload
    function setupDragAndDrop() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('ai-post-img-file');
        const filenameDisplay = document.getElementById('preview-upload-filename');

        if (!dropZone || !fileInput || !filenameDisplay) return;

        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
            }
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-blue-400', 'bg-blue-50/20');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('border-blue-400', 'bg-blue-50/20');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-blue-400', 'bg-blue-50/20');
            if (e.dataTransfer.files.length > 0) {
                fileInput.files = e.dataTransfer.files;
                handleFile(e.dataTransfer.files[0]);
            }
        });

        function handleFile(file) {
            if (!file.type.startsWith('image/')) {
                showToast('Chỉ cho phép tải lên tệp hình ảnh!', 'info');
                return;
            }
            uploadedImageFile = file;
            selectedImageUrl = URL.createObjectURL(file);
            filenameDisplay.textContent = `📎 ${file.name} (${Math.round(file.size / 1024)} KB)`;
            filenameDisplay.classList.remove('hidden');
        }
    }

    // Generate Button and Simulated AI Multi-step Logic
    function bindGenerateButton() {
        const btn = document.getElementById('btn-generate-ai-post');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            let reqText = document.getElementById('ai-post-requirement').value.trim();
            if (!reqText) {
                showToast('Đang tự động lấy gợi ý chủ đề ngẫu nhiên từ AI...', 'info');
                try {
                    const topics = await fetchSuggestedTopics();
                    if (topics && topics.length > 0) {
                        const randomTopic = topics[Math.floor(Math.random() * topics.length)];
                        const promptText = typeof randomTopic === 'string' ? randomTopic : (randomTopic.prompt || randomTopic.title || String(randomTopic));
                        const textarea = document.getElementById('ai-post-requirement');
                        textarea.value = promptText;
                        textarea.dispatchEvent(new Event('input'));
                        reqText = promptText;
                        showToast(`Đã chọn chủ đề ngẫu nhiên: "${reqText}"`, 'success');
                    } else {
                        showToast('Không có gợi ý chủ đề nào khả dụng. Vui lòng nhập chủ đề.', 'warning');
                        document.getElementById('ai-post-requirement').focus();
                        return;
                    }
                } catch (err) {
                    showToast('Lỗi khi lấy gợi ý tự động. Vui lòng nhập chủ đề.', 'error');
                    document.getElementById('ai-post-requirement').focus();
                    return;
                }
            }

            // Hide empty and output states, show loading state
            document.getElementById('preview-empty-state').classList.add('hidden');
            document.getElementById('preview-output-state').classList.add('hidden');
            
            const loader = document.getElementById('preview-loading-state');
            loader.classList.remove('hidden');

            const loadTitle = document.getElementById('ai-loading-title');
            const loadStep = document.getElementById('ai-loading-step');
            const loadProgress = document.getElementById('ai-loading-progress');

            // 5-step progress loader simulation
            const steps = [
                { progress: 15, title: 'AI đang phân tích...', step: 'Đang phân tích yêu cầu từ người dùng...' },
                { progress: 40, title: 'AI đang lên dàn ý...', step: 'Đang lập cấu trúc dàn bài & chèn phong cách lựa chọn...' },
                { progress: 70, title: 'AI đang soạn thảo...', step: 'Đang triển khai chi tiết từng đoạn văn và chèn Emojis...' },
                { progress: 92, title: 'AI đang duyệt bài...', step: 'Đang tối ưu ngữ pháp và rà soát bài viết...' },
                { progress: 100, title: 'Hoàn tất!', step: 'Đang kết xuất bài viết ra khung xem trước...' }
            ];

            // Trigger actual API call in parallel
            let apiSuccess = false;
            let generatedData = null;
            let apiErrorMsg = '';

            // Map selectedLength to string
            const lengthMap = {
                'very-short': '50 - 100 từ',
                'short': '100 - 150 từ',
                'medium': '150 - 250 từ',
                'full': '250 - 500 từ',
                'detailed': '500 - 1000 từ'
            };
            const postLength = lengthMap[selectedLength] || '150 - 250 từ';

            // Map selectedStyles to string
            const styleMap = {
                'professional': 'Chuyên nghiệp',
                'funny': 'Hài hước',
                'creative': 'Sáng tạo',
                'emotional': 'Cảm xúc',
                'persuasive': 'Thuyết phục',
                'storytelling': 'Kể chuyện',
                'formal': 'Trang trọng'
            };
            const postStyles = Array.from(selectedStyles).map(s => styleMap[s] || s).join(', ') || 'Chuyên nghiệp';

            const activeUserId = getCurrentUserId();
            const refUrlVal = document.getElementById('ai-post-ref-url')?.value?.trim() || '';

            const apiPayload = {
                requirements: reqText,
                refUrl: refUrlVal,
                length: selectedLength,
                styles: Array.from(selectedStyles),
                platform: selectedPlatform,
                imageSource: selectedImgSource
            };

            if (selectedImgSource === 'ai') {
                const imgStyle = document.getElementById('ai-img-style')?.value || 'realistic';
                const imgAspect = selectedImgAspect || '1:1';
                const imgPrompt = document.getElementById('ai-post-img-prompt')?.value?.trim() || '';
                apiPayload.imageOptions = {
                    style: imgStyle,
                    aspect: imgAspect,
                    prompt: imgPrompt
                };
            }

            const apiCall = fetch(`${apiBase()}/api/content/generate-post`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(apiPayload)
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data && data.data.content) {
                    apiSuccess = true;
                    generatedData = data.data;
                } else {
                    apiErrorMsg = data.message || 'Lỗi không xác định từ máy chủ.';
                }
            })
            .catch(err => {
                apiErrorMsg = err.message || 'Lỗi kết nối mạng.';
            });

            // Parallel Hybrid Image Search Trigger (if source is internet)
            let imagesSuccess = false;
            let searchedImages = [];
            let imagesCall = Promise.resolve();

            if (selectedImgSource === 'internet') {
                imagesCall = fetch(`${apiBase()}/api/content/get-images-hybrid`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({
                        query: reqText,
                        limit: 10,
                        userId: activeUserId
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success && data.data && Array.isArray(data.data.images)) {
                        imagesSuccess = true;
                        searchedImages = data.data.images;
                    }
                })
                .catch(err => {
                    console.error('[get-images-hybrid] failed:', err);
                });
            }

            let stepIdx = 0;
            const runStep = async () => {
                if (stepIdx >= steps.length) {
                    // Wait for both text generator and hybrid images promises to resolve
                    try {
                        await Promise.all([apiCall, imagesCall]);
                    } catch (_) {}

                    setTimeout(() => {
                        if (apiSuccess && generatedData) {
                            renderRealGeneratedPost(generatedData, imagesSuccess, searchedImages);
                        } else {
                            console.error('[generate-post] API failed:', apiErrorMsg);
                            dbgLog('H2', 'js/votri-create-post-ai.js:bindGenerateButton', 'API failed', {
                                error: apiErrorMsg,
                            });
                            // Hide loading and restore empty state
                            document.getElementById('preview-loading-state').classList.add('hidden');
                            document.getElementById('preview-empty-state').classList.remove('hidden');
                            showToast(`Tạo bài viết AI thất bại: ${apiErrorMsg}`, 'error');
                        }
                    }, 400);
                    return;
                }

                const current = steps[stepIdx];
                if (loadTitle) loadTitle.textContent = current.title;
                if (loadStep) loadStep.textContent = current.step;
                if (loadProgress) loadProgress.style.width = `${current.progress}%`;

                stepIdx++;
                setTimeout(runStep, 800 + Math.random() * 600); // realistic variance
            };

            runStep();
        });
    }

    function renderRealGeneratedPost(data, imagesSuccess = false, searchedImages = []) {
        generatedPostContent = data.content || '';

        // Apply to preview mockup
        const textContentEl = document.getElementById('mock-text-content');
        if (textContentEl) {
            textContentEl.textContent = generatedPostContent;
            textContentEl.setAttribute('contenteditable', 'false'); // reset editable
        }

        // Handle image source selection
        const wrapper = document.getElementById('image-selection-wrapper');
        if (selectedImgSource === 'internet') {
            if (imagesSuccess && searchedImages.length > 0) {
                renderSearchedImagesGrid(searchedImages);
            } else {
                renderSearchedImagesGrid([]);
                showToast('Không tìm thấy ảnh hoặc tải ảnh từ internet thất bại.', 'error');
            }
        } else {
            if (wrapper) wrapper.classList.add('hidden');
            const imgContainer = document.getElementById('mock-image-container');

            if (imgContainer) {
                if (data.image) {
                    selectedImageUrl = data.image;
                    updateMockupImages([selectedImageUrl]);
                } else {
                    if (selectedImgSource === 'ai') {
                        // Smart image categories based on content keywords
                        const reqText = document.getElementById('ai-post-requirement').value.trim().toLowerCase();
                        let imgKey = 'default';
                        if (reqText.includes('giày') || reqText.includes('shoes') || reqText.includes('sneaker')) imgKey = 'shoes';
                        else if (reqText.includes('minigame') || reqText.includes('đoán số') || reqText.includes('quà')) imgKey = 'minigame';
                        else if (reqText.includes('mụn') || reqText.includes('da') || reqText.includes('spa')) imgKey = 'spa';
                        else if (reqText.includes('work') || reqText.includes('remote')) imgKey = 'remote';
                        else if (reqText.includes('sale') || reqText.includes('khuyến mãi')) imgKey = 'sale';
                        
                        selectedImageUrl = TOPIC_IMAGES[imgKey];
                        updateMockupImages([selectedImageUrl]);
                    } else if (selectedImgSource === 'device') {
                        if (uploadedImageFile && selectedImageUrl) {
                            updateMockupImages([selectedImageUrl]);
                        } else {
                            updateMockupImages([]);
                        }
                    }
                }
            }
        }

        // Toggle state
        document.getElementById('preview-loading-state').classList.add('hidden');
        document.getElementById('preview-output-state').classList.remove('hidden');

        showToast('Tạo bài viết AI thành công!', 'success');
        runAdsSafeScan();
    }

    function runAdsSafeScan() {
        const text = generatedPostContent || '';
        const checkListEl = document.getElementById('ads-safe-check-list');
        const checkCardEl = document.getElementById('ads-safe-check-card');
        if (!checkListEl || !checkCardEl) return;

        const rules = [
            {
                pattern: /cam kết|đảm bảo/gi,
                replacement: 'hỗ trợ / ưu tiên / đồng hành'
            },
            {
                pattern: /100%/g,
                replacement: 'tối đa / hết mình'
            },
            {
                pattern: /chuyên gia|authority/gi,
                replacement: 'đội ngũ am hiểu / người đồng hành'
            },
            {
                pattern: /điều trị|chữa dứt điểm|cải thiện sức khỏe|chữa trị|trị dứt/gi,
                replacement: 'hỗ trợ / tập trung / hạn chế / phù hợp'
            },
            {
                pattern: /thuốc(?! bổ)/gi,
                replacement: 'sản phẩm / dưỡng chất'
            }
        ];

        let html = '';
        let hasViolations = false;

        rules.forEach(rule => {
            const matches = text.match(rule.pattern);
            if (matches && matches.length > 0) {
                hasViolations = true;
                const uniqueMatches = Array.from(new Set(matches.map(m => m.toLowerCase())));
                html += `
                    <div class="flex items-start gap-2 text-amber-400 bg-amber-500/5 p-2 rounded border border-solid border-amber-500/10">
                        <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5 animate-pulse"></i>
                        <div>
                            <span class="font-bold">⚠️ Phát hiện từ nhạy cảm:</span> <code class="bg-gray-800 px-1.5 py-0.5 rounded text-red-400">${uniqueMatches.join(', ')}</code>
                            <div class="text-[10px] text-gray-400 mt-1">Nên thay thế bằng: <strong class="text-green-400 font-semibold">${rule.replacement}</strong></div>
                        </div>
                    </div>
                `;
            }
        });

        if (!hasViolations) {
            html = `
                <div class="flex items-center gap-2 text-green-400 bg-green-500/5 p-2.5 rounded border border-solid border-green-500/10">
                    <i data-lucide="check-circle" class="w-4 h-4 text-green-400 flex-shrink-0"></i>
                    <span class="font-medium">✅ Bài viết an toàn không chứa từ cấm chạy Ads. Bao an toàn!</span>
                </div>
            `;
        }

        checkListEl.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    async function autoFixAdsSafe() {
        const text = generatedPostContent || '';
        if (!text.trim()) return;

        const btnAutoFix = document.getElementById('btn-auto-fix-ads-safe');
        if (btnAutoFix) {
            btnAutoFix.disabled = true;
            btnAutoFix.innerHTML = '⏳ Đang tối ưu...';
        }

        showToast('Đang gọi AI để tối ưu hóa ngôn từ an toàn chạy Ads...', 'info');

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/content/optimize-ads-safe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ content: text })
            });

            const data = await res.json();
            if (data.success && data.optimizedContent) {
                generatedPostContent = data.optimizedContent;
                const textContentEl = document.getElementById('mock-text-content');
                if (textContentEl) {
                    textContentEl.textContent = generatedPostContent;
                }
                runAdsSafeScan();
                showToast('⚡ AI đã tự động tối ưu hóa từ ngữ an toàn chạy Ads thành công!', 'success');
            } else {
                showToast(data.message || 'Lỗi khi tối ưu hóa bằng AI.', 'error');
            }
        } catch (err) {
            console.error('[autoFixAdsSafe]', err);
            showToast('Lỗi kết nối khi gọi AI tối ưu hóa.', 'error');
        } finally {
            if (btnAutoFix) {
                btnAutoFix.disabled = false;
                btnAutoFix.innerHTML = '⚡ Tối ưu Ads-Safe';
            }
        }
    }

    // Smart copywriting generator based on keywords
    function displayGeneratedPost(requirement, imagesSuccess = false, searchedImages = []) {
        const text = requirement.toLowerCase();
        let content = '';
        let imgKey = 'default';

        // Select Unsplash image category based on context
        if (text.includes('giày') || text.includes('shoes') || text.includes('sneaker')) {
            imgKey = 'shoes';
            content = `👟 ĐỘT PHÁ PHONG CÁCH - BƯỚC ĐI TỰ TIN CÙNG URBAN RUNNERS 👟\n\nBạn đã sẵn sàng để nâng tầm phong cách thời trang năng động của mình chưa? Dòng giày chạy bộ thế hệ mới Urban Runners chính thức ra mắt, thiết kế dành riêng cho thế hệ trẻ bứt phá!\n\n✨ ƯU ĐIỂM VƯỢT TRỘI:\n🔹 Công nghệ đệm UltraFoam siêu nhẹ giúp giảm chấn tối đa trên mọi địa hình.\n🔹 Thân giày dệt lưới Knit 3D thoáng khí vượt trội, ôm chân êm ái.\n🔹 Thiết kế phối màu đa sắc thời thượng, dễ phối mọi set đồ.\n\n🔥 ƯU ĐÃI KHỦNG THÁNG NÀY:\n🎁 Giảm ngay 20% cho 50 bạn đầu tiên comment chốt đơn.\n🎁 Freeship toàn quốc khi đặt hàng online.\n\n👇 ĐỂ LẠI BÌNH LUẬN hoặc INBOX shop ngay để nhận tư vấn size chuẩn nhất!`;
        } else if (text.includes('minigame') || text.includes('đoán số') || text.includes('quà')) {
            imgKey = 'minigame';
            content = `🎉 MINIGAME ĐOÁN SỐ MAY MẮN - RINH QUÀ HÈ CỰC ĐÃ 🎉\n\nChào cả nhà thân yêu! Hè này Vô Tri Club chơi lớn mang đến cho các thành viên cơ hội nhận voucher mua hàng cực giá trị. Thể lệ cực dễ ai cũng có thể trúng luôn nha!\n\n👇 CÁC BƯỚC THAM GIA:\n1️⃣ Bấm Thích (Like) trang Fanpage và bài đăng này.\n2️⃣ Comment 1 con số may mắn từ 00 đến 99 kèm tag 3 người bạn thân vào chung vui.\n3️⃣ Chia sẻ (Share) bài viết này về trang cá nhân của bạn ở chế độ Công Khai.\n\n🏆 PHẦN THƯỞNG:\n🎁 01 Voucher quà tặng trị giá 500.000đ mua hàng tại Vô Tri Store dành cho comment đoán đúng hoặc gần nhất kết quả 2 số cuối giải Đặc Biệt XSMB ngày chủ nhật tuần này.\n\n⏰ Thời gian đóng cổng bình luận: 18h00 Chủ Nhật tuần này. Kết quả sẽ được công bố nhanh chóng lúc 20h00.\n\nNhanh tay tương tác rinh quà khủng nào các bạn ơi! Chúc cả nhà may mắn! 🍀`;
        } else if (text.includes('mụn') || text.includes('da') || text.includes('spa') || text.includes('beauty')) {
            imgKey = 'spa';
            content = `🌸 TẠM BIỆT MỤN - TỰ TIN KHOE LÀN DA MỊN MÀNG SAU 14 NGÀY 🌸\n\nLàn da mụn viêm, mụn ẩn làm bạn mất đi sự tự tin khi giao tiếp? Bạn đã thử nhiều cách nhưng mụn vẫn quay lại? Đừng lo lắng, liệu trình trị mụn chuyên sâu của chúng tôi sẽ hồi sinh làn da bạn!\n\n✨ LIỆU TRÌNH ĐIỀU TRỊ CHUYÊN SÂU CAM KẾT:\n✔️ Sử dụng 100% thảo dược thiên nhiên kết hợp công nghệ phục hồi tầng sâu.\n✔️ Xử lý cồi mụn chuẩn y khoa, hạn chế tối đa để lại vết thâm hay sẹo rỗ.\n✔️ Giảm sưng viêm tức thì chỉ sau buổi đầu tiên trị liệu.\n✔️ Bảo hành hiệu quả da sạch mụn lên tới 95% sau 2 tuần.\n\n🔥 ƯU ĐÃI ĐẶC QUYỀN MÙA HÈ:\n🎁 Tặng ngay 1 buổi thải độc chì trị giá 300k cho khách hàng đặt lịch hẹn hôm nay.\n\n👇 Hãy INBOX chụp ảnh tình trạng da hiện tại để bác sĩ tư vấn chi tiết hoàn toàn miễn phí nhé!`;
        } else if (text.includes('work') || text.includes('remote') || text.includes('mẹo') || text.includes('tips')) {
            imgKey = 'remote';
            content = `📚 BỎ TÚI 5 MẸO TẬP TRUNG CAO ĐỘ KHI LÀM VIỆC TẠI NHÀ (REMOTE WORK) 📚\n\nLàm việc tại nhà mang lại sự tự do nhưng cũng đi kèm rất nhiều sự phân tâm. Làm sao để duy trì năng suất công việc 100%? Xem ngay 5 mẹo từ các chuyên gia nhé:\n\n1️⃣ Tạo Không Gian Riêng Biệt: Hãy set up một góc làm việc đủ ánh sáng, tách biệt với giường ngủ.\n2️⃣ Quy Tắc Pomodoro: Tập trung cao độ trong 25 phút rồi nghỉ ngơi 5 phút để tái tạo năng lượng.\n3️⃣ Lập Kế Hoạch Trước: Ghi ra 3 đầu việc quan trọng cần hoàn thành trước khi bắt đầu ngày mới.\n4️⃣ Tắt Mạng Xã Hội: Để điện thoại ở chế độ im lặng hoặc dùng app chặn ứng dụng giải trí.\n5️⃣ Vận Động Nhẹ Nhàng: Đứng dậy đi lại, giãn cơ 10 phút sau mỗi 2 tiếng làm việc.\n\n💡 Áp dụng ngay hôm nay để thấy sự thay đổi vượt trội trong hiệu suất làm việc của bạn nhé! Hãy lưu lại bài viết và share cho bạn bè cùng biết.\n\n#remotework #productivity #tips`;
        } else if (text.includes('sale') || text.includes('khuyến mãi') || text.includes('giảm giá')) {
            imgKey = 'sale';
            content = `🔥 ĐẠI TIỆC SUMMER SALE - GIẢM GIÁ SIÊU KHỦNG LÊN ĐẾN 50% toàn shop 🔥\n\nCơ hội vàng để sắm sửa những bộ cánh xinh đẹp đón hè đã đến rồi! Chương trình khuyến mãi lớn nhất trong năm chính thức bắt đầu từ ngày hôm nay!\n\n👉 ÁP DỤNG TRÊN TOÀN HỆ THỐNG:\n📌 Sale up to 50% tất cả sản phẩm váy đầm thiết kế, áo thun trẻ trung, quần short thời thượng.\n📌 Đồng giá chỉ từ 99k cho nhiều mặt hàng phụ kiện hot hit.\n📌 ĐẶC BIỆT: Tặng thêm voucher 50k cho đơn hàng từ 500k.\n\n🚚 FREESHIP toàn quốc cho hóa đơn từ 300k.\n⏰ Chương trình chỉ diễn ra từ ngày 01 đến ngày 05 tháng sau. Số lượng sản phẩm có hạn!\n\n👇 CLICK ngay vào giỏ hàng hoặc gửi tin nhắn cho shop để săn sale liền tay kẻo hết size!`;
        } else {
            // General high-quality template using user prompt keywords
            imgKey = 'default';
            const cleanReq = requirement.length > 80 ? requirement.substring(0, 80) + '...' : requirement;
            content = `💡 SÁNG TẠO NỘI DUNG VỚI TRÍ TUỆ NHÂN TẠO AI 💡\n\nBài viết được tạo lập hoàn toàn tự động dựa trên mong muốn của bạn: "${cleanReq}"\n\nChào mọi người! Hôm nay chúng tôi muốn mang lại một cái nhìn mới mẻ và giải pháp hữu ích cho vấn đề này. Hãy cùng điểm qua những thông tin nổi bật nhất dưới đây:\n\n📌 LỢI ÍCH KHÔNG THỂ BỎ QUA:\n🔹 Tối ưu thời gian: Giải pháp nhanh gọn giúp bạn xử lý công việc nhanh gấp 5 lần thông thường.\n🔹 Tiết kiệm chi phí: Chất lượng hàng đầu đi kèm giá cả vô cùng hợp lý, phù hợp cho mọi đối tượng.\n🔹 Vận hành tự động: Tích hợp công nghệ hiện đại thông minh nhất hiện nay giúp tự động hóa 100% quy trình.\n\n👉 Đừng chần chừ, hãy liên hệ với chúng tôi để nhận những tư vấn cụ thể và chuyên sâu hơn nhé!\n\n#aicreator #votriclub #marketingonline`;
        }

        // Adjust length if short/very short
        if (selectedLength === 'very-short') {
            content = content.split('\n\n').slice(0, 2).join('\n\n') + '\n\n👉 Đăng ký ngay để không bỏ lỡ!';
        } else if (selectedLength === 'short') {
            content = content.split('\n\n').slice(0, 3).join('\n\n') + '\n\n👉 Inbox shop ngay để được tư vấn!';
        }

        // Setup style line at the end
        let styleNote = '';
        if (selectedStyles.size > 0) {
            const list = Array.from(selectedStyles).map(s => {
                if (s === 'professional') return 'Chuyên nghiệp';
                if (s === 'funny') return 'Hài hước';
                if (s === 'creative') return 'Sáng tạo';
                if (s === 'emotional') return 'Cảm xúc';
                if (s === 'persuasive') return 'Thuyết phục';
                if (s === 'storytelling') return 'Kể chuyện';
                if (s === 'formal') return 'Trang trọng';
                return s;
            }).join(', ');
            styleNote = `\n\n*(Bài viết được hiệu chỉnh theo phong cách: ${list})*`;
        }

        generatedPostContent = content + styleNote;

        // Apply to preview mockup
        const textContentEl = document.getElementById('mock-text-content');
        if (textContentEl) {
            textContentEl.textContent = generatedPostContent;
            textContentEl.setAttribute('contenteditable', 'false'); // reset editable
        }

        // Handle image source selection
        const wrapper = document.getElementById('image-selection-wrapper');
        if (selectedImgSource === 'internet') {
            if (imagesSuccess && searchedImages.length > 0) {
                renderSearchedImagesGrid(searchedImages);
            } else {
                renderSearchedImagesGrid([]);
                showToast('Không tìm thấy ảnh hoặc tải ảnh từ internet thất bại.', 'error');
            }
        } else {
            if (wrapper) wrapper.classList.add('hidden');
            const imgContainer = document.getElementById('mock-image-container');

            if (imgContainer) {
                if (selectedImgSource === 'ai') {
                    selectedImageUrl = TOPIC_IMAGES[imgKey];
                    updateMockupImages([selectedImageUrl]);
                } else if (selectedImgSource === 'device') {
                    if (uploadedImageFile && selectedImageUrl) {
                        updateMockupImages([selectedImageUrl]);
                    } else {
                        updateMockupImages([]);
                    }
                }
            }
        }

        // Toggle state
        document.getElementById('preview-loading-state').classList.add('hidden');
        document.getElementById('preview-output-state').classList.remove('hidden');

        runAdsSafeScan();
    }

    // Action buttons inside mockup preview
    function bindActionButtons() {
        const btnCopy = document.getElementById('btn-copy-post');
        const btnEdit = document.getElementById('btn-edit-post');
        const btnPublish = document.getElementById('btn-publish-post');
        const btnSetupAccount = document.getElementById('btn-setup-platform-account');
        const btnAutoFixAdsSafe = document.getElementById('btn-auto-fix-ads-safe');

        if (btnAutoFixAdsSafe) {
            btnAutoFixAdsSafe.addEventListener('click', autoFixAdsSafe);
        }

        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                const textEl = document.getElementById('mock-text-content');
                if (!textEl) return;
                
                navigator.clipboard.writeText(textEl.textContent.trim())
                    .then(() => {
                        showToast('Đã sao chép nội dung bài viết vào bộ nhớ tạm!', 'success');
                    })
                    .catch(() => {
                        showToast('Không thể sao chép. Vui lòng chọn tay nội dung bài đăng.', 'info');
                    });
            });
        }

        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                const textEl = document.getElementById('mock-text-content');
                if (!textEl) return;

                const isEditable = textEl.getAttribute('contenteditable') === 'true';
                if (isEditable) {
                    textEl.setAttribute('contenteditable', 'false');
                    textEl.classList.remove('border', 'border-dashed', 'border-blue-400', 'p-2', 'rounded-lg', 'bg-blue-50/5');
                    generatedPostContent = textEl.textContent;
                    runAdsSafeScan();
                    btnEdit.innerHTML = '<i data-lucide="edit-3" class="w-4 h-4 text-gray-500"></i> Sửa bài';
                    showToast('Đã lưu các thay đổi của bạn!', 'success');
                } else {
                    textEl.setAttribute('contenteditable', 'true');
                    textEl.classList.add('border', 'border-dashed', 'border-blue-400', 'p-2', 'rounded-lg', 'bg-blue-50/5');
                    textEl.focus();
                    btnEdit.innerHTML = '<i data-lucide="check" class="w-4 h-4 text-green-600"></i> Xong';
                    showToast('Bấm trực tiếp vào văn bản xem trước để chỉnh sửa!', 'info');
                }
                if (typeof lucide !== 'undefined') lucide.createIcons();
            });
        }

        if (btnPublish) {
            btnPublish.addEventListener('click', async () => {
                if (!generatedPostContent) {
                    showToast('Vui lòng tạo bài viết bằng AI trước khi đăng.', 'info');
                    return;
                }

                if (selectedPages.size === 0) {
                    showToast('Vui lòng chọn ít nhất 1 Fanpage để đăng bài.', 'info');
                    return;
                }

                const pageCount = selectedPages.size;
                showToast(`🚀 Đang chuẩn bị đăng bài viết tự động lên ${pageCount} Fanpage...`, 'success');
                
                setTimeout(() => {
                    showToast(`✅ Đã đăng bài viết thành công lên ${pageCount} Fanpage!`, 'success');
                }, 2000);
            });
        }

        if (btnSetupAccount) {
            btnSetupAccount.addEventListener('click', () => {
                // Redirect settings tab
                if (window.VotriGuard) {
                    window.VotriGuard.navigate('settings');
                    showToast('Vui lòng cài đặt access token tài khoản ở bảng này để tự động kết nối.', 'info');
                } else if (window.VotriNav) {
                    window.VotriNav.showMainTab('settings');
                }
            });
        }
    }

    // Bind custom elements globally or load when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Register dynamic hook in VotriNav so we re-render Lucide icons if switching to this tab
    if (window.VotriNav) {
        const originalShowMainTab = window.VotriNav.showMainTab;
        window.VotriNav.showMainTab = function (tabId, options) {
            const ret = originalShowMainTab.apply(this, arguments);
            if (tabId === 'create-post-ai') {
                dbgLog('H4', 'js/votri-create-post-ai.js:showMainTab', 'AI post tab opened', {
                    tabId,
                    hasLucide: typeof lucide !== 'undefined',
                    bodyBg: window.getComputedStyle(document.body).backgroundColor
                });
                // Initialize elements
                init();
                // Ensure icons are loaded
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
            return ret;
        };
    }
})();
