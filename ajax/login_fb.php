<?php
/************************************************
*                                              *
* MÃ NGUỒN ĐƯỢC CUNG CẤP BỞI TUANORI           *
* LIÊN HỆ QUA ZALO : 0812.665.001              *
* FACEBOOK : FB.COM/PHAMHOANGTUAN.YTB          *
* CODE BỞI TUẤN ORI IT                         *
* WEBSITE : TUANORI.VN OR TUANORI.COM          *
*                                              *
************************************************/

// Khởi chạy session để lưu trữ state OAuth
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}

// Lưu origin gốc từ client (để nhảy về đúng cổng/domain khi hoàn tất)
if (isset($_GET['origin'])) {
    $_SESSION['oauth_origin'] = $_GET['origin'];
}

// Lưu state gốc từ JS truyền vào (chỉ ở lượt gọi đầu tiên từ Dashboard, không có 'code')
if (isset($_GET['state']) && !isset($_GET['code'])) {
    $_SESSION['js_state'] = $_GET['state'];
}

// Tự động nhận diện Base URL của trang web (hỗ trợ proxy/ngrok)
$protocol = "http";
if ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') || 
    (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')) {
    $protocol = "https";
}
$host = $_SERVER['HTTP_HOST'];
$script_dir = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME']));
// Loại bỏ /ajax ở cuối nếu có
$base_dir = preg_replace('/\/ajax$/', '', $script_dir);
$base_url = $protocol . "://" . $host . rtrim($base_dir, '/') . '/';

// Tải file config.php
$config_loaded = false;
$config_paths = [
    $_SERVER['DOCUMENT_ROOT'] . '/config/config.php',
    __DIR__ . '/../config/config.php',
    __DIR__ . '/config/config.php',
    __DIR__ . '/config.php'
];
foreach ($config_paths as $path) {
    if (file_exists($path)) {
        require $path;
        $config_loaded = true;
        break;
    }
}

// Tải thư viện Facebook SDK Autoload
$sdk_loaded = false;
$sdk_paths = [
    $_SERVER['DOCUMENT_ROOT'] . '/ajax/Facebook/autoload.php',
    $_SERVER['DOCUMENT_ROOT'] . '/Facebook/autoload.php',
    __DIR__ . '/Facebook/autoload.php'
];
foreach ($sdk_paths as $path) {
    if (file_exists($path)) {
        require $path;
        $sdk_loaded = true;
        break;
    }
}

if (!$sdk_loaded) {
    echo "Lỗi: Không tìm thấy thư viện Facebook SDK tại /Facebook/autoload.php";
    exit;
}

// Kiểm tra xem đã cấu hình App Secret chưa
if (empty($fb_app_secret) || $fb_app_secret === 'YOUR_FACEBOOK_APP_SECRET') {
    echo "<div style='font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 50px auto; background: #ffebeb; border: 1px solid #ffcccc; border-radius: 8px;'>";
    echo "<h2 style='color: #d32f2f;'>Thiếu cấu hình Facebook App Secret!</h2>";
    echo "<p>Vui lòng mở file <code>config/config.php</code> và điền <strong>App Secret</strong> thực tế của ứng dụng Facebook của bạn.</p>";
    echo "<pre style='background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 4px;'>\$fb_app_secret = 'MÃ_BÍ_MẬT_APP_CỦA_BẠN';</pre>";
    echo "</div>";
    exit;
}

$fb = new Facebook\Facebook ([
  'app_id' => $fb_app_id,
  'app_secret' => $fb_app_secret,
  'default_graph_version' => 'v23.0',
]);

// Đường dẫn callback động (trùng khớp với file đang chạy hiện tại)
$domain = $protocol . "://" . $host . $_SERVER['SCRIPT_NAME'];
$helper = $fb->getRedirectLoginHelper();

if (isset($_GET['state'])) {
    $helper->getPersistentDataHandler()->set('state', $_GET['state']);
}

try {
    $accessToken = $helper->getAccessToken($domain);
} catch(Facebook\Exceptions\FacebookResponseException $e) {
    echo 'Graph returned an error: ' . $e->getMessage();
    exit;
} catch(Facebook\Exceptions\FacebookSDKException $e) {
    echo 'Facebook SDK returned an error: ' . $e->getMessage();
    exit;
}

if (!isset($accessToken)) {
    // Các quyền cần thiết cho hệ thống quản lý Fanpage & SMM (đã loại bỏ 'email' bị lỗi scope)
    $permissions = array('public_profile', 'pages_show_list', 'pages_read_engagement');
    $loginUrl = $helper->getLoginUrl($domain, $permissions);
    header("Location: " . $loginUrl);  
    exit;
}

// Đổi sang long-lived token
$oAuth2Client = $fb->getOAuth2Client();
if (!$accessToken->isLongLived()) {
    try {
        $accessToken = $oAuth2Client->getLongLivedAccessToken($accessToken);
    } catch (Facebook\Exceptions\FacebookSDKException $e) {
        echo 'Error getting long-lived access token: ' . $e->getMessage();
        exit;
    }
}

// Lấy Access Token dạng chuỗi
$token_value = $accessToken->getValue();

// Lấy thông tin cá nhân của User trên Server-side để tránh lỗi fetch client-side
$fb_user_name = '';
$fb_user_avatar = '';
try {
    $response = $fb->get('/me?fields=name,picture.type(large)', $token_value);
    $userNode = $response->getGraphUser();
    $fb_user_name = $userNode->getField('name');
    $picture = $userNode->getField('picture');
    if ($picture && isset($picture['data']['url'])) {
        $fb_user_avatar = $picture['data']['url'];
    }
} catch (Exception $e) {
    // Nếu lỗi, in lỗi chi tiết thay vì chuyển hướng âm thầm
    echo "<div style='font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 50px auto; background: #ffebeb; border: 1px solid #ffcccc; border-radius: 8px;'>";
    echo "<h2 style='color: #d32f2f;'>Lỗi xác thực Token Facebook!</h2>";
    echo "<p>Facebook Graph API trả về lỗi sau khi cố gắng xác minh tài khoản:</p>";
    echo "<pre style='background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 4px; white-space: pre-wrap;'>" . htmlspecialchars($e->getMessage()) . "</pre>";
    echo "<p><a href='javascript:history.back()' style='color: #0066cc; text-decoration: none;'>Quay lại thử lại</a></p>";
    echo "</div>";
    exit;
}

// Lấy state truyền ngược lại để client validate (dùng js_state đã lưu ban đầu)
$state = isset($_SESSION['js_state']) ? $_SESSION['js_state'] : '';

// Xác định URL điều hướng trở lại Dashboard
$target_origin = isset($_SESSION['oauth_origin']) ? $_SESSION['oauth_origin'] : $base_url;
$redirect_url = rtrim($target_origin, '/') . "/index.html#access_token=" . urlencode($token_value)
    . "&fb_name=" . urlencode($fb_user_name)
    . "&fb_avatar=" . urlencode($fb_user_avatar);
if (!empty($state)) {
    $redirect_url .= "&state=" . urlencode($state);
}

// Xóa session sau khi dùng xong
unset($_SESSION['oauth_origin']);
unset($_SESSION['js_state']);

header("Location: " . $redirect_url);
exit;
?>