#!/usr/bin/env bash
#
# Smoke-tests a deployed tier over HTTP. Needs nothing but curl and the URL —
# no SSH, no credentials — so it can run from a laptop, from CI, or from the
# deploy workflow straight after it publishes.
#
#   bash scripts/smoke-dev.sh https://dev.bkesari.com
#   bash scripts/smoke-dev.sh https://dev.bkesari.com --env dev
#
# The tier is taken from the hostname unless --env says otherwise, and is
# checked against what the site reports about itself: a dev site that believes
# it is production is a configuration fault worth failing on, because the tier
# is what decides which database the app opens.
#
# Exit status: 0 when nothing FAILED. Warnings do not fail the run — they mark
# things that are safe but incomplete, such as a project not deployed yet.
#
# This covers only what a response can prove. The checks a human still has to
# make — the bar rendering correctly, the hamburger at phone width, a real
# login, a write reaching the right database — are in TESTING.md.

set -uo pipefail

BASE="${1:-${SMOKE_URL:-}}"
EXPECT_ENV="${SMOKE_ENV:-}"

case "${BASE:-}" in
  "" | -*)
    echo "usage: bash scripts/smoke-dev.sh <base-url> [--env dev|test|prod]" >&2
    echo "   eg: bash scripts/smoke-dev.sh https://dev.bkesari.com --env dev" >&2
    exit 2 ;;
esac

shift $(( $# > 0 ? 1 : 0 ))
while [ $# -gt 0 ]; do
  case "$1" in
    --env) EXPECT_ENV="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done


BASE="${BASE%/}"                       # one trailing slash policy, ours
HOST="${BASE#*://}"; HOST="${HOST%%/*}"; HOST="${HOST%%:*}"

# Mirror the rule in portal/public/shared/menu.js, so this script and the site
# agree on what tier a hostname means.
if [ -z "$EXPECT_ENV" ]; then
  case "$HOST" in
    dev.*|localhost|127.0.0.1) EXPECT_ENV=dev ;;
    test.*) EXPECT_ENV=test ;;
    *) EXPECT_ENV=prod ;;
  esac
fi

pass=0; fail=0; warn=0
BODY=$(mktemp); HEAD=$(mktemp)
trap 'rm -f "$BODY" "$HEAD"' EXIT

ok()     { pass=$((pass+1)); printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()    { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
caution(){ warn=$((warn+1)); printf '  \033[33mwarn\033[0m  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
group()  { printf '\n%s\n' "$1"; }

# fetch <path> -> sets STATUS, and fills $BODY and $HEAD. Never fails the script.
#
# -L follows redirects, so an http:// URL against a host that forces HTTPS is
# tested rather than reported as a wall of 301s. -D captures only the final
# response's headers, which is what the header checks want.
fetch() {
  STATUS=$(curl -sS -L --max-redirs 5 -o "$BODY" -D "$HEAD" -w '%{http_code}' \
    --max-time 20 --retry 2 --retry-connrefused \
    "$BASE$1" 2>/dev/null) || STATUS=000
}

# status <path> <description> <expected...>
status() {
  local p="$1" desc="$2"; shift 2
  fetch "$p"
  for want in "$@"; do
    if [ "$STATUS" = "$want" ]; then ok "$desc ($STATUS)"; return 0; fi
  done
  bad "$desc" "$p answered $STATUS, expected one of: $*"
  return 1
}

# contains <path> <needle> <description>
contains() {
  local p="$1" needle="$2" desc="$3"
  fetch "$p"
  if [ "$STATUS" != 200 ]; then
    bad "$desc" "$p answered $STATUS, so could not check for '$needle'"
  elif grep -qF -- "$needle" "$BODY"; then
    ok "$desc"
  else
    bad "$desc" "$p (200) does not contain '$needle'"
  fi
}

# With -L, curl appends one header block per hop, so take the LAST match:
# the headers of the response the body actually came from.
header() { tr -d '\r' < "$HEAD" | grep -i "^$1:" | tail -1 | cut -d' ' -f2-; }

echo "Smoke test: $BASE   (expecting tier: $EXPECT_ENV)"

# Reachability first, and stop here if it fails. Otherwise checks phrased as
# absences ("/.env is not served") pass against a site that is simply down,
# and a dead tier reports a handful of greens.
fetch /
if [ "$STATUS" = 000 ]; then
  printf '\n  \033[31mFAIL\033[0m  %s is not answering at all\n' "$BASE"
  printf '        No HTTP response. Check the site exists, DNS resolves, and the\n'
  printf '        Node app is running, then run this again.\n\n'
  echo "Smoke test FAILED. Do not promote this tier."
  exit 1
fi

# --- The hub itself --------------------------------------------------------
group "The hub"
status / "the welcome page is served" 200
contains / '/shared/menu.js' "the welcome page includes the shared menu"
# The bar is script-injected on static pages, so the <noscript> list is what
# proves every project is reachable without JavaScript.
contains / 'Driving Simulator' "the no-JavaScript fallback lists the projects"
status /shared/menu.js "the shared menu script is served" 200
status /shared/page.css "the shared stylesheet is served" 200

# A menu served as text/plain or text/html does not execute, and every page
# silently loses its bar.
fetch /shared/menu.js
CT=$(header content-type)
case "$CT" in
  *javascript*) ok "the menu script is served as JavaScript ($CT)" ;;
  "") caution "could not read the menu script's Content-Type" ;;
  *) bad "the menu script's Content-Type is wrong" "got '$CT'; browsers will refuse to execute it" ;;
esac

# --- Access control --------------------------------------------------------
# The most important checks here. /tasks/ fails OPEN by design when its
# credentials are unset (portal/server.js basicAuth, failClosed=false), which
# is right for a laptop and catastrophic on a public hostname: a 200 means
# anyone on the internet can read and edit the task tracker.
group "Access control"
# Under Neon Auth (NEON_AUTH_BASE_URL set) /tasks/ redirects to the sign-in
# page instead, and fetch follows redirects -- so a 200 that IS that page is
# the login working, not the tracker being open.
fetch /tasks/
case "$STATUS" in
  401) ok "the task tracker requires a login (401)" ;;
  200)
    if grep -q 'id="credForm"' "$BODY"; then
      ok "the task tracker requires a sign-in (Neon Auth sign-in page)"
    else
      bad "THE TASK TRACKER IS OPEN TO THE INTERNET" \
          "/tasks/ answered 200. Set TRACKER_USER and TRACKER_PASSWORD (or Neon Auth) on the server and redeploy."
    fi ;;
  *)   caution "/tasks/ answered $STATUS" "expected 401; check the site is fully deployed" ;;
esac

# The API under it, which both logins answer with 401 rather than a page.
fetch /tasks/api/overview
case "$STATUS" in
  401) ok "the task tracker API refuses an anonymous request (401)" ;;
  200) bad "THE TASK TRACKER API IS OPEN TO THE INTERNET" "/tasks/api/overview answered 200 with no login." ;;
  *)   caution "/tasks/api/overview answered $STATUS" "expected 401" ;;
esac

# /atip/ fails CLOSED (failClosed=true): 503 when unconfigured, never open.
fetch /atip/
case "$STATUS" in
  401) ok "the ATIP viewer requires a login (401)" ;;
  503) caution "the ATIP viewer is not configured yet (503)" \
                "set ATIP_USER and ATIP_PASSWORD on the server. It is refusing everyone, so this is safe." ;;
  200) bad "THE ATIP VIEWER IS OPEN TO THE INTERNET" "/atip/ answered 200 with no login." ;;
  *)   caution "/atip/ answered $STATUS" "expected 401, or 503 if not configured yet" ;;
esac

# The snapshot upload endpoint must never accept an unauthenticated POST.
# --location-trusted is deliberately NOT used: this request carries no
# credentials and must not start doing so across a redirect.
UP=$(curl -sS -L --max-redirs 5 -o /dev/null -w '%{http_code}' --max-time 20 \
  -X POST -H 'Content-Type: application/json' -d '{"html":"<p>smoke</p>"}' \
  "$BASE/atip/api/snapshot" 2>/dev/null) || UP=000
case "$UP" in
  401) ok "the ATIP upload endpoint rejects an unauthenticated POST (401)" ;;
  503) caution "the ATIP upload endpoint is not configured (503)" \
                "set ATIP_PUBLISH_TOKEN before pointing the ATIP machine at this tier." ;;
  2*)  bad "THE ATIP UPLOAD ENDPOINT ACCEPTED AN UNAUTHENTICATED POST" \
            "it answered $UP. Anyone could replace the published dashboard." ;;
  *)   caution "the ATIP upload endpoint answered $UP" "expected 401, or 503 if not configured" ;;
esac

# --- Which tier does the site think it is? ---------------------------------
# The placeholder page for an undeployed tab is server-rendered and carries the
# tier badge, so it reports the tier the app actually resolved — which is the
# same value that decides which database it opens.
group "Tier identity"
# The hub states its tier in a header. That value is the one the app resolves,
# and it is what decides which database every project on this tier opens — a
# site that thinks it is production while serving dev is the most expensive
# misconfiguration here, so it is checked rather than assumed.
fetch /
REPORTED=$(header x-bkesari-env)
if [ -z "$REPORTED" ]; then
  bad "the site does not report its tier" \
      "no X-Bkesari-Env header on /. Either this is an older deploy, or something in front of the app is stripping it."
elif [ "$REPORTED" = "$EXPECT_ENV" ]; then
  ok "the site reports itself as '$EXPECT_ENV'"
else
  bad "the site reports itself as '$REPORTED', not '$EXPECT_ENV'" \
      "The tier decides which database it opens. Check APP_ENV on the server before using this site."
fi

# A second, independent read of the same thing: the tier badge beside the
# brand. Only a tab with no app behind it can be used for this, because its
# placeholder is the one page the hub renders server-side without a login — so
# this is a bonus check when one is available, never a requirement.
for probe in /edu/ /ladwani/; do
  fetch "$probe"
  [ "$STATUS" = 404 ] || continue
  grep -qF 'not on this tier yet' "$BODY" || continue
  if [ "$EXPECT_ENV" = prod ]; then
    if grep -qF 'class="bk-env"' "$BODY"; then
      bad "the menu is wearing a tier badge on production" \
          "seen on $probe. APP_ENV or the hostname is making production look like a lower tier."
    else
      ok "the menu shows no tier badge on production"
    fi
  elif grep -qF "class=\"bk-env\">$EXPECT_ENV<" "$BODY"; then
    ok "the menu's tier badge agrees ('$EXPECT_ENV', seen on $probe)"
  else
    GOT=$(grep -o 'class="bk-env">[a-z]*<' "$BODY" | head -1 | sed 's/.*>\(.*\)</\1/')
    bad "the menu's tier badge reads '${GOT:-none}', not '$EXPECT_ENV'" \
        "seen on $probe. The header and the badge disagree, so one of them is wrong."
  fi
  break
done

# Non-production tiers must not be indexable: they carry the same real-looking
# content as production and would compete with it in search results.
fetch /
RB=$(header x-robots-tag)
if [ "$EXPECT_ENV" = prod ]; then
  case "$RB" in
    *noindex*) bad "production is telling search engines not to index it" "X-Robots-Tag: $RB" ;;
    *) ok "production is indexable" ;;
  esac
else
  case "$RB" in
    *noindex*) ok "this tier is not indexable (X-Robots-Tag: $RB)" ;;
    *) bad "this tier is indexable" \
           "no noindex on X-Robots-Tag. $EXPECT_ENV content will show up in search results." ;;
  esac
fi

# --- Nothing private is served ---------------------------------------------
# A misconfigured document root is the usual way a .env ends up public.
group "Nothing private is served"
for secret in /.env /.env.example /.git/config /package.json /portal/db.js /portal/server.js; do
  fetch "$secret"
  if [ "$STATUS" = 200 ]; then
    bad "$secret is publicly readable" "answered 200; fix the document root before anything else."
  else
    ok "$secret is not served ($STATUS)"
  fi
done

# --- The project tabs ------------------------------------------------------
# Each tab is either deployed (200) or honestly absent (404 + the placeholder
# that keeps the menu usable). Anything else means something is broken.
group "The project tabs"
for tab in /global-warming/ /driving-simulator/; do
  status "$tab" "$tab is served from the hub" 200
done
contains /environment/ 'shared/menu.js' "/environment/ carries the shared menu"
contains /driving-simulator/ 'shared/menu.js' "/driving-simulator/ carries the shared menu"

for tab in /ladwani/ /edu/; do
  fetch "$tab"
  # fetch follows redirects, so a protected project answers 200 from the sign-in page.
  if [ "$STATUS" = 200 ]; then
    ok "$tab is deployed and answering"
  elif [ "$STATUS" = 404 ] && grep -qF 'not on this tier yet' "$BODY"; then
    caution "$tab is not deployed on this tier yet" "the menu still works; it shows the placeholder."
  elif [ "$STATUS" = 404 ]; then
    # Neither the hub's placeholder nor the app: so an origin IS configured
    # for this tab, the hub forwarded the request, and the app answered 404.
    # Almost always the app is not serving itself under the prefix — a missing
    # basePath for a Next.js app, or APP_URL for Laravel. This is the likeliest
    # mistake when wiring a tab up, so it is named rather than left as a code.
    bad "$tab answered 404 from the app behind it, not from the hub" \
        "An origin is set for $tab, so the request reached the app and the app did not recognise the path. For /ladwani/ the app is probably not serving itself under $tab (Next.js basePath). For /edu/ the hub strips the prefix, so a 404 means the app has no route for the stripped path at all. See DEPLOY.md Part 7."
  else
    bad "$tab answered $STATUS" "expected 200, or 404 with the placeholder page."
  fi
done

# Education's prefix is stripped at the hub and put back by the app, so it can
# serve a perfect-looking 200 page in which every URL points at the hub. The
# loudest case is Livewire's endpoint: the sign-in form has no action of its own
# and posts there, so getting it wrong means nobody can sign in while the page
# itself looks completely healthy. A status code cannot see any of this.
fetch /edu/
if [ "$STATUS" = 200 ]; then
  if grep -qF 'data-update-uri="/edu/livewire/update"' "$BODY"; then
    ok "/edu/ points Livewire at its own endpoint, so the sign-in form can post"
  elif grep -qF 'data-update-uri="/livewire/update"' "$BODY"; then
    bad "NOBODY CAN SIGN IN TO /edu/ — Livewire is posting to the hub" \
        "The page carries data-update-uri=\"/livewire/update\" with no /edu prefix, so the sign-in form posts to the hub and silently does nothing. Set APP_URL=<origin>/edu on the Education site — see DEPLOY.md Part 7."
  else
    caution "/edu/ served no Livewire endpoint to check" "no data-update-uri in the page; the markup may have changed."
  fi

  if grep -qE 'src="[^"]*/edu/livewire/livewire(\.min)?\.js' "$BODY"; then
    ok "/edu/ loads Livewire's script from under its own path"
  else
    bad "/edu/ is loading Livewire's script from the wrong place" \
        "The script src is missing the /edu prefix, so it 404s at the hub and the page gets no Livewire at all — no sign-in form, no interactive page. Check APP_URL on the Education site."
  fi
fi

# --- Result ----------------------------------------------------------------
printf '\n%d passed, %d failed, %d warnings\n' "$pass" "$fail" "$warn"
if [ "$fail" -gt 0 ]; then
  echo "Smoke test FAILED. Do not promote this tier."
  exit 1
fi
[ "$warn" -gt 0 ] && echo "No failures. The warnings above are things still to finish, not faults."
echo "Smoke test passed."
