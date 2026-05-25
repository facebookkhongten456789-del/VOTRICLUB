/**
 * EmailJS — hỗ trợ 1 hoặc 2 tài khoản.
 * - default: OTP đăng ký, quên mật khẩu
 * - new_login: thông báo đăng nhập thiết bị lạ
 *
 * Nếu chỉ có 1 tài khoản: chỉ cần EMAILJS_PUBLIC_KEY / PRIVATE_KEY / SERVICE_ID
 * và các template ID; bỏ trống EMAILJS_NEW_LOGIN_PUBLIC_KEY (sẽ dùng chung).
 */
function getEmailJsConfig(purpose = 'default') {
    const main = {
        publicKey: process.env.EMAILJS_PUBLIC_KEY,
        privateKey: process.env.EMAILJS_PRIVATE_KEY,
        serviceId: process.env.EMAILJS_SERVICE_ID,
    };

    if (purpose === 'new_login') {
        const dedicated = process.env.EMAILJS_NEW_LOGIN_PUBLIC_KEY;
        if (dedicated) {
            return {
                publicKey: dedicated,
                privateKey:
                    process.env.EMAILJS_NEW_LOGIN_PRIVATE_KEY || process.env.EMAILJS_PRIVATE_KEY,
                serviceId:
                    process.env.EMAILJS_NEW_LOGIN_SERVICE_ID || process.env.EMAILJS_SERVICE_ID,
                templateId: process.env.EMAILJS_NEW_LOGIN_TEMPLATE_ID,
            };
        }
        return {
            ...main,
            templateId: process.env.EMAILJS_NEW_LOGIN_TEMPLATE_ID,
        };
    }

    return main;
}

function isEmailJsReady(purpose = 'default') {
    const c = getEmailJsConfig(purpose);
    const templateId =
        purpose === 'new_login'
            ? c.templateId
            : purpose === 'reset'
              ? process.env.EMAILJS_RESET_TEMPLATE_ID
              : process.env.EMAILJS_TEMPLATE_ID;
    return !!(
        c.publicKey &&
        c.privateKey &&
        c.serviceId &&
        c.publicKey !== 'your_public_key_here' &&
        c.privateKey !== 'your_private_key_here' &&
        (purpose === 'default' || purpose === 'reset' ? templateId : c.templateId)
    );
}

module.exports = { getEmailJsConfig, isEmailJsReady };
