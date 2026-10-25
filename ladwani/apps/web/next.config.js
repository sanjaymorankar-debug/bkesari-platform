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

/**
 * NEXT_OUTPUT=export builds plain files in out/ with no server at all: every
 * page is a client component, so the bkesari.com hub serves them as they are
 * and runs the API in its own process (the hub's portal/ladwani.js). Each
 * [param] page is built once and read its real id from the address bar
 * (src/lib/route-params.ts). The API rewrite below needs a running Next
 * server, so it is left out; the hub serves /api/v1 itself.
 */
const staticExport = process.env.NEXT_OUTPUT === 'export'

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  // NEXT_OUTPUT=standalone builds a self-contained server in .next/standalone
  // with only the files it traces as needed, so the host runs
  // `node apps/web/server.js` with no npm install. A regular install would put
  // ~276 MB of build-only compiler binaries on the server.
  output: staticExport ? 'export' : process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // One folder per page (family/_/index.html), which the hub maps every id onto.
  ...(staticExport ? { trailingSlash: true, images: { unoptimized: true } } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  ...(buildCpus ? { experimental: { cpus: buildCpus } } : {}),
  ...(staticExport
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: '/api/v1/:path*',
              destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/:path*`,
            },
          ]
        },
      }),
}

module.exports = nextConfig
