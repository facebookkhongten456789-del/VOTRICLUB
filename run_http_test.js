const http = require('http');

function getRoot(cb){
  http.get('http://localhost:3000/', res => {
    let b='';
    res.on('data', c=> b+=c);
    res.on('end', ()=> cb(null, res.statusCode, b));
  }).on('error', e=> cb(e));
}

function postLogin(cb){
  const data = JSON.stringify({ email: 'admin@votri.club', password: 'Admin@123' });
  const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
    let b='';
    res.on('data', c=> b+=c);
    res.on('end', ()=> cb(null, res.statusCode, b));
  });
  req.on('error', e=> cb(e));
  req.write(data);
  req.end();
}

getRoot((err, status, body)=>{
  if(err) return console.error('GET / ERROR:', err.message);
  console.log('GET / ->', status, 'bodyLength=', body.length);
  postLogin((err2, status2, body2)=>{
    if(err2) return console.error('POST /api/auth/login ERROR:', err2.message);
    console.log('POST /api/auth/login ->', status2, body2);
  });
});
