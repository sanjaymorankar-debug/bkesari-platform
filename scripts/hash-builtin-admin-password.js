#!/usr/bin/env node
/*
 * Prints the value for BUILTIN_ADMIN_PASSWORD_HASH, the password of the hub's
 * built-in administrators (smorankar, sonalimorankar; portal/builtin-admins.js).
 *
 *   node scripts/hash-builtin-admin-password.js
 *
 * It asks for the password twice without showing it, so the password stays out
 * of the shell history. Or pipe it in: `printf %s "$PW" | node scripts/...`.
 *
 * Set the printed line as an environment variable on every tier's hub
 * (Hostinger: the Node.js app's environment variables; then restart it).
 * Never commit it: this repository is public.
 */
const readline = require('readline');
const { hashPassword } = require('../portal/builtin-admins.js');

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(prompt) || s === '\r\n' || s === '\n') process.stdout.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function readPiped() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

(async () => {
  let password;
  if (process.stdin.isTTY) {
    password = await ask('Password: ');
    if ((await ask('Again: ')) !== password) throw new Error('The two passwords differ.');
  } else {
    password = await readPiped();
  }
  if (password.length < 12) throw new Error('Use at least 12 characters: this password opens every project.');
  console.log(`BUILTIN_ADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
})().catch((err) => { console.error(err.message); process.exit(1); });
