# Tránh lỗi encoding khi sửa `app.js`

## Triệu chứng

Sau khi lưu/sửa file bằng **PowerShell** (`Set-Content`, copy/paste sai code page), các API hợp lệ bị thêm chữ **`c`** ở đầu:

| Sai | Đúng |
|-----|------|
| `platformSelect.ccloneNode` | `cloneNode` |
| `ctx.arcc` | `ctx.arc` |
| `Math.cceil` | `Math.ceil` |
| `img.srcc` | `img.src` |
| `if (cconfirm(` | `if (confirm(` |
| `register-cconfirm` | `register-confirm` (ID input) |
| `lucide.createIccons` | `createIcons` |
| `document.querySeletorAll` | `querySelectorAll` |
| `classList.ccontains` | `contains` |
| `addEventListener('cchange')` | `'change'` |

Console thường báo: **`xxx.cyyy is not a function`**.

## Fanpage — nguồn dữ liệu

- **MySQL** (`fanpages`) là nguồn chính sau khi đăng nhập.
- Nút **Kiểm tra** Fanpage phải gọi `PATCH /api/pages/:id/check-sync` — không chỉ `localStorage`.
- `localStorage.votri_sys_pages` chỉ là cache; reload/đăng nhập lại lấy từ API `/api/pages/list`.

## Quy tắc (bắt buộc)

1. **Không** dùng `Set-Content` / `Out-File` PowerShell lên `app.js` hoặc `index.html`.
2. Sửa bằng **Cursor/VS Code**, encoding **UTF-8** (không UTF-16).
3. Sau mỗi lần sửa lớn `app.js`:
   ```bash
   node --check app.js
   node scripts/check-encoding-typos.js
   ```
4. Nếu phát hiện typo hàng loạt:
   ```bash
   node scripts/fix-app-crash-typos.js
   node scripts/check-encoding-typos.js
   ```
5. Tăng `?v=` trên `<script src="app.js?v=...">` trong `index.html` để tránh cache trình duyệt.

## Script hỗ trợ

| Script | Mục đích |
|--------|----------|
| `scripts/check-encoding-typos.js` | Quét repo, báo lỗi (exit 1) |
| `scripts/fix-app-crash-typos.js` | Sửa tập typo đã biết trong `app.js` |
| `scripts/sweep-encoding-bugs.js` | Quét + sửa `app.js` và `js/*.js` (chạy khi còn lỗi lạ) |
| `scripts/fix-vietnamese-ui.js` | Sửa chuỗi tiếng Việt hiển thị (toast, nhật ký, profile) |

## Tách module an toàn

Khi tách code khỏi `app.js`, **copy bằng Node UTF-8** hoặc editor — không truncate bằng PowerShell. Xem `docs/MODULE_MAP.md`.
