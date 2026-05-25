# Email thông báo đăng nhập thiết bị mới

File mẫu HTML: [`email-new-login-template.html`](../email-new-login-template.html) (cùng phong cách `email-reset-template.html`).

## Cấu hình EmailJS

1. Đăng nhập [EmailJS Dashboard](https://dashboard.emailjs.com/).
2. **Email Templates** → **Create New Template**.
3. **Subject:** `Cảnh báo đăng nhập từ thiết bị mới — VÔ TRI CLUB`
4. Chuyển sang chế độ **HTML** / dán toàn bộ nội dung từ `email-new-login-template.html`.
5. Đảm bảo template có các biến (EmailJS tự nhận `{{...}}`):

| Biến | Mô tả |
|------|--------|
| `{{name}}` | Tên hiển thị |
| `{{user_email}}` | Email tài khoản |
| `{{device}}` | Windows / Android / … |
| `{{ip}}` | Địa chỉ IP |
| `{{login_time}}` | Thời gian (giờ VN) |
| `{{profile_link}}` | Link mở Dashboard |

6. **To Email:** `{{to_email}}` hoặc `{{user_email}}`
7. Lưu template → copy **Template ID** (dạng `template_xxxxx`).

## Một hay hai tài khoản EmailJS?

| Cách | Khi nào dùng |
|------|----------------|
| **1 tài khoản** | Một Public/Private Key, nhiều template (OTP, reset, thiết bị lạ) — đơn giản nhất. |
| **2 tài khoản** | OTP/reset dùng `EMAILJS_*`; thiết bị lạ dùng `EMAILJS_NEW_LOGIN_*` (code đã hỗ trợ). |

**Quan trọng:** Template và Service phải thuộc **cùng tài khoản** với Public/Private Key gửi API. Không trộn key tài khoản A + template tài khoản B.

## File `.env` (hai tài khoản)

```env
# Tài khoản 1 — OTP, quên MK
EMAILJS_PUBLIC_KEY=...
EMAILJS_PRIVATE_KEY=...
EMAILJS_SERVICE_ID=service_...
EMAILJS_TEMPLATE_ID=template_...
EMAILJS_RESET_TEMPLATE_ID=template_...

# Tài khoản 2 — thiết bị lạ (bỏ NEW_LOGIN_PUBLIC_KEY nếu chỉ dùng 1 tài khoản)
EMAILJS_NEW_LOGIN_PUBLIC_KEY=...
EMAILJS_NEW_LOGIN_PRIVATE_KEY=...
EMAILJS_NEW_LOGIN_SERVICE_ID=service_...
EMAILJS_NEW_LOGIN_TEMPLATE_ID=template_ypw3e4b
```

Khởi động lại `node server.js`.

## Khi nào email được gửi?

- User bật **Thông báo đăng nhập** trong Hồ sơ → Bảo mật.
- Đăng nhập thành công từ **thiết bị chưa từng dùng** (lưu trong `user_known_devices` trên MySQL).
- Lần đăng nhập sau từ cùng thiết bị **không** gửi lại.

## Kiểm tra

1. Bật thông báo trong Hồ sơ.
2. Đăng nhập bằng trình duyệt ẩn danh hoặc máy khác.
3. Kiểm tra hộp thư + log server: `[SECURITY] New-login email sent → ...`
