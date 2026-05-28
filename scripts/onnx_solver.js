const { InferenceSession, Tensor } = require('onnxruntime-web');
const { Jimp, intToRGBA } = require('jimp');
const path = require('path');
const fs = require('fs');

async function solveCaptchaWithONNX(imgBuffer) {
    const modelPath = path.join(__dirname, 'vcb_model', 'vietcombank_captcha', 'models', 'vietcombank_captcha.onnx');
    
    // 1. Khởi tạo session ONNX với CPU execution provider
    const session = await InferenceSession.create(modelPath);
    
    // 2. Load và chuẩn hoá ảnh bằng Jimp
    const img = await Jimp.fromBuffer(imgBuffer);
    
    // Convert sang RGB và resize về đúng kích thước model mong đợi (155x50)
    // Jimp v4 resize sử dụng object parameter { w, h }
    img.resize({ w: 155, h: 50 });
    
    // Tạo mảng dữ liệu float32 phẳng cho tensor đầu vào: [1, 50, 155, 3] (Height, Width, Channels)
    const inputData = new Float32Array(50 * 155 * 3);
    
    let i = 0;
    for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 155; x++) {
            const pixel = img.getPixelColor(x, y);
            const rgba = intToRGBA(pixel);
            
            // Model mong đợi giá trị chuẩn hoá từ 0 đến 1
            inputData[i]     = rgba.r / 255.0; // R
            inputData[i + 1] = rgba.g / 255.0; // G
            inputData[i + 2] = rgba.b / 255.0; // B
            i += 3;
        }
    }
    
    // 3. Tạo Tensor đầu vào (batch size = 1, height = 50, width = 155, channels = 3)
    const inputTensor = new Tensor('float32', inputData, [1, 50, 155, 3]);
    
    // Khớp tên input của model
    const inputName = session.inputNames[0];
    const feeds = {};
    feeds[inputName] = inputTensor;
    
    // 4. Chạy mô hình
    const outputs = await session.run(feeds);
    
    // Model trả về 5 tensor đầu ra ứng với 5 vị trí số
    const outputNames = session.outputNames;
    let predictedDigits = '';
    
    for (let pos = 0; pos < 5; pos++) {
        const tensorName = outputNames[pos];
        const probabilities = outputs[tensorName].data; // Float32Array độ dài 10 (chứa xác suất từ 0 đến 9)
        
        // Tìm chữ số có xác suất lớn nhất (argmax)
        let maxIndex = 0;
        let maxProb = probabilities[0];
        for (let num = 1; num < 10; num++) {
            if (probabilities[num] > maxProb) {
                maxProb = probabilities[num];
                maxIndex = num;
            }
        }
        predictedDigits += maxIndex.toString();
    }
    
    return predictedDigits;
}

// Chạy thử với captcha_1.png
async function main() {
    const imgPath = path.join(__dirname, 'vcb_output', 'captcha_1.png');
    if (!fs.existsSync(imgPath)) {
        console.error('❌ Không tìm thấy file captcha test. Hãy chạy scraper trước.');
        return;
    }
    
    console.log('🤖 Đang giải thử captcha bằng mô hình ONNX offline...');
    const buf = fs.readFileSync(imgPath);
    const code = await solveCaptchaWithONNX(buf);
    console.log(`🎉 Kết quả giải được: "${code}" (Thực tế là 31117 hoặc tương tự)`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { solveCaptchaWithONNX };
