/**
 * Quét typo do lỗi encoding (thêm chữ "c" trước API DOM/JS).
 * Chạy: node scripts/check-encoding-typos.js
 * Exit 1 nếu phát hiện lỗi — dùng trước khi commit hoặc sau khi sửa app.js bằng PowerShell.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['', 'js', 'routes', 'lib'];
const SKIP = new Set(['node_modules', '.git', 'scripts']);
const SCAN_FILES = ['app.js']; // luôn quét app.js dù nằm root

/** [regex, mô tả, gợi ý sửa] */
const RULES = [
    [/\.ccloneNode\b/g, 'ccloneNode', 'cloneNode'],
    [/\.arcc\b/g, 'arcc', 'arc'],
    [/Math\.cceil\b/g, 'cceil', 'ceil'],
    [/\.srcc\b/g, 'srcc', 'src'],
    [/unsplash\.ccom\b/g, 'unsplash.ccom', 'unsplash.com'],
    [/\.ccontains\b/g, 'ccontains', 'contains'],
    [/classList\.ccontains/g, 'classList.ccontains', 'classList.contains'],
    [/querySeletorAll\b/g, 'querySeletorAll', 'querySelectorAll'],
    [/querySeletor\b/g, 'querySeletor', 'querySelector'],
    [/createIccons\b/g, 'createIccons', 'createIcons'],
    [/ccheckResetTokenFromUrl\b/g, 'ccheckResetTokenFromUrl', 'checkResetTokenFromUrl'],
    [/ccalculateSmmPrice\b/g, 'ccalculateSmmPrice', 'calculateSmmPrice'],
    [/bindAcctionButtons\b/g, 'bindAcctionButtons', 'bindActionButtons'],
    [/addEventListener\(\s*['"]cchange['"]/g, "addEventListener('cchange'", "addEventListener('change'"],
    [/new Event\(\s*['"]cchange['"]/g, "new Event('cchange')", "new Event('change')"],
    [/pages-ccards-grid/g, 'pages-ccards-grid', 'pages-cards-grid'],
    [/btn-ccheck/g, 'btn-ccheck', 'btn-check'],
    [/dashboard-service-ccard/g, 'dashboard-service-ccard', 'dashboard-service-card'],
    [/Math\.cceil\b/g, 'Math.cceil', 'Math.ceil'],
    [/Math\.cfloor\b/g, 'Math.cfloor', 'Math.floor'],
    [/\bcconfirm\s*\(/g, 'cconfirm(', 'confirm('],
    [/register-cconfirm/g, 'register-cconfirm', 'register-confirm'],
    [/register-otp-ccode/g, 'register-otp-ccode', 'register-otp-code'],
    [/profile-name-ccooldown/g, 'profile-name-ccooldown', 'profile-name-cooldown'],
    [/pricing-pagination-ccontrols/g, 'pricing-pagination-ccontrols', 'pricing-pagination-controls'],
    [/avatarIccon/g, 'avatarIccon', 'avatarIcon'],
    [/authSccreen/g, 'authSccreen', 'authScreen'],
];

function listJsFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            if (SKIP.has(name)) continue;
            out.push(...listJsFiles(full));
        } else if (name.endsWith('.js') && !full.includes('node_modules')) {
            out.push(full);
        }
    }
    return out;
}

const files = [
    ...SCAN_FILES.map((f) => path.join(ROOT, f)).filter(fs.existsSync),
    ...SCAN_DIRS.flatMap((d) => listJsFiles(path.join(ROOT, d)))
];
const uniqueFiles = [...new Set(files)];
let hits = 0;

for (const file of uniqueFiles) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const [re, bad, good] of RULES) {
        re.lastIndex = 0;
        lines.forEach((line, i) => {
            if (re.test(line)) {
                hits++;
                console.error(`${rel}:${i + 1}  ${bad} → ${good}`);
                console.error(`  ${line.trim().slice(0, 120)}`);
            }
            re.lastIndex = 0;
        });
    }
}

if (hits) {
    console.error(`\n${hits} encoding typo(s). Chạy: node scripts/fix-app-crash-typos.js`);
    process.exit(1);
}
console.log('OK — không phát hiện typo encoding phổ biến.');
