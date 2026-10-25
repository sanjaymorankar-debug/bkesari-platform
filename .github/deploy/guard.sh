#!/usr/bin/env bash
#
# Refuses any deploy target that is not the dev site.
#
# This is the piece that makes "dev only, never test or production" mechanical
# instead of a convention, so it lives in its own file and is exercised by
# guard.test.sh in CI. A deploy workflow runs it before it holds an SSH
# connection, a build artefact, or anything else worth losing.
#
# Reads from the environment:
#   DEV_SITE     the one hostname this deploy may ever write to (required)
#   GITHUB_REF   the ref being deployed; must be refs/heads/dev
#   DEPLOY_HOST  SSH host
#   DEPLOY_USER  SSH user
#   DEPLOY_DIR   absolute directory on the server, inside a $DEV_SITE directory
#                (each workflow maps its own per-site secret into this)
#   DEPLOY_KEY   SSH private key
#   KNOWN_HOSTS  pinned host key
#   SMOKE_URL    optional; must be an https URL on $DEV_SITE
#
# Exits 0 and prints the target when every check passes, otherwise prints a
# GitHub Actions error annotation and exits 1.

set -uo pipefail

fail() { echo "::error::$1" >&2; exit 1; }

[ -n "${DEV_SITE:-}" ] || fail "DEV_SITE is not set. This script cannot tell which site is dev."

# 1. Only the dev branch deploys. The workflows' push trigger already filters
#    this, but workflow_dispatch can be aimed at any branch from the UI.
[ "${GITHUB_REF:-}" = "refs/heads/dev" ] \
  || fail "Refusing to deploy ${GITHUB_REF:-<unset>}. Only refs/heads/dev deploys, and only to $DEV_SITE."

# 2. Every secret must be non-empty. An empty DEPLOY_DIR would otherwise mean
#    "the login directory", and an empty host would make rsync treat the
#    destination as a local path — both silent, both wrong.
[ -n "${DEPLOY_HOST:-}" ] || fail "The SSH host secret (DEV_SSH_HOST) is empty."
[ -n "${DEPLOY_USER:-}" ] || fail "The SSH user secret (DEV_SSH_USER) is empty."
[ -n "${DEPLOY_DIR:-}"  ] || fail "The deploy path secret is empty (DEPLOY_DIR)."
[ -n "${DEPLOY_KEY:-}"  ] || fail "The SSH key secret (DEV_SSH_KEY) is empty."
[ -n "${KNOWN_HOSTS:-}" ] || fail "The host key secret (DEV_SSH_KNOWN_HOSTS) is empty."

# 3. The destination must be an absolute path, with no way to climb out of it,
#    inside a directory named exactly $DEV_SITE. test.bkesari.com and
#    bkesari.com cannot satisfy this, whatever the secret says.
case "$DEPLOY_DIR" in
  /*) ;;
  *) fail "The deploy path must be an absolute path; got '$DEPLOY_DIR'." ;;
esac
case "$DEPLOY_DIR" in
  *..*) fail "The deploy path must not contain '..'; got '$DEPLOY_DIR'." ;;
esac
case "$DEPLOY_DIR" in
  */"$DEV_SITE" | */"$DEV_SITE"/*) ;;
  *) fail "The deploy path must be inside a directory named exactly $DEV_SITE; got '$DEPLOY_DIR'." ;;
esac

# 4. The tiers that are off limits at this stage, named outright. Check 3
#    already covers them while DEV_SITE is a dev hostname; this is what stops
#    a future edit to DEV_SITE from quietly turning a workflow into a
#    production deploy, and it keeps every one of these away from
#    gokesari.com, which this project must not touch at all.
case "$DEPLOY_DIR" in
  *test.bkesari.com* | */bkesari.com/* | */bkesari.com | *gokesari*)
    fail "The deploy path points outside dev: '$DEPLOY_DIR'." ;;
esac

# 5. The smoke-check URL is optional, but if set it must point at dev too —
#    otherwise a green deploy could be reporting on somebody else's site.
if [ -n "${SMOKE_URL:-}" ]; then
  case "$SMOKE_URL" in
    "https://$DEV_SITE" | "https://$DEV_SITE"/*) ;;
    *) fail "The smoke-check URL must start with https://$DEV_SITE/; got '$SMOKE_URL'." ;;
  esac
fi

echo "Target: $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR ($DEV_SITE)"
