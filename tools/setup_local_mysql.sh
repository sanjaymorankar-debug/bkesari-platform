#!/usr/bin/env bash
# Set up local MySQL databases for the bkesari.com sites on this Mac, and point
# each app at them.
#
#   tools/setup_local_mysql.sh                       # repos next to this one
#   tools/setup_local_mysql.sh --projects ~/Projects # or name their folder
#   tools/setup_local_mysql.sh --no-migrate          # databases and settings only
#
# What it does:
#   1. Logs in to the MySQL on this Mac as root. It asks for the root password
#      you chose when installing MySQL, once.
#   2. Creates one database and one user per site. Each user can touch only its
#      own database, and only from this Mac.
#   3. Writes those logins into each app's .env file. An existing .env is backed
#      up first and only its database lines (plus any empty secrets) change.
#   4. Creates the tables: runs each app's migrations, and seeds demo data into
#      a database that was empty.
#
#   | Site                        | Database             | Settings file              |
#   |-----------------------------|----------------------|----------------------------|
#   | Milk & Dairy (bkesari repo) | bk_milk, bk_milk_test| bkesari/.env               |
#   | Portal / Task Tracker       | bk_portal            | bkesari-platform/.env      |
#   | Education (edu/)            | bk_edu               | bkesari-platform/edu/.env  |
#   | LadWani                     | bk_ladwani           | (schema only: no app here) |
#   | ATIP                        | bk_atip              | (created, not switched on) |
#
# ATIP keeps its own SQLite file. Its MySQL runtime is still marked experimental,
# so this script only makes the database ready; it never changes ATIP's config.
#
# Generated passwords are kept in ~/.bkesari_local_mysql.env (readable only by
# you). Re-running reuses them, so it is safe to run again at any time.
#
# Nothing leaves this Mac: everything connects to 127.0.0.1.
# Written for macOS's built-in bash 3.2.
set -euo pipefail

PROJECTS=""
MIGRATE=1
MYSQL_PORT="${MYSQL_PORT:-3306}"
ROOT_USER="${MYSQL_ROOT_USER:-root}"
CREDS="$HOME/.bkesari_local_mysql.env"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --projects) PROJECTS="$2"; shift 2 ;;
        --no-migrate) MIGRATE=0; shift ;;
        --port) MYSQL_PORT="$2"; shift 2 ;;
        -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # bkesari-platform
[[ -n "$PROJECTS" ]] || PROJECTS="$(dirname "$HERE")"
PLATFORM="$PROJECTS/bkesari-platform"
[[ -d "$PLATFORM/portal" ]] || PLATFORM="$HERE"
MILK="$PROJECTS/bkesari"

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*"; }

# ---------------------------------------------------------------- find mysql
MYSQL=""
for c in "${MYSQL_BIN:-}" "$(command -v mysql 2>/dev/null || true)" \
         /usr/local/mysql/bin/mysql /opt/homebrew/bin/mysql /usr/local/bin/mysql \
         /opt/homebrew/opt/mysql/bin/mysql /opt/homebrew/opt/mysql@8.4/bin/mysql; do
    if [[ -n "$c" && -x "$c" ]]; then MYSQL="$c"; break; fi
done
if [[ -z "$MYSQL" ]]; then
    echo "Cannot find the mysql command." >&2
    echo "The installer from mysql.com puts it at /usr/local/mysql/bin/mysql." >&2
    echo "If yours is elsewhere, run:  MYSQL_BIN=/path/to/mysql $0" >&2
    exit 1
fi

# ---------------------------------------------------------------- root login
umask 077
ROOT_CNF="$(mktemp "${TMPDIR:-/tmp}/bkmysql.XXXXXX")"
trap 'rm -f "$ROOT_CNF"' EXIT

if [[ -z "${MYSQL_ROOT_PASSWORD+set}" ]]; then
    printf 'MySQL %s password (the one you set when installing MySQL): ' "$ROOT_USER"
    IFS= read -r -s MYSQL_ROOT_PASSWORD
    echo
fi
# Option-file values: escape backslashes and double quotes, then quote.
esc_pw="$(printf '%s' "$MYSQL_ROOT_PASSWORD" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
printf '[client]\nuser="%s"\npassword="%s"\nhost=127.0.0.1\nport=%s\n' \
    "$ROOT_USER" "$esc_pw" "$MYSQL_PORT" > "$ROOT_CNF"

root_sql() { "$MYSQL" --defaults-extra-file="$ROOT_CNF" --batch --skip-column-names "$@"; }

say "Connecting to MySQL ($MYSQL) at 127.0.0.1:$MYSQL_PORT"
if ! version="$(root_sql -e 'SELECT VERSION()' 2>&1)"; then
    echo "$version" | sed 's/^/    /' >&2
    echo "    Could not log in as $ROOT_USER. Check that MySQL is running" >&2
    echo "    (System Settings -> MySQL -> Start MySQL Server) and the password is right." >&2
    exit 1
fi
info "MySQL $version"

# ---------------------------------------------------------------- passwords
[[ -f "$CREDS" ]] && . "$CREDS"
newpw() { openssl rand -hex 16; }
: "${BK_MILK_PASS:=$(newpw)}"
: "${BK_PORTAL_PASS:=$(newpw)}"
: "${BK_EDU_PASS:=$(newpw)}"
: "${BK_LADWANI_PASS:=$(newpw)}"
: "${BK_ATIP_PASS:=$(newpw)}"
cat > "$CREDS" <<EOF
# Local MySQL logins for the bkesari.com sites, made by setup_local_mysql.sh.
# Host 127.0.0.1, port $MYSQL_PORT. Each user owns the database of the same name.
BK_MILK_PASS=$BK_MILK_PASS
BK_PORTAL_PASS=$BK_PORTAL_PASS
BK_EDU_PASS=$BK_EDU_PASS
BK_LADWANI_PASS=$BK_LADWANI_PASS
BK_ATIP_PASS=$BK_ATIP_PASS
EOF
chmod 600 "$CREDS"

# ---------------------------------------------------------------- databases
table_count() { root_sql -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$1'"; }

say "Creating databases and users"
SQL=""
add_site() {   # user password database...
    local user="$1" pw="$2"; shift 2
    local db
    for db in "$@"; do
        SQL+="CREATE DATABASE IF NOT EXISTS \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    done
    # localhost (the socket, and ::1) and 127.0.0.1 (TCP) are separate accounts to
    # MySQL. Never '%': that would let other machines on the network try to log in.
    local host
    for host in localhost 127.0.0.1; do
        SQL+="CREATE USER IF NOT EXISTS '$user'@'$host' IDENTIFIED BY '$pw';"
        SQL+="ALTER USER '$user'@'$host' IDENTIFIED BY '$pw';"
        for db in "$@"; do
            SQL+="GRANT ALL PRIVILEGES ON \`$db\`.* TO '$user'@'$host';"
        done
    done
}
add_site bk_milk    "$BK_MILK_PASS"    bk_milk bk_milk_test
add_site bk_portal  "$BK_PORTAL_PASS"  bk_portal
add_site bk_edu     "$BK_EDU_PASS"     bk_edu
add_site bk_ladwani "$BK_LADWANI_PASS" bk_ladwani
add_site bk_atip    "$BK_ATIP_PASS"    bk_atip
# Counted before anything is created, so "fresh" really means fresh.
MILK_FRESH=0; EDU_FRESH=0; LADWANI_FRESH=0
[[ "$(table_count bk_milk)" == 0 ]] && MILK_FRESH=1
[[ "$(table_count bk_edu)" == 0 ]] && EDU_FRESH=1
[[ "$(table_count bk_ladwani)" == 0 ]] && LADWANI_FRESH=1
root_sql -e "$SQL FLUSH PRIVILEGES;"
for db in bk_milk bk_milk_test bk_portal bk_edu bk_ladwani bk_atip; do
    info "$db ($(table_count "$db") tables)"
done

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

# --- Milk & Dairy (bkesari repo) -------------------------------------------
MILK_ENV=""
if [[ -f "$MILK/package.json" ]]; then
    MILK_ENV="$MILK/.env"
    prepare_env "$MILK_ENV" "$MILK/.env.example"
    if [[ $CREATED == 1 ]]; then
        # Local: served straight on localhost:3000, not behind the hub's /milk.
        set_env "$MILK_ENV" APP_ENV dev
        set_env "$MILK_ENV" BASE_URL http://localhost:3000
        set_env "$MILK_ENV" BASE_PATH ""
        set_env "$MILK_ENV" AUTH_URL http://localhost:3000
    fi
    set_env "$MILK_ENV" DB_HOST 127.0.0.1
    set_env "$MILK_ENV" DB_PORT "$MYSQL_PORT"
    set_env "$MILK_ENV" DB_NAME bk_milk
    set_env "$MILK_ENV" DB_USER bk_milk
    set_env "$MILK_ENV" DB_PASS "$BK_MILK_PASS"
    # The migration reads DATABASE_URL only, and it wins over DB_* everywhere,
    # so it is set too (this also replaces an old PostgreSQL URL).
    set_env "$MILK_ENV" DATABASE_URL "mysql://bk_milk:$BK_MILK_PASS@127.0.0.1:$MYSQL_PORT/bk_milk"
    set_env "$MILK_ENV" TEST_DATABASE_URL "mysql://bk_milk:$BK_MILK_PASS@127.0.0.1:$MYSQL_PORT/bk_milk_test"
    set_if_empty "$MILK_ENV" AUTH_SECRET "$(openssl rand -base64 32)"
    set_if_empty "$MILK_ENV" CRON_SECRET "$(openssl rand -hex 32)"
    set_if_empty "$MILK_ENV" PAN_ENCRYPTION_KEY "$(openssl rand -base64 32)"
    info "bkesari/.env -> bk_milk (tests: bk_milk_test)"
else
    warn "no bkesari repo at $MILK: skipped (clone it next to bkesari-platform, or pass --projects)"
fi

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
set_env "$PORTAL_ENV" DB_CLIENT mysql
set_env "$PORTAL_ENV" DB_HOST 127.0.0.1
set_env "$PORTAL_ENV" DB_PORT "$MYSQL_PORT"
set_env "$PORTAL_ENV" DB_NAME bk_portal
set_env "$PORTAL_ENV" DB_USER bk_portal
set_env "$PORTAL_ENV" DB_PASSWORD "$BK_PORTAL_PASS"
info "bkesari-platform/.env -> bk_portal"

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
set_env "$EDU_ENV" DB_CONNECTION mysql
set_env "$EDU_ENV" DB_HOST 127.0.0.1
set_env "$EDU_ENV" DB_PORT "$MYSQL_PORT"
set_env "$EDU_ENV" DB_DATABASE bk_edu
set_env "$EDU_ENV" DB_USERNAME bk_edu
set_env "$EDU_ENV" DB_PASSWORD "$BK_EDU_PASS"
info "edu/.env -> bk_edu"

# ---------------------------------------------------------------- tables
if [[ $MIGRATE == 1 ]]; then
    say "Creating tables"

    if [[ -n "$MILK_ENV" ]]; then
        if command -v npm >/dev/null 2>&1; then
            ( cd "$MILK"
              [[ -d node_modules ]] || { info "bkesari: npm ci (first time only, takes a minute)"; npm ci --silent; }
              npm run --silent db:migrate
              DATABASE_URL="mysql://bk_milk:$BK_MILK_PASS@127.0.0.1:$MYSQL_PORT/bk_milk_test" npm run --silent db:migrate
              if [[ $MILK_FRESH == 1 ]]; then npm run --silent db:seed; fi )
            info "bk_milk: $(table_count bk_milk) tables, bk_milk_test: $(table_count bk_milk_test) tables"
        else
            warn "npm not found: run 'npm ci && npm run db:migrate && npm run db:seed' in bkesari"
        fi
    fi

    info "bk_portal: the portal creates its tables itself when it starts"

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
        info "bk_edu: $(table_count bk_edu) tables"
    else
        warn "php not found: run 'php artisan migrate --seed' in edu"
    fi

    LADWANI_SQL="$PLATFORM/database/ladwani"
    if [[ $LADWANI_FRESH == 1 && -f "$LADWANI_SQL/01_ladwani_schema.sql" ]]; then
        root_sql bk_ladwani < "$LADWANI_SQL/01_ladwani_schema.sql"
        root_sql bk_ladwani < "$LADWANI_SQL/02_ladwani_reference_data.sql"
    fi
    info "bk_ladwani: $(table_count bk_ladwani) tables (schema and reference data only)"
    info "bk_atip: left empty -- ATIP keeps its SQLite file"
fi

# ---------------------------------------------------------------- summary
say "Done. Start each site with:"
[[ -n "$MILK_ENV" ]] && info "Milk & Dairy  cd $MILK && npm run dev                       -> http://localhost:3000"
info "Portal        cd $PLATFORM && node --env-file=.env portal/server.js -> http://localhost:3001"
info "Education     cd $EDU && php artisan serve --port=8001     -> http://127.0.0.1:8001"
info ""
info "Database passwords: $CREDS"
info "Portal logins (Task Tracker, ATIP viewer): $PORTAL_ENV"
