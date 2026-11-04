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

# redirect URL LOCATION [STATUS]: a 302 (or STATUS) to a location starting with LOCATION.
redirect() {
  local url=$1 want=$2 status=${3:-302} code loc
  read -r code loc < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 30 "$url")
  if [[ "$code" == "$status" && "$loc" == "$want"* ]]; then ok "$url -> $code $loc"; else bad "$url -> $code $loc (want $status $want...)"; fi
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
probe "$HUB/edu/sign-in" 200 'This is a separate account for Education.'
probe "$HUB/edu/sign-up" 200 'This is a separate account for Education.'
probe "$HUB/edu/forgot-password" 200 'This is a separate account for Education.'

# Education's own accounts: the shell asks /edu/shell/me (401 for a guest,
# pointing at Education's own sign-in), and the session cookie is edu_sid,
# HttpOnly, SameSite=Lax, sent only to /edu.
code=$(curl -s -o "$TMP/me" -w '%{http_code}' --max-time 30 -H 'Accept: application/json' "$HUB/edu/shell/me")
if [[ "$code" == 401 ]] && python3 -I -c 'import json, sys; d = json.load(open(sys.argv[1])); sys.exit(0 if d.get("user") is None and d.get("signInUrl") == sys.argv[2] else 1)' "$TMP/me" "$HUB/edu/sign-in"; then
  ok "$HUB/edu/shell/me -> 401, sign in at /edu/sign-in"
else
  bad "$HUB/edu/shell/me -> $code $(head -c 200 "$TMP/me")"
fi
cookie=$(curl -s -o /dev/null -D - --max-time 30 "$HUB/edu/login" | grep -i '^set-cookie: edu_sid=' | tr -d '\r')
if [[ -n "$cookie" ]] && grep -qi 'path=/edu;' <<<"$cookie" && grep -qi 'httponly' <<<"$cookie" && grep -qi 'samesite=lax' <<<"$cookie"; then
  ok "edu_sid is set on /edu, HttpOnly, SameSite=Lax"
else
  bad "edu_sid cookie wrong or missing: ${cookie:-none}"
fi
redirect "$HUB/education/sign-in" "$HUB/edu/sign-in" 301

# Every URL these pages write must stay under /edu: a bare /login or /build/...
# would take the visitor out of the tab and onto the hub. The one exception is
# what the hub itself serves to every project: the Kesari design system
# (/kesari-ui/) and the app shell (/shared/menu.js).
for page in /edu/ /edu/login /edu/schools /edu/schools/1; do
  curl -s --max-time 30 "$HUB$page" > "$TMP/page"
  if python3 -I - "$TMP/page" "$HUB" <<'PY'
import re, sys
html = open(sys.argv[1]).read(); hub = sys.argv[2]
urls = re.findall(r'(?:href|src|action|data-update-uri)="([^"]*)"', html)
def ours(u):
    return (u.startswith('/edu/') or u == '/edu' or u.startswith(hub + '/edu')
            or u.startswith(('#', 'mailto:', 'tel:', '/kesari-ui/', '/shared/'))
            or re.match(r'https?://', u) and not u.startswith(hub))
escaping = [u for u in urls if not ours(u)]
for u in escaping:
    print('   escapes /edu:', u)
sys.exit(1 if escaping or not urls else 0)
PY
  then ok "every URL on $page carries /edu"; else bad "URLs on $page escape /edu (listed above)"; fi
done

# The stylesheet, script and Livewire's own script, and the hub's Kesari files
# and shell, fetched as the browser would.
curl -s --max-time 30 "$HUB/edu/login" > "$TMP/login"
assets=$(grep -oE '(src|href)="[^"]*(/build/assets/[^"]+|/livewire/livewire(\.min)?\.js[^"]*|/kesari-ui/[^"]+|/shared/menu\.js)"' "$TMP/login" \
  | sed -E 's/^(src|href)="//; s/"$//; s/&amp;/\&/g' | sort -u)
[[ -n "$assets" ]] || bad "no build assets or Livewire script found on /edu/login"
for asset in $assets; do
  [[ "$asset" == http* ]] || asset="$HUB$asset"
  probe "$asset" 200
done

echo "-- protected pages send a guest to the prefixed sign-in page"
for p in /dashboard /admin/rating-weights /admin/audit-log /privacy/queue /privacy/requests \
         /notifications /growth/1 /safeguarding /schools/1/safeguarding/report /complaints/create /profile /verify; do
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
