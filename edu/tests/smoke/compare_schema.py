"""Compare two `pg_dump --schema-only --no-owner --no-privileges` files
(TEST_SPEC.md, level S3): the database `php artisan migrate` built, and one
built by hand from SQL scripts.

    python3 tests/smoke/compare_schema.py migrated.sql loaded.sql

Every line must match, with one exception that is pg_dump's and not a schema
difference: a CHECK constraint that was itself loaded from a dump is printed
back as `ARRAY[('a'::character varying)::text, ...]` rather than
`(ARRAY['a'::character varying, ...])::text[]`. Those are compared by
constraint name, column and the ordered list of allowed values instead.
Lines that name the dump's own version are ignored. Exits non-zero on any
difference and prints the first ones.
"""
import difflib
import re
import sys

CHECK = re.compile(r"CONSTRAINT (\w+) CHECK \(\(\((\w+)\)::text = ANY ")
IGNORED = re.compile(r'^(-- Dumped (from|by) |\\(un)?restrict )')


def load(path):
    lines, checks = [], {}
    for raw in open(path):
        line = raw.rstrip('\n')
        if IGNORED.match(line):
            continue
        match = CHECK.search(line)
        if match:
            checks[match.group(1)] = (match.group(2), re.findall(r"'([^']*)'", line))
            line = f'<CHECK {match.group(1)}>'
        lines.append(line)
    return lines, checks


a_lines, a_checks = load(sys.argv[1])
b_lines, b_checks = load(sys.argv[2])
problems = list(difflib.unified_diff(a_lines, b_lines, sys.argv[1], sys.argv[2], lineterm='', n=0))[:40]
for name in sorted(set(a_checks) | set(b_checks)):
    if a_checks.get(name) != b_checks.get(name):
        problems.append(f'CHECK {name}: {a_checks.get(name)!r} != {b_checks.get(name)!r}')

if problems:
    print('\n'.join(problems))
    sys.exit(1)
print(f'schemas match: {len(a_lines)} lines, {len(a_checks)} CHECK constraints compared by value')
