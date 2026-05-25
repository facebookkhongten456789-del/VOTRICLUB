/**
 * Vai trò người dùng — đồng bộ MySQL / admin / XAMPP
 */
const USER_ROLES = Object.freeze(['member', 'collaborator', 'distributor', 'admin']);

const ROLE_LABELS_VI = Object.freeze({
    member: 'Thành viên',
    collaborator: 'Cộng tác viên',
    distributor: 'Nhà phân phối',
    admin: 'Quản trị viên',
});

const ROLE_ALIASES = Object.freeze({
    member: 'member',
    'thành viên': 'member',
    thanhvien: 'member',
    collaborator: 'collaborator',
    'cộng tác viên': 'collaborator',
    'cong tac vien': 'collaborator',
    cotacvien: 'collaborator',
    distributor: 'distributor',
    'nhà phân phối': 'distributor',
    'nha phan phoi': 'distributor',
    nhapphanphoi: 'distributor',
    admin: 'admin',
    'quản trị': 'admin',
    'quản trị viên': 'admin',
});

let rolesSchemaReady = false;

function normalizeUserRole(role) {
    const key = String(role || 'member')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const raw = String(role || 'member').trim().toLowerCase();
    if (USER_ROLES.includes(raw)) return raw;
    if (ROLE_ALIASES[raw]) return ROLE_ALIASES[raw];
    if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
    return 'member';
}

function roleLabelVi(role) {
    return ROLE_LABELS_VI[normalizeUserRole(role)] || ROLE_LABELS_VI.member;
}

function isAdminRole(role) {
    return normalizeUserRole(role) === 'admin';
}

async function ensureUserRolesSchema(dbQuery) {
    if (rolesSchemaReady) return;
    try {
        await dbQuery(
            `ALTER TABLE users MODIFY COLUMN role
             ENUM('member','collaborator','distributor','admin') NOT NULL DEFAULT 'member'`,
        );
    } catch (err) {
        console.warn('[ROLES] ALTER ENUM:', err.message);
    }
    rolesSchemaReady = true;
}

module.exports = {
    USER_ROLES,
    ROLE_LABELS_VI,
    normalizeUserRole,
    roleLabelVi,
    isAdminRole,
    ensureUserRolesSchema,
};
