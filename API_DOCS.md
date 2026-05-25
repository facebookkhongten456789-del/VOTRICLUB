# VÔ TRI CLUB - SYSTEM API Reference

Tài liệu này mô tả các endpoint của backend API để các hệ thống khác (hoặc chính frontend) có thể gọi và lấy dữ liệu báo cáo đầy đủ.

---

## 1. Kiểm tra sức khỏe Fanpage (Check Page API)

Endpoint này sử dụng Access Token (User Token hoặc Page Token) để lấy toàn bộ thông tin của một Fanpage từ Facebook Graph API, bao gồm trạng thái hoạt động, lượt theo dõi, bài viết gần nhất, và các hạn chế (nếu có).

**URL**: `/api/check-page`  
**Method**: `POST`  
**Content-Type**: `application/json`

### 1.1. Request Body

| Trường | Kiểu dữ liệu | Bắt buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `accessToken` | `string` | Có | Facebook Access Token (User Token có quyền đọc hoặc Page Access Token). |
| `pageId` | `string` | Không* | ID của Fanpage (VD: `1097305496803181`). |
| `url` | `string` | Không* | URL của Fanpage (VD: `https://facebook.com/votriclub`). Hệ thống sẽ tự trích xuất ID từ URL. |
| `pageName` | `string` | Không | Tên Fanpage dùng để tìm kiếm fallback trong Business Manager. |

*\* Lưu ý: Cần truyền ít nhất `pageId` hoặc `url` để hệ thống biết cần kiểm tra Fanpage nào.*

**Ví dụ Request:**
```json
{
  "accessToken": "EAA...",
  "pageId": "1097305496803181"
}
```

### 1.2. Response (Báo cáo đầy đủ)

API trả về một JSON Object chứa thông tin tổng hợp (`message`, `page`) và một object `report` chứa báo cáo phân tích chi tiết toàn bộ dữ liệu gọi từ Facebook.

**Ví dụ Response:**
```json
{
  "success": true,
  "message": "Hoạt Động · 895 follow/like · Post cuối: 2 ngày trước",
  "readSummary": "Page: VO TRI CLUB - Đỡ Suy Mỗi Ngày · ID: 1097305496803181 · Follow/Like: 895 · Đọc được: followers_count, name, id, is_published",
  "readFields": [
    "/1097305496803181?fields=followers_count",
    "is_published",
    "name",
    "posts"
  ],
  "skippedFields": [],
  "page": {
    "fbPageId": "1097305496803181",
    "name": "VO TRI CLUB - Đỡ Suy Mỗi Ngày",
    "followers": 895,
    "status": "Active",
    "isPublished": true,
    "verificationStatus": "not_verified",
    "lastCheck": "2026-05-24T09:20:00.000Z"
  },
  "report": {
    "mode": "me_accounts_then_page_id",
    "pageContext": {
      "pageId": "1097305496803181",
      "pageName": "VO TRI CLUB - Đỡ Suy Mỗi Ngày",
      "graphPath": "1097305496803181",
      "tokenType": "direct_lookup",
      "tokenHolderName": "Unknown",
      "managedPages": []
    },
    "alive": {
      "id": "1097305496803181",
      "name": "VO TRI CLUB - Đỡ Suy Mỗi Ngày",
      "followers_count": 895,
      "is_published": true,
      "link": "https://facebook.com/..."
    },
    "restrictions": {
      "hasRestrictions": false,
      "restrictions": []
    },
    "engagement": {
      "raw": [],
      "metrics": {}
    },
    "lastPost": {
      "post": {
        "id": "1097305496803181_123456",
        "message": "Nội dung bài viết...",
        "created_time": "2026-05-22T10:00:00+0000"
      },
      "posts": [...],
      "postCount": 1,
      "daysSincePost": 2,
      "isDead": false,
      "source": "1097305496803181/posts"
    },
    "warnings": [
      "Tra cứu trực tiếp thành công ID: 1097305496803181 (bỏ qua me/accounts)"
    ],
    "errors": []
  }
}
```

### 1.3. Cấu trúc Object `report` (Phân tích chi tiết)

*   `pageContext`: Thông tin về cách mà Token đã truy cập vào Page (bằng direct ID, từ BM, hay từ `me/accounts`).
*   `alive`: Dữ liệu gốc trả về từ Graph API của Fanpage (chứa `id`, `name`, `followers_count`, `is_published`).
*   `restrictions`: Phân tích tình trạng vi phạm/hạn chế quảng cáo của Fanpage (`hasRestrictions`: true/false).
*   `engagement`: Các chỉ số tương tác (Insight) nếu Token có quyền `read_insights`.
*   `lastPost`: Dữ liệu bài viết mới nhất để xác định Fanpage còn hoạt động hay bị bỏ hoang (`isDead`: true nếu lâu không đăng bài, `daysSincePost`: số ngày).
*   `warnings`: Các cảnh báo trong quá trình gọi API (không làm crash app nhưng cần chú ý).
*   `errors`: Các lỗi kĩ thuật (lỗi quyền, lỗi mạng) bị chặn lại trong quá trình quét.

---

## 2. Các API Khác (Xác thực & OTP)

*   `POST /api/send-otp`: Gửi mã OTP về Email. `body: { email }`
*   `POST /api/verify-otp`: Kiểm tra mã OTP. `body: { email, code }`
*   `POST /api/forgot-password`: Yêu cầu link/token reset mật khẩu. `body: { email }`
*   `POST /api/reset-password`: Đổi mật khẩu mới. `body: { token, newPassword }`
