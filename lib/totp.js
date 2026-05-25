/**
 * TOTP (RFC 6238) — Google Authenticator compatible
 */
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(str) {
    const cleaned = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (let i = 0; i < cleaned.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function generateSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter, digits = 6) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(code % 10 ** digits).padStart(digits, '0');
}

function generateToken(secret, step = 30, digits = 6, timeMs = Date.now()) {
    const counter = Math.floor(timeMs / 1000 / step);
    return hotp(secret, counter, digits);
}

function verifyToken(secret, token, window = 2, step = 30, digits = 6) {
    const norm = String(token || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(norm)) return false;
    const now = Date.now();
    const counter = Math.floor(now / 1000 / step);
    for (let w = -window; w <= window; w++) {
        if (hotp(secret, counter + w, digits) === norm) return true;
    }
    return false;
}

/** URL chuẩn Google Authenticator / Authy (TOTP SHA-1, 30s, 6 số) */
function getOtpAuthUrl(secret, email, issuer = 'Votri Club') {
    const sec = String(secret || '').replace(/\s/g, '').toUpperCase();
    const account = encodeURIComponent(String(email || '').trim());
    const issEnc = encodeURIComponent(issuer);
    return `otpauth://totp/${issEnc}:${account}?secret=${sec}&issuer=${issEnc}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
    generateSecret,
    generateToken,
    verifyToken,
    getOtpAuthUrl,
};
