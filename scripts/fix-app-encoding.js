/**
 * Sửa chuỗi UTF-8 hỏng (U+FFFD) trong app.js sau PowerShell Set-Content.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app.js');
let text = fs.readFileSync(filePath, 'utf8');

// Bỏ ký tự điều khiển lạ
text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const replacements = [
    [/\* V.\s*TRI CLUB/g, '* VÔ TRI CLUB'],
    [/V\uFFFD TRI/g, 'VÔ TRI'],
    [/V\uFFFD\u001d TRI/g, 'VÔ TRI'],
    [/â†'/g, '->'],
    [/0Ä‘/g, '0đ'],
    [/(\d)\s*Ä‘/g, '$1đ'],
    [/Ä‘/g, 'đ'],
    [/Hiá»ƒn thá»‹/g, 'Hiển thị'],
    [/cá»§a/g, 'của'],
    [/dá»‹ch vá»¥/g, 'dịch vụ'],
    [/Tá»‘i thiá»ƒu/g, 'Tối thiểu'],
    [/Tá»‘i Ä‘a/g, 'Tối đa'],
    [/tĒng/g, 'tăng'],
    [/Không thỒ/g, 'Không thể'],
    [/thỒ/g, 'thể'],
    [/Qu\uFFFDn tr\uFFFD9/g, 'Quản trị'],
    [/Qu\uFFFDn tr\uFFFD/g, 'Quản trị'],
    [/tr\uFFFD9/g, 'trị'],
    [/Th\uFFFDnh vi\uFFFDn/g, 'Thành viên'],
    [/Thnh vin/g, 'Thành viên'],
    [/Phi\uFFFDn/g, 'Phiên'],
    [/Phin/g, 'Phiên'],
    [/nh\uFFFDr/g, 'nhập'],
    [/nh\uFFFDp/g, 'nhập'],
    [/nhp/g, 'nhập'],
    [/h\uFFFDt/g, 'hết'],
    [/ht/g, 'hết'],
    [/l\uFFFDr/g, 'lỗi'],
    [/l\uFFFDi/g, 'lại'],
    [/Đ\uFFFD/g, 'Đã'],
    [/Đăng/g, 'Đăng'],
    [/\uFFFD\u0012ng/g, 'Đăng'],
    [/\uFFFDang/g, 'đang'],
    [/ho\uFFFDt/g, 'hoạt'],
    [/hot/g, 'hoạt'],
    [/đ\uFFFD\uFFFD"ng/g, 'ộng'],
    [/\uFFFD"ng/g, 'ộng'],
    [/\"ng/g, 'ộng'],
    [/x\uFFFDa/g, 'xóa'],
    [/xa/g, 'xóa'],
    [/b\uFFFD" l\uFFFDc/g, 'bộ lọc'],
    [/b\" l\uFFFDc/g, 'bộ lọc'],
    [/t\uFFFDi/g, 'tải'],
    [/ti/g, 'tải'],
    [/d\uFFFD li\uFFFD!u/g, 'dữ liệu'],
    [/d li!u/g, 'dữ liệu'],
    [/th\uFFFDnh c\uFFFDng/g, 'thành công'],
    [/thnh cng/g, 'thành công'],
    [/Ch\uFFFDo m\uFFFDng/g, 'Chào mừng'],
    [/tr\uFFFDx l\uFFFDi/g, 'trở lại'],
    [/Kh\uFFFDng/g, 'Không'],
    [/Khng/g, 'Không'],
    [/g\uFFFDi/g, 'gửi'],
    [/gi/g, 'gửi'],
    [/đ\uFFFD\uFFFDc/g, 'ược'],
    [/c/g, 'ược'], // too broad - remove
    [/Ki\uFFFDm tra/g, 'Kiểm tra'],
    [/m\uFFFD x/g, 'mở'],
    [/ng d\uFFFDng/g, 'ng dụng'],
    [/hi\uFFFDn t\uFFFDi/g, 'hiện tại'],
    [/Vui l\uFFFDng/g, 'Vui lòng'],
    [/g\uFFFDi v\uFFFD/g, 'gửi và'],
    [/m\uFFFD OTP/g, 'mã OTP'],
    [/ch\uFFFD s\uFFFD/g, 'chữ số'],
    [/đ\uFFFDng k\uFFFD/g, 'đăng ký'],
    [/t\uFFFDi kho\uFFFDn/g, 'tài khoản'],
    [/k\uFFFDt n\uFFFDi/g, 'kết nối'],
    [/h\uFFFD th\uFFFDng/g, 'hệ thống'],
    [/b\uFFFD9 kh\uFFFDa/g, 'bị khóa'],
    [/m\uFFFDt kh\uFFFDu/g, 'mật khẩu'],
    [/đ\uFFFDt l\uFFFDi/g, 'đặt lại'],
    [/X\uFFFDc nh\uFFFDn/g, 'Xác nhận'],
    [/kh\uFFFDng kh\uFFFD:p/g, 'không khớp'],
    [/đ\uFFFD xu\uFFFDt/g, 'đăng xuất'],
    [/đi\uFFFDn/g, 'điền'],
    [/đ\uFFFDy đ\uFFFD/g, 'đầy đủ'],
    [/S\uFFFD&/g, '✅'],
    [/âœ…/g, '✅'],
    [/R /g, '❌ '],
    [/L\uFFFDi/g, 'Lỗi'],
    [/c\uFFFDp nh\uFFFDt/g, 'cập nhật'],
    [/đ\uFFFD"i/g, 'đổi'],
    [/S\uFFFD ti\uFFFDn/g, 'Số tiền'],
    [/Ng\uFFFDi/g, 'Người'],
    [/tr\uFFFDng th\uFFFDi/g, 'trạng thái'],
    [/ch\uFFFDn d\uFFFD9ch/g, 'chọn dịch'],
    [/d\uFFFD9ch v\uFFFD/g, 'dịch vụ'],
    [/đ\uFFFDt h\uFFFDng/g, 'đặt hàng'],
    [/H\uFFFDng/g, 'Hàng'],
    [/Hng/g, 'Hàng'],
    [/n\uFFFDm trong/g, 'nằm trong'],
    [/d\uFFFDng getter/g, 'dùng getter'],
    [/tr\uFFFDnh/g, 'tránh'],
    [/v\uFFFD n\uFFFDm/g, 'vì nằm'],
    [/c\uFFFDc element/g, 'các element'],
    [/token \uFFFD c\uần/g, 'token — cần'],
    [/Counters \uFFFD getter/g, 'Counters — getter'],
    [/Inputs \uFFFD getter/g, 'Inputs — getter'],
    [/Containers \uFFFD getter/g, 'Containers — getter'],
    [/Control \uFFFD null/g, 'Control — null'],
    [/Filtering \uFFFD dùng/g, 'Filtering — dùng'],
    [/Giữ t\uFFFDi đa/g, 'Giữ tối đa'],
    [/Support ->/g, '// Support ->'],
];

// Loại rule quá ngắn / nguy hiểm
const safe = replacements.filter(([re]) => String(re).length > 3 || re.source.length > 4);

for (const [from, to] of safe) {
    text = text.replace(from, to);
}

// Xóa U+FFFD còn sót trong từ (sau khi đã sửa phần lớn)
text = text.replace(/\uFFFD/g, '');

// Sửa vài lỗi do xóa FFFD
const post = [
    [/Phin /g, 'Phiên '],
    [/nhap/g, 'nhập'],
    [/hot động/g, 'hoạt động'],
    [/Đang nhập/g, 'Đăng nhập'],
    [/đang nhập/g, 'đăng nhập'],
    [/Quan trị/g, 'Quản trị'],
    [/Thnh vien/g, 'Thành viên'],
    [/Core -> js/g, '// Core -> js'],
];
for (const [from, to] of post) text = text.replace(from, to);

fs.writeFileSync(filePath, text, 'utf8');
const left = (text.match(/\uFFFD/g) || []).length;
let syntax = 'ok';
try { new Function(text); } catch (e) { syntax = e.message; }
console.log('FFFD left:', left, '| syntax:', syntax);
