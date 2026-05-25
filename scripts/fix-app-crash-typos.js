const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const p = path.join(__dirname, '..', 'app.js');
let t = fs.readFileSync(p, 'utf8');

const pairs = [
    // DOM / Canvas API
    ['ccloneNode', 'cloneNode'],
    ['.arcc(', '.arc('],
    ['querySeletorAll', 'querySelectorAll'],
    ['querySeletor', 'querySelector'],
    ['createIccons', 'createIcons'],
    ['classList.ccontains', 'classList.contains'],
    ['.ccontains(', '.contains('],
    ['Math.cceil', 'Math.ceil'],
    ['.srcc', '.src'],
    ['unsplash.ccom', 'unsplash.com'],
    ['fit=ccrop', 'fit=crop'],
    ['phoạto-', 'photo-'],
    // Functions / handlers
    ['ccheckResetTokenFromUrl', 'checkResetTokenFromUrl'],
    ['ccalculateSmmPrice', 'calculateSmmPrice'],
    ['bindUserAcctionButtons', 'bindUserActionButtons'],
    ['bindAcctionButtons', 'bindActionButtons'],
    ['getThemeAcccentColor', 'getThemeAccentColor'],
    ['acccentColor', 'accentColor'],
    // Element IDs (must match views/*.html)
    ['settings-btn-cclear', 'settings-btn-clear'],
    ['btn-cchange-password', 'btn-change-password'],
    ['reset-cconfirm-password', 'reset-confirm-password'],
    ['profile-cconfirm-password', 'profile-confirm-password'],
    ['profile-ccredits-display', 'profile-credits-display'],
    ['pages-ccards-grid', 'pages-cards-grid'],
    // Events / classes
    ["addEventListener('cchange'", "addEventListener('change'"],
    ["new Event('cchange')", "new Event('change')"],
    ['btn-ccheck', 'btn-check'],
    ['page-ccard', 'page-card'],
    ['glass-ccard', 'glass-card'],
    ['ccard-ccheck-info', 'card-check-info'],
    ['ccard-stat-label', 'card-stat-label'],
    ['ccard-stat-value', 'card-stat-value'],
    ['ccard-stat-box', 'card-stat-box'],
    ['ccard-title-text', 'card-title-text'],
    ['ccard-title-group', 'card-title-group'],
    ['ccard-niche-badge', 'card-niche-badge'],
    ['ccard-actions', 'card-actions'],
    ['ccard-stats', 'card-stats'],
    ['ccard-top', 'card-top'],
    ['dashboard-service-ccard', 'dashboard-service-card'],
    ['refresh-ccw', 'refresh-cw'],
    // Auth / profile
    ['admin@votri.cclub', 'admin@votri.club'],
    ['user.ccredits', 'user.balance'],
  // Vietnamese / mojibake
    ['Kiá»ƒm tra sá»©cc khá»e', 'Kiểm tra sức khỏe'],
    ['Kiá»ƒm tra ${', 'Kiểm tra ${'],
    ['Sá»­a trang', 'Sửa trang'],
    ['ChÆ°a kiá»ƒm tra', 'Chưa kiểm tra'],
    ['Vá»«a xong', 'Vừa xong'],
    ['phết tr:cc', 'phút trước'],
    ['giá» trÆ°á»›cc', 'giờ trước'],
    ['ngy tr:cc', 'ngày trước'],
    ['Dá»‹cch vá»¥ Facebook', 'Dịch vụ Facebook'],
    ['Khácc', 'Khác'],
    ['d9cch v', 'dịch vụ'],
    ['Danh sch', 'Danh sách'],
    ['Chn d9cch', 'Chọn dịch vụ'],
    ['Vui lòng cchn', 'Vui lòng chọn'],
    ['tr:cc', 'trước'],
    ['Phn loi', 'phân loại'],
    ['Nn tng', 'nền tảng'],
    ['ang tải dữ liệu', 'Đang tải dữ liệu'],
    ['mx lại trang hoc th sau', 'vui lòng tải lại trang hoặc thử sau'],
    ["showToast(' xóa bộ lọcc'", "showToast('Đã xóa bộ lọc'"],
    ['Quản trị vin', 'Quản trị viên'],
    ['Lifecyccle', 'Lifecycle'],
    ['Cha trang. Ti demo trong Ci t  xem biu .', 'Chưa có trang. Tải demo trong Cài đặt để xem biểu đồ.'],
    ['Cá»™ng/Trá»« sá»‘ dÆ°', 'Cộng/Trừ số dư'],
    ['nh qu l:n, vui lng cchn nh d/i 2MB.', 'Ảnh quá lớn, vui lòng chọn ảnh dưới 2MB.'],
    ['Trnh duy!t khng xcc 9nh', 'Trình duyệt không xác định'],
    ['italicc', 'italic'],
    ['ccost', 'cost'],
];

for (const [from, to] of pairs) {
    if (!t.includes(from)) continue;
    t = t.split(from).join(to);
}

// Variable names (safe renames)
t = t.replace(/\bcconfirmPassword\b/g, 'confirmPassword');
t = t.replace(/\bcconfirmPass\b/g, 'confirmPass');
t = t.replace(/\bccreditsDisplay\b/g, 'creditsDisplay');
t = t.replace(/\bconst ccategories\b/g, 'const categories');
t = t.replace(/ccategories\.forEach\(cc =>/g, 'categories.forEach(cat =>');
t = t.replace(/option\.value = cc;/g, 'option.value = cat;');
t = t.replace(/option\.textContent = cc;/g, 'option.textContent = cat;');

const fanpageBridge = `
// Fanpage handlers (js/votri-fanpages.js)
function openPageModal(id) { return window.VotriFanpages?.openPageModal(id); }
function closePageModal() { return window.VotriFanpages?.closePageModal(); }
function handleFormSubmit(e) { return window.VotriFanpages?.handleFormSubmit(e); }
function deletePage(id) { return window.VotriFanpages?.runPageCheck(id, btn); }
function runPageCheck(id, btn) { return window.VotriFanpages?.runPageCheck(id, btn); }
`;

// Fix accidental corruption in bridge if present
t = t.replace(
    /function handleFormSubmit\(e\) \{ return window\.VotriFanpages\?\.handleFormSubmit\(e\); \}\s*function deletePage\(id\) \{ return window\.VotriFanpages\?\.runPageCheck/g,
    'function handleFormSubmit(e) { return window.VotriFanpages?.handleFormSubmit(e); }\nfunction deletePage(id) { return window.VotriFanpages?.deletePage(id); }\nfunction runPageCheck(id, btn) { return window.VotriFanpages?.runPageCheck'
);

if (!t.includes('function openPageModal(id) { return window.VotriFanpages')) {
    const marker = '// Core -> js/votri-core.js | Fanpage -> js/votri-fanpages.js';
    if (t.includes(marker)) {
        t = t.replace(marker, marker + fanpageBridge);
    }
}

fs.writeFileSync(p, t, 'utf8');
execSync(`node --check "${p}"`, { stdio: 'inherit' });
console.log('app.js crash typo repair done');
