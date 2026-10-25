/**
 * Both halves of the rebuild in ONE process, for a single Hostinger Node.js site.
 *
 * Hostinger's launcher lets only the first http.Server.listen() through, and the
 * account's process limit refuses a child process (spawn EAGAIN), so the API
 * cannot have a port of its own. Instead the Next.js standalone server (built by
 * `npm run build:hostinger`) listens on the site's PORT, and every request for
 * `${BASE_PATH}/api/v1/...` is handed to the NestJS app's Express handler before
 * Next.js sees it. The API never listens anywhere.
 */
const http = require('http')
const path = require('path')

const base = (process.env.BASE_PATH || '').replace(/\/$/, '')
const api = `${base}/api/v1`
const isApi = (url) => url === api || url.startsWith(`${api}/`) || url.startsWith(`${api}?`)

let apiHandler = null
const apiReady = require(path.join(__dirname, '..', 'apps', 'api', 'dist', 'main.js'))
  .createApi()
  .then(async (app) => {
    await app.init()
    apiHandler = app.getHttpAdapter().getInstance()
    console.log('API ready (in-process)')
  })
  .catch((err) => {
    console.error('API failed to start:', err)
  })

const createServer = http.createServer
http.createServer = function (...args) {
  const listener = typeof args[args.length - 1] === 'function' ? args.pop() : null
  const server = createServer.apply(this, args)
  if (!listener) return server
  server.on('request', (req, res) => {
    if (!isApi(req.url || '')) return listener(req, res)
    // Nest's prefix is api/v1, so the API sees the path without BASE_PATH.
    if (base) req.url = req.url.slice(base.length)
    if (apiHandler) return apiHandler(req, res)
    apiReady.then(() => {
      if (apiHandler) return apiHandler(req, res)
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end('{"message":"API unavailable"}')
    })
  })
  return server
}

require(path.join(__dirname, '..', 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js'))
