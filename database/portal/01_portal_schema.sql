-- bkesari.com portal database (Task Tracker + the ATIP read-only snapshot).
-- Same as portal/sql/mysql_schema.sql (the app also runs it on start). Safe to re-run.

-- Task Tracker schema for MySQL / MariaDB (Hostinger).
-- Safe to run more than once in phpMyAdmin: every statement is IF NOT EXISTS.
-- The app also runs this automatically on startup.

CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  owner VARCHAR(120) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Not Started',
  planned_start DATE NULL,
  planned_end DATE NULL,
  actual_start DATE NULL,
  actual_end DATE NULL,
  current_step TEXT NULL,
  next_step TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NULL,
  title VARCHAR(250) NOT NULL,
  description TEXT NULL,
  owner VARCHAR(120) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Not Started',
  planned_start DATE NULL,
  planned_end DATE NULL,
  actual_start DATE NULL,
  actual_end DATE NULL,
  current_step TEXT NULL,
  next_step TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_tasks_project (project_id),
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Status-update comments for both projects and tasks.
-- created_at is set by the server (UTC) at the moment the comment is posted.
CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(10) NOT NULL,
  entity_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_comments_entity (entity_type, entity_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Latest read-only ATIP dashboard page, pushed from the ATIP machine
-- by atip/publish_snapshot.py. Only the newest row is kept.
CREATE TABLE IF NOT EXISTS atip_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  html MEDIUMTEXT NOT NULL,
  trade_date VARCHAR(20) NULL,
  generated_at VARCHAR(40) NULL,
  received_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
