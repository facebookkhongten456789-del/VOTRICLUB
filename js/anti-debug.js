/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  VÔ TRI CLUB — Anti-Debug & Anti-Tamper Shield v2.0     ║
 * ║  Chống F12, DevTools, Burp Suite, Proxy Interception    ║
 * ╚══════════════════════════════════════════════════════════╝
 */
(function () {
    'use strict';

    // ─── Configuration ──────────────────────────────────────
    var REDIRECT_URL = '/';               // Redirect khi phát hiện hack
    var CHECK_INTERVAL = 800;             // ms — kiểm tra DevTools
    var DEBUGGER_INTERVAL = 50;           // ms — spam debugger statement
    var MAX_VIOLATIONS = 3;               // Số lần vi phạm trước khi redirect
    var _violations = 0;

    // ─── 1. BLOCK KEYBOARD SHORTCUTS ────────────────────────
    // F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U
    document.addEventListener('keydown', function (e) {
        // F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            e.stopPropagation();
            _onViolation('keyboard_f12');
            return false;
        }
        // Ctrl+Shift+I (Inspect), Ctrl+Shift+J (Console), Ctrl+Shift+C (Element picker)
        if (e.ctrlKey && e.shiftKey && (
            e.key === 'I' || e.key === 'i' ||
            e.key === 'J' || e.key === 'j' ||
            e.key === 'C' || e.key === 'c' ||
            e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67
        )) {
            e.preventDefault();
            e.stopPropagation();
            _onViolation('keyboard_devtools');
            return false;
        }
        // Ctrl+U (View Source)
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
            e.preventDefault();
            e.stopPropagation();
            _onViolation('keyboard_source');
            return false;
        }
    }, true); // capture phase — chặn trước mọi handler khác

    // ─── 2. BLOCK RIGHT-CLICK CONTEXT MENU ──────────────────
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    }, true);

    // ─── 3. DEVTOOLS DETECTION — Window Size ────────────────
    // Khi DevTools mở docked, outerWidth/Height khác innerWidth/Height
    var _devToolsOpen = false;

    function _checkWindowSize() {
        var widthThreshold = window.outerWidth - window.innerWidth > 160;
        var heightThreshold = window.outerHeight - window.innerHeight > 160;
        if (widthThreshold || heightThreshold) {
            if (!_devToolsOpen) {
                _devToolsOpen = true;
                _onViolation('devtools_size');
            }
        } else {
            _devToolsOpen = false;
        }
    }

    // ─── 4. DEVTOOLS DETECTION — Timing Attack ──────────────
    // console.log với getter bị DevTools gọi → phát hiện thời gian thực thi
    function _checkDebuggerTiming() {
        var start = performance.now();
        // Tạo object với toString → DevTools sẽ evaluate khi mở console
        var _trap = new Image();
        Object.defineProperty(_trap, 'id', {
            get: function () {
                _onViolation('devtools_console');
            }
        });
        console.log('%c', _trap);
        console.clear();
    }

    // ─── 5. DEVTOOLS DETECTION — debugger statement ─────────
    // Khi DevTools Network/Sources mở → debugger sẽ pause execution
    function _antiDebugLoop() {
        (function _trap() {
            // Hàm này sẽ bị pause nếu DevTools mở
            try {
                // Tạo function để tránh bị optimized out
                (function () { return false; })
                    ['constructor']('debugger')
                    ['call']();
            } catch (e) { }
        })();
    }

    // ─── 6. ANTI-PROXY / BURP SUITE DETECTION ───────────────
    // Phát hiện proxy qua timing bất thường và header check
    function _checkProxy() {
        var startTime = performance.now();
        var testUrl = '/api/health?_t=' + Date.now() + Math.random();

        fetch(testUrl, {
            method: 'HEAD',
            cache: 'no-store',
            credentials: 'same-origin'
        }).then(function (response) {
            var elapsed = performance.now() - startTime;

            // Kiểm tra header bất thường từ proxy
            var via = response.headers.get('via');
            var xProxy = response.headers.get('x-forwarded-for');
            var proxyAuth = response.headers.get('proxy-authenticate');

            if (via || proxyAuth) {
                _onViolation('proxy_detected');
            }

            // Nếu response quá chậm (> 3s cho local request) → khả năng bị intercept
            if (elapsed > 3000 && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1'
            )) {
                _onViolation('proxy_slow');
            }
        }).catch(function () {
            // Nếu bị block bởi proxy → fetch fail
        });
    }

    // ─── 7. DETECT console.log OVERRIDE ─────────────────────
    // Một số tool hook console.log để capture data
    function _checkConsoleIntegrity() {
        try {
            var _origLog = Function.prototype.toString.call(console.log);
            if (_origLog.indexOf('[native code]') === -1) {
                _onViolation('console_tampered');
            }
        } catch (e) { }
    }

    // ─── 8. ANTI-COPY / ANTI-SELECT ────────────────────────
    /*
    document.addEventListener('copy', function (e) {
        e.preventDefault();
        return false;
    }, true);

    document.addEventListener('cut', function (e) {
        e.preventDefault();
        return false;
    }, true);

    // Cho phép select text trong input/textarea nhưng chặn select source code
    document.addEventListener('selectstart', function (e) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return true; // Cho phép
        }
        // Chặn select text ngoài input
        e.preventDefault();
        return false;
    }, true);
    */

    // ─── 9. ANTI-DRAG (kéo hình, file) ─────────────────────
    /*
    document.addEventListener('dragstart', function (e) {
        e.preventDefault();
        return false;
    }, true);
    */

    // ─── VIOLATION HANDLER ──────────────────────────────────
    function _onViolation(type) {
        _violations++;
        console.clear();

        // Log mỗi lần bị phát hiện (server-side log nếu cần)
        try {
            fetch('/api/security/violation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: type,
                    count: _violations,
                    ts: new Date().toISOString(),
                    ua: navigator.userAgent
                })
            }).catch(function () { });
        } catch (e) { }

        if (_violations >= MAX_VIOLATIONS) {
            // Xóa toàn bộ session + redirect
            try {
                sessionStorage.clear();
                localStorage.removeItem('session_token');
                localStorage.removeItem('currentUser');
            } catch (e) { }

            // Thay thế toàn bộ trang bằng warning
            document.documentElement.innerHTML = '';
            document.title = '⚠️ VÔ TRI — BẢO MẬT';
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:#0a0a0f;display:flex;' +
                'flex-direction:column;align-items:center;justify-content:center;z-index:999999;' +
                'font-family:Outfit,sans-serif;color:#fff;text-align:center;padding:40px;';
            overlay.innerHTML =
                '<div style="font-size:72px;margin-bottom:20px;">🛡️</div>' +
                '<h1 style="font-size:28px;margin-bottom:12px;color:#ff3b6f;">PHÁT HIỆN HÀNH VI BẤT THƯỜNG</h1>' +
                '<p style="font-size:16px;color:rgba(255,255,255,0.7);max-width:480px;line-height:1.6;">' +
                'Hệ thống bảo mật đã phát hiện hành vi đáng ngờ từ phiên làm việc của bạn.<br>' +
                'Phiên đăng nhập đã bị hủy để bảo vệ tài khoản.</p>' +
                '<p style="font-size:14px;color:rgba(255,255,255,0.4);margin-top:20px;">' +
                'Mã sự kiện: VTC-' + Date.now().toString(36).toUpperCase() + '</p>' +
                '<a href="/" style="margin-top:30px;padding:12px 32px;background:linear-gradient(135deg,#00f0ff,#6c63ff);' +
                'color:#fff;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;">Quay lại trang chủ</a>';
            document.body.appendChild(overlay);

            // Chặn mọi tương tác sau đó
            setTimeout(function () {
                window.location.replace(REDIRECT_URL);
            }, 8000);
        }
    }

    // ─── START DETECTION LOOPS ───────────────────────────────
    // Debugger loop — chạy liên tục
    setInterval(_antiDebugLoop, DEBUGGER_INTERVAL);

    // Window size check
    setInterval(_checkWindowSize, CHECK_INTERVAL);

    // Console integrity check
    setInterval(_checkConsoleIntegrity, 5000);

    // Proxy check — chạy 1 lần sau load và mỗi 30s
    setTimeout(_checkProxy, 2000);
    setInterval(_checkProxy, 30000);

    // Timing attack — mỗi 1s
    setInterval(_checkDebuggerTiming, 1000);

    // ─── DEVTOOLS DETECTION via toString override ───────────
    // Khi DevTools mở, nó sẽ evaluate toString() của objects trong console
    var _devEl = document.createElement('div');
    Object.defineProperty(_devEl, 'id', {
        get: function () {
            _devToolsOpen = true;
            _onViolation('devtools_element');
        }
    });

    // Gửi object vào console — DevTools sẽ trigger getter
    setInterval(function () {
        console.log(_devEl);
        console.clear();
    }, 1000);

    // ─── BLOCK eval/Function constructor abuse ──────────────
    // Override để ngăn chặn injection qua console
    var _origEval = window.eval;
    window.eval = function (code) {
        // Chỉ cho phép eval từ code tin cậy (cùng origin)
        if (typeof code === 'string' && code.length > 200) {
            _onViolation('eval_abuse');
            return undefined;
        }
        return _origEval.call(window, code);
    };

})();
