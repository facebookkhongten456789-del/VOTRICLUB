-- Chặn tài khoản theo hành vi (đồng bộ admin + phpMyAdmin)
USE `votri_club`;

ALTER TABLE `users` ADD COLUMN `block_reason` VARCHAR(500) NULL COMMENT 'Lý do chặn hành vi';
ALTER TABLE `users` ADD COLUMN `blocked_at` DATETIME NULL;
