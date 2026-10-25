/**
 * BASE_PATH serves the app under a path prefix, e.g. BASE_PATH=/ladwani so the
 * bkesari.com hub can forward /ladwani/ here with the prefix intact (the hub's
 * DEPLOY.md, Part 7). Unset, the app is at the root as before.
 *
 * It is read at build time AND when `next start` runs, so set it in both
 * places. Next applies it to <Link>, router.push, assets and the rewrite below,
 * but not to fetch() -- hence NEXT_PUBLIC_BASE_PATH for src/lib/api-client.ts.
 */
const basePath = process.env.BASE_PATH || ''
if (basePath && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
  throw new Error(`BASE_PATH must start with "/" and not end with one (got "${basePath}")`)
}

/**
 * NEXT_BUILD_CPUS caps the build's worker processes. Hostinger's builder
 * reports 64 cores; Next then starts ~63 workers and the account's thread
 * limit aborts the build ("OS can't spawn worker thread"). `build:hostinger`
 * sets it to 1; unset keeps Next's default.
 */
const buildCpus = process.env.NEXT_BUILD_CPUS ? Number(process.env.NEXT_BUILD_CPUS) : undefined
if (buildCpus !== undefined && !(Number.isInteger(buildCpus) && buildCpus >= 1)) {
  throw new Error(`NEXT_BUILD_CPUS must be a positive integer (got "${process.env.NEXT_BUILD_CPUS}")`)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  // NEXT_OUTPUT=standalone (the dev deploy sets it) builds a self-contained
  // server in .next/standalone with only the files it traces as needed, so the
  // host runs `node apps/web/server.js` with no npm install. A regular install
  // would put ~276 MB of build-only compiler binaries on the server.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  ...(buildCpus ? { experimental: { cpus: buildCpus } } : {}),
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
