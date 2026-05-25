const http = require('http');
function post(port, cb) {
  const data = JSON.stringify({ email: 'admin@votri.club', password: 'Admin@123' });
  const req = http.request({ hostname: 'localhost', port, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => cb(null, port, res.statusCode, b));
  });
  req.on('error', e => cb(e, port));
  req.write(data);
  req.end();
}
[3000,3001].forEach(p => post(p, (err, port, status, body) => {
  if (err) return console.log(`PORT ${port} ERROR:`, err.message);
  console.log(`PORT ${port} -> ${status} : ${body}`);
}));
