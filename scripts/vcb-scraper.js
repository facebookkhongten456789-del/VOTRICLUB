/**
 * VCB Digibank Scraper — Playwright + Gemini Vision + Math Color Filter fallback
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Jimp, intToRGBA } = require('jimp');
const { createWorker } = require('tesseract.js');
const path = require('path'), fs = require('fs');

const VCB_USER   = process.env.VCB_USERNAME;
const VCB_PASS   = process.env.VCB_PASSWORD;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OUT        = path.join(__dirname, 'vcb_output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ── Giải mã Captcha bằng mô hình ONNX qua Python với bộ lọc Lanczos (Chính xác >99%) ──
const { execSync } = require('child_process');

function solveCaptchaWithPython(imgBuffer) {
    try {
        const pythonPath = path.join(__dirname, 'bank-ocrcaptcha', 'venv', 'Scripts', 'python.exe');
        const solverScript = path.join(__dirname, 'vcb_model', 'solve.py');
        
        if (!fs.existsSync(pythonPath)) {
            throw new Error(`Không tìm thấy Python venv tại: ${pythonPath}`);
        }
        if (!fs.existsSync(solverScript)) {
            throw new Error(`Không tìm thấy script solver tại: ${solverScript}`);
        }

        // Tạo file ảnh tạm thời để python đọc
        const tempPath = path.join(OUT, 'temp_captcha.png');
        fs.writeFileSync(tempPath, imgBuffer);

        // Gọi python solver và lấy output
        const code = execSync(`"${pythonPath}" "${solverScript}" "${tempPath}"`, {
            encoding: 'utf8',
            timeout: 5000 // Tối đa 5 giây
        }).trim();
        
        // Dọn dẹp file tạm
        try { fs.unlinkSync(tempPath); } catch (e) {}

        if (code.startsWith('ERROR')) {
            throw new Error(code);
        }
        
        console.log(`  🤖 [Deep Learning Offline] Giải thành công: "${code}"`);
        return code;
    } catch (err) {
        console.log('  ⚠️ Lỗi Deep Learning Python Solver:', err.message);
        return null;
    }
}

// ── Hàm tổng hợp giải mã Captcha (Ưu tiên Deep Learning Python -> Fallback Gemini -> Fallback Math OCR) ──────
async function solveCaptchaAI(imgBuffer) {
    // 1. Luôn ưu tiên dùng mô hình Deep Learning qua Python vì độ chính xác >99% và hoàn toàn offline
    console.log('  🤖 Đang giải bằng mô hình Deep Learning (Python Offline)...');
    const dlResult = solveCaptchaWithPython(imgBuffer);
    if (dlResult && dlResult.length === 5) {
        return dlResult;
    }

    // 2. Fallback sang Gemini AI
    if (GEMINI_KEY && GEMINI_KEY !== 'your_gemini_api_key_here') {
        console.log('  ⚠️ ONNX không khả dụng. Đang gọi Gemini AI...');
        const models = ['gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', 'gemini-1.5-flash', 'gemini-2.0-flash'];
        const genAI = new GoogleGenerativeAI(GEMINI_KEY);

        for (const modelName of models) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent([
                    { inlineData: { mimeType: 'image/png', data: imgBuffer.toString('base64') } },
                    'Read ONLY the alphanumeric characters shown in this captcha image. Reply with just the characters, no spaces, no punctuation.',
                ]);
                const text = result.response.text().replace(/[^a-zA-Z0-9]/g, '').trim();
                if (text.length >= 3) {
                    console.log(`  🤖 ${modelName}: "${text}"`);
                    return text;
                }
            } catch (e) {
                const msg = e.message || '';
                if (msg.includes('429') || msg.includes('quota')) {
                    console.log(`  ⚠️ ${modelName}: quota, thử tiếp...`);
                } else {
                    console.log(`  ⚠️ ${modelName}: ${msg.slice(0, 60)}`);
                }
            }
        }
    }

    // 3. Fallback cuối cùng sang Xử lý ảnh Toán học + Tesseract OCR
    console.log('  🔢 Fallback: lọc màu pixel...');
    return await colorFilterOCR(imgBuffer);
}

// ── Lọc pixel màu xanh lá + Xoá đường gạch ngang + Xử lý toán học hình thái học ──
async function colorFilterOCR(imgBuffer) {
    try {
        const img = await Jimp.fromBuffer(imgBuffer);
        const w = img.bitmap.width;
        const h = img.bitmap.height;

        // 1. Phân ngưỡng màu sắc để lấy nét màu xanh lá (Chữ số + Đường gạch)
        // Loại bỏ hoàn toàn bóng đổ màu xám và nền sáng
        img.scan(0, 0, w, h, function(x, y, idx) {
            const r = this.bitmap.data[idx];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            
            // Màu xanh lá của VCB: Green chiếm ưu thế rõ rệt
            const isGreen = g > 55 && g > r * 1.15 && g > b * 1.15 && (r + g + b) < 550;
            if (isGreen) {
                // Giữ lại nét chữ (để màu đen)
                this.bitmap.data[idx] = 0;
                this.bitmap.data[idx + 1] = 0;
                this.bitmap.data[idx + 2] = 0;
            } else {
                // Xoá nền (để màu trắng)
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
            }
        });

        // 2. Thuật toán loại bỏ đường gạch ngang bằng phân tích độ dài liên tục dọc (Vertical Connected Component Analysis)
        // Đường gạch ngang thường có chiều dày rất mỏng theo chiều dọc (1-3 pixel)
        // Trong khi nét chữ số thường có chiều dày dọc lớn hơn (trừ các nét nằm ngang của số 7, 5, 2, 3...)
        // Quét từng cột từ trái qua phải để phát hiện các nét mảnh nằm ngang
        const matrix = [];
        for (let y = 0; y < h; y++) {
            matrix[y] = [];
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                matrix[y][x] = img.bitmap.data[idx] === 0 ? 1 : 0; // 1 là nét đen, 0 là nền trắng
            }
        }

        // Tạo bản sao để tránh làm hỏng các nét chữ quan trọng
        const cleanMatrix = JSON.parse(JSON.stringify(matrix));

        // Thuật toán: Với mỗi pixel đen, đếm xem có bao nhiêu pixel đen liên tục thẳng đứng đi qua nó.
        // Nếu số lượng pixel đen thẳng đứng liên tiếp quá nhỏ (<= 3 pixel), khả năng cao đó là một phần của đường gạch ngang mảnh.
        for (let x = 0; x < w; x++) {
            let y = 0;
            while (y < h) {
                if (matrix[y][x] === 1) {
                    let startY = y;
                    while (y < h && matrix[y][x] === 1) {
                        y++;
                    }
                    let endY = y;
                    let runLength = endY - startY;

                    // Nếu độ dày nét theo chiều dọc tại vị trí này cực mỏng (1 đến 2 pixel), xóa nó đi
                    if (runLength <= 2) {
                        for (let j = startY; j < endY; j++) {
                            cleanMatrix[j][x] = 0;
                        }
                    }
                } else {
                    y++;
                }
            }
        }

        // Cập nhật lại ảnh từ ma trận đã làm sạch
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const val = cleanMatrix[y][x] === 1 ? 0 : 255;
                img.bitmap.data[idx] = val;
                img.bitmap.data[idx + 1] = val;
                img.bitmap.data[idx + 2] = val;
            }
        }

        // 3. Thuật toán giãn nở nét (Mathematical Dilation) để khôi phục các điểm đứt gãy do xoá đường kẻ gây ra
        // Một pixel sẽ thành màu đen nếu có ít nhất 1 pixel đen xung quanh nó (kernel 3x3)
        const dilatedMatrix = JSON.parse(JSON.stringify(cleanMatrix));
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (cleanMatrix[y][x] === 0) {
                    // Kiểm tra 8 hướng xung quanh
                    const hasBlackNeighbor = 
                        cleanMatrix[y-1][x-1] === 1 || cleanMatrix[y-1][x] === 1 || cleanMatrix[y-1][x+1] === 1 ||
                        cleanMatrix[y][x-1] === 1   ||                              cleanMatrix[y][x+1] === 1 ||
                        cleanMatrix[y+1][x-1] === 1 || cleanMatrix[y+1][x] === 1 || cleanMatrix[y+1][x+1] === 1;
                    
                    if (hasBlackNeighbor) {
                        dilatedMatrix[y][x] = 1;
                    }
                }
            }
        }

        // Cập nhật ảnh sau giãn nở nét
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const val = dilatedMatrix[y][x] === 1 ? 0 : 255;
                img.bitmap.data[idx] = val;
                img.bitmap.data[idx + 1] = val;
                img.bitmap.data[idx + 2] = val;
            }
        }

        // 4. Phóng đại kích thước ảnh lên 4 lần để nét chữ mượt mà
        img.scale(4);

        const cleanBuf = await img.getBuffer('image/png');
        fs.writeFileSync(path.join(OUT, 'captcha_filtered.png'), cleanBuf);

        // 5. Chạy Tesseract OCR nhận diện ảnh với whitelist chữ + số
        const worker = await createWorker('eng', 1, { logger: () => {} });
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
            tessedit_pageseg_mode: '8', // Xem toàn bộ ảnh như một từ duy nhất
        });
        const { data: { text } } = await worker.recognize(cleanBuf);
        await worker.terminate();
        
        const result = text.replace(/[^a-zA-Z0-9]/g, '').trim();
        console.log(`  🔢 Math Filtered Alphanumeric OCR: "${result}"`);
        return result;
    } catch (e) {
        console.log('  ❌ colorFilterOCR error:', e.message);
        return '';
    }
}


async function main() {
    if (!VCB_USER || !GEMINI_KEY || GEMINI_KEY === 'your_gemini_api_key_here') {
        console.error('❌ Thiếu VCB_USERNAME hoặc GEMINI_API_KEY trong .env');
        return;
    }
    console.log('🏦 VCB Scraper + Gemini AI | User:', VCB_USER);

    const browser = await chromium.launch({
        headless: false, slowMo: 300,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const ctx = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh',
    });
    await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const apis = [];
    ctx.on('response', async res => {
        if ((res.headers()['content-type'] || '').includes('json') && !res.url().includes('.js')) {
            try {
                const body = await res.json();
                apis.push({ url: res.url().slice(-100), body });
                const s = JSON.stringify(body).toLowerCase();
                if (s.includes('tran') || s.includes('amount') || s.includes('balance') || s.includes('sotien')) {
                    fs.writeFileSync(path.join(OUT, `api_${Date.now()}.json`), JSON.stringify(body, null, 2));
                    console.log('🎯 API data lưu');
                }
            } catch (_) {}
        }
    });

    const page = await ctx.newPage();
    try {
        await page.goto('https://vcbdigibank.vietcombank.com.vn/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
        console.log('✅ Trang login tải xong');

        for (let attempt = 1; attempt <= 5; attempt++) {
            console.log(`\n── Lần thử ${attempt}/5 ──`);

            const userEl = await page.$('input[placeholder*="đăng nhập" i]');
            const passEl = await page.$('input[placeholder*="khẩu" i]');
            if (userEl) await userEl.fill(VCB_USER);
            if (passEl) await passEl.fill(VCB_PASS);

            const capImg = await page.$('img[src*="captcha" i]');
            if (!capImg) { console.log('  ℹ️ Không có captcha'); break; }

            const buf = await capImg.screenshot();
            fs.writeFileSync(path.join(OUT, `captcha_${attempt}.png`), buf);
            const code = await solveCaptchaAI(buf);
            console.log(`  ✅ Kết quả: "${code}"`);

            const capInput = await page.$('input[placeholder*="mã" i]') || await page.$('input[placeholder*="kiểm tra" i]');
            if (capInput) await capInput.fill(code);

            const btn = await page.$('button:has-text("Đăng nhập")') || await page.$('button[type="submit"]');
            if (btn) await btn.click(); else await page.keyboard.press('Enter');

            await page.waitForTimeout(4000);
            await page.screenshot({ path: path.join(OUT, `attempt_${attempt}.png`), fullPage: true });

            const url  = page.url();
            const body = await page.evaluate(() => document.body.innerText);

            if (!url.includes('auth')) { console.log('✅ ĐĂNG NHẬP THÀNH CÔNG!'); break; }

            if (body.includes('thiết bị di động') || body.includes('xác nhận đăng nhập')) {
                console.log('📱 Mở app VCB Digibank → bấm XÁC NHẬN (chờ tối đa 120s)...');
                try { await page.waitForURL(u => !u.includes('auth'), { timeout: 120000 }); }
                catch { for (let i=0; i<24; i++) { await page.waitForTimeout(5000); if (!page.url().includes('auth')) break; console.log(`  ⏳ ${(i+1)*5}s`); } }
                break;
            }

            console.log('  ❌ Sai, thử lại...');
            const reload = await page.$('[class*="reload" i], [onclick*="captcha" i]');
            if (reload) await reload.click();
            await page.waitForTimeout(1000);
        }

        await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: true });
        console.log('📍 URL cuối:', page.url());

        if (!page.url().includes('auth')) {
            console.log('\n💰 Đang tiến hành đọc số dư trực tiếp từ trang chủ...');
            
            // 1. Phân tích số dư từ các cuộc gọi API thu thập được (nếu có giải mã)
            let detectedBalances = [];
            
            function findBalancesInJSON(obj, url = '') {
                if (!obj || typeof obj !== 'object') return;
                
                const balanceKeys = ['balance', 'availbal', 'currentbalance', 'sodu', 'so_du', 'amount', 'curbal', 'availablebalance'];
                const accountKeys = ['accountno', 'acctno', 'sotaikhoan', 'so_tai_khoan', 'accountnumber'];

                if (Array.isArray(obj)) {
                    for (const item of obj) {
                        findBalancesInJSON(item, url);
                    }
                    return;
                }

                let foundAcc = null;
                let foundBal = null;

                for (const key of Object.keys(obj)) {
                    const val = obj[key];
                    const lowerKey = key.toLowerCase();

                    if (accountKeys.some(k => lowerKey.includes(k)) && typeof val === 'string' && val.trim().length > 5) {
                        foundAcc = val.trim();
                    }
                    if (balanceKeys.some(k => lowerKey.includes(k)) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(val.replace(/[^0-9.-]/g, ''))))) {
                        const parsed = parseFloat(typeof val === 'number' ? val : val.replace(/[^0-9.-]/g, ''));
                        if (!isNaN(parsed) && parsed >= 0) {
                            foundBal = parsed;
                        }
                    }

                    if (val && typeof val === 'object') {
                        findBalancesInJSON(val, url);
                    }
                }

                if (foundBal !== null) {
                    const exists = detectedBalances.some(b => b.account === foundAcc && b.balance === foundBal);
                    if (!exists) {
                        detectedBalances.push({
                            account: foundAcc || 'Mặc định/Chính',
                            balance: foundBal,
                            url: url.slice(-50)
                        });
                    }
                }
            }

            for (const api of apis) {
                if (api.body) {
                    findBalancesInJSON(api.body, api.url);
                }
            }

            // 2. Trích xuất số dư từ giao diện DOM UI ngay tại Trang chủ
            const uiBalances = await page.evaluate(() => {
                const results = [];
                const elements = Array.from(document.querySelectorAll('*'));
                for (const el of elements) {
                    if (el.children.length === 0 && el.textContent) {
                        const text = el.textContent.trim().replace(/\s+/g, ' ');
                        // Khớp định dạng tiền tệ như "1,234,567 VND", "500.000 đ"
                        if (/(VND|đ|VND)/i.test(text) && /[0-9]/.test(text) && text.length < 40) {
                            const parentText = el.parentElement ? el.parentElement.textContent.toLowerCase() : '';
                            if (parentText.includes('số dư') || parentText.includes('khả dụng') || parentText.includes('tài khoản') || parentText.includes('balance') || text.includes('VND')) {
                                results.push(text);
                            }
                        }
                    }
                }
                return [...new Set(results)];
            });

            // Báo cáo số dư rõ ràng ra màn hình ngay lập tức
            console.log('\n==================================================');
            console.log('📊 KẾT QUẢ SỐ DƯ TÀI KHOẢN TRÊN TRANG CHỦ:');
            console.log('==================================================');
            
            if (detectedBalances.length > 0) {
                console.log('🔹 Từ Crawl Response API (nếu bắt được):');
                detectedBalances.forEach(b => {
                    console.log(`   👉 Tài khoản: ${b.account} | Số dư: ${b.balance.toLocaleString('vi-VN')} VND`);
                });
            }

            if (uiBalances.length > 0) {
                console.log('🔹 Từ Giao diện Web (DOM UI):');
                uiBalances.forEach(val => {
                    console.log(`   👉 Số dư khả dụng: ${val}`);
                });
            } else {
                console.log('🔹 Từ Giao diện Web (DOM UI): Đang tải thông tin số dư...');
            }
            console.log('==================================================\n');

            // Lưu số dư vào file JSON riêng biệt
            fs.writeFileSync(path.join(OUT, 'balance.json'), JSON.stringify({
                apiBalances: detectedBalances,
                uiBalances: uiBalances,
                timestamp: new Date().toISOString()
            }, null, 2));

            // 3. Click mô phỏng tự nhiên vào tài khoản thanh toán để xem chi tiết & lịch sử giao dịch
            console.log('📊 Đang tìm và nhấn vào Tài khoản thanh toán để xem lịch sử giao dịch...');
            
            const clickSuccess = await page.evaluate(async () => {
                // Tìm bất kỳ phần tử nào chứa chữ "Tài khoản thanh toán" hoặc hiển thị số tài khoản thanh toán chính
                const elements = Array.from(document.querySelectorAll('*'));
                
                // Mẫu 1: Tìm theo text trực quan
                let targetEl = elements.find(el => 
                    el.textContent && 
                    el.textContent.includes('Tài khoản thanh toán') && 
                    el.children.length === 0
                );
                
                // Mẫu 2: Nếu không thấy, tìm thẻ cha hoặc thẻ chứa số tài khoản
                if (!targetEl) {
                    targetEl = elements.find(el => 
                        el.textContent && 
                        (el.textContent.includes('Tài khoản thanh toán') || el.textContent.includes('Danh sách tài khoản'))
                    );
                }
                
                // Mẫu 3: Click vào phần tử số dư VND đầu tiên trên trang chủ (thường là link dẫn tới tài khoản chính)
                if (!targetEl) {
                    targetEl = elements.find(el => 
                        el.children.length === 0 && 
                        el.textContent && 
                        el.textContent.includes('VND') && 
                        /[0-9]/.test(el.textContent)
                    );
                }

                if (targetEl) {
                    // Click trực tiếp hoặc click thông qua phần tử cha có thể tương tác
                    let clickable = targetEl;
                    while (clickable && !clickable.onclick && clickable.tagName !== 'BUTTON' && clickable.tagName !== 'A' && clickable.role !== 'button' && clickable.parentElement) {
                        clickable = clickable.parentElement;
                    }
                    if (clickable) {
                        clickable.click();
                        return true;
                    }
                    targetEl.click();
                    return true;
                }
                return false;
            });

            if (clickSuccess) {
                console.log('  👉 Đã nhấn vào phần tử tài khoản, đợi 6 giây để lịch sử tải...');
                await page.waitForTimeout(6000);
            } else {
                console.log('  ⚠️ Không tìm thấy phần tử click tự động. Tiến hành đi đến link chi tiết dự phòng...');
                try {
                    await page.goto('https://vcbdigibank.vietcombank.com.vn/account/detail?type=account', { waitUntil: 'networkidle', timeout: 15000 });
                    await page.waitForTimeout(4000);
                } catch (e) {}
            }

            await page.screenshot({ path: path.join(OUT, 'history.png'), fullPage: true });

            // 4. Quét bảng lịch sử giao dịch bằng thuật toán đối sánh mẫu thông minh (Ngày tháng + Số tiền +-)
            console.log('\n📋 Bắt đầu cào danh sách giao dịch từ màn hình...');
            const transactions = await page.evaluate(() => {
                const results = [];
                const allElements = Array.from(document.querySelectorAll('*'));
                
                for (const el of allElements) {
                    // Chỉ lấy các thẻ chứa nội dung lá ngắn gọn hoặc các dòng bảng biểu
                    if (el.textContent && (el.tagName === 'TR' || el.tagName === 'LI' || el.classList.contains('transaction-item') || el.children.length <= 3)) {
                        const text = el.textContent.trim().replace(/\s+/g, ' ');
                        
                        // Kiểm tra xem dòng text này có chứa Ngày giao dịch (dd/mm/yyyy) và Số tiền (+ hoặc - và VND/đ) hay không
                        const hasDate = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}/.test(text);
                        const hasAmount = /(VND|đ)/i.test(text) && (text.includes('+') || text.includes('-') || /[0-9]/.test(text));
                        
                        if (hasDate && hasAmount && text.length > 15 && text.length < 300) {
                            results.push(text);
                        }
                    }
                }
                
                // Lọc bỏ trùng lặp và làm sạch text
                return [...new Set(results)].map(t => {
                    // Cắt bớt khoảng trắng thừa
                    return t.trim();
                });
            });

            console.log(`📋 Thu thập thành công ${transactions.length} giao dịch thực tế từ màn hình:`);
            if (transactions.length > 0) {
                transactions.forEach((r, i) => console.log(`  ${i+1}. ${r}`));
            } else {
                console.log('  ⚠️ Chưa có giao dịch nào xuất hiện trên màn hình hoặc giao diện chưa load xong.');
                // Lấy toàn bộ text thô của bảng để debug
                const rawText = await page.evaluate(() => {
                    const table = document.querySelector('table, [class*="transaction" i]');
                    return table ? table.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : 'Không tìm thấy bảng';
                });
                console.log(`  🔍 Debug text thô: ${rawText}`);
            }

            fs.writeFileSync(path.join(OUT, 'transactions.json'), JSON.stringify({ transactions, apiCount: apis.length }, null, 2));
            fs.writeFileSync(path.join(OUT, 'apis.json'), JSON.stringify(apis.map(a => ({ url: a.url, keys: Object.keys(a.body||{}) })), null, 2));
            console.log(`📡 ${apis.length} API calls mã hoá đã lưu để phân tích bảo mật.`);
        }

        await page.waitForTimeout(15000);
    } catch (e) {
        console.error('❌', e.message);
        await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
    } finally {
        await browser.close();
    }
}
main();
