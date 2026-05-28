-- ============================================
-- SMM SCHEDULES DATABASE TABLE
-- ============================================

USE `votri_club`;

CREATE TABLE IF NOT EXISTS `smm_schedules` (
    `id`             INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`        INT NOT NULL,
    `service_id`     INT NOT NULL,
    `service_name`   VARCHAR(255) NOT NULL,
    `links`          TEXT NOT NULL COMMENT 'JSON array of links',
    `quantity`       INT NOT NULL,
    `scheduled_time` DATETIME NOT NULL,
    `repeat_type`    ENUM('once', 'daily') NOT NULL DEFAULT 'once',
    `status`         ENUM('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    `result`         TEXT DEFAULT NULL,
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_schedules` (`user_id`),
    INDEX `idx_schedule_status` (`status`)
) ENGINE=InnoDB;
