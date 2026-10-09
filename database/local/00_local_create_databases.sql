-- OPTIONAL: only for trying the sites on your own machine's PostgreSQL (13 or newer).
--   macOS:  brew install postgresql@16 && brew services start postgresql@16
--           psql -d postgres -f 00_local_create_databases.sql
--   (Homebrew's PostgreSQL makes your macOS user a superuser, so no password is asked.)
-- tools/setup_local_postgres.sh does all of this for you, with generated passwords,
-- and also points each app at its database. Use this file when you want to do it by hand.
--
-- NOT for production: on a managed PostgreSQL service the provider's console creates
-- databases and users. (Hostinger's shared / cloud web hosting has no PostgreSQL at all;
-- see DEPLOY.md.)
--
-- Must be run with psql: it uses psql's \gexec, because PostgreSQL has no
-- CREATE DATABASE IF NOT EXISTS. Safe to re-run.
--
-- Replace every CHANGE_ME password before running. Each site gets its own database,
-- owned by its own login role, and nobody else may connect to it.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('bk_portal',  'CHANGE_ME_portal'),
      ('bk_edu',     'CHANGE_ME_edu'),
      ('bk_ladwani', 'CHANGE_ME_ladwani'),
      ('bk_atip',    'CHANGE_ME_atip')) AS t(name, pw)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.name) THEN
      EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r.name, r.pw);
    ELSE
      EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', r.name, r.pw);
    END IF;
  END LOOP;
END
$$;

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', d, d, 'UTF8')
FROM unnest(ARRAY['bk_portal', 'bk_edu', 'bk_ladwani',
                  -- ATIP's own database. Its schema is NOT in this folder: ATIP creates its
                  -- tables itself once ATIP_DATABASE_URL points here and its config opts in
                  -- to PostgreSQL (see the ATIP repo's docs/POSTGRESQL_MIGRATION.md).
                  'bk_atip']) AS d
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = d)
\gexec

-- Only each database's owner (and superusers) may connect to it.
REVOKE CONNECT ON DATABASE bk_portal, bk_edu, bk_ladwani, bk_atip FROM PUBLIC;
GRANT  CONNECT ON DATABASE bk_portal  TO bk_portal;
GRANT  CONNECT ON DATABASE bk_edu     TO bk_edu;
GRANT  CONNECT ON DATABASE bk_ladwani TO bk_ladwani;
GRANT  CONNECT ON DATABASE bk_atip    TO bk_atip;

-- Then load each site's scripts into its own database, in order, as that site's user, e.g.
--   psql -h 127.0.0.1 -U bk_edu -d bk_edu -v ON_ERROR_STOP=1 -f ../edu/01_edu_schema.sql
--
-- One database per TIER as well as per site: dev, test and production never share
-- one (DEPLOY.md). On a local Mac, suffix them if you want more than one tier
-- side by side, e.g. bk_edu_dev / bk_edu_test.
