# 🌐 Tài Liệu Đặc Tả SMM API Gateway & Admin Control Panel

Tài liệu này mô tả chi tiết kiến trúc **SMM API Gateway động** và hệ thống **Admin Control Panel** được xây dựng cho Vô Tri Club. 

Hệ thống cho phép Admin cấu hình động 100% các nhà cung cấp API SMM khác nhau (như Bytemart SMM hoặc bất kỳ nhà cung cấp nào khác) thông qua cơ sở dữ liệu và giao diện quản trị mà không cần sửa đổi mã nguồn.

---

## ⚡ 1. Kiến Trúc SMM API Gateway

Hệ thống hoạt động như một **API Gateway (Proxy trung gian)** bảo mật:
1. **Bảo mật tối đa**: Ẩn giấu hoàn toàn API Key của các nhà cung cấp SMM trên máy chủ, tránh lộ thông tin ở Client.
2. **Cấu hình Động**: Toàn bộ Endpoint, Method, Headers, Parameters và Quy tắc Map trạng thái của 7 hành động cốt lõi được lưu trữ trong bảng cơ sở dữ liệu `smm_apis`.
3. **Log & Debug Realtime**: Tự động ghi nhận đầy đủ chi tiết cuộc gọi gồm: *Thời gian, API Name, Endpoint, Method, Request Body, Response Body và HTTP Status* vào bảng `smm_api_logs`.
4. **Nguyên tắc Chuyển Tiếp Nguyên Bản (100% Raw Response)**: Backend không can thiệp hay sửa đổi cấu trúc JSON phản hồi từ API gốc, chuyển tiếp 100% nguyên trạng về cho Client xử lý.
5. **Cơ chế Tự Động Fallback**: Nếu một hành động API chưa được cấu hình hoặc bị tắt (`Inactive`), hệ thống tự động Fallback về API gốc **Bytemart SMM** sử dụng cấu hình môi trường `.env` (`BYTEMART_API_URL`, `BYTEMART_API_KEY`).

---

## 📦 2. 7 Hành Động SMM Cốt Lõi Hỗ Trợ Động

Các hành động sau được đồng bộ động qua Gateway khi người dùng hoặc admin thực hiện thao tác:

| Action (`action_type`) | Vai Trò trong Hệ Thống | Placeholders Hỗ Trợ |
| :--- | :--- | :--- |
| `services` | Lấy danh sách dịch vụ, giá gốc, số lượng min/max | Không yêu cầu |
| `order` | Đặt đơn hàng mới trên API gốc | `{{serviceId}}`, `{{link}}`, `{{quantity}}`, `{{comments}}` |
| `status` | Kiểm tra trạng thái đơn hàng để cập nhật | `{{orders}}` (Danh sách ID đơn hàng) |
| `balance` | Kiểm tra số dư tài khoản đại lý API | Không yêu cầu |
| `cancel` | Gửi yêu cầu hủy đơn hàng loạt | `{{orders}}` |
| `refill` | Gửi yêu cầu bảo hành đơn hàng | `{{orders}}` hoặc `{{order}}` |
| `refill_status` | Kiểm tra trạng thái bảo hành của đơn hàng | `{{refills}}` hoặc `{{orders}}` |

### 🔄 Cơ Chế Thay Thế Placeholders Động
Trong cấu hình `params` (JSON) của API trong Database, Admin có thể định nghĩa các chuỗi giữ chỗ. API Gateway sẽ tự động thay thế chúng bằng dữ liệu thực tế do Client gửi lên:
- `{{serviceId}}`: ID dịch vụ SMM (ví dụ: `185`)
- `{{link}}`: Đường dẫn đích chạy dịch vụ (ví dụ: `https://facebook.com/profile`)
- `{{quantity}}`: Số lượng đặt mua (ví dụ: `1000`)
- `{{orders}}`: Danh sách mã đơn hàng gốc cách nhau bằng dấu phẩy (ví dụ: `12345,12346`)
- `{{comments}}`: Ghi chú bổ sung (nếu có)

---

## 🛠️ 3. Cơ Chế Custom Status Mapping

Mỗi nhà cung cấp API SMM trả về trạng thái đơn hàng bằng các từ khóa khác nhau (ví dụ: *Pending, In progress, Completed, Partial, Canceled, Failed*). 

Để đồng bộ chính xác với hệ thống Vô Tri Club, Admin có thể cấu hình trường **Status Mapping (JSON)**:
```json
{
  "Pending": "Pending",
  "In progress": "Processing",
  "Processing": "Processing",
  "Completed": "Completed",
  "Partial": "Completed",
  "Canceled": "Failed",
  "Failed": "Failed"
}
```
* **Cơ chế hoạt động**: Khi Gateway gọi API kiểm tra trạng thái đơn hàng (`action_type = status`), hệ thống sẽ đọc trạng thái gốc từ API phản hồi, đối chiếu qua bản đồ `status_mapping` của API đó và tự động cập nhật trạng thái đơn hàng trong database tương ứng thành 1 trong 4 trạng thái chuẩn của hệ thống: **Pending**, **Processing**, **Completed**, **Failed**.

---

## 🔐 4. Danh Sách Endpoint Quản Trị (Chỉ Dành Cho Admin)

Mọi yêu cầu quản trị SMM API đều yêu cầu quyền **Admin Role** và truyền Token xác thực qua Header `Authorization: Bearer <token>`.

### 1️⃣ Lấy Danh Sách Cấu Hình API
* **Endpoint**: `GET /api/smm/admin/apis`
* **Response**:
```json
{
  "success": true,
  "apis": [
    {
      "id": 1,
      "name": "Bytemart Check Balance",
      "provider": "Bytemart",
      "action_type": "balance",
      "endpoint": "https://smm.bytemart.io.vn/api/v2",
      "method": "POST",
      "status": "Active"
    }
  ]
}
```

### 2️⃣ Thêm Cấu Hình API Mới
* **Endpoint**: `POST /api/smm/admin/apis`
* **Body**:
```json
{
  "name": "Bytemart Order API",
  "provider": "Bytemart",
  "action_type": "order",
  "endpoint": "https://smm.bytemart.io.vn/api/v2",
  "method": "POST",
  "headers": "{\"Content-Type\": \"application/x-www-form-urlencoded\"}",
  "params": "{\"key\": \"20ae9********\", \"action\": \"add\", \"service\": \"{{serviceId}}\", \"link\": \"{{link}}\", \"quantity\": \"{{quantity}}\"}",
  "status_mapping": "{}",
  "status": "Active"
}
```

### 3️⃣ Cập Nhật Cấu Hình API
* **Endpoint**: `PUT /api/smm/admin/apis/:id`
* **Body**: Tương tự như thêm mới.

### 4️⃣ Xóa Cấu Hình API
* **Endpoint**: `DELETE /api/smm/admin/apis/:id`

### 5️⃣ Bật/Tắt Nhanh Trạng Thái API
* **Endpoint**: `POST /api/smm/admin/apis/:id/toggle`

### 6️⃣ Đọc Nhật Ký Logs Cuộc Gọi API Gateway (50 log gần nhất)
* **Endpoint**: `GET /api/smm/admin/apis/logs`

### 7️⃣ Gọi Chạy Thử Nghiệm API Thực Tế (Test Connection & Params)
* **Endpoint**: `POST /api/smm/admin/apis/:id/test`
* **Body**:
```json
{
  "customParams": "{\"key\":\"20ae9********\",\"action\":\"balance\"}"
}
```
* **Response**: Trả về chi tiết raw response, thời gian phản hồi (`duration`), endpoint thực gọi và trạng thái để Admin kiểm tra và tối ưu cấu hình.

---

## 💻 5. Tài Liệu Tham Khảo API Bytemart Gốc (Fallback Default)

Dưới đây là các cấu trúc Request & Response gốc của Bytemart SMM dùng làm tài liệu tham khảo cho Admin khi cấu hình các tham số:

### 🪙 Kiểm Tra Số Dư (API Check Balance)
* **Request Params**:
```json
{
  "key": "Your API key",
  "action": "balance"
}
```
* **Response**:
```json
{
  "balance": "100.84292",
  "currency": "VND"
}
```

### 📦 Đặt Hàng Mới (API Add Order)
* **Request Params**:
```json
{
  "key": "Your API key",
  "action": "add",
  "service": "{{serviceId}}",
  "link": "{{link}}",
  "quantity": "{{quantity}}"
}
```
* **Response**:
```json
{
  "order": 12345
}
```

### ❌ Hủy Đơn Hàng (API Cancel Orders)
* **Request Params**:
```json
{
  "key": "Your API key",
  "action": "cancel",
  "orders": "{{orders}}"
}
```
* **Response**:
```json
[
  {
    "order": 12345,
    "cancel": 1
  },
  {
    "order": 12346,
    "cancel": {
      "error": "Incorrect order ID"
    }
  }
]
```

### 🔄 Bảo Hành Đơn Hàng (API Refill)
* **Request Params**:
```json
{
  "key": "Your API key",
  "action": "refill",
  "orders": "{{orders}}"
}
```
* **Response**:
```json
[
  {
    "order": 12345,
    "refill": 901
  }
]
```

### 🔍 Kiểm Tra Trạng Thái Bảo Hành (API Refill Status)
* **Request Params**:
```json
{
  "key": "Your API key",
  "action": "refill_status",
  "refills": "{{refills}}"
}
```
* **Response**:
```json
[
  {
    "refill": 901,
    "status": "Completed"
  },
  {
    "refill": 902,
    "status": "Rejected"
  }
]
```