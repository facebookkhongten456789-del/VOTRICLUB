/**
 * Tạo QR PNG (data URL) cho otpauth:// — không cần CDN trình duyệt
 */
const QRCode = require('qrcode');

async function otpAuthToQrDataUrl(otpauthUrl) {
    return QRCode.toDataURL(String(otpauthUrl), {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M',
        type: 'image/png',
        color: { dark: '#000000', light: '#ffffff' },
    });
}

module.exports = { otpAuthToQrDataUrl };
