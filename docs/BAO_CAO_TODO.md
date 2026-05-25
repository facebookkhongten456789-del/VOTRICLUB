# Báo cáo / Ghi chú việc cần làm — VÔ TRI CLUB Dashboard

*Cập nhật: 25/05/2026*

---

## 0. Deploy demo MoMo (Vercel)

→ Xem hướng dẫn: **[DEPLOY_VERCEL_MOMO.md](./DEPLOY_VERCEL_MOMO.md)**  
Mục đích: link HTTPS cho MoMo xem dự án, xin API. Bảo mật full làm **sau** khi MoMo duyệt.

---

## 1. API MoMo nạp tiền — **CHƯA HOÀN THIỆN / THIẾU CẤU HÌNH**

### Hiện trạng code
| Thành phần | Trạng thái |
|------------|------------|
| `POST /api/momo/create-payment` | Có route (`server.js`) — cần key thật |
| `POST /api/webhooks/momo` (IPN) | Có — đã có kiểm tra chữ ký + chống cộng tiền trùng |
| UI Nạp tiền | `js/votri-deposit.js` gọi API |
| Bảng `deposits` | Có trong MySQL (`database/init.sql`) |

### Thiếu / chưa làm
- [ ] **Điền key MoMo thật** trong `.env` (hiện placeholder):
  ```env
  MOMO_PARTNER_CODE=MOMO_YOUR_PARTNER_CODE   # ← cần thay
  MOMO_ACCESS_KEY=YOUR_ACCESS_KEY
  MOMO_SECRET_KEY=YOUR_SECRET_KEY
  MOMO_ENVIRONMENT=test   # đổi production khi go-live
  APP_BASE_URL=https://domain-cua-ban.com   # IPN callback phải public HTTPS
  ```
- [ ] **Đăng ký IPN URL** với MoMo: `https://<domain>/api/webhooks/momo`
- [ ] Test end-to-end: tạo QR → thanh toán test → IPN cộng `balance` + `total_deposited`
- [ ] Production: `MOMO_ENVIRONMENT=production`, domain SSL, `TRUST_PROXY=1` nếu sau reverse proxy

> **Ghi chú:** Không nạp được tiền thật cho đến khi Partner Code / Access Key / Secret Key hợp lệ và webhook MoMo gọi được vào server (localhost chỉ test được create-payment, IPN cần tunnel như ngrok nếu dev local).

---

## 2. API đơn hàng (Order) — **MỘT PHẦN**

### Đã có
| API | Mô tả |
|-----|--------|
| `POST /api/smm/order` | Tạo đơn SMM (Bytemart), trừ balance, lưu `orders` |
| `GET /api/orders/list` | Lịch sử đơn (user / admin) |
| UI | Tạo đơn (`votri-smm.js`), Lịch sử (`orders-page.js`) |

### Cấu hình / thiếu
- [ ] **Bytemart API** trong `.env`:
  ```env
  BYTEMART_API_URL=https://smm.bytemart.io.vn/api/v2
  BYTEMART_API_KEY=<key-thật>
  SMM_PROFIT_PERCENT=40   # % markup — xem mục 3
  ```
- [ ] **Đồng bộ trạng thái đơn** từ panel Bytemart (hiện chỉ lưu lúc tạo: Pending / Processing / Failed)
- [ ] (Tuỳ chọn) Webhook/cron cập nhật `status` đơn hàng từ nhà cung cấp
- [ ] (Tuỳ chọn) API admin: hủy đơn, hoàn tiền thủ công

---

## 3. Nhắc: Tăng / chỉnh **cost & giá bán** trên web

- Biến markup: **`SMM_PROFIT_PERCENT`** trong `.env` (mặc định `40` = +40% trên rate gốc Bytemart).
- Logic: `routes/smm.js` + `lib/smm-order.js` — `rate` hiển thị = `ceil(rate_gốc × (1 + SMM_PROFIT_PERCENT/100))`.
- [ ] Rà soát lại % lợi nhuận theo từng nền tảng / dịch vụ hot
- [ ] Cập nhật bảng giá sau khi đổi % — user cần **Ctrl+F5** (cache client đã giảm gọi API trùng)
- [ ] Kiểm tra đơn mẫu: số dư đủ, `quantity` min/max, không âm (đã fix cheat)

---

## 4. Sau khi xong MoMo + Order — **Theme / API Captcha / Cloudflare**

> Làm **sau** khi nạp tiền & đặt hàng ổn định.

- [ ] Bật **Cloudflare** trước domain production (DNS, SSL Full/Strict, proxy orange cloud)
- [ ] Cấu hình **WAF / Rate limiting** trên Cloudflare (bổ sung cho `lib/api-rate-limits.js`)
- [ ] **Captcha** (Cloudflare Turnstile hoặc reCAPTCHA) cho:
  - Đăng nhập / đăng ký / quên mật khẩu
  - (Tuỳ chọn) Tạo đơn, nạp tiền, gửi ticket
- [ ] Cập nhật **CSP** `index.html` nếu embed script captcha
- [ ] `ALLOWED_ORIGINS` + `APP_BASE_URL` khớp domain thật sau Cloudflare

---

## 5. Nhắc: Tắt / hạn chế **F12 (DevTools)** trên production

> Mục tiêu: user mở F12 **không làm được gì hữu ích** (không debug, không copy token dễ dàng). Không chặn 100% được nhưng giảm rủi ro.

### Hiện trạng debug trong code
- `app.js`: `window.__votriDbg` gửi log tới endpoint debug local (`127.0.0.1:7429`)
- Nhiều file có `// #region agent log` + `__votriDbg?.(...)`
- `server.js`: ghi `debug-d15afd.log` (đã chặn public qua `lib/security-middleware.js`)

### Việc bạn cần làm khi **lên production**
- [ ] **Tắt debug ingest**: không gọi `__votriDbg` / xóa hoặc bọc `if (process.env.DEV === '1')` toàn bộ agent log
- [ ] **Xóa / không deploy** file `debug-*.log`
- [ ] **Client anti-devtools** (tuỳ chọn, chỉ production):
  - Phát hiện DevTools mở → cảnh báo hoặc reload (dễ bypass, chỉ rào cản nhẹ)
  - Không lưu token FB trong `localStorage` nếu có thể (đã note bảo mật)
- [ ] **Kiểm tra tay**: mở F12 → Console / Network — không thấy OTP, reset link, `simulatorCode`, stack trace nhạy cảm
- [ ] `.env` production:
  ```env
  NODE_ENV=production
  ALLOW_DEV_SIMULATOR=0
  ALLOW_FALLBACK_ADMIN_LOGIN=0
  DEV=0
  ```
- [ ] Chỉ khi **F12 không còn lộ API key / debug / cheat dễ** → coi như **OK**

---

## 6. Checklist go-live nhanh

| # | Hạng mục | Xong? |
|---|----------|-------|
| 1 | MoMo keys + test IPN | ☐ |
| 2 | Bytemart key + test đặt đơn | ☐ |
| 3 | Chỉnh `SMM_PROFIT_PERCENT` / giá | ☐ |
| 4 | MySQL password mạnh, phpMyAdmin không public | ☐ |
| 5 | `NODE_ENV=production`, tắt simulator & fallback admin | ☐ |
| 6 | Cloudflare + Captcha | ☐ |
| 7 | Tắt debug F12 / agent log | ☐ |

---

## 7. File liên quan

| File | Nội dung |
|------|----------|
| `.env` | MoMo, Bytemart, profit %, DB |
| `server.js` | MoMo create + webhook |
| `routes/smm.js`, `lib/smm-order.js` | Đơn hàng SMM |
| `routes/orders.js` | List đơn |
| `js/votri-deposit.js` | UI nạp MoMo |
| `lib/security-middleware.js` | Chặn leak file, static an toàn |
| `docs/MODULE_MAP.md` | Sơ đồ module |

---

*Báo cáo này dùng nội bộ — cập nhật khi hoàn từng mục.*
