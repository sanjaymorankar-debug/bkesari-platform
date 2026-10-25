# Phase 2.1 — System Architecture (Finalized)

## 1. Monorepo Layout

```
community-platform/
├── apps/
│   ├── api/            NestJS — all backend modules (§ Phase 1 module map)
│   └── web/             Next.js — all frontend screens
├── packages/
│   ├── shared-types/     DTOs, enums, permission strings — imported by BOTH apps so a
│   │                     contract change is a compile error on whichever side didn't update
│   └── config/           Shared eslint/tsconfig/prettier base
├── prisma/               Schema, migrations (source of truth for the DB)
└── docs/                 This folder
```

npm workspaces (not a separate tool like Turborepo/Nx) — the project doesn't need build-graph caching at this scale yet, and one less tool is one less thing to operate on shared hosting.

## 2. Why Two Apps Instead of the Previous Project's "One Next.js App with API Routes"

The brief calls for a NestJS backend + Next.js frontend specifically (§67), not the integrated Next.js-API-routes pattern the previous Ladwani build used. The trade this makes: real separation of concerns and a backend that isn't tied to Next's request lifecycle (useful once background jobs, webhooks, and a proper DI/module system for 22 modules matter) — at the cost of needing two deployed processes instead of one, and CORS between them.

## 3. Deployment Topology on Hostinger

This is the concrete question the previous build's whole session answered the hard way, so it's worth being explicit now rather than rediscovering it mid-M0:

- Hostinger's Node.js hosting runs **one Node process per site/subdomain** (confirmed from the existing deployment: `devmiladwani.agtci.com` is one "Website" entry with its own Node.js app manager, build pipeline, and env-var panel).
- Two apps therefore need **two subdomains, each its own Hostinger "Website" entry**:
  - `app.<domain>` (or the existing bare subdomain) → `apps/web`, the Next.js frontend
  - `api.<domain>` → `apps/api`, the NestJS backend
- Both connect to the **same MySQL database** (one Hostinger MySQL database, per Phase 1's confirmed engine choice).
- The frontend talks to the backend over HTTPS via `NEXT_PUBLIC_API_URL`; the backend's CORS config allowlists the frontend's exact origin (never `*`, since cookies/credentials are involved).
- **No CLI access on this host** — confirmed repeatedly this session. Every migration and seed operation is generated locally as SQL and run by hand through phpMyAdmin, same pattern already proven working. This is not a workaround to route around eventually; it's a standing constraint the whole M0–M5 plan designs around (see `15-database-architecture.md` §3).
- GitHub-based auto-deploy (already set up for the current site) is reused for both new subdomains once each is created — same "connect repo, set build/start command, set env vars" flow already walked through this session.

## 4. Environments

| Environment | Purpose | Database |
|---|---|---|
| Local dev | Day-to-day development | Docker MySQL container |
| Staging | M0–M5 build/test target | A **second** Hostinger MySQL database (or a free-tier external MySQL if Hostinger's plan limits database count) — never the live one |
| Production | Live cutover, M5 only | The current live Hostinger MySQL database, after the confirmed destructive replacement (Phase 1 §13.1a) |

## 5. Background Jobs

Redis + BullMQ for anything that shouldn't block a request: thumbnail generation after photo upload, payment-reminder scheduling, webhook retry handling, reconciliation runs. Hostinger's shared plan may not support a persistent Redis instance — flagged as a concrete thing to verify before M0 locks in; the fallback is a lightweight polling-based job table (`scheduled_jobs`) if a managed Redis isn't feasible on the current hosting tier.

## 6. Observability (minimum viable for launch)

- Structured JSON logging (NestJS's built-in `Logger`, one line per request with a request-id) — enough to debug production issues via Hostinger's runtime logs, the same log viewer already used throughout this session's debugging.
- No dedicated APM/tracing tool at this scale; revisit if/when member count approaches the 100k mark from the NFR target.
