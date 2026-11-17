#!/usr/bin/env bash
# Updates bkesari.com on the VPS (gk-db-1) to one bkesari-platform commit.
#
# Layout on the server (set up 17 Nov 2026; Caddy: /etc/caddy/sites/bkesari.caddy):
#   /var/www/bkesari/platform      the code, owned by user bkesari (not a git checkout)
#     .env                         the hub's settings (bkesari-platform.service EnvironmentFile)
#     .home                        that user's HOME for npm
#     node_modules, ladwani/...    packages and LadWani's build
#     edu/.env, edu/vendor, edu/storage   Education's settings, packages, files and logs
#   bkesari-platform.service       node portal/start.js on 127.0.0.1:3200 (hub, TaskList, LadWani)
#   php8.3-fpm, pool bkesari       Education (Caddy serves platform/edu/public on 127.0.0.1:8200)
#
# The new copy is made and built BESIDE the live one; only the switch touches the
# live site (two renames and a restart, a few seconds). The old copy is kept for
# "rollback". Nothing of GoKesari's (gk-site, Caddy, PostgreSQL) is touched. The
# build runs at low priority so GoKesari is not slowed. Settings are copied as
# files; no value is ever printed.
#
#   sudo bash update-bkesari.sh check    <commit>   what it would do; changes nothing
#   sudo bash update-bkesari.sh prepare  <commit>   download + build the new copy beside the live one
#   sudo bash update-bkesari.sh switch   <commit>   Education's migration, swap, restart, checks
#   sudo bash update-bkesari.sh link              the bkesari ID's day-one linking: dry run
#   sudo bash update-bkesari.sh link --apply      ...and write it
#   sudo bash update-bkesari.sh rollback          back to the copy before the last switch
#
# <commit> is a full 40-character commit of sanjaymorankar-debug/bkesari-platform.
set -euo pipefail

REPO=sanjaymorankar-debug/bkesari-platform
BASE=${BK_BASE:-/var/www/bkesari}
LIVE=$BASE/platform
OWNER=${BK_OWNER:-bkesari}
SERVICE=${BK_SERVICE:-bkesari-platform}
FPM=${BK_FPM:-php8.3-fpm}
PORT=${BK_PORT:-3200}
DRY=0

say() { printf '\n== %s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
# Runs a command as the site's user, with npm's HOME inside the given copy.
as_owner() { local home=$1; shift; sudo -u "$OWNER" env HOME="$home" PATH="$PATH" "$@"; }
# BK_SYSTEMCTL: a stand-in for systemctl, for rehearsing the script away from the server.
svc() { "${BK_SYSTEMCTL:-systemctl}" "$@"; }

need_commit() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die "give the full 40-character commit (git rev-parse origin/main), not '${1:-}'"
  SHA=$1; SHORT=${SHA:0:7}; NEW=$BASE/platform-new-$SHORT
}
[ "$(id -u)" = 0 ] || die "run it with sudo"
[ -d "$LIVE" ] || die "$LIVE is not there"
[ -f "$LIVE/.env" ] || die "$LIVE/.env is not there"

cmd=${1:-}; shift || true

case "$cmd" in
check)
  need_commit "${1:-}"; DRY=1
  say "Live: $LIVE at $(cat "$LIVE/.deployed-commit" 2>/dev/null || echo unknown); new: $SHORT"
  echo "prepare: download $REPO@$SHORT into $NEW, copy in .env, .home, node_modules,"
  echo "         ladwani's packages and env files, edu/.env and edu/vendor; npm run build:hostinger (nice 10)"
  echo "switch:  php artisan migrate --force (Education), then rename $LIVE -> $BASE/platform-prev-<old>-<time>,"
  echo "         $NEW -> $LIVE (moving edu/storage across), restart $SERVICE, php artisan optimize, reload $FPM"
  echo "checks:  http://127.0.0.1:$PORT/auth/sign-in is the bkesari ID's page; Education answers"
  for t in curl tar node npm php; do command -v "$t" >/dev/null || die "$t is missing"; done
  echo "tools:   curl tar node $(node -v) npm $(npm -v) php $(php -r 'echo PHP_VERSION;')"
  df -h "$BASE" | tail -1
  [ -e "$NEW" ] && echo "note: $NEW exists already (prepare will start it again)"
  echo "Nothing was changed."
  ;;

prepare)
  need_commit "${1:-}"
  say "1/4 Download $REPO@$SHORT into $NEW"
  rm -rf "$NEW"
  install -d -o "$OWNER" -g "$OWNER" "$NEW"
  if [ -n "${BK_TARBALL:-}" ]; then
    sudo -u "$OWNER" tar -xzf "$BK_TARBALL" -C "$NEW" --strip-components=1
  else
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | sudo -u "$OWNER" tar -xz -C "$NEW" --strip-components=1
  fi
  [ -f "$NEW/portal/server.js" ] && [ -f "$NEW/portal/access.js" ] || die "the download is not the bkesari ID release"

  say "2/4 Copy in what lives only on the server (settings, packages)"
  for p in .env .home node_modules edu/.env edu/vendor; do
    if [ -e "$LIVE/$p" ]; then rm -rf "${NEW:?}/$p"; cp -a "$LIVE/$p" "$NEW/$p"; echo "  $p"; fi
  done
  # LadWani's packages, and any env file of its own (it normally reads LADWANI_* from the hub's .env).
  while IFS= read -r -d '' d; do
    rel=${d#"$LIVE/"}; mkdir -p "$NEW/$(dirname "$rel")"; rm -rf "${NEW:?}/$rel"; cp -a "$d" "$NEW/$rel"; echo "  $rel"
  done < <(find "$LIVE/ladwani" -maxdepth 3 \( -name node_modules -type d -o -name '.env' -type f \) -not -path '*/node_modules/*' -print0 2>/dev/null)
  chown -R "$OWNER:$OWNER" "$NEW"

  say "3/4 Build (npm run build:hostinger: checks + LadWani's API and pages), low priority"
  ( cd "$NEW" && as_owner "$NEW/.home" nice -n 10 npm run build:hostinger ) || die "the build failed; the live site is untouched. Remove $NEW when done looking."

  say "4/4 Ready"
  echo "$SHORT" > "$NEW/.deployed-commit"; chown "$OWNER:$OWNER" "$NEW/.deployed-commit"
  echo "Built: $NEW. Next: sudo bash $0 switch $SHA"
  ;;

switch)
  need_commit "${1:-}"
  [ -f "$NEW/.deployed-commit" ] || die "run 'prepare $SHA' first"
  OLD=$BASE/platform-prev-$(cat "$LIVE/.deployed-commit" 2>/dev/null || echo old)-$(date +%Y%m%d-%H%M)

  say "1/5 Education: database migration (adds users.hub_role; the old code ignores it)"
  # Laravel's working folders (the download has them; a copy that was rolled back may not).
  for d in storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache; do
    mkdir -p "$NEW/edu/$d"
  done
  chown -R "$OWNER:$OWNER" "$NEW/edu/storage" "$NEW/edu/bootstrap/cache"
  ( cd "$NEW/edu" && as_owner "$NEW/.home" php artisan migrate --force )

  say "2/5 Swap: the old copy is kept as $OLD"
  # Education's files and logs move across, so nothing written since prepare is lost.
  if [ -d "$LIVE/edu/storage" ]; then rm -rf "${NEW:?}/edu/storage"; mv "$LIVE/edu/storage" "$NEW/edu/storage"; fi
  mv "$LIVE" "$OLD"
  mv "$NEW" "$LIVE"
  echo "$OLD" > "$BASE/.previous-platform"

  say "3/5 Restart the hub ($SERVICE)"
  svc restart "$SERVICE"

  say "4/5 Education: caches for the new code (php artisan optimize), reload $FPM"
  ( cd "$LIVE/edu" && as_owner "$LIVE/.home" php artisan optimize )
  svc reload "$FPM"

  say "5/5 Checks"
  ok=0
  for i in $(seq 1 30); do
    body=$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/auth/sign-in" 2>/dev/null || true)
    if printf '%s' "$body" | grep -q 'data-signin'; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" = 1 ]; then echo "  hub: /auth/sign-in is the bkesari ID's page"; else
    echo "  hub: NOT answering with the new sign-in page after 60 s."
    echo "  Look: journalctl -u $SERVICE -n 50 --no-pager"
    echo "  Undo: sudo bash $0 rollback"; exit 1; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/edu/" || true)
  echo "  /edu/ through the hub answers $code (302 to sign-in is right for a visitor)"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Host: 127.0.0.1' "http://127.0.0.1:8200/" || true)
  echo "  Education itself answers $code"
  echo "Done: bkesari.com runs $SHORT. The previous copy: $OLD (remove it after a few days)."
  ;;

link)
  # The hub's .env names the hub, TaskList and LadWani databases; Education's comes from edu/.env.
  # Read inside Node, so no address or password is ever on a command line.
  apply=""; [ "${1:-}" = "--apply" ] && apply="--apply"
  ( cd "$LIVE" && as_owner "$LIVE/.home" node --env-file=.env --input-type=module -e '
    import fs from "node:fs"; import { parseEnv } from "node:util";
    const { main } = await import(process.cwd() + "/tools/link_accounts_to_hub.mjs");
    const env = { ...process.env };
    try {
      const e = parseEnv(fs.readFileSync("edu/.env", "utf8"));
      if (e.DB_URL) env.EDU_DATABASE_URL = e.DB_URL;
      else if ((e.DB_CONNECTION || "") === "pgsql" && e.DB_DATABASE) {
        const u = new URL("postgresql://x");
        u.hostname = e.DB_HOST || "127.0.0.1"; u.port = e.DB_PORT || "5432"; u.pathname = "/" + e.DB_DATABASE;
        u.username = e.DB_USERNAME || ""; u.password = e.DB_PASSWORD || "";
        env.EDU_DATABASE_URL = u.toString();
      }
    } catch { /* no edu/.env: Education is left out */ }
    if (!env.EDU_DATABASE_URL) console.log("(Education database not found in edu/.env; it is left out)");
    process.exitCode = await main(process.argv.slice(1), env);
  ' -- $apply )
  ;;

rollback)
  prev=$(cat "$BASE/.previous-platform" 2>/dev/null || true)
  [ -n "$prev" ] && [ -d "$prev" ] || die "no previous copy recorded"
  failed=$BASE/platform-failed-$(date +%Y%m%d-%H%M)
  say "Back to $prev (the current copy is kept as $failed)"
  if [ -d "$LIVE/edu/storage" ]; then rm -rf "${prev:?}/edu/storage"; mv "$LIVE/edu/storage" "$prev/edu/storage"; fi
  mv "$LIVE" "$failed"
  mv "$prev" "$LIVE"
  rm -f "$BASE/.previous-platform"
  svc restart "$SERVICE"
  ( cd "$LIVE/edu" && as_owner "$LIVE/.home" php artisan optimize ) || true
  svc reload "$FPM"
  echo "Rolled back. The database changes stay (they only add columns and tables; the old code ignores them)."
  ;;

*)
  sed -n '2,24p' "$0"; exit 2 ;;
esac
