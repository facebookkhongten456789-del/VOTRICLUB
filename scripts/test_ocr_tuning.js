const { createWorker } = require('tesseract.js');
const { Jimp } = require('jimp');
const path = require('path');

async function testTuning() {
    const imgPath = path.join(__dirname, 'vcb_output', 'captcha_1.png');
    const img = await Jimp.fromBuffer(require('fs').readFileSync(imgPath));
    const w = img.bitmap.width;
    const h = img.bitmap.height;

    // 1. Phân ngưỡng màu xanh lá
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

    // 2. Xoá viền (Borders & Corners) - cực kỳ quan trọng để tránh Tesseract đọc góc viền thành chữ
    const borderWidth = 6;
    img.scan(0, 0, w, h, function(x, y, idx) {
        if (x < borderWidth || x > w - borderWidth || y < borderWidth || y > h - borderWidth) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
        }
    });

    // 3. Xoá nét gạch ngang (Line Removal)
    const matrix = [];
    for (let y = 0; y < h; y++) {
        matrix[y] = [];
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            matrix[y][x] = img.bitmap.data[idx] === 0 ? 1 : 0;
        }
    }

    const cleanMatrix = JSON.parse(JSON.stringify(matrix));
    for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
            if (matrix[y][x] === 1) {
                let startY = y;
                while (y < h && matrix[y][x] === 1) y++;
                let endY = y;
                let runLength = endY - startY;
                if (runLength <= 2) {
                    for (let j = startY; j < endY; j++) cleanMatrix[j][x] = 0;
                }
            } else {
                y++;
            }
        }
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const val = cleanMatrix[y][x] === 1 ? 0 : 255;
            img.bitmap.data[idx] = val;
            img.bitmap.data[idx + 1] = val;
            img.bitmap.data[idx + 2] = val;
        }
    }

    img.scale(4);
    const buf = await img.getBuffer('image/png');
    require('fs').writeFileSync(path.join(__dirname, 'vcb_output', 'captcha_test_tuned.png'), buf);

    // Chạy thử các chế độ PSM khác nhau
    const psmModes = ['7', '8', '6'];
    for (const psm of psmModes) {
        const worker = await createWorker('eng', 1, { logger: () => {} });
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: psm,
        });
        const { data: { text } } = await worker.recognize(buf);
        await worker.terminate();
        console.log(`PSM ${psm} -> Result: "${text.trim()}"`);
    }
}

testTuning().catch(console.error);
