#!/usr/bin/env bash
# Run the Education app locally (macOS / Linux).
#
# The macOS counterpart of serve.bat, which pointed at
# D:\Claude_development\edu-platform and a bundled php.exe and so is dead on the
# Mac. This resolves the app from its own location instead of a hardcoded path.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v php >/dev/null 2>&1; then
    echo "php not found on PATH. On macOS: brew install php" >&2
    exit 1
fi

[[ -f .env ]] || { echo "No .env yet. Run: cp .env.example .env && php artisan key:generate"; exit 1; }
[[ -d vendor ]] || composer install

echo "Education app → http://127.0.0.1:8000"
exec php artisan serve --host=127.0.0.1 --port="${PORT:-8000}"
