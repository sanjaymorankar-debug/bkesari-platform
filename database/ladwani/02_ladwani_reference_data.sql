-- Mi Ladwani reference data (production AND test): roles, relationship types, post types, settings.
-- Copied from D:\My_Code\miladwani-source\seed_reference_data.sql. Safe to re-run (INSERT IGNORE).

-- Reference data that prisma/seeds/seed.ts would normally create.
-- Safe to run multiple times (idempotent).
-- Run this in phpMyAdmin against your live database.

-- ── Roles ────────────────────────────────────────────────────────
INSERT IGNORE INTO roles (id, code, label, isSystem, createdAt) VALUES
(UUID(), 'MEMBER', 'Member', 1, NOW()),
(UUID(), 'KARTA', 'Family Head (Karta)', 1, NOW()),
(UUID(), 'OPERATOR', 'Operator', 1, NOW()),
(UUID(), 'ADMIN', 'Administrator', 1, NOW());

-- ── Relationship Types ───────────────────────────────────────────
INSERT IGNORE INTO relationship_types (id, code, label, inverseCode, genderApplicable, isSpouse, isActive, sortOrder) VALUES
(UUID(), 'father', 'Father', 'son', 'MALE', 0, 1, 0),
(UUID(), 'mother', 'Mother', 'son', 'FEMALE', 0, 1, 0),
(UUID(), 'son', 'Son', 'father', 'MALE', 0, 1, 0),
(UUID(), 'daughter', 'Daughter', 'father', 'FEMALE', 0, 1, 0),
(UUID(), 'husband', 'Husband', 'wife', 'MALE', 1, 1, 0),
(UUID(), 'wife', 'Wife', 'husband', 'FEMALE', 1, 1, 0),
(UUID(), 'brother', 'Brother', 'brother', 'MALE', 0, 1, 0),
(UUID(), 'sister', 'Sister', 'brother', 'FEMALE', 0, 1, 0),
(UUID(), 'grandfather_p', 'Grandfather (Paternal)', 'grandson', 'MALE', 0, 1, 0),
(UUID(), 'grandmother_p', 'Grandmother (Paternal)', 'grandson', 'FEMALE', 0, 1, 0),
(UUID(), 'grandson', 'Grandson', 'grandfather_p', 'MALE', 0, 1, 0),
(UUID(), 'granddaughter', 'Granddaughter', 'grandfather_p', 'FEMALE', 0, 1, 0),
(UUID(), 'uncle', 'Uncle', 'nephew', 'MALE', 0, 1, 0),
(UUID(), 'aunt', 'Aunt', 'nephew', 'FEMALE', 0, 1, 0),
(UUID(), 'nephew', 'Nephew', 'uncle', 'MALE', 0, 1, 0),
(UUID(), 'niece', 'Niece', 'uncle', 'FEMALE', 0, 1, 0),
(UUID(), 'son_in_law', 'Son-in-law', 'father_in_law', 'MALE', 0, 1, 0),
(UUID(), 'daughter_in_law', 'Daughter-in-law', 'father_in_law', 'FEMALE', 0, 1, 0),
(UUID(), 'father_in_law', 'Father-in-law', 'son_in_law', 'MALE', 0, 1, 0),
(UUID(), 'mother_in_law', 'Mother-in-law', 'son_in_law', 'FEMALE', 0, 1, 0);

-- ── Post Types ───────────────────────────────────────────────────
INSERT IGNORE INTO post_types (id, code, label, icon, requiresApproval, isActive) VALUES
(UUID(), 'GENERAL', 'General', '📌', 0, 1),
(UUID(), 'ANNOUNCEMENT', 'Announcement', '📢', 0, 1),
(UUID(), 'EVENT', 'Event', '🎉', 0, 1),
(UUID(), 'ACHIEVEMENT', 'Achievement', '🏆', 0, 1),
(UUID(), 'BIRTHDAY', 'Birthday', '🎂', 0, 1),
(UUID(), 'MARRIAGE', 'Marriage', '💒', 0, 1),
(UUID(), 'CONDOLENCE', 'Condolence', '🙏', 0, 1),
(UUID(), 'JOB', 'Job Opportunity', '💼', 0, 1),
(UUID(), 'BUSINESS', 'Business', '🏢', 0, 1),
(UUID(), 'LOST_FOUND', 'Lost & Found', '🔍', 0, 1);

-- ── Settings ─────────────────────────────────────────────────────
INSERT IGNORE INTO settings (id, `key`, value, description, updatedAt) VALUES
(UUID(), 'community.name', '"Ladwani Samaj"', 'Community display name', NOW()),
(UUID(), 'community.tagline', '"Our Community, Our Heritage, Our Future"', 'Community tagline', NOW());

-- The first administrator is set up by 03_ladwani_first_admin.sql.
