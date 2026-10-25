# LadWani on Postgres (Neon `bk_ladwani`)

LadWani runs the **`rebuild`** branch of `sanjaymorankar-debug/Ladwani` (NestJS API +
Next.js web). The SQL one folder up is that schema for MySQL; this folder is the
same schema for Postgres, as loaded into Neon database `bk_ladwani` on branch
`production` on 2026-10-24.

| Step | What | Result on `bk_ladwani` |
|---|---|---|
| 1 | `psql "$URL" -v ON_ERROR_STOP=1 -1 -f 01_ladwani_schema.sql` | 73 tables, 108 foreign keys |
| 2 | The rebuild's `apps/api/prisma/seed.ts`, with a Prisma client generated from the schema with `provider = "postgresql"` | 1 community, 28 permissions, 5 roles, 70 role grants, 16 relationship types, 12 approval rules, 5 post types, 4 asset categories, 8 education levels, 9 occupations, 7 skills. Run twice, same counts. |

`01_ladwani_schema.sql` is generated (its header says how), so regenerate it
rather than editing it when the rebuild's schema changes.

No users exist yet. The first administrator is granted after they sign up, as
`../03_ladwani_first_admin.sql` does for MySQL. The Postgres form:

```sql
INSERT INTO user_roles (id, user_id, role_id, granted_at)
SELECT gen_random_uuid()::text, u.id, r.id, now()
FROM users u JOIN roles r ON r.code = 'ADMIN'
WHERE u.email = 'you@example.com'
ON CONFLICT DO NOTHING;
```

## The app is not on Postgres yet

The rebuild's Prisma schema, migrations and CI still target **MySQL**. Running it
against this database needs, in the Ladwani repository:

- `provider = "postgresql"`, and a Postgres migration baseline in place of the
  MySQL history. The schema here is that baseline. Mark it applied with
  `prisma migrate resolve --applied <name>` rather than re-running it.
- `mode: 'insensitive'` on its 16 `contains:` filters. MySQL's default collation
  made those searches case-insensitive; on Postgres they would silently become
  case-sensitive.
- A Postgres check of the one raw query (the booking slot lock, `SELECT … FOR
  UPDATE` in `bookings.service.ts`). It is valid Postgres; its date parameter
  may need a `::date` cast.
- CI on a Postgres service instead of MySQL 8.4.
