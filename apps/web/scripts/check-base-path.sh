#!/usr/bin/env bash
# Fails if src/ calls fetch() with a bare absolute path ('/api/...').
#
# Behind BASE_PATH (the bkesari.com hub serves this app at /ladwani/), Next
# prefixes links, routing and assets but never a fetch() string, so such a
# call would reach the hub's root instead of this app -- with every page still
# looking fine. Build URLs from API_BASE in src/lib/api-client.ts instead.
set -euo pipefail
cd "$(dirname "$0")/.."
if matches=$(grep -rnE "fetch\(\s*['\"\`]/" src); then
  echo "Bare absolute fetch() paths ignore BASE_PATH:" >&2
  echo "$matches" >&2
  exit 1
fi
echo "No bare absolute fetch() paths."
