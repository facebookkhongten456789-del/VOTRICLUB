const { createWorker } = require('tesseract.js');
const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

async function testSegmentedOCR() {
    const imgPath = path.join(__dirname, 'vcb_output', 'captcha_1.png');
    const img = await Jimp.fromBuffer(fs.readFileSync(imgPath));
    const w = img.bitmap.width;
    const h = img.bitmap.height;

    // 1. Lọc màu xanh lá đậm
    img.scan(0, 0, w, h, function(x, y, idx) {
        const r = this.bitmap.data[idx];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        const isGreen = g > 55 && g > r * 1.15 && g > b * 1.15 && (r + g + b) < 550;
        if (isGreen) {
            this.bitmap.data[idx] = 0;
            this.bitmap.data[idx + 1] = 0;
            this.bitmap.data[idx + 2] = 0;
        } else {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
        }
    });

    // Xoá viền nhiễu xung quanh
    const border = 5;
    img.scan(0, 0, w, h, function(x, y, idx) {
        if (x < border || x > w - border || y < border || y > h - border) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
        }
    });

    // 2. Tìm vùng giới hạn chứa chữ thực sự (Bounding Box)
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (img.bitmap.data[idx] === 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    console.log(`Bounding Box: X[${minX} -> ${maxX}], Y[${minY} -> ${maxY}]`);
    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;

    if (contentW <= 0 || contentH <= 0) {
        console.log('Không tìm thấy vùng chứa chữ');
        return;
    }

    // Cắt lấy vùng chứa chữ thực sự
    const cropped = img.clone().crop({ x: minX, y: minY, w: contentW, h: contentH });
    
    // 3. Phân đoạn thành 5 phần bằng nhau theo chiều rộng (vì captcha VCB luôn có 5 chữ số)
    const segmentW = Math.floor(contentW / 5);
    const worker = await createWorker('eng', 1, { logger: () => {} });
    await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '10', // Đọc ảnh như 1 ký tự đơn lẻ duy nhất (Single Character)
    });

    let finalResult = '';
    const outDir = path.join(__dirname, 'vcb_output', 'segments');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (let i = 0; i < 5; i++) {
        const startX = i * segmentW;
        // Phần cuối cùng lấy hết phần còn thừa để tránh mất nét
        const width = (i === 4) ? (contentW - startX) : segmentW;
        
        const segment = cropped.clone().crop({ x: startX, y: 0, w: width, h: contentH });
        
        // Thêm khoảng đệm viền trắng xung quanh ký tự để Tesseract nhận dạng tốt hơn
        const padded = new Jimp({
            width: width + 20,
            height: contentH + 20,
            color: 0xFFFFFFFF
        });
        padded.composite(segment, 10, 10);
        padded.scale(3); // Zoom lên để nhìn rõ nét

        const segBuf = await padded.getBuffer('image/png');
        fs.writeFileSync(path.join(outDir, `seg_${i}.png`), segBuf);

        const { data: { text } } = await worker.recognize(segBuf);
        const char = text.replace(/[^0-9]/g, '').trim();
        console.log(`Segment ${i} OCR: "${char}"`);
        finalResult += char || '?';
    }

    await worker.terminate();
    console.log(`\n=> KẾT QUẢ PHÂN ĐOẠN CUỐI CÙNG: "${finalResult}"`);
}

testSegmentedOCR().catch(console.error);
