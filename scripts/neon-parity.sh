#!/usr/bin/env bash
#
# Neon parity: runs the hub the way it runs on Neon, against a Neon-like local
# database, and checks the things that only show up there.
#
#   PARITY_POOLED_URL='postgresql://ROLE:PW@127.0.0.1:6432/DB?sslmode=require&channel_binding=require' \
#   PARITY_DIRECT_URL='postgresql://ROLE:PW@127.0.0.1:5432/DB?sslmode=require&channel_binding=require' \
#     bash scripts/neon-parity.sh
#
# Needs: a PostgreSQL with TLS (the DIRECT URL) and a PgBouncer in transaction
# mode in front of it that requires TLS (the POOLED URL), both reaching the
# same throwaway database, owned by ROLE, which must not be a superuser.
# THE DATABASE IS WIPED: the four tracker tables are dropped first. If the
# server certificate comes from a local CA, point NODE_EXTRA_CA_CERTS at it;
# nothing here turns certificate checks off. Also needs node, psql and curl.
#
# Without both URLs it says why and exits 0: the level is skipped, not passed.
# Never point it at Neon itself; TEST_SPEC.md (Neon parity) says why.
#
#   1. the role owns the database and is not a superuser
#   2. the tables are created over the DIRECT URL, as that role, over TLS
#   3. the hub serves the smoke test with its queries on the POOLED URL
#   4. the server drops the hub's connections while it is idle; the hub keeps
#      running and the next request works -- through the pooler, and again
#      with the hub connected directly, which is what Neon's suspend does to it

set -uo pipefail

POOLED="${PARITY_POOLED_URL:-}"
DIRECT="${PARITY_DIRECT_URL:-}"
PORT="${PARITY_PORT:-3101}"
# Idle long enough to be idle, but under pg's 10 s idleTimeoutMillis, after
# which the pool closes the connection itself and there is nothing to drop.
IDLE="${PARITY_IDLE_SECONDS:-3}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="http://127.0.0.1:$PORT"
U=parity; PW=parity-local-only; TOKEN=parity-local-token

if [ -z "$POOLED" ] || [ -z "$DIRECT" ]; then
  echo "Neon parity SKIPPED: set PARITY_POOLED_URL and PARITY_DIRECT_URL (TEST_SPEC.md, Neon parity)."
  exit 0
fi
case "$POOLED$DIRECT" in
  *neon.tech*) echo "Refusing: these checks wipe the database, and that is Neon." >&2; exit 2 ;;
esac
for tool in node psql curl; do
  command -v "$tool" >/dev/null || { echo "Neon parity BLOCKED: $tool is not installed." >&2; exit 2; }
done

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok    %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
sql() { PGOPTIONS='-c client_min_messages=warning' psql "$DIRECT" -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

LOG=$(mktemp); HUB=""
stop_hub() { [ -n "$HUB" ] && kill "$HUB" 2>/dev/null; wait "$HUB" 2>/dev/null; HUB=""; }
trap 'stop_hub; rm -f "$LOG"' EXIT

# start_hub <DATABASE_URL> [DATABASE_URL_UNPOOLED]
start_hub() {
  if curl -s -o /dev/null --max-time 2 "$BASE/"; then echo "        something is already listening on $PORT" >"$LOG"; return 1; fi
  : > "$LOG"
  ( cd "$ROOT" && exec env -u DB_HOST -u DB_PORT -u DB_NAME -u DB_USER -u DB_PASSWORD -u DB_SSL \
      DATABASE_URL="$1" DATABASE_URL_UNPOOLED="${2:-}" PORT="$PORT" APP_ENV=dev \
      TRACKER_USER=$U TRACKER_PASSWORD=$PW ATIP_USER=$U ATIP_PASSWORD=$PW ATIP_PUBLISH_TOKEN=$TOKEN \
      node portal/server.js ) >"$LOG" 2>&1 &
  HUB=$!
  for _ in $(seq 1 60); do
    grep -q 'running at' "$LOG" && return 0
    kill -0 "$HUB" 2>/dev/null || break
    sleep 0.5
  done
  return 1
}

# The role's other sessions, i.e. the hub's: ends them the way an idle
# compute's suspend does, and waits until they are gone.
drop_connections() {
  DROPPED=$(sql "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
                 WHERE usename = current_user AND pid <> pg_backend_pid()")
  for _ in $(seq 1 50); do
    [ "$(sql "SELECT count(*) FROM pg_stat_activity WHERE usename = current_user AND pid <> pg_backend_pid()")" = 0 ] && break
    sleep 0.1
  done
}

# survives <label>: idle, drop, then the hub must still be up and answer a read and a write.
survives() {
  curl -s -o /dev/null -u "$U:$PW" "$BASE/tasks/api/overview"   # make sure it holds a connection
  sleep "$IDLE"
  drop_connections
  if [ "${DROPPED:-0}" -gt 0 ]; then ok "$1: the server dropped $DROPPED idle connection(s) of $role"
  else bad "$1: the server dropped the hub's idle connections" "there were none to drop, so this proved nothing"; fi
  sleep 1
  if ! kill -0 "$HUB" 2>/dev/null; then
    bad "$1: the hub is still running after its connections were dropped" "it exited; last log lines: $(tail -3 "$LOG" | tr '\n' ' ')"
    return
  fi
  ok "$1: the hub is still running after its connections were dropped"
  local r w
  r=$(code -u "$U:$PW" "$BASE/tasks/api/overview")
  w=$(code -u "$U:$PW" -X POST -H 'content-type: application/json' -d '{"name":"after the drop"}' "$BASE/tasks/api/projects")
  if [ "$r" = 200 ] && [ "$w" = 201 ]; then ok "$1: the next read and write work ($r, $w)"
  else bad "$1: the next read and write work" "read answered $r, write $w"; fi
}

echo "Neon parity: pooled and direct URLs given; hub on $BASE"

echo; echo "The role"
facts=$(sql "SELECT r.rolsuper, d.datdba = r.oid, current_database(), current_user
             FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = current_database()") \
  || { echo "  FAIL  cannot connect over PARITY_DIRECT_URL"; exit 1; }
IFS='|' read -r super owner db role <<<"$facts"
[ "$super" = f ] && ok "$role is not a superuser" || bad "$role is not a superuser" "it is; Neon never gives an app one"
[ "$owner" = t ] && ok "$role owns $db" || bad "$role owns $db" "it does not; on Neon each app's role owns its database"
if [ "$(sql "SELECT pg_has_role(current_user, 'neon_superuser', 'member') FROM pg_roles WHERE rolname = 'neon_superuser'")" = t ]; then
  ok "$role is a member of neon_superuser, as Neon's roles are"
else
  printf '  info  no neon_superuser membership here; the portal creates no extensions, so it needs none\n'
fi

echo; echo "Tables created over the direct URL"
sql "DROP TABLE IF EXISTS comments, tasks, projects, atip_snapshots CASCADE" >/dev/null
if start_hub "$POOLED" "$DIRECT"; then
  ok "the hub starts on the pooled URL, with DATABASE_URL_UNPOOLED set"
else
  bad "the hub starts on the pooled URL" "$(tail -5 "$LOG" | tr '\n' ' ')"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"; exit 1
fi
grep -q 'tables set up over' "$LOG" && ok "it set the tables up over the direct URL" \
  || bad "it set the tables up over the direct URL" "the start-up log does not say so: $(head -3 "$LOG" | tr '\n' ' ')"
owned=$(sql "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema() AND tableowner = current_user
             AND tablename IN ('projects', 'tasks', 'comments', 'atip_snapshots')")
[ "$owned" = 4 ] && ok "all four tables exist, owned by $role" || bad "all four tables exist, owned by $role" "found $owned"

echo; echo "Over TLS"
# The pooled URL with TLS switched off must be refused; then the hub, which is
# connected to it, is necessarily encrypted. (The direct case is checked below.)
PLAIN=$(printf '%s' "$POOLED" | sed -e 's/sslmode=[a-z-]*/sslmode=disable/' -e 's/channel_binding=[a-z]*/channel_binding=disable/')
if psql "$PLAIN" -XAtqc 'SELECT 1' >/dev/null 2>&1; then
  bad "the pooled endpoint refuses a connection without TLS" "it accepted one, so nothing here proves the hub used TLS"
else
  ok "the pooled endpoint refuses a connection without TLS, so the hub's are encrypted"
fi

echo; echo "Smoke test, with every query on the pooled URL"
if out=$(bash "$ROOT/scripts/smoke-dev.sh" "$BASE" --env dev 2>&1); then
  ok "scripts/smoke-dev.sh passes ($(printf '%s\n' "$out" | grep -E '^[0-9]+ passed' | sed 's/\x1b\[[0-9;]*m//g'))"
else
  bad "scripts/smoke-dev.sh passes" "$(printf '%s\n' "$out" | grep -E 'FAIL' | sed 's/\x1b\[[0-9;]*m//g' | head -3 | tr '\n' ' ')"
fi
c=$(code -u "$U:$PW" -X POST -H 'content-type: application/json' -d '{"name":"parity"}' "$BASE/tasks/api/projects")
[ "$c" = 201 ] && ok "a project is saved through the pooler (201)" || bad "a project is saved through the pooler" "answered $c"
c=$(code -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"html":"<html><body>parity</body></html>"}' "$BASE/ATIP/api/snapshot")
[ "$c" = 200 ] && ok "an ATIP snapshot is stored through the pooler (200)" || bad "an ATIP snapshot is stored through the pooler" "answered $c"

echo; echo "Connections dropped while idle"
survives "pooled"
stop_hub
if start_hub "$DIRECT"; then
  curl -s -o /dev/null -u "$U:$PW" "$BASE/tasks/api/overview"
  tls=$(sql "SELECT count(*) FILTER (WHERE s.ssl), count(*) FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
             WHERE a.usename = current_user AND a.pid <> pg_backend_pid()")
  IFS='|' read -r enc total <<<"$tls"
  if [ "${total:-0}" -gt 0 ] && [ "$enc" = "$total" ]; then ok "direct: the hub's connections are encrypted ($enc of $total)"
  else bad "direct: the hub's connections are encrypted" "$enc of $total sessions"; fi
  survives "direct"
else
  bad "the hub starts on the direct URL" "$(tail -5 "$LOG" | tr '\n' ' ')"
fi
stop_hub

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] && echo "Neon parity passed." || { echo "Neon parity FAILED."; exit 1; }
