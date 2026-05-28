const Jimp = require('jimp');
console.log('Jimp exports:', Object.keys(Jimp).slice(0, 30));
console.log('Jimp.read:', typeof Jimp.read);
console.log('Jimp.create:', typeof Jimp.create);
console.log('Jimp.fromBuffer:', typeof Jimp.fromBuffer);
console.log('new Jimp?', typeof Jimp === 'function');
const j = new Jimp({ width: 10, height: 10, color: 0xFFFFFFFF });
console.log('new Jimp() OK:', typeof j);
