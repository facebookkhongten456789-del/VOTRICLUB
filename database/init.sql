-- ============================================
-- VÔ TRI CLUB - DATABASE SCHEMA
-- Chạy file này trong phpMyAdmin (tab SQL)
-- ============================================

CREATE DATABASE IF NOT EXISTS `votri_club`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `votri_club`;

-- -------------------------------------------
-- Bảng USERS: Quản lý tài khoản thành viên
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `name`            VARCHAR(100) NOT NULL,
    `email`           VARCHAR(150) NOT NULL UNIQUE,
    `phone`           VARCHAR(20) DEFAULT NULL,
    `password`        VARCHAR(255) NOT NULL COMMENT 'bcrypt hashed',
    `role`            ENUM('member','collaborator','distributor','admin') NOT NULL DEFAULT 'member',
    `status`          ENUM('Verified','Blocked') NOT NULL DEFAULT 'Verified',
    `block_reason`    VARCHAR(500) DEFAULT NULL COMMENT 'Lý do chặn hành vi (admin)',
    `blocked_at`      DATETIME DEFAULT NULL,
    `balance`         DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Số dư hiện tại (VND)',
    `total_deposited` DECIMAL(15,2) NOT NULL DEFAULT 0.00 COMMENT 'Tổng nạp (VND)',
    `ip`              VARCHAR(45) DEFAULT NULL,
    `user_agent`      TEXT DEFAULT NULL,
    `avatar_url`      MEDIUMTEXT DEFAULT NULL,
    `two_factor_enabled` TINYINT(1) NOT NULL DEFAULT 0,
    `two_factor_secret` VARCHAR(64) DEFAULT NULL,
    `notify_new_login` TINYINT(1) NOT NULL DEFAULT 1,
    `last_name_change` DATETIME DEFAULT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_email` (`email`),
    INDEX `idx_role` (`role`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng DEPOSITS: Lịch sử nạp tiền
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `deposits` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`         INT NOT NULL,
    `amount`          DECIMAL(15,2) NOT NULL,
    `method`          VARCHAR(50) NOT NULL DEFAULT 'MoMo' COMMENT 'MoMo, Bank, Manual',
    `transaction_id`  VARCHAR(100) DEFAULT NULL COMMENT 'Mã giao dịch từ cổng thanh toán',
    `status`          ENUM('pending','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
    `note`            TEXT DEFAULT NULL,
    `confirmed_by`    INT DEFAULT NULL COMMENT 'Admin ID xác nhận (nếu manual)',
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_status` (`status`),
    INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng SUPPORT_TICKETS: Yêu cầu hỗ trợ
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `support_tickets` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`         INT NOT NULL,
    `title`           VARCHAR(255) NOT NULL,
    `topic`           VARCHAR(50) NOT NULL DEFAULT 'Khác',
    `order_id`        VARCHAR(50) DEFAULT NULL,
    `status`          ENUM('Pending','Open','Replied','Closed') NOT NULL DEFAULT 'Pending',
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng TICKET_MESSAGES: Tin nhắn trong ticket
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `ticket_messages` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id`       INT NOT NULL,
    `sender_id`       INT NOT NULL,
    `content`         TEXT NOT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_ticket_id` (`ticket_id`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng ORDERS: Lịch sử đặt đơn SMM
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
    `id`              INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`         INT NOT NULL,
    `service_id`      INT NOT NULL COMMENT 'ID dịch vụ từ API SMM',
    `service_name`    VARCHAR(255) DEFAULT NULL,
    `link`            TEXT NOT NULL COMMENT 'Link mạng xã hội',
    `quantity`        INT NOT NULL,
    `charge`          DECIMAL(15,2) NOT NULL COMMENT 'Số tiền trừ',
    `external_order_id` VARCHAR(50) DEFAULT NULL COMMENT 'Order ID từ API SMM',
    `status`          VARCHAR(50) NOT NULL DEFAULT 'Pending',
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng FANPAGES: Quản lý trang Facebook
-- -------------------------------------------
CREATE TABLE IF NOT EXISTS `fanpages` (
    `id`          INT AUTO_INCREMENT PRIMARY KEY,
    `user_id`     INT NOT NULL,
    `name`        VARCHAR(255) NOT NULL,
    `niche`       VARCHAR(100) DEFAULT NULL,
    `tier`        VARCHAR(50) NOT NULL DEFAULT 'Tier 3',
    `status`      VARCHAR(50) NOT NULL DEFAULT 'Active',
    `followers`   INT NOT NULL DEFAULT 0,
    `url`         TEXT DEFAULT NULL,
    `fb_page_id`  VARCHAR(80) DEFAULT NULL,
    `last_check`  DATETIME DEFAULT NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB;

-- -------------------------------------------
-- Bảng USER_ACTIVITY_LOGS + USER_KNOWN_DEVICES (bảo mật hồ sơ)
-- -------------------------------------------
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

-- -------------------------------------------
-- SEED: Tài khoản Admin mặc định
-- Mật khẩu: Admin@123 (bcrypt hash)
-- -------------------------------------------
INSERT INTO `users` (`name`, `email`, `phone`, `password`, `role`, `status`, `balance`, `total_deposited`)
VALUES (
    'Admin VÔ TRI CLUB',
    'admin@votri.club',
    '0900000000',
    '$2b$10$H5FiqYSnJ84ZZLEGRktHQujAZk6dVqxJaDyCNm1nh08SNuGju/m.W',
    'admin',
    'Verified',
    999999999.00,
    0.00
)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
