const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DAEMON_DIR = path.join(__dirname, 'bank-ocrcaptcha');
const PYTHON_PATH = path.join(DAEMON_DIR, 'venv', 'Scripts', 'python.exe');
const APP_PATH = path.join(DAEMON_DIR, 'app.py');
const PORT = 8277;

/**
 * Kiểm tra xem Flask Captcha Server có đang hoạt động hay không
 */
function checkDaemonRunning() {
    return new Promise((resolve) => {
        const req = http.request({
            host: '127.0.0.1',
            port: PORT,
            path: '/api/captcha/vietcombank', // endpoint test
            method: 'POST',
            timeout: 1000,
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            // endpoint trả về 400 hoặc 500 do thiếu base64 là bình thường, miễn là có phản hồi từ server
            resolve(true);
        });

        req.on('error', () => {
            resolve(false);
        });

        // Gửi body trống chỉ để test sự tồn tại của server
        req.write(JSON.stringify({}));
        req.end();
    });
}

/**
 * Đảm bảo Flask Captcha Server hoạt động
 */
async function ensureCaptchaDaemon() {
    console.log('🔍 Đang kiểm tra trạng thái dịch vụ giải Captcha AI Master...');
    const isRunning = await checkDaemonRunning();
    if (isRunning) {
        console.log('✅ Dịch vụ Captcha AI Master đã hoạt động ngầm (cổng 8277).');
        return true;
    }

    console.log('⚙️ Khởi chạy dịch vụ Captcha AI Master mới...');
    if (!fs.existsSync(PYTHON_PATH)) {
        throw new Error(`Không tìm thấy trình chạy Python ảo tại: ${PYTHON_PATH}. Hãy kiểm tra xem bước cài đặt venv đã chạy đúng chưa.`);
    }

    // Khởi chạy ngầm app.py
    const child = spawn(PYTHON_PATH, [APP_PATH], {
        cwd: DAEMON_DIR,
        detached: true,
        stdio: 'ignore' // Không chặn output của Node
    });

    child.unref(); // Cho phép node kết thúc độc lập với python process

    // Đợi tối đa 15 giây cho TensorFlow khởi động và load các mô hình Vietcombank, MBBank, BIDV
    console.log('⏳ Đang khởi tạo mô hình Deep Learning (TensorFlow)...');
    for (let i = 1; i <= 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const active = await checkDaemonRunning();
        if (active) {
            console.log(`🎉 Dịch vụ Captcha AI Master khởi động thành công sau ${i}s!`);
            return true;
        }
        if (i % 3 === 0) {
            console.log(`   ⏳ Đang nạp model... (${i}s)`);
        }
    }

    throw new Error('Dịch vụ Captcha AI Master khởi động quá lâu hoặc gặp lỗi. Vui lòng chạy thủ công "py app.py" trong thư mục scripts/bank-ocrcaptcha để chẩn đoán.');
}

module.exports = { ensureCaptchaDaemon };

if (require.main === module) {
    ensureCaptchaDaemon().catch(err => {
        console.error('❌ Lỗi Daemon:', err.message);
    });
}
