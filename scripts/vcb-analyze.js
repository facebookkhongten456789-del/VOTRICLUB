const fs = require('fs');
const path = require('path');

// Đọc và in ra innerText của attempt cuối để biết Vietcombank báo lỗi gì
const outDir = path.join(__dirname, 'vcb_output');
const files = fs.readdirSync(outDir).filter(f => f.startsWith('api_'));
console.log('Danh sách API Responses đã lưu:', files);

for (const file of files) {
    const filePath = path.join(outDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`\n=== File: ${file} ===`);
    console.log(JSON.stringify(content, null, 2).slice(0, 1000));
}
