const crypto = require('crypto');
const clientId = 'e6d7a838-2ca0-48a8-9754-91d47f535d20';
const apiKey = 'cbc91e1c-0aef-4f8d-a8c0-1ed31b463ad1';
const checksumKey = 'f44dc15c30345dea7287fea9552e880b0714d2e94dd8a789661818d72bb8d623';

const orderCode = Number(String(Date.now()).slice(-9)); // Ensure orderCode is within safe limit
const amount = 50000;
const description = ('VTC nap ' + orderCode).slice(0, 25);
const cancelUrl = 'http://localhost:3000';
const returnUrl = 'http://localhost:3000';

const signatureData = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
const signature = crypto.createHmac('sha256', checksumKey).update(signatureData).digest('hex');

const body = { orderCode, amount, description, cancelUrl, returnUrl, signature };

fetch('https://api-merchant.payos.vn/v2/payment-requests', {
    method: 'POST',
    headers: { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
})
.then(res => res.json())
.then(data => {
    console.log(JSON.stringify(data, null, 2));
})
.catch(err => console.error(err));
