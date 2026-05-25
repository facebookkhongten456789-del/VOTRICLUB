/**
 * Sửa chuỗi tiếng Việt bị hỏng encoding trong app.js
 * node scripts/fix-vietnamese-ui.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const p = path.join(__dirname, '..', 'app.js');
let t = fs.readFileSync(p, 'utf8');

const pairs = [
    // Profile / nhật ký hoạt động
    ['Cha hoạt ộng no.', 'Chưa có hoạt động nào.'],
    ['Phiên đang hoạt ộng', 'Phiên đang hoạt động'],
    ['Tn khng  trng!', 'Tên không được trống!'],
    ['Tn khng thay "i g', 'Tên không thay đổi gì'],
    ['Bn cch0 "i tn 1 ln mi 60 ngy. Cn lại', 'Bạn chỉ đổi tên 1 lần mỗi 60 ngày. Còn lại'],
    ['Cập nhập tên thành công!', 'Cập nhật tên thành công!'],
    ['Cp nhết nh i di!n', 'Cập nhật ảnh đại diện'],
    ['Cp nhết nh i di!n thành công!', 'Cập nhật ảnh đại diện thành công!'],
    ['"i mật khẩu ti khon', 'Đổi mật khẩu tài khoản'],
    ['"i mật khẩu thành công!', 'Đổi mật khẩu thành công!'],
    ['Mt khu m:i phi t nhết 6 k t.', 'Mật khẩu mới phải tối thiểu 6 ký tự.'],
    ['Xác nhận mật khẩu m:i không khớp.', 'Xác nhận mật khẩu mới không khớp.'],
    ['Mt khu hi!n ti khng ng.', 'Mật khẩu hiện tại không đúng.'],
    ['Ch0 h tr 9nh dng hnh nh.', 'Chỉ hỗ trợ định dạng hình ảnh.'],

    // Auth subtitles & toasts
    ['To ti khon tham gia VÔ TRI CLUB - SYSTEM', 'Tạo tài khoản tham gia VÔ TRI CLUB - SYSTEM'],
    ['Khôi phụcc mật khẩu tài khoản', 'Khôi phục mật khẩu tài khoản'],
    ['ĐặĐặt lại mật khẩu tài khoản', 'Đặt lại mật khẩu tài khoản'],
    ['ĐặĐặt lại mật khẩu thành công! Vui lòng ng nhập.', 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập.'],
    ['Link ĐặĐặt lại mật khẩu đã gửi n', 'Link đặt lại mật khẩu đã gửi đến'],
    ['Không th gi link Đặt lại mật khẩu.', 'Không thể gửi link đặt lại mật khẩu.'],
    ['Không th Đặt lại mật khẩu.', 'Không thể đặt lại mật khẩu.'],
    [' đăng xuất khi hệ thống', 'Đã đăng xuất khỏi hệ thống'],
    ['đăng xuất khi thit b9', 'đăng xuất khỏi thiết bị'],
    ['Đăng ký tài khoản m:i (MySQL)', 'Đăng ký tài khoản mới (MySQL)'],
    ['Đặt lại mật khẩu m:i (MySQL)', 'Đặt lại mật khẩu mới (MySQL)'],

    // OTP / register
    ["'Gi Mã OTP'", "'Gửi mã OTP'"],
    ['Đang gi OTP...', 'Đang gửi OTP...'],
    ['Không gi OTP.', 'Không gửi được OTP.'],
    ['Vui lòng gi v nhập mã OTP', 'Vui lòng gửi và nhập mã OTP'],
    ['M OTP không hợp lệ! hoc lại', 'Mã OTP không hợp lệ! Vui lòng thử lại'],
    ['Không thể gi OTP.', 'Không thể gửi OTP.'],
    ['Không gi email OTP.', 'Không gửi được email OTP.'],
    ['S& OTP  gi n', 'Mã OTP đã gửi đến'],
    ['h"p th', 'hộp thư'],
    ['a Không kết nối server. Chy npm start v mở', 'Không kết nối server. Chạy npm start và mở'],
    ['Chy start.bat (hoc node server.js) ri mx hếttp://localhost:3000  khng dụng Live Server.', 'Chạy start.bat (hoặc node server.js) rồi mở http://localhost:3000 — không dùng Live Server.'],
    ['Bt XAMPP MySQL v cchy: node server.js', 'Bật XAMPP MySQL và chạy: node server.js'],

    // Admin / accounts
    ['Mx kha', 'Mở khóa'],
    ["'Kha'", "'Khóa'"],
    ['plus-ccircle', 'plus-circle'],
    ['Nhp s tin mun ccộng ccho', 'Nhập số tiền muốn cộng cho'],
    ['(V d: 50000  ccộng, -20000  tr)', '(VD: 50000 = cộng, -20000 = trừ)'],
    ['S tin không hợp lệ!.', 'Số tiền không hợp lệ.'],
    [' thay "i s d ti khon', 'Đã thay đổi số dư tài khoản'],
    ['Lỗi khi cập nhật s d.', 'Lỗi khi cập nhật số dư.'],
    ['Lỗi kết nối my cch.', 'Lỗi kết nối máy chủ.'],
    ['Ngi dung', 'Người dùng'],
    ['Ngi dng', 'Người dùng'],
    ['ngi dng', 'người dùng'],
    ['ti khon', 'tài khoản'],
    ['Lỗi khi xóa ti khon.', 'Lỗi khi xóa tài khoản.'],
    ['hi!n l', 'hiện là'],

    // Misc UI
    ['Không trang  phn tch niche.', 'Không có trang để phân tích niche.'],
    ['Lỗi khi t hng. Th lại sau.', 'Lỗi khi đặt hàng. Thử lại sau.'],
    ['Link reset không hợp lệ!.', 'Link reset không hợp lệ.'],
    ['Quantity input real-time price ccalculator', 'Quantity input real-time price calculator'],
    ['Avatar Upload Logicc', 'Avatar Upload Logic'],
    ['Cp nhết localStorage ngay v:i dữ liệu ti t DB', 'Cập nhật localStorage ngay với dữ liệu từ DB'],
    ['Kiểm tra email tn ti trong DB thay v dng localStorage ccache', 'Kiểm tra email tồn tại trong DB thay vì dùng localStorage cache'],
    ['Kiểm tra 60 ngy nu thay "i tn', 'Kiểm tra 60 ngày nếu thay đổi tên'],
    ['// "i Mt khu', '// Đổi mật khẩu'],
    ['// Filter Inputs — getter functions v ccc element ny nằm trong view động', '// Filter Inputs — getter (element trong view động)'],
    ['// Acction ccontrols', '// Action controls'],
    ['// Attách listener', '// Attach listener'],
    ['// Sidebar Logout Acction Trigger', '// Sidebar Logout Action Trigger'],
    ['// Acccent Theme Buttons Click', '// Accent Theme Buttons Click'],
    ['// Render Niche Breakdown Graph ccard', '// Render Niche Breakdown Graph card'],
    ['// Hiển thị Logs', '// Hiển thị nhật ký hoạt động'],
    ['// in vo Form (tránh ghi  khi đang g)', '// Điền vào form (tránh ghi đè khi đang gõ)'],
    ['// Cập nhật Credits', '// Cập nhật số dư'],
    ['toggleBlockIccon', 'toggleBlockIcon'],
    ['descc', 'desc'],
];

let n = 0;
for (const [from, to] of pairs) {
    if (!t.includes(from)) continue;
    const c = t.split(from).length - 1;
    t = t.split(from).join(to);
    n += c;
    console.log(`  ${from.slice(0, 50)}… → (${c}x)`);
}

fs.writeFileSync(p, t, 'utf8');
console.log(`\nĐã sửa ${n} chuỗi UI.`);
execSync(`node --check "${p}"`, { stdio: 'inherit' });
