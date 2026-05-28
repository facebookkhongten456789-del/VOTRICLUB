const http = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const url = 'https://archive1.piwheels.org/simple/vietcombank-captcha/vietcombank_captcha-0.1.0-py3-none-any.whl';
const outDir = path.join(__dirname, 'vcb_model');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const destZip = path.join(outDir, 'model.zip');

console.log('📥 Đang tải package chứa model từ piwheels...');
const file = fs.createWriteStream(destZip);

http.get(url, (res) => {
    res.pipe(file);
    file.on('finish', () => {
        file.close(() => {
            console.log('✅ Đã tải xong file .whl và đóng file stream');
            
            console.log('📂 Đang giải nén model...');
            try {
                // Trên Windows dùng tar giải nén zip cực kỳ nhanh và không bị khóa
                execSync(`tar -xf "${destZip}" -C "${outDir}"`);
                console.log('✅ Giải nén thành công!');
                
                // Liệt kê các file giải nén được
                console.log('\nDanh sách file trong thư mục model:');
                const listFiles = (dir) => {
                    const files = fs.readdirSync(dir);
                    for (const f of files) {
                        if (f === 'model.zip') continue;
                        const fullPath = path.join(dir, f);
                        if (fs.statSync(fullPath).isDirectory()) {
                            console.log(`📁 [Dir] ${f}`);
                            // Liệt kê cấp con nếu không phải __pycache__
                            if (f !== '__pycache__') {
                                fs.readdirSync(fullPath).forEach(sub => console.log(`  └─ 📄 ${sub}`));
                            }
                        } else {
                            console.log(`📄 [File] ${f} (${fs.statSync(fullPath).size} bytes)`);
                        }
                    }
                };
                listFiles(outDir);
            } catch (e) {
                console.error('❌ Lỗi giải nén:', e.message);
            }
        });
    });
}).on('error', (err) => {
    console.error('❌ Lỗi tải file:', err.message);
});
