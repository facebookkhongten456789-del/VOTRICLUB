# Cấu trúc module — VÔ TRI Dashboard

Mục tiêu: **app.js** chỉ điều phối (init, tab, renderAllViews). Logic từng tính năng tách file riêng.

> **Encoding:** Trước commit, chạy `node scripts/check-encoding-typos.js`. Chi tiết: [ENCODING_SAFETY.md](./ENCODING_SAFETY.md).

## Frontend (`js/`)

| File | Chức năng | API backend |
|------|-----------|-------------|
| `votri-core.js` | Toast, auth headers, escapeHTML, admin check | — |
| `page-status.js` | Nhãn trạng thái Fanpage | — |
| `pages-api.js` | CRUD Fanpage | `routes/pages.js` |
| `votri-fanpages.js` | UI Fanpage, check Graph | `routes/facebook-check.js` |
| `orders-page.js` | Lịch sử đơn SMM | `routes/orders.js` |
| `votri-support.js` | Ticket hỗ trợ | `routes/support.js` |
| `votri-deposit.js` | Nạp MoMo | `server.js` `/api/momo/*` |
| `profile-api.js` | Gọi API hồ sơ MySQL | `routes/profile.js` |
| `votri-profile.js` | UI hồ sơ: 2FA, thông báo, avatar, mật khẩu | `routes/profile.js` |
| `votri-guard.js` | ACL tab + throttle client sau đăng nhập | — |
| `votri-nav.js` | Tab sidebar (`showMainTab`) | — |
| `votri-smm.js` | Bảng giá, Mua ngay, tạo đơn SMM | `routes/smm.js` |
| `lib/api-rate-limits.js` | Rate limit API theo user/IP | — |
| **app.js** (còn lại) | Auth, dashboard charts, users admin, theme, `renderAllViews` | `server.js` auth/sync |

### Tách tiếp (ưu tiên)

1. `votri-auth.js` — login, register, OTP, reset password
2. `votri-users.js` — quản lý tài khoản (admin)
3. `votri-dashboard.js` — stats, charts, render table/cards fanpage

## Backend (`routes/`)

| File | Prefix |
|------|--------|
| `pages.js` | `/api/pages` |
| `orders.js` | `/api/orders` |
| `smm.js` | `/api/smm` |
| `support.js` | `/api/support` |
| `facebook-check.js` | `/api/check-page` |

| `lib/facebook-page-status.js` | Logic trạng thái page FB |

Phần auth/sync/admin vẫn trong `server.js` — có thể tách `routes/auth.js`, `routes/sync.js` sau.

## Thứ tự load script (`index.html`)

```
votri-core → page-status → pages-api → orders-page → votri-fanpages
→ votri-support → votri-deposit → profile-api → votri-guard → votri-nav → votri-smm → votri-profile → app.js
```
