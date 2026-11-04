#!/usr/bin/env node
'use strict';
/*
 * A stand-in for the Education app behind the hub's /edu/ (the hub strips the
 * prefix), for CI and the testers' smoke runs: a sign-in page carrying the
 * markup Livewire 3 emits when APP_URL ends in /edu, which is what
 * scripts/smoke-dev.sh checks. It echoes the request, so a run can also see
 * which cookies the hub forwarded.
 *
 * Point the hub at it with EDU_ORIGIN=http://127.0.0.1:<port>. Then nothing in
 * a run depends on devedu.bkesari.com being up (decision D-031).
 *
 *   node scripts/edu-standin.js [port]     (default 3111; listens on 127.0.0.1 only)
 */
const http = require('http');

const port = Number(process.argv[2] || process.env.EDU_STANDIN_PORT || 3111);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><head><title>Education sign-in (stand-in)</title></head><body>
<form wire:submit="login"><input name="email"></form>
<script src="/edu/livewire/livewire.min.js?id=standin" data-csrf="standin" data-update-uri="/edu/livewire/update" data-navigate-once="true"></script>
<!-- stand-in answered ${esc(req.method)} ${esc(req.url)}; cookie: ${esc(req.headers.cookie || '')} --></body></html>`);
}).listen(port, '127.0.0.1', () => console.log(`Education stand-in on http://127.0.0.1:${port}`));
