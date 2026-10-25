#!/usr/bin/env node
// Runs a command with the variables from an env file layered over the real
// environment. Needed because nothing in this repo loads .env at runtime:
// PrismaService is a bare PrismaClient, so it reads process.env.DATABASE_URL
// and nothing else. CI injects DATABASE_URL as a workflow env var, which is
// why the plain `test:integration` script works there without this wrapper.
//
// Deliberately dependency-free (no dotenv) and shell-agnostic: `VAR=x cmd`
// is bash syntax that does not work in cmd.exe, and Node's --env-file does
// not compose cleanly with npx/prisma.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const [, , envFile, command, ...args] = process.argv

if (!envFile || !command) {
  console.error('Usage: node scripts/with-env.js <envFile> <command> [args...]')
  process.exit(1)
}

const envPath = path.resolve(process.cwd(), envFile)

if (!fs.existsSync(envPath)) {
  console.error(`env file not found: ${envPath}`)
  console.error('Copy apps/api/.env.test.example to apps/api/.env.test to get started.')
  process.exit(1)
}

const env = { ...process.env }

for (const rawLine of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const key = line.slice(0, eq).trim()
  let value = line.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  env[key] = value
}

const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
