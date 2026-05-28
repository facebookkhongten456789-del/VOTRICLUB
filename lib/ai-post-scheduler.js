/**
 * Vô Tri Club - AI Post Scheduler Background Worker
 */

async function checkAndRunAiPostSchedules(dbQuery) {
    try {
        // Ensure table exists before querying
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS ai_post_schedules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                page_id VARCHAR(80) NOT NULL,
                page_name VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT DEFAULT NULL,
                schedule_time TIME NOT NULL,
                repeat_days VARCHAR(50) NOT NULL,
                specific_date DATE DEFAULT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'Active',
                last_run_date DATE DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_user_id (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `).catch(() => {});

        const now = new Date();
        // Chuyển đổi sang múi giờ Asia/Ho_Chi_Minh
        const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const dayOfWeek = vnTime.getDay(); // 0 (CN), 1-6 (T2-T7)
        const hours = String(vnTime.getHours()).padStart(2, '0');
        const minutes = String(vnTime.getMinutes()).padStart(2, '0');
        const todayStr = vnTime.toISOString().slice(0, 10); // YYYY-MM-DD

        // Tìm kiếm các lịch đăng bài hợp lệ trùng giờ/phút và ngày trong tuần, hoặc trùng ngày cố định, chưa chạy hôm nay
        const schedules = await dbQuery(
            `SELECT * FROM ai_post_schedules 
             WHERE status = 'Active' 
               AND TIME_FORMAT(schedule_time, '%H:%i') = ?
               AND (
                 (specific_date IS NULL AND FIND_IN_SET(?, repeat_days) > 0)
                 OR (specific_date = ?)
               )
               AND (last_run_date IS NULL OR last_run_date < ?)`,
            [`${hours}:${minutes}`, String(dayOfWeek), todayStr, todayStr]
        );

        for (const sched of schedules) {
            console.log(`[AI POST SCHEDULER] Đang chạy lịch đăng bài #${sched.id} cho trang ${sched.page_name} (${sched.page_id})`);

            // Đánh dấu đã chạy để tránh lặp lại (ngày cố định thì chuyển sang Completed)
            if (sched.specific_date) {
                await dbQuery(
                    `UPDATE ai_post_schedules SET last_run_date = ?, status = 'Completed' WHERE id = ?`,
                    [todayStr, sched.id]
                );
            } else {
                await dbQuery(
                    `UPDATE ai_post_schedules SET last_run_date = ? WHERE id = ?`,
                    [todayStr, sched.id]
                );
            }

            // Tiến hành đăng bài lên Facebook
            const token = process.env.FACEBOOK_ACCESS_TOKEN;
            if (token) {
                try {
                    // Lấy Page Access Token tương ứng
                    const accountsRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=access_token,id&access_token=${token}`);
                    const accountsData = await accountsRes.json();
                    
                    let pageToken = token;
                    if (accountsData && accountsData.data) {
                        const match = accountsData.data.find(a => String(a.id) === String(sched.page_id));
                        if (match && match.access_token) {
                            pageToken = match.access_token;
                            console.log(`[AI POST SCHEDULER] Tìm thấy Page Access Token cho trang ${sched.page_id}`);
                        }
                    }

                    // Gọi API đăng bài lên Facebook
                    let postRes;
                    if (sched.image_url) {
                        const path = require('path');
                        const fs = require('fs');
                        if (sched.image_url.startsWith('/uploads/')) {
                            // Local file binary upload
                            const localFilePath = path.join(__dirname, '..', sched.image_url);
                            if (fs.existsSync(localFilePath)) {
                                const fileBuffer = fs.readFileSync(localFilePath);
                                const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
                                
                                const formData = new FormData();
                                formData.append('source', blob, path.basename(localFilePath));
                                formData.append('message', sched.content);
                                
                                postRes = await fetch(`https://graph.facebook.com/v21.0/${sched.page_id}/photos?access_token=${pageToken}`, {
                                    method: 'POST',
                                    body: formData
                                });
                            } else {
                                console.warn(`[AI POST SCHEDULER] Không tìm thấy file ảnh cục bộ: ${localFilePath}`);
                                // Fallback to plain feed post if file missing
                                const postBody = new URLSearchParams();
                                postBody.append('message', sched.content);
                                postRes = await fetch(`https://graph.facebook.com/v21.0/${sched.page_id}/feed?access_token=${pageToken}`, {
                                    method: 'POST',
                                    body: postBody
                                });
                            }
                        } else {
                            // Remote image URL posting to photos
                            const postBody = new URLSearchParams();
                            postBody.append('message', sched.content);
                            postBody.append('url', sched.image_url);
                            
                            postRes = await fetch(`https://graph.facebook.com/v21.0/${sched.page_id}/photos?access_token=${pageToken}`, {
                                method: 'POST',
                                body: postBody
                            });
                        }
                    } else {
                        // Plain text feed post
                        const postBody = new URLSearchParams();
                        postBody.append('message', sched.content);
                        postRes = await fetch(`https://graph.facebook.com/v21.0/${sched.page_id}/feed?access_token=${pageToken}`, {
                            method: 'POST',
                            body: postBody
                        });
                    }
 
                    const postData = postRes ? await postRes.json() : null;
                    if (postData && (postData.id || postData.post_id)) {
                        console.log(`[AI POST SCHEDULER] Đã đăng thành công lên FB Page! ID: ${postData.id || postData.post_id}`);
                    } else {
                        console.error(`[AI POST SCHEDULER] Graph API trả về lỗi:`, postData);
                    }
                } catch (fbErr) {
                    console.error(`[AI POST SCHEDULER] Lỗi gọi API Facebook Graph:`, fbErr);
                }
            } else {
                console.log(`[AI POST SCHEDULER] [MÔ PHỎNG] Đăng bài thành công lên Fanpage "${sched.page_name}": ${sched.content.slice(0, 100)}...`);
            }
        }
    } catch (err) {
        console.error('[AI POST SCHEDULER] Lỗi trong tiến trình quét lịch đăng bài:', err);
    }
}

function startAiPostScheduler(dbQuery) {
    // Chạy kiểm tra mỗi phút
    setInterval(() => {
        checkAndRunAiPostSchedules(dbQuery);
    }, 60000);
    
    // Chạy thử 5 giây sau khi server khởi động
    setTimeout(() => {
        checkAndRunAiPostSchedules(dbQuery);
    }, 5000);
}

module.exports = { startAiPostScheduler };
