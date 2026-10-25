#!/usr/bin/env bash
# Set up local PostgreSQL databases for the bkesari.com sites on this Mac, and
# point each app at them.
#
#   tools/setup_local_postgres.sh                       # repos next to this one
#   tools/setup_local_postgres.sh --projects ~/Projects # or name their folder
#   tools/setup_local_postgres.sh --no-migrate          # databases and settings only
#
# Needs PostgreSQL 13 or newer running on this Mac. With Homebrew:
#   brew install postgresql@16 && brew services start postgresql@16
#
# What it does:
#   1. Logs in to the PostgreSQL on this Mac as an administrator. With
#      Homebrew's PostgreSQL that is your own macOS user, with no password.
#   2. Creates one login role and one database per site. Each role owns only
#      its own database, and no other role may connect to it.
#   3. Writes those logins into each app's .env file. An existing .env is backed
#      up first and only its database lines (plus any empty secrets) change.
#   4. Creates the tables: runs each app's migrations, and seeds demo data into
#      a database that was empty.
#
#   | Site                        | Database             | Settings file              |
#   |-----------------------------|----------------------|----------------------------|
#   | Portal / Task Tracker       | bk_portal            | bkesari-platform/.env      |
#   | Education (edu/)            | bk_edu               | bkesari-platform/edu/.env  |
#   | LadWani                     | bk_ladwani           | (schema only: no app here) |
#   | ATIP                        | bk_atip              | (created, not switched on) |
#
# ATIP keeps its own SQLite file. Its PostgreSQL runtime is opt-in in ATIP's
# own config, so this script only makes the database ready; it never changes
# ATIP's config.
#
# Generated passwords are kept in ~/.bkesari_local_postgres.env (readable only
# by you). Re-running reuses them, so it is safe to run again at any time.
#
# Settings, all optional (environment variables):
#   PG_HOST / PG_PORT        the server (default 127.0.0.1 / 5432; --port works too)
#   PG_ADMIN_USER            an administrator role (default: your login name,
#                            which is what Homebrew's PostgreSQL creates)
#   PG_ADMIN_PASSWORD        its password, if it needs one (asked for otherwise)
#   PG_ADMIN_DB              database to connect to as the admin (default postgres)
#   PSQL_BIN                 the psql to use, if it is not found automatically
#   BK_DB_PREFIX             prefix for every database and role name (default bk_)
#
# Nothing leaves this Mac unless PG_HOST says so.
# Written for macOS's built-in bash 3.2.
set -euo pipefail

PROJECTS=""
MIGRATE=1
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"
ADMIN_USER="${PG_ADMIN_USER:-$(id -un)}"
ADMIN_DB="${PG_ADMIN_DB:-postgres}"
P="${BK_DB_PREFIX:-bk_}"
CREDS="$HOME/.bkesari_local_postgres.env"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --projects) PROJECTS="$2"; shift 2 ;;
        --no-migrate) MIGRATE=0; shift ;;
        --port) PG_PORT="$2"; shift 2 ;;
        -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
done

case "$P" in
    *[!a-z0-9_]*|"") echo "BK_DB_PREFIX may only hold lower-case letters, digits and _" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # bkesari-platform
[[ -n "$PROJECTS" ]] || PROJECTS="$(dirname "$HERE")"
PLATFORM="$PROJECTS/bkesari-platform"
[[ -d "$PLATFORM/portal" ]] || PLATFORM="$HERE"

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*"; }

# ---------------------------------------------------------------- find psql
PSQL=""
for c in "${PSQL_BIN:-}" "$(command -v psql 2>/dev/null || true)" \
         /opt/homebrew/opt/postgresql@16/bin/psql /usr/local/opt/postgresql@16/bin/psql \
         /opt/homebrew/opt/postgresql@17/bin/psql /usr/local/opt/postgresql@17/bin/psql \
         /opt/homebrew/bin/psql /usr/local/bin/psql \
         /Applications/Postgres.app/Contents/Versions/latest/bin/psql; do
    if [[ -n "$c" && -x "$c" ]]; then PSQL="$c"; break; fi
done
if [[ -z "$PSQL" ]]; then
    echo "Cannot find the psql command." >&2
    echo "Install PostgreSQL with:  brew install postgresql@16 && brew services start postgresql@16" >&2
    echo "If psql is somewhere else, run:  PSQL_BIN=/path/to/psql $0" >&2
    exit 1
fi

# ---------------------------------------------------------------- admin login
# The admin password, when one is needed, travels in PGPASSWORD for psql's
# own process only: never on a command line, never written to disk.
ADMIN_PW="${PG_ADMIN_PASSWORD:-}"
admin_sql() {  # [-d database] psql args...: run as the administrator
    local db="$ADMIN_DB"
    if [[ "${1:-}" == "-d" ]]; then db="$2"; shift 2; fi
    PGPASSWORD="$ADMIN_PW" PGCONNECT_TIMEOUT=10 "$PSQL" -X -q -At -v ON_ERROR_STOP=1 \
        -h "$PG_HOST" -p "$PG_PORT" -U "$ADMIN_USER" -d "$db" "$@"
}
site_sql() {   # user password database psql args...: run as a site's own role
    local user="$1" pw="$2" db="$3"; shift 3
    PGPASSWORD="$pw" "$PSQL" -X -q -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$user" -d "$db" "$@"
}

say "Connecting to PostgreSQL ($PSQL) at $PG_HOST:$PG_PORT as $ADMIN_USER"
if ! version="$(admin_sql -c 'SHOW server_version' 2>&1)"; then
    if [[ -z "$ADMIN_PW" && -t 0 ]]; then
        printf 'PostgreSQL password for %s: ' "$ADMIN_USER"
        IFS= read -r -s ADMIN_PW
        echo
        version="$(admin_sql -c 'SHOW server_version' 2>&1)" || {
            echo "$version" | sed 's/^/    /' >&2; exit 1; }
    else
        echo "$version" | sed 's/^/    /' >&2
        echo "    Could not log in as $ADMIN_USER. Check that PostgreSQL is running" >&2
        echo "    (brew services list) and, if it needs one, set PG_ADMIN_PASSWORD." >&2
        exit 1
    fi
fi
info "PostgreSQL $version"
if [[ "$(admin_sql -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")" != t ]]; then
    echo "    $ADMIN_USER is not a superuser, which creating roles and databases for other roles needs. Use one (PG_ADMIN_USER=...)." >&2
    exit 1
fi
major="${version%%.*}"
if [[ "$major" =~ ^[0-9]+$ ]] && (( major < 13 )); then
    echo "    PostgreSQL $version is too old: these apps need 13 or newer." >&2
    exit 1
fi

# ---------------------------------------------------------------- passwords
umask 077
[[ -f "$CREDS" ]] && . "$CREDS"
newpw() { openssl rand -hex 16; }
: "${BK_PORTAL_PASS:=$(newpw)}"
: "${BK_EDU_PASS:=$(newpw)}"
: "${BK_LADWANI_PASS:=$(newpw)}"
: "${BK_ATIP_PASS:=$(newpw)}"
cat > "$CREDS" <<EOF
# Local PostgreSQL logins for the bkesari.com sites, made by setup_local_postgres.sh.
# Host $PG_HOST, port $PG_PORT. Each role owns the database of the same name.
BK_PORTAL_PASS=$BK_PORTAL_PASS
BK_EDU_PASS=$BK_EDU_PASS
BK_LADWANI_PASS=$BK_LADWANI_PASS
BK_ATIP_PASS=$BK_ATIP_PASS
EOF
chmod 600 "$CREDS"

# ---------------------------------------------------------------- databases
db_exists()   { [[ "$(admin_sql -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]; }
table_count() {
    if db_exists "$1"; then
        admin_sql -d "$1" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    else
        echo 0
    fi
}
sql_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

say "Creating roles and databases"
add_site() {   # role password database...
    local role="$1" pw="$2" db; shift 2
    admin_sql -c "DO \$\$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$role') THEN
            ALTER ROLE \"$role\" WITH LOGIN PASSWORD $(sql_quote "$pw");
        ELSE
            CREATE ROLE \"$role\" WITH LOGIN PASSWORD $(sql_quote "$pw");
        END IF;
    END \$\$;"
    for db in "$@"; do
        if ! db_exists "$db"; then
            admin_sql -c "CREATE DATABASE \"$db\" OWNER \"$role\" ENCODING 'UTF8' TEMPLATE template0"
        fi
        # Only the owner (and administrators) may connect.
        admin_sql -c "REVOKE CONNECT ON DATABASE \"$db\" FROM PUBLIC; GRANT CONNECT ON DATABASE \"$db\" TO \"$role\""
    done
}
# Counted before anything is created, so "fresh" really means fresh.
EDU_FRESH=0; LADWANI_FRESH=0
[[ "$(table_count "${P}edu")" == 0 ]] && EDU_FRESH=1
[[ "$(table_count "${P}ladwani")" == 0 ]] && LADWANI_FRESH=1
add_site "${P}portal"  "$BK_PORTAL_PASS"  "${P}portal" "${P}portal_test"
add_site "${P}edu"     "$BK_EDU_PASS"     "${P}edu" "${P}edu_test"
add_site "${P}ladwani" "$BK_LADWANI_PASS" "${P}ladwani"
add_site "${P}atip"    "$BK_ATIP_PASS"    "${P}atip"
for db in "${P}portal" "${P}portal_test" "${P}edu" "${P}edu_test" "${P}ladwani" "${P}atip"; do
    info "$db ($(table_count "$db") tables)"
done

url() { printf 'postgresql://%s:%s@%s:%s/%s' "$1" "$2" "$PG_HOST" "$PG_PORT" "$3"; }

# ---------------------------------------------------------------- .env files
get_env() {    # file key -> value ('' if missing)
    awk -v k="$2" 'index($0, k"=")==1 { sub(/^[^=]*=/, ""); v=$0 } END { print v }' "$1"
}
set_env() {    # file key value: replace the KEY= line, or append one
    local tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/bkenv.XXXXXX")"
    awk -v k="$2" -v v="$3" '
        index($0, k"=")==1 { if (!done) print k"="v; done=1; next }
        { print }
        END { if (!done) print k"="v }' "$1" > "$tmp"
    cat "$tmp" > "$1"
    rm -f "$tmp"
}
unset_env() {  # file key: drop the KEY= line if there is one
    local tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/bkenv.XXXXXX")"
    awk -v k="$2" 'index($0, k"=")!=1' "$1" > "$tmp"
    cat "$tmp" > "$1"
    rm -f "$tmp"
}
set_if_empty() { [[ -n "$(get_env "$1" "$2")" ]] || set_env "$1" "$2" "$3"; }
BACKUPS="$HOME/.bkesari_env_backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
prepare_env() { # file template; sets CREATED=1 when the file is new
    local file="$1" template="$2" name
    if [[ -f "$file" ]]; then
        # Kept outside the repositories: a backup holds passwords, and only the
        # .env file itself is git-ignored.
        name="$(basename "$(dirname "$file")")$(basename "$file")"
        mkdir -p "$BACKUPS"
        cp "$file" "$BACKUPS/$name.$STAMP"
        info "backed up the existing $(basename "$(dirname "$file")")/$(basename "$file") to $BACKUPS/$name.$STAMP"
        CREATED=0
    else
        if [[ -n "$template" && -f "$template" ]]; then cp "$template" "$file"; else : > "$file"; fi
        CREATED=1
    fi
    chmod 600 "$file"
}

say "Pointing the apps at their databases"

# --- Portal (bkesari-platform) ---------------------------------------------
PORTAL_ENV="$PLATFORM/.env"
prepare_env "$PORTAL_ENV" ""
if [[ $CREATED == 1 ]]; then
    set_env "$PORTAL_ENV" PORT 3001
    set_env "$PORTAL_ENV" TRACKER_USER admin
    set_env "$PORTAL_ENV" TRACKER_PASSWORD "$(openssl rand -hex 8)"
    set_env "$PORTAL_ENV" ATIP_USER viewer
    set_env "$PORTAL_ENV" ATIP_PASSWORD "$(openssl rand -hex 8)"
    set_env "$PORTAL_ENV" ATIP_PUBLISH_TOKEN "$(openssl rand -hex 32)"
fi
# Left over from older setups, or copied from a Neon .env: a local
# setup uses the DB_* parts below, so neither URL may point anywhere else.
unset_env "$PORTAL_ENV" DB_CLIENT
unset_env "$PORTAL_ENV" SQLITE_PATH
unset_env "$PORTAL_ENV" DATABASE_URL
unset_env "$PORTAL_ENV" DATABASE_URL_UNPOOLED
set_env "$PORTAL_ENV" DB_HOST "$PG_HOST"
set_env "$PORTAL_ENV" DB_PORT "$PG_PORT"
set_env "$PORTAL_ENV" DB_NAME "${P}portal"
set_env "$PORTAL_ENV" DB_USER "${P}portal"
set_env "$PORTAL_ENV" DB_PASSWORD "$BK_PORTAL_PASS"
# The tracker tests (npm test) wipe their tables, so they get a database of their own.
set_env "$PORTAL_ENV" TEST_DATABASE_URL "$(url "${P}portal" "$BK_PORTAL_PASS" "${P}portal_test")"
info "bkesari-platform/.env -> ${P}portal (tests: ${P}portal_test)"

# --- Education (bkesari-platform/edu) --------------------------------------
EDU="$PLATFORM/edu"
EDU_ENV="$EDU/.env"
prepare_env "$EDU_ENV" "$EDU/.env.example"
if [[ $CREATED == 1 ]]; then
    # Local: served straight on 127.0.0.1:8001, not behind the hub's /edu.
    set_env "$EDU_ENV" APP_ENV local
    set_env "$EDU_ENV" APP_DEBUG true
    set_env "$EDU_ENV" APP_URL http://127.0.0.1:8001
fi
set_if_empty "$EDU_ENV" APP_KEY "base64:$(openssl rand -base64 32)"
set_env "$EDU_ENV" DB_CONNECTION pgsql
set_env "$EDU_ENV" DB_HOST "$PG_HOST"
set_env "$EDU_ENV" DB_PORT "$PG_PORT"
set_env "$EDU_ENV" DB_DATABASE "${P}edu"
set_env "$EDU_ENV" DB_USERNAME "${P}edu"
set_env "$EDU_ENV" DB_PASSWORD "$BK_EDU_PASS"
info "edu/.env -> ${P}edu (tests on PostgreSQL: ${P}edu_test, see TESTING.md)"

# ---------------------------------------------------------------- tables
if [[ $MIGRATE == 1 ]]; then
    say "Creating tables"

    # The portal creates its tables itself when it starts; doing it now means
    # they exist before then, and are owned by the portal's own role.
    site_sql "${P}portal" "$BK_PORTAL_PASS" "${P}portal" -f "$PLATFORM/portal/sql/schema.sql" -f "$PLATFORM/portal/sql/hub_schema.sql"
    info "${P}portal: $(table_count "${P}portal") tables"

    if command -v php >/dev/null 2>&1; then
        ( cd "$EDU"
          if [[ ! -d vendor ]]; then
              if command -v composer >/dev/null 2>&1; then
                  info "edu: composer install (first time only, takes a minute)"
                  composer install --no-interaction --quiet
              else
                  warn "composer not found: run 'composer install' in edu, then re-run this script"
                  exit 0
              fi
          fi
          if [[ $EDU_FRESH == 1 ]]; then
              php artisan migrate --seed --force --no-interaction
          else
              php artisan migrate --force --no-interaction
          fi )
        info "${P}edu: $(table_count "${P}edu") tables"
    else
        warn "php not found: run 'php artisan migrate --seed' in edu"
    fi

    LADWANI_SQL="$PLATFORM/database/ladwani"
    if [[ $LADWANI_FRESH == 1 && -f "$LADWANI_SQL/01_ladwani_schema.sql" ]]; then
        # As LadWani's own role, so it owns the tables it will later use.
        site_sql "${P}ladwani" "$BK_LADWANI_PASS" "${P}ladwani" -1 -f "$LADWANI_SQL/01_ladwani_schema.sql"
        site_sql "${P}ladwani" "$BK_LADWANI_PASS" "${P}ladwani" -1 -f "$LADWANI_SQL/02_ladwani_reference_data.sql"
    fi
    info "${P}ladwani: $(table_count "${P}ladwani") tables (schema and reference data only)"
    info "${P}atip: left empty -- ATIP keeps its SQLite file"
fi

# ---------------------------------------------------------------- summary
say "Done. Start each site with:"
info "Portal        cd $PLATFORM && node --env-file=.env portal/server.js -> http://localhost:3001"
info "Education     cd $EDU && php artisan serve --port=8001     -> http://127.0.0.1:8001"
info ""
info "Database passwords: $CREDS"
info "Look inside one:    psql \"$(url "${P}edu" '<password>' "${P}edu")\""
info "Portal logins (Task Tracker, ATIP viewer): $PORTAL_ENV"
