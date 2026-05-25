# HƯỚNG DẪN SETUP & SỬA LỖI ĐỒNG BỘ DỮ LIỆU XAMPP (MYSQL) VỚI NODE.JS

Hệ thống đã được cập nhật toàn bộ API endpoints kết nối trực tiếp với database MySQL của XAMPP. Dưới đây là các bước thiết lập chi tiết để deploy mượt mà và đảm bảo dữ liệu tài khoản (balance, support tickets, orders) luôn được cập nhật chính xác từ database hệ thống.

---

## 1. Yêu cầu Hệ thống
*   **XAMPP**: Đã chạy Apache và MySQL (mặc định cổng 3306).
*   **Node.js**: Phiên bản >= 16.
*   **Database**: MySQL Database tên `votri_club` đã được khởi tạo.

---

## 2. Các bước Thiết lập & Khởi chạy

### Bước 1: Kiểm tra cấu hình môi trường `.env`
Đảm bảo file `.env` ở thư mục gốc có thông tin kết nối MySQL chính xác:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=votri_club
```

### Bước 2: Import Cơ sở dữ liệu (Database Schema)
Bạn có thể khởi tạo database bằng 2 cách:
1.  **Cách tự động**: Chạy câu lệnh sau trong terminal/powershell để tự động import file `init.sql`:
    ```bash
    node database/setup.js
    ```
2.  **Cách thủ công**:
    *   Truy cập `http://localhost/phpmyadmin` trên trình duyệt.
    *   Tạo database mới tên là `votri_club` với mã hóa `utf8mb4_unicode_ci`.
    *   Chọn database `votri_club`, bấm vào tab **SQL**, copy toàn bộ nội dung trong file `database/init.sql` dán vào và bấm **Go (Chạy)**.

### Bước 3: Khởi động lại Server Node.js (Quan trọng)
Vì các tiến trình cũ có thể đang giữ cổng `3000` (EADDRINUSE), bạn cần tắt toàn bộ tiến trình Node cũ và chạy lại:

1.  **Tắt tiến trình cũ (trên Windows)**:
    Mở PowerShell với quyền Admin và chạy lệnh sau để giải phóng cổng 3000:
    ```powershell
    Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force
    ```
2.  **Chạy lại Server**:
    ```bash
    npm start
    ```
    *Hoặc nếu muốn chạy chế độ dev:*
    ```bash
    npm run dev
    ```

---

## 3. Cơ chế hoạt động của Luồng Đồng bộ Mới

Hệ thống đã loại bỏ hoàn toàn việc lưu trữ/kiểm tra tài khoản thông qua bộ nhớ đệm `localStorage` của trình duyệt vốn dễ bị mất đồng bộ khi người dùng chuyển đổi thiết bị hoặc xóa cache.

*   **Đăng ký (Register)**: Dữ liệu gửi lên được validate mã OTP tạo từ server, sau đó lưu trực tiếp vào bảng `users` trong MySQL.
*   **Đăng nhập (Login)**: Kiểm tra thông tin đăng nhập trực tiếp từ MySQL bằng thư viện an toàn `bcryptjs` (password hash).
*   **Quên mật khẩu (Forgot Password)**: Truy vấn trực tiếp email trong MySQL thông qua API `/api/auth/me` để gửi link reset mật khẩu thực, thay vì tìm kiếm trong `localStorage` của trình duyệt.
*   **Đồng bộ dữ liệu (Sync Data)**: Mỗi lần đăng nhập hoặc tải lại trang dashboard, client sẽ gọi API `/api/sync/data` để tải dữ liệu tài khoản, lịch sử nạp tiền (deposits) và hỗ trợ (tickets) trực tiếp từ database MySQL.
*   **Nạp tiền MoMo / Cộng tiền**: MoMo IPN Webhook `/api/webhooks/momo` sẽ tự động xử lý giao dịch và cộng tiền trực tiếp vào tài khoản trong MySQL.

---

## 4. Deploy lên Hosting/VPS thực tế

Khi bạn muốn deploy hệ thống này lên VPS hoặc Hosting chạy thực tế (không phải localhost):
1.  **Cập nhật APP_BASE_URL** trong file `.env` thành tên miền của bạn (ví dụ: `https://votri.club`).
2.  **Thay đổi thông tin Database** (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) tương ứng với MySQL trên VPS của bạn.
3.  **Cài đặt các gói phụ thuộc** bằng lệnh `npm install --production`.
4.  Dùng **PM2** để chạy server background liên tục:
    ```bash
    npm install -g pm2
    pm2 start server.js --name "votri-dashboard"
    pm2 save
    pm2 startup
    ```
5.  Mở cổng firewall cho port `3000` hoặc cấu hình **Nginx Reverse Proxy** để trỏ tên miền (cổng 80/443) về cổng `3000`.
