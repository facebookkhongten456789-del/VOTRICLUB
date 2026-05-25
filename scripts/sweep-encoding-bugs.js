/**
 * Quét + sửa typo encoding trên app.js và js/*.js
 * node scripts/sweep-encoding-bugs.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [
    path.join(ROOT, 'app.js'),
    ...fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'js', f))
];

const LITERAL = [
    ['Math.cceil', 'Math.ceil'],
    ['Math.cfloor', 'Math.floor'],
    ['Math.cround', 'Math.round'],
    ['Math.cmax', 'Math.max'],
    ['Math.cmin', 'Math.min'],
    ['Math.cabs', 'Math.abs'],
    ['ccloneNode', 'cloneNode'],
    ['.arcc(', '.arc('],
    ['.srcc', '.src'],
    ['querySeletorAll', 'querySelectorAll'],
    ['querySeletor', 'querySelector'],
    ['createIccons', 'createIcons'],
    ['classList.ccontains', 'classList.contains'],
    ['ccheckResetTokenFromUrl', 'checkResetTokenFromUrl'],
    ['ccalculateSmmPrice', 'calculateSmmPrice'],
    ['bindAcctionButtons', 'bindActionButtons'],
    ['bindUserAcctionButtons', 'bindUserActionButtons'],
    ['getThemeAcccentColor', 'getThemeAccentColor'],
    ['register-cconfirm', 'register-confirm'],
    ['register-otp-ccode', 'register-otp-code'],
    ['reset-cconfirm-password', 'reset-confirm-password'],
    ['profile-cconfirm-password', 'profile-confirm-password'],
    ['profile-ccredits-display', 'profile-credits-display'],
    ['profile-name-ccooldown', 'profile-name-cooldown'],
    ['pricing-pagination-ccontrols', 'pricing-pagination-controls'],
    ['authSccreen', 'authScreen'],
    ['avatarIccon', 'avatarIcon'],
    ['getElementById(\'profile-avatar-iccon\')', "getElementById('profile-avatar-icon')"],
    ['if (cconfirm(', 'if (confirm('],
    ['pages-ccards-grid', 'pages-cards-grid'],
    ['btn-ccheck', 'btn-check'],
    ['dashboard-service-ccard', 'dashboard-service-card'],
    ['settings-btn-cclear', 'settings-btn-clear'],
    ['btn-cchange-password', 'btn-change-password'],
    ["addEventListener('cchange'", "addEventListener('change'"],
    ["new Event('cchange')", "new Event('change')"],
    ['unsplash.ccom', 'unsplash.com'],
    ['fit=ccrop', 'fit=crop'],
    ['phoạto-', 'photo-'],
    ['admin@votri.cclub', 'admin@votri.club'],
    ['Đã lưu ccấu hình', 'Đã lưu cấu hình'],
    ['ccp nhết', 'cập nhật'],
    ['d9cch v', 'dịch vụ'],
    ['Danh sch', 'Danh sách'],
];

/** Math.cXXX -> Math.XXX except ceil, clz32, cos, cbrt, cosh */
const MATH_C_TYPO = /Math\.c(?!eil\b|lz32\b|os\b|brt\b|osh\b)([a-z]{2,})\b/g;

let total = 0;

for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    let t = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    let fileChanges = 0;

    for (const [from, to] of LITERAL) {
        if (!t.includes(from)) continue;
        const n = t.split(from).length - 1;
        t = t.split(from).join(to);
        fileChanges += n;
        console.log(`  ${rel}: ${from} → ${to} (${n}x)`);
    }

    const mathMatches = [...t.matchAll(MATH_C_TYPO)];
    if (mathMatches.length) {
        t = t.replace(MATH_C_TYPO, (_, method) => {
            fileChanges++;
            return `Math.${method}`;
        });
        console.log(`  ${rel}: Math.c* typo → Math.* (${mathMatches.length}x)`);
    }

    if (rel === 'app.js') {
        if (t.includes("const cconfirm = document.getElementById('register-confirm')")) {
            t = t.replace(
                /const cconfirm = document\.getElementById\('register-confirm'\)\.value;/g,
                "const confirmPassword = document.getElementById('register-confirm').value;"
            );
            t = t.replace(/password !== cconfirm/g, 'password !== confirmPassword');
            fileChanges++;
            console.log(`  ${rel}: cconfirm variable → confirmPassword`);
        }
        if (!t.includes('function saveDatabase()')) {
            const bridge = `
function saveDatabase() { return window.VotriFanpages?.saveDatabase(); }
`;
            const marker = 'function runPageCheck(id, btn)';
            if (t.includes(marker) && !t.includes('function saveDatabase()')) {
                t = t.replace(marker, `function saveDatabase() { return window.VotriFanpages?.saveDatabase(); }\n${marker}`);
                fileChanges++;
                console.log(`  ${rel}: added saveDatabase() bridge`);
            }
        }
        // confirm dialogs — Vietnamese
        t = t.replace(
            /if \(confirm\('CNH BO: Bn cchcc mun xóa ton b" trang\? Hnh ộng ny khng th hon tcc\.'\)\)/,
            "if (confirm('CẢNH BÁO: Bạn chắc chắn muốn xóa toàn bộ trang? Hành động này không thể hoàn tác.'))"
        );
        t = t.replace(
            /if \(confirm\(`Bn cchcc mun xóa ti khon: \$\{email\}\? Không th hon tcc\.`\)\)/,
            'if (confirm(`Bạn chắc chắn muốn xóa tài khoản: ${email}? Không thể hoàn tác.`))'
        );
    }

    if (fileChanges) {
        fs.writeFileSync(file, t, 'utf8');
        total += fileChanges;
    }
}

if (total === 0) {
    console.log('Không phát hiện thêm typo.');
} else {
    console.log(`\nĐã sửa ${total} thay đổi.`);
}

try {
    execSync(`node --check "${path.join(ROOT, 'app.js')}"`, { stdio: 'inherit' });
} catch {
    process.exit(1);
}
