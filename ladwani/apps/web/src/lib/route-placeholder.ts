/**
 * The static export (NEXT_OUTPUT=export, the build bkesari.com serves) holds
 * each [param] page once, built for this placeholder. The hub serves that one
 * page for every real id, so there the real values are only in the address bar
 * (src/lib/route-params.ts). Kept out of that client module so the server
 * pages' generateStaticParams() receives a plain string.
 */
export const PLACEHOLDER = '_'
