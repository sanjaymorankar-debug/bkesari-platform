#!/usr/bin/env bash
#
# Exercises guard.sh. Run with: bash .github/deploy/guard.test.sh
#
# The cases that must FAIL are the point of this file: they are the deploys
# that would publish dev's code to test or to production.

set -uo pipefail
cd "$(dirname "$0")"

pass=0
fail=0

# run <expect: ok|no> <description> <env assignments...>
run() {
  local expect="$1" desc="$2"; shift 2
  local out status
  out=$(env -i PATH="$PATH" "$@" bash ./guard.sh 2>&1); status=$?
  if { [ "$expect" = ok ] && [ $status -eq 0 ]; } ||
     { [ "$expect" = no ] && [ $status -ne 0 ]; }; then
    pass=$((pass + 1))
    printf 'ok    %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s\n      expected %s, got status %d: %s\n' \
      "$desc" "$expect" "$status" "$out"
  fi
}

# A complete, valid dev target. Each case below changes one thing.
ok=(
  DEV_SITE=dev.bkesari.com
  GITHUB_REF=refs/heads/dev
  DEPLOY_HOST=1.2.3.4
  DEPLOY_USER=u879099820
  DEPLOY_DIR=/home/u879099820/domains/dev.bkesari.com/app
  DEPLOY_KEY=key
  KNOWN_HOSTS=hostkey
)

run ok "a complete dev target is accepted" "${ok[@]}"
run ok "the site directory itself, with no subdirectory" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/dev.bkesari.com
run ok "a dev subdomain of its own (devedu)" \
  DEV_SITE=devedu.bkesari.com GITHUB_REF=refs/heads/dev DEPLOY_HOST=h \
  DEPLOY_USER=u DEPLOY_KEY=k KNOWN_HOSTS=kh \
  DEPLOY_DIR=/home/u879099820/domains/devedu.bkesari.com/platform
run ok "a matching smoke URL" \
  "${ok[@]}" SMOKE_URL=https://dev.bkesari.com/
run ok "a matching smoke URL with no trailing slash" \
  "${ok[@]}" SMOKE_URL=https://dev.bkesari.com

# --- The deploys that must never happen ------------------------------------

run no "production: the bare bkesari.com directory" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/bkesari.com/app
run no "production: bkesari.com as the final component" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/bkesari.com
run no "test tier" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/test.bkesari.com/app
run no "test tier of a project subdomain" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/testedu.bkesari.com/app
run no "gokesari.com, which this project must not touch" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/gokesari.com/app
run no "test.gokesari.com" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/test.gokesari.com/app
run no "climbing out of dev into production with .." \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/dev.bkesari.com/../bkesari.com
run no "a directory that merely starts with the dev site's name" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/dev.bkesari.com.old/app
run no "a directory that merely ends with it" \
  "${ok[@]}" DEPLOY_DIR=/home/u879099820/domains/olddev.bkesari.com/app
run no "a relative path" \
  "${ok[@]}" DEPLOY_DIR=domains/dev.bkesari.com/app
run no "the main branch" \
  "${ok[@]}" GITHUB_REF=refs/heads/main
run no "the staging branch" \
  "${ok[@]}" GITHUB_REF=refs/heads/staging
run no "a tag" \
  "${ok[@]}" GITHUB_REF=refs/tags/v1.0.0
run no "a smoke URL pointing at production" \
  "${ok[@]}" SMOKE_URL=https://bkesari.com/
run no "a smoke URL pointing at test" \
  "${ok[@]}" SMOKE_URL=https://test.bkesari.com/
run no "a smoke URL on a lookalike host" \
  "${ok[@]}" SMOKE_URL=https://dev.bkesari.com.evil.test/

# Check 4 is the belt for a future edit to DEV_SITE: even if a workflow were
# changed to call a non-dev site "dev", these targets still refuse.
run no "DEV_SITE edited to production" \
  DEV_SITE=bkesari.com GITHUB_REF=refs/heads/dev DEPLOY_HOST=h DEPLOY_USER=u \
  DEPLOY_KEY=k KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/bkesari.com/app
run no "DEV_SITE edited to production, site directory itself" \
  DEV_SITE=bkesari.com GITHUB_REF=refs/heads/dev DEPLOY_HOST=h DEPLOY_USER=u \
  DEPLOY_KEY=k KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/bkesari.com
run no "DEV_SITE edited to the test tier" \
  DEV_SITE=test.bkesari.com GITHUB_REF=refs/heads/dev DEPLOY_HOST=h DEPLOY_USER=u \
  DEPLOY_KEY=k KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/test.bkesari.com/app
run no "DEV_SITE edited to gokesari.com" \
  DEV_SITE=gokesari.com GITHUB_REF=refs/heads/dev DEPLOY_HOST=h DEPLOY_USER=u \
  DEPLOY_KEY=k KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/gokesari.com/app

# --- Missing configuration fails closed, it does not default ---------------

run no "no DEV_SITE" \
  GITHUB_REF=refs/heads/dev DEPLOY_HOST=h DEPLOY_USER=u DEPLOY_KEY=k \
  KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/dev.bkesari.com
run no "an empty deploy path" "${ok[@]}" DEPLOY_DIR=
run no "an empty host" "${ok[@]}" DEPLOY_HOST=
run no "an empty user" "${ok[@]}" DEPLOY_USER=
run no "an empty key" "${ok[@]}" DEPLOY_KEY=
run no "empty known_hosts" "${ok[@]}" KNOWN_HOSTS=
run no "no ref at all" \
  DEV_SITE=dev.bkesari.com DEPLOY_HOST=h DEPLOY_USER=u DEPLOY_KEY=k \
  KNOWN_HOSTS=kh DEPLOY_DIR=/home/u/domains/dev.bkesari.com

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
