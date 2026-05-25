-- Vai trò: Thành viên / Cộng tác viên / Nhà phân phối / Quản trị viên
-- Chạy trong phpMyAdmin nếu server chưa tự ALTER
USE `votri_club`;

ALTER TABLE `users`
  MODIFY COLUMN `role`
  ENUM('member','collaborator','distributor','admin')
  NOT NULL DEFAULT 'member';
