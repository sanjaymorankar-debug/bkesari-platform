import { defineConfig } from "@neon/config/v1";

// Deploy with the env file so the function secret below resolves:
//   neon deploy --env .env.local
// ORIGIN_SECRET is not Neon-managed: add it to .env.local yourself
// (`openssl rand -hex 32`) and set the same value on the portal's host.

export default defineConfig({
  preview: {
    // The origins the browser may open the Realtime WebSocket from: the
    // portal on a laptop and the dev tier. Add test/production when they move.
    realtime: {
      allowedOrigins: ["http://localhost:3000", "https://dev.bkesari.com"],
    },
  },
  auth: true,
  // AI Gateway does not serve model requests on Neon's Free plan, and
  // `neon deploy` refuses a neon.ts that declares it there. Put this back
  // after upgrading the org's plan, then run `neon deploy` again:
  // aiGateway: true,
  functions: {
    // The Task Tracker's last-seven-days figures (functions/report.ts).
    report: {
      name: "Task Tracker report",
      source: "./functions/report.ts",
      env: { ORIGIN_SECRET: process.env.ORIGIN_SECRET! },
    },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads.
    // Holds the ATIP snapshot archive (portal/storage.js).
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
