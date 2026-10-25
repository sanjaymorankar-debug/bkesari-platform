#!/usr/bin/env bash
# HTTP smoke test for the Education app: the app on its own port, and the same
# app through the bkesari.com hub under /edu/ (TEST_SPEC.md, level S5).
#
#   APP=http://127.0.0.1:8101 HUB=http://127.0.0.1:3105 bash tests/smoke/http.sh
#
# Expects the app to be running with APP_URL=$HUB/edu against a database seeded
# by `php artisan db:seed` (the demo school is school 1), and the hub to be
# running with EDU_ORIGIN=$APP. Prints one PASS/FAIL line per check and exits
# non-zero if any check failed. Reads only; writes nothing.
set -uo pipefail
APP=${APP:-http://127.0.0.1:8101}
HUB=${HUB:-http://127.0.0.1:3105}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf 'PASS %s\n' "$*"; }
bad() { fail=$((fail+1)); printf 'FAIL %s\n' "$*"; }

# probe URL STATUS [TEXT]: the status, the text in the body, and no error page.
probe() {
  local url=$1 want=$2 needle=${3:-} code
  code=$(curl -s -o "$TMP/body" -w '%{http_code}' --max-time 30 "$url")
  if [[ "$code" != "$want" ]]; then bad "$url -> $code (want $want)"; return; fi
  if [[ -n "$needle" ]] && ! grep -qF -- "$needle" "$TMP/body"; then bad "$url -> $code but the body lacks '$needle'"; return; fi
  if grep -qiE 'whoops|SQLSTATE|Illuminate\\' "$TMP/body"; then bad "$url -> $code but the body is an error page"; return; fi
  ok "$url -> $code${needle:+ ('$needle')}"
}

# redirect URL LOCATION: a 302 to a location starting with LOCATION.
redirect() {
  local url=$1 want=$2 code loc
  read -r code loc < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 30 "$url")
  if [[ "$code" == 302 && "$loc" == "$want"* ]]; then ok "$url -> 302 $loc"; else bad "$url -> $code $loc (want 302 $want...)"; fi
}

echo "-- the app on its own port"
probe "$APP/up" 200
probe "$APP/" 200 'Education Accountability Platform'
probe "$APP/login" 200 'data-update-uri='
probe "$APP/schools" 200 'School Search'
probe "$APP/schools/1" 200 'What it costs'
probe "$APP/schools/1/improvement" 200 'Improvement over time'
probe "$APP/how-india-compares" 200 'There is no Indian PISA score on this page'

echo "-- through the hub under /edu/"
probe "$HUB/edu/" 200 'Education Accountability Platform'
probe "$HUB/edu/login" 200 'data-update-uri="/edu/livewire/update"'
probe "$HUB/edu/schools" 200 'School Search'
probe "$HUB/edu/schools/1" 200 'What it costs'
probe "$HUB/edu/how-india-compares" 200 'There is no Indian PISA score on this page'

# Every URL these pages write must stay under /edu: a bare /login or /build/...
# would take the visitor out of the tab and onto the hub.
for page in /edu/ /edu/login /edu/schools /edu/schools/1; do
  curl -s --max-time 30 "$HUB$page" > "$TMP/page"
  if python3 -I - "$TMP/page" "$HUB" <<'PY'
import re, sys
html = open(sys.argv[1]).read(); hub = sys.argv[2]
urls = re.findall(r'(?:href|src|action|data-update-uri)="([^"]*)"', html)
def ours(u):
    return (u.startswith('/edu/') or u == '/edu' or u.startswith(hub + '/edu')
            or u.startswith(('#', 'mailto:', 'tel:'))
            or re.match(r'https?://', u) and not u.startswith(hub))
escaping = [u for u in urls if not ours(u)]
for u in escaping:
    print('   escapes /edu:', u)
sys.exit(1 if escaping or not urls else 0)
PY
  then ok "every URL on $page carries /edu"; else bad "URLs on $page escape /edu (listed above)"; fi
done

# The stylesheet, script and Livewire's own script, fetched as the browser would.
curl -s --max-time 30 "$HUB/edu/login" > "$TMP/login"
assets=$(grep -oE '(src|href)="[^"]*(/build/assets/[^"]+|/livewire/livewire(\.min)?\.js[^"]*)"' "$TMP/login" \
  | sed -E 's/^(src|href)="//; s/"$//; s/&amp;/\&/g' | sort -u)
[[ -n "$assets" ]] || bad "no build assets or Livewire script found on /edu/login"
for asset in $assets; do
  [[ "$asset" == http* ]] || asset="$HUB$asset"
  probe "$asset" 200
done

echo "-- protected pages send a guest to the prefixed sign-in page"
for p in /dashboard /admin/rating-weights /admin/audit-log /privacy/queue /privacy/requests \
         /notifications /growth/1 /safeguarding /schools/1/safeguarding/report /complaints/create /profile; do
  redirect "$HUB/edu$p" "$HUB/edu/login"
done

echo "-- nothing private is served, through the hub or directly"
for p in /.env /.env.example /composer.json /composer.lock /artisan /storage/logs/laravel.log \
         /vendor/autoload.php /database/seeders/UserSeeder.php /phpunit.xml /../.env; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 --path-as-is "$HUB/edu$p")
  [[ "$code" == 404 || "$code" == 403 ]] && ok "hub /edu$p -> $code" || bad "hub /edu$p -> $code (want 404)"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 --path-as-is "$APP$p")
  [[ "$code" == 404 || "$code" == 403 || "$code" == 400 ]] && ok "app $p -> $code" || bad "app $p -> $code (want 404)"
done

echo "http smoke: $pass passed, $fail failed"
[[ $fail == 0 ]]
