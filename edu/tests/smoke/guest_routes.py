"""Every GET route behind the `auth` middleware must send a guest to sign in
(TEST_SPEC.md, level S6).

    php artisan route:list --json > /tmp/routes.json
    python3 tests/smoke/guest_routes.py /tmp/routes.json http://127.0.0.1:3105/edu

The base URL is where the app is reached (the hub's /edu, or the app's own
origin when APP_URL has no path); the sign-in page is expected at BASE/login.
Route parameters are filled with 1. Exits non-zero if any route answers a
guest with anything but a redirect to the sign-in page.
"""
import json
import re
import subprocess
import sys

routes = json.load(open(sys.argv[1]))
base = sys.argv[2].rstrip('/')
login = base + '/login'
checked = failed = 0

for route in routes:
    if 'GET' not in route['method']:
        continue
    if not any(m == 'auth' or m.endswith('\\Authenticate') for m in route['middleware']):
        continue
    uri = re.sub(r'\{[^}]+\}', '1', route['uri']).lstrip('/')
    result = subprocess.run(
        ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', '--max-time', '30', f'{base}/{uri}'],
        capture_output=True, text=True,
    ).stdout
    code, _, location = result.partition(' ')
    checked += 1
    if code != '302' or not location.startswith(login):
        failed += 1
        print(f'FAIL /{uri} answered a guest with {result}')

print(f'guest routes: {checked} GET routes behind auth, {failed} not sent to {login}')
sys.exit(1 if failed or not checked else 0)
