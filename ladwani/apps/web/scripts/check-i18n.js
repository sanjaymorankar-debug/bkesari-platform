#!/usr/bin/env node
// Fails when Marathi or Hindi (src/i18n/*.json) has a key English lacks, lacks
// one English has, is empty, or drops a {placeholder}. English is the source;
// the TypeScript MessageKey type (src/lib/i18n.ts) already checks every key
// the code uses exists in English.
'use strict'
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'src', 'i18n')
const load = (lang) => JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8'))
const en = load('en')
const keys = Object.keys(en).filter((k) => k !== '_meta')
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const problems = []

for (const lang of ['mr', 'hi']) {
  const dict = load(lang)
  if (!dict._meta || !dict._meta.review) problems.push(`${lang}: _meta.review should say who still needs to check it`)
  for (const k of keys) {
    if (typeof dict[k] !== 'string' || !dict[k].trim()) problems.push(`${lang}: missing "${k}"`)
    else if (vars(dict[k]) !== vars(en[k])) problems.push(`${lang}: "${k}" has {${vars(dict[k])}}, English has {${vars(en[k])}}`)
  }
  for (const k of Object.keys(dict)) if (k !== '_meta' && !(k in en)) problems.push(`${lang}: "${k}" is not an English key`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`i18n: ${keys.length} keys in en, mr and hi.`)
