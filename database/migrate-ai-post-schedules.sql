-- Migration: Create ai_post_schedules table for Facebook Post scheduling
CREATE TABLE IF NOT EXISTS `ai_post_schedules` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`         INT NOT NULL,
    `page_id`         VARCHAR(80) NOT NULL,
    `page_name`       VARCHAR(255) NOT NULL,
    `content`         TEXT NOT NULL,
    `image_url`       TEXT DEFAULT NULL,
    `schedule_time`   TIME NOT NULL,
    `repeat_days`     VARCHAR(50) NOT NULL COMMENT 'Comma separated list of days: 0 for Sunday, 1-6 for Mon-Sat',
    `status`          VARCHAR(50) NOT NULL DEFAULT 'Active',
    `last_run_date`   DATE DEFAULT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
