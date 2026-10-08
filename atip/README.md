# ATIP is not vendored here any more

This folder used to hold a **copy** of ATIP. That copy had gone stale and has been
removed, because nothing deployed from it and keeping it invited deploying the
wrong code.

How stale it was, measured against the canonical repository before removal:

| | |
|---|---|
| Files here | 69 |
| Files in the real ATIP | 510 |
| Whole directories missing | 13 — `ml/ quant/ wealth/ brokers/ execution/ enterprise/ strategy_engine/ ops/ tools/ altdata/ backtest/ deploy/ docs/` |
| Files unique to this copy | **0** — nothing was lost by removing it |
| Files identical to the real ATIP | 34 |
| Files that were **older versions** | **35** — including `orders/paper.py`, `orders/broker.py` and `orders/rules.py` |

Those last three are order-handling code. A stale copy of them is the one thing
you really do not want someone to deploy by accident.

## Where ATIP actually lives

- **Repository:** `sanjaymorankar-debug/ATIP-DEV`
- **On the owner's Mac:** `/Users/agtci/Documents/Project_Documents/Projects/ATIP`

## What this repo still does for ATIP

Nothing is lost by the removal, because the portal never ran this code:

- `portal/server.js` receives a rendered dashboard snapshot at
  `POST /ATIP/api/snapshot` (and the legacy `/atip/api/snapshot`) and serves it
  read-only, behind a login, at **`/ATIP/`**. That is the entire integration.
- The uploader is `publish_snapshot.py` in the ATIP repo, run on the Mac by
  `deploy/launchd/com.atip.publish-snapshot.plist` every 5 minutes.

## If ATIP is to be hosted as the full interactive app

See `docs/HOSTED_DEPLOYMENT.md` in the ATIP repo. Two things it establishes up
front:

1. It **cannot** run on Hostinger shared hosting — it needs a long-lived Python
   process, an in-process scheduler and a persistent outbound WebSocket for the
   Dhan feed. `/ATIP/` has to proxy to a VPS.
2. Exposing it is a gated step. The interactive dashboard can place, confirm and
   cancel orders, which is exactly what the read-only snapshot design was built to
   avoid. TLS, authentication on *every* route, `enterprise.enabled` and
   `execution.mode=paper` are prerequisites.
