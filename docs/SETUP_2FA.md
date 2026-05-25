# Thiết lập 2FA — Google Authenticator (VÔ TRI CLUB)

Xác thực **TOTP thật** (RFC 6238): mã 6 số đổi mỗi **30 giây**, tương thích **Google Authenticator**, Authy, Microsoft Authenticator.

---

## Bước 1: Cài app trên điện thoại

| Hệ điều hành | Link |
|--------------|------|
| Android | [Google Authenticator — CH Play](https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2) |
| iPhone | [Google Authenticator — App Store](https://apps.apple.com/app/google-authenticator/id388497605) |

---

## Bước 2: Bật 2FA trong Dashboard

1. Đăng nhập http://localhost:3000 (hoặc domain production).
2. Sidebar → **Hồ sơ cá nhân**.
3. Card **Bảo mật** → bật công tắc **Xác thực 2 lớp (2FA)**.
4. Màn hình hiện **mã QR** — trong Google Authenticator:
   - Bấm **+** (Thêm tài khoản)
   - Chọn **Quét mã QR**
   - Quét mã trên web

5. App hiện mục **Votri Club** + email của bạn.
6. Nhập **mã 6 số** đang hiển thị trên điện thoại vào ô trên web.
7. Bấm **Xác nhận bật 2FA**.

> **Không quét được QR?** Mở mục *“Không quét được? Nhập khóa thủ công”* → trong app chọn **Nhập khóa thiết lập** → dán **secret** (khóa Base32).

---

## Bước 3: Đăng nhập sau khi bật 2FA

1. Nhập **Email + Mật khẩu** như bình thường.
2. Hệ thống chuyển sang màn **Xác thực 2 lớp**.
3. Mở Google Authenticator → mục **Votri Club** → nhập mã **6 số** (lưu ý mã đổi sau ~30 giây).
4. Bấm **Xác nhận đăng nhập**.

---

## Tắt 2FA

Hồ sơ → Bảo mật → tắt công tắc 2FA → nhập **mã 6 số hiện tại** + **mật khẩu đăng nhập**.

---

## Lưu ý

- Đồng hồ điện thoại và máy server nên đúng giờ (lệch > 2 phút có thể làm mã sai).
- Secret và trạng thái 2FA lưu trong **MySQL** (`users.two_factor_secret`, `users.two_factor_enabled`).
- Mỗi lần bật/tắt/đăng nhập 2FA được ghi **Nhật ký hoạt động** trên DB.

---

## QR code

Mã QR được **tạo trên server** (`lib/qr-otp.js`, package `qrcode`) — không cần CDN hay mạng ngoài khi mở Dashboard.

Sau khi sửa code: **khởi động lại** `node server.js` (hoặc `start.bat`).

---

## Kiểm tra nhanh (dev)

```bash
node -e "const t=require('./lib/totp');const s=t.generateSecret();const c=t.generateToken(s);console.log('secret',s,'code',c,'ok',t.verifyToken(s,c));"
```

Nếu `ok true` — server TOTP hoạt động đúng chuẩn Google Authenticator.
