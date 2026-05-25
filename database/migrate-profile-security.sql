-- Chạy trong phpMyAdmin (votri_club) nếu DB đã tồn tại từ trước
USE `votri_club`;

ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `avatar_url` MEDIUMTEXT NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `two_factor_enabled` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `two_factor_secret` VARCHAR(64) NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `notify_new_login` TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `last_name_change` DATETIME NULL;

-- MariaDB cũ không hỗ trợ IF NOT EXISTS trên ADD COLUMN — server tự migrate khi khởi động

CREATE TABLE IF NOT EXISTS `user_activity_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `action` VARCHAR(255) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Thành công',
    `ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `user_known_devices` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `device_hash` VARCHAR(64) NOT NULL,
    `device_label` VARCHAR(255) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `first_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_user_device` (`user_id`, `device_hash`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
