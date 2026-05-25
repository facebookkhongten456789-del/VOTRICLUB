# Deploy Vercel — demo xin API MoMo

**Mục đích:** Đưa link HTTPS cho MoMo xem dự án → xin Partner Code / API.  
**Giai đoạn này:** Chỉ demo ổn định URL + luồng nạp tiền. **Bảo mật đầy đủ (Cloudflare, Captcha, chặn F12) làm sau** khi MoMo duyệt.

---

## 1. Chuẩn bị (bắt buộc)

| Hạng mục | Ghi chú |
|----------|---------|
| **MySQL trên cloud** | Vercel **không** chạy XAMPP. Dùng [PlanetScale](https://planetscale.com), [Railway](https://railway.app), hoặc MySQL host bất kỳ có **SSL**. |
| **GitHub** | Push code lên repo (không commit file `.env`). |
| **Tài khoản Vercel** | [vercel.com](https://vercel.com) → Import project từ GitHub. |

Import schema: chạy `database/init.sql` trên MySQL cloud (tạo DB `votri_club` + bảng).

---

## 2. Deploy trên Vercel (5 bước)

1. **Import** repo → Framework: **Other** (đã có `vercel.json`).
2. **Environment Variables** (Settings → Environment Variables) — copy từ `.env`, chỉnh lại:

| Biến | Ví dụ / ghi chú |
|------|------------------|
| `APP_BASE_URL` | `https://ten-project.vercel.app` (URL Vercel sau deploy lần 1) |
| `TRUST_PROXY` | `1` |
| `DB_HOST` | Host MySQL cloud (không dùng `localhost`) |
| `DB_PORT` | `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Theo nhà cung cấp DB |
| `MOMO_ENVIRONMENT` | `test` |
| `MOMO_PARTNER_CODE` | Để trống hoặc test — MoMo cấp sau |
| `MOMO_ACCESS_KEY` / `MOMO_SECRET_KEY` | MoMo cấp sau |
| EmailJS, Bytemart | Tuỳ chọn cho demo |

3. **Deploy** → đợi **Ready**.
4. Vào **Settings → Domains** — copy URL production (vd. `https://votri-club.vercel.app`).
5. Sửa lại `APP_BASE_URL` = URL đó → **Redeploy**.

---

## 3. URL gửi MoMo (điền vào form / email)

Thay `https://YOUR-APP.vercel.app` bằng domain thật sau deploy.

| Mục | URL |
|-----|-----|
| **Website dự án** | `https://YOUR-APP.vercel.app` |
| **IPN (callback thanh toán)** | `https://YOUR-APP.vercel.app/api/webhooks/momo` |
| **Redirect sau thanh toán** | `https://YOUR-APP.vercel.app` |
| **API tạo thanh toán** | `POST https://YOUR-APP.vercel.app/api/momo/create-payment` |

**Content-Type:** `application/json` (body JSON).

---

## 4. Mẫu mô tả ngắn gửi MoMo (copy chỉnh tên)

```
Kính gửi MoMo,

Tôi xin tích hợp cổng thanh toán MoMo cho hệ thống VÔ TRI CLUB (dịch vụ SMM / nạp ví).

- Tên dự án: VÔ TRI CLUB - SYSTEM
- Website demo: https://YOUR-APP.vercel.app
- IPN URL: https://YOUR-APP.vercel.app/api/webhooks/momo
- Phương thức: captureWallet (MoMo v2)
- Môi trường: test (sau khi duyệt chuyển production)

Luồng: User đăng nhập → Nạp tiền → Tạo link/QR MoMo → IPN xác nhận → Cộng số dư ví.

Xin hỗ trợ cấp Partner Code, Access Key, Secret Key để hoàn thiện tích hợp.

Trân trọng,
[Tên bạn] — [SĐT / Email]
```

---

## 5. Kiểm tra sau deploy

| Kiểm tra | Kỳ vọng |
|----------|---------|
| Mở trang chủ | Hiện giao diện đăng nhập / dashboard |
| `GET /api/health` | `{"status":"ok","db":true}` (nếu DB đúng) |
| Đăng nhập / đăng ký | OK nếu DB + EmailJS cấu hình |
| Menu **Nạp tiền** | Có form MoMo (lỗi “chưa cấu hình” là bình thường trước khi có key MoMo) |

---

## 6. Lưu ý kỹ thuật (Vercel)

- **CSS/JS 404:** Cần `includeFiles` trong `vercel.json` (xem file trong repo). Kiểm tra `/style.css` trả CSS, không 404.
- **Đăng nhập gọi `:3000`:** `js/votri-core.js` phải dùng `window.location.origin` trên Vercel (không port). Sau sửa, redeploy và hard-refresh (Ctrl+F5).
- Session lưu **RAM** — serverless có thể reset; demo MoMo vẫn xem được UI + API path.
- **IPN** cần URL public HTTPS — Vercel đáp ứng.
- MySQL cloud: bật kết nối từ IP bên ngoài (allow `%` hoặc Vercel IP nếu host yêu cầu).

---

## 7. Sau khi MoMo duyệt

1. Điền key MoMo vào Vercel Environment Variables.
2. Đăng ký IPN trên portal MoMo = URL mục 3.
3. Test nạp tiền test → IPN cộng ví.
4. **Lúc này mới** bật lại: Cloudflare, Captcha, `NODE_ENV=production`, tắt debug F12 (xem `docs/BAO_CAO_TODO.md`).

---

## 8. Lệnh local (không dùng khi deploy Vercel)

```bash
npm install
node server.js
```

Deploy Vercel: **không** cần lệnh trên — push Git là Vercel tự build.
