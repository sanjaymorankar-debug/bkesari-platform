-- OPTIONAL: only for trying the sites on your own machine's MySQL 8.4+.
--   macOS:  brew install mysql && brew services start mysql
--           mysql -u root -p < 00_local_create_databases.sql
--   (or MySQL Workbench)
-- NOT for Hostinger: there, databases and users are created in hPanel -> Databases ->
-- MySQL Databases (see database/README.md), and phpMyAdmin cannot create them.
--
-- Replace every CHANGE_ME password before running. Each site gets its own database and
-- its own user that can touch only that database.

CREATE DATABASE IF NOT EXISTS bk_portal  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS bk_edu     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS bk_ladwani CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- ATIP's own database. Its schema is NOT in this folder: ATIP creates its 186
-- tables itself with `python main.py --init` once ATIP_DATABASE_URL points here
-- and config.json sets database.backend = "mysql" (see the ATIP repo's
-- docs/HOSTED_DEPLOYMENT.md).
CREATE DATABASE IF NOT EXISTS bk_atip    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'bk_portal'@'localhost'  IDENTIFIED BY 'CHANGE_ME_portal';
CREATE USER IF NOT EXISTS 'bk_edu'@'localhost'     IDENTIFIED BY 'CHANGE_ME_edu';
CREATE USER IF NOT EXISTS 'bk_ladwani'@'localhost' IDENTIFIED BY 'CHANGE_ME_ladwani';
CREATE USER IF NOT EXISTS 'bk_atip'@'localhost'    IDENTIFIED BY 'CHANGE_ME_atip';

GRANT ALL PRIVILEGES ON bk_portal.*  TO 'bk_portal'@'localhost';
GRANT ALL PRIVILEGES ON bk_edu.*     TO 'bk_edu'@'localhost';
GRANT ALL PRIVILEGES ON bk_ladwani.* TO 'bk_ladwani'@'localhost';
GRANT ALL PRIVILEGES ON bk_atip.*    TO 'bk_atip'@'localhost';
FLUSH PRIVILEGES;

-- Then load each site's scripts into its own database, in order, e.g.
--   mysql -u bk_edu -p bk_edu < ../edu/01_edu_schema.sql
--
-- One database per TIER as well as per site: dev, test and production never share
-- one (DEPLOY.md). On a local Mac, suffix them if you want more than one tier
-- side by side, e.g. bk_edu_dev / bk_edu_test.
