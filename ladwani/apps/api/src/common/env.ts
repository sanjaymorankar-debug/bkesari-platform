/**
 * LadWani's setting `name`. LADWANI_<name> wins, so the API can run inside the
 * bkesari.com hub process (the hub's portal/ladwani.js), where DATABASE_URL and
 * the like belong to the hub. Run on its own, the plain names work as before.
 */
export function env(name: string): string | undefined {
  return process.env[`LADWANI_${name}`] ?? process.env[name]
}
