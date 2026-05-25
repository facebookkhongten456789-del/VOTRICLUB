# Setup MySQL + phpMyAdmin để Quản lý Users & Nạp tiền

## Bối cảnh
Hiện tại toàn bộ dữ liệu users, tickets, pages đều lưu trong `localStorage` trên trình duyệt. Điều này có nghĩa:
- Mỗi trình duyệt có dữ liệu riêng biệt
- Xóa cache = mất toàn bộ dữ liệu
- Admin không thể quản lý users từ bên ngoài

Bạn yêu cầu setup **phpMyAdmin** để quản lý database thực sự cho users và nạp tiền.

---

## Phương án đề xuất: XAMPP (MySQL + phpMyAdmin bundle)

XAMPP là giải pháp đơn giản nhất trên Windows — cài 1 lần có luôn **MySQL + phpMyAdmin** sẵn.

> [!IMPORTANT]
> Máy bạn hiện **chưa có MySQL, XAMPP, WAMP, Docker** — cần cài XAMPP trước.

### Bước 1: Cài đặt XAMPP
- Tải XAMPP từ https://www.apachefriends.org/download.html
- Cài đặt → chỉ cần tick **MySQL** và **phpMyAdmin** (bỏ Apache nếu muốn dùng port 3000 của Node)
- Mở **XAMPP Control Panel** → Start **MySQL**
- Nếu bạn dùng XAMPP chỉ để dev, để lại `DB_HOST=localhost` và `DB_PORT=3306`
- Nếu bạn dùng database thực tế ở server khác, chỉnh lại `.env` sau khi cài xong
- Truy cập phpMyAdmin: `http://localhost/phpmyadmin`

### Bước 2: Tạo Database & Tables

Tôi sẽ tạo script SQL tự động tạo database `votri_club` với 3 bảng. Nếu cần dùng database thật, bạn có thể đổi tên database và thông số kết nối trong `.env` để trỏ tới MySQL thực tế.

#### Bảng `users`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | INT AUTO_INCREMENT | ID tự tăng |
| name | VARCHAR(100) | Họ tên |
| email | VARCHAR(150) UNIQUE | Email đăng nhập |
| phone | VARCHAR(20) | Số điện thoại |
| password | VARCHAR(255) | Mật khẩu (hash bcrypt) |
| role | ENUM('member','admin') | Vai trò |
| status | ENUM('Verified','Blocked') | Trạng thái |
| balance | DECIMAL(15,2) DEFAULT 0 | Số dư hiện tại |
| total_deposited | DECIMAL(15,2) DEFAULT 0 | Tổng nạp |
| ip | VARCHAR(45) | IP đăng ký |
| user_agent | TEXT | Trình duyệt |
| created_at | DATETIME | Ngày đăng ký |

#### Bảng `deposits`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | INT AUTO_INCREMENT | ID giao dịch |
| user_id | INT FK→users | User nạp tiền |
| amount | DECIMAL(15,2) | Số tiền |
| method | VARCHAR(50) | Phương thức (MoMo, Bank) |
| transaction_id | VARCHAR(100) | Mã giao dịch bên thứ 3 |
| status | ENUM('pending','completed','failed') | Trạng thái |
| created_at | DATETIME | Thời gian nạp |

#### Bảng `support_tickets`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | INT AUTO_INCREMENT | ID ticket |
| user_id | INT FK→users | User tạo ticket |
| title | VARCHAR(255) | Tiêu đề |
| topic | VARCHAR(50) | Chủ đề |
| order_id | VARCHAR(50) | Mã đơn hàng |
| status | ENUM('Open','Replied','Closed') | Trạng thái |
| created_at / updated_at | DATETIME | Timestamps |

#### Bảng `ticket_messages`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | INT AUTO_INCREMENT | ID tin nhắn |
| ticket_id | INT FK→tickets | Ticket ID |
| sender_id | INT FK→users | Người gửi |
| content | TEXT | Nội dung |
| created_at | DATETIME | Thời gian |

---

## Proposed Changes

### [NEW] database/init.sql
- Script SQL tạo database `votri_club`, 4 bảng trên, và seed tài khoản admin mặc định.

### [MODIFY] [.env](file:///c:/Users/PC/Downloads/Dashboard/.env)
- Thêm biến kết nối MySQL:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=votri_club
```
- Nếu bạn dùng database thật trên server khác, tùy chỉnh các giá trị này cho đúng thông tin MySQL thực tế.

### [MODIFY] [package.json](file:///c:/Users/PC/Downloads/Dashboard/package.json)
- Thêm dependencies: `mysql2` (driver MySQL cho Node.js), `bcryptjs` (hash mật khẩu)

### [NEW] database/db.js
- Module kết nối MySQL pool với `mysql2/promise`
- Export các helper functions: `query()`, `getUser()`, `createUser()`, v.v.

### [MODIFY] [server.js](file:///c:/Users/PC/Downloads/Dashboard/server.js)
- Thêm API endpoints mới:
  - `POST /api/auth/register` — Đăng ký user (lưu vào MySQL)
  - `POST /api/auth/login` — Đăng nhập (kiểm tra MySQL)
  - `GET /api/user/profile` — Lấy thông tin user
  - `GET /api/admin/users` — Admin xem danh sách users
  - `POST /api/admin/users/:id/block` — Admin khóa tài khoản
  - `GET /api/admin/deposits` — Admin xem lịch sử nạp
  - `POST /api/deposit/confirm` — Xác nhận nạp tiền (cộng balance)

### [MODIFY] [app.js](file:///c:/Users/PC/Downloads/Dashboard/app.js)
- Chuyển logic đăng ký/đăng nhập từ localStorage sang gọi API server
- Chuyển quản lý users (bảng accounts) sang fetch từ server
- Giữ nguyên giao diện — chỉ đổi data layer phía dưới

---

## Open Questions

> [!IMPORTANT]
> **Bạn đã cài XAMPP chưa?** Nếu chưa, bạn cần tải và cài trước khi tôi có thể tiếp tục. Tải tại: https://www.apachefriends.org/download.html
> 
> Sau khi cài xong, mở XAMPP Control Panel → Start **MySQL** → báo lại cho tôi.

> [!WARNING]
> Thay đổi này sẽ ảnh hưởng đến flow đăng ký/đăng nhập hiện tại. Các tài khoản trong localStorage cũ sẽ **không tự chuyển sang MySQL** — cần đăng ký lại hoặc tôi sẽ viết script migrate.

---

## Verification Plan

### Automated Tests
- Kiểm tra kết nối MySQL từ Node.js
- Test API endpoints bằng `curl` hoặc Invoke-WebRequest
- Kiểm tra phpMyAdmin hiển thị đúng dữ liệu

### Manual Verification
- Đăng ký user mới trên web → kiểm tra phpMyAdmin thấy record
- Admin đăng nhập → xem danh sách users trong phpMyAdmin
- Nạp tiền → kiểm tra bảng `deposits` và `balance` cập nhật
