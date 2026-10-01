-- OPTIONAL: only for trying the sites on YOUR PC's MySQL 8.4 (e.g. with MySQL Workbench or
--   mysql -u root -p < 00_local_create_databases.sql
-- NOT for Hostinger: there, databases and users are created in hPanel -> Databases ->
-- MySQL Databases (see database/README.md), and phpMyAdmin cannot create them.
--
-- Replace every CHANGE_ME password before running. Each site gets its own database and
-- its own user that can touch only that database.

CREATE DATABASE IF NOT EXISTS bk_portal  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS bk_edu     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS bk_ladwani CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'bk_portal'@'localhost'  IDENTIFIED BY 'CHANGE_ME_portal';
CREATE USER IF NOT EXISTS 'bk_edu'@'localhost'     IDENTIFIED BY 'CHANGE_ME_edu';
CREATE USER IF NOT EXISTS 'bk_ladwani'@'localhost' IDENTIFIED BY 'CHANGE_ME_ladwani';

GRANT ALL PRIVILEGES ON bk_portal.*  TO 'bk_portal'@'localhost';
GRANT ALL PRIVILEGES ON bk_edu.*     TO 'bk_edu'@'localhost';
GRANT ALL PRIVILEGES ON bk_ladwani.* TO 'bk_ladwani'@'localhost';
FLUSH PRIVILEGES;

-- Then load each site's scripts into its own database, in order, e.g.
--   mysql -u bk_edu -p bk_edu < ..\edu\01_edu_schema.sql
