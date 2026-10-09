-- Central auth service: identity, roles, feature subscriptions, sessions,
-- OAuth/OIDC clients and the audit log. MySQL 8 / MariaDB 10.6+.
--
-- Every table is prefixed auth_ because these live in the main (Milk & Dairy)
-- database, which already has its own users / sessions / roles / audit_logs.
-- Applied by portal/auth/migrate.js, which records it in auth_schema_migrations.
-- Times are UTC DATETIME, written by the application.

CREATE TABLE IF NOT EXISTS auth_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(120) NULL,
  password_hash VARCHAR(100) NULL,
  email_verified_at DATETIME NULL,
  google_sub VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  totp_secret_enc VARCHAR(255) NULL,
  totp_enabled_at DATETIME NULL,
  totp_last_step BIGINT NULL,
  privacy_consent_at DATETIME NULL,
  privacy_version VARCHAR(20) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  last_login_at DATETIME NULL,
  UNIQUE KEY uq_auth_users_email (email),
  UNIQUE KEY uq_auth_users_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_roles (
  code VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_features (
  code VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  path VARCHAR(120) NULL,
  subscribable TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- feature_code is '' (not NULL) for roles that are not per-feature, so the
-- unique key also covers them: NULLs never collide in a UNIQUE index.
CREATE TABLE IF NOT EXISTS auth_user_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  feature_code VARCHAR(32) NOT NULL DEFAULT '',
  granted_by CHAR(36) NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_auth_user_roles (user_id, role_code, feature_code),
  CONSTRAINT fk_auth_user_roles_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_user_roles_role FOREIGN KEY (role_code) REFERENCES auth_roles(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  feature_code VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  starts_at DATETIME NULL,
  expires_at DATETIME NULL,
  source VARCHAR(16) NOT NULL,
  payment_provider VARCHAR(40) NULL,
  payment_ref VARCHAR(120) NULL,
  requested_at DATETIME NULL,
  decided_by CHAR(36) NULL,
  decided_at DATETIME NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_auth_subscriptions (user_id, feature_code),
  INDEX idx_auth_subscriptions_status (status),
  CONSTRAINT fk_auth_subscriptions_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_subscriptions_feature FOREIGN KEY (feature_code) REFERENCES auth_features(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  idle_expires_at DATETIME NOT NULL,
  mfa_at DATETIME NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_auth_sessions_token (token_hash),
  INDEX idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_oauth_clients (
  client_id VARCHAR(80) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  secret_hash CHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  tier VARCHAR(8) NOT NULL,
  feature_code VARCHAR(32) NULL,
  redirect_uris TEXT NULL,
  post_logout_redirect_uris TEXT NULL,
  backchannel_logout_uri VARCHAR(500) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_oauth_codes (
  code_hash CHAR(64) NOT NULL PRIMARY KEY,
  client_id VARCHAR(80) NOT NULL,
  user_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  redirect_uri VARCHAR(500) NOT NULL,
  code_challenge VARCHAR(128) NOT NULL,
  nonce VARCHAR(255) NULL,
  scope VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_auth_email_tokens_user (user_id),
  CONSTRAINT fk_auth_email_tokens_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only: the application never updates or deletes a row here.
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  at DATETIME NOT NULL,
  actor_user_id CHAR(36) NULL,
  subject_user_id CHAR(36) NULL,
  action VARCHAR(60) NOT NULL,
  feature_code VARCHAR(32) NULL,
  detail TEXT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  INDEX idx_auth_audit_at (at),
  INDEX idx_auth_audit_subject (subject_user_id),
  INDEX idx_auth_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO auth_roles (code, name, description) VALUES
  ('SUPER_ADMIN', 'Super admin', 'The owner. Assigned only from the server CLI.'),
  ('ADMIN', 'Admin', 'Manages users, roles and subscriptions.'),
  ('MODERATOR', 'Moderator', 'Moderates one feature.'),
  ('USER', 'User', 'A signed-up user.');

INSERT IGNORE INTO auth_features (code, name, path, subscribable) VALUES
  ('MILK_DAIRY', 'Milk & Dairy Products', '/milk/', 1),
  ('EDUCATION', 'Education', '/edu/', 1),
  ('LADWANI', 'LadWani', '/ladwani/', 1),
  ('TASKLIST', 'TaskList', '/tasks/', 1),
  ('AGTCI', 'AGTCI client area', 'https://agtci.com/client', 1)
