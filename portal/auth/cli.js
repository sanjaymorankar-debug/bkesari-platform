#!/usr/bin/env node
/**
 * Server-side administration for the central login. Run on the server, with
 * the same environment as the hub:
 *
 *   npm run auth -- migrate
 *   npm run auth -- keygen                       print a new OIDC signing key (PEM)
 *   npm run auth -- owner:bootstrap [--name "…"] create / repair the owner (AUTH_OWNER_EMAIL);
 *                                                password from AUTH_BOOTSTRAP_PASSWORD or stdin
 *   npm run auth -- owner:totp                   start the owner's TOTP enrolment (prints the key)
 *   npm run auth -- owner:totp:confirm <code>    finish it
 *   npm run auth -- client:add --id agtci-dev --kind oidc --tier dev --feature AGTCI \
 *        --redirect https://dev.agtci.com/auth/callback \
 *        --post-logout https://dev.agtci.com/ --backchannel https://dev.agtci.com/auth/backchannel-logout
 *   npm run auth -- client:add --id milk-dev --kind internal --tier dev
 *   npm run auth -- client:rotate <id>
 *   npm run auth -- client:list
 *
 * Secrets are printed once and never stored in clear.
 */
const readline = require('readline');
const createDb = require('../db');
const { loadConfig } = require('./config');
const { migrate } = require('./migrate');
const { createService } = require('./service');
const { createAudit } = require('./audit');
const { createClients } = require('./clients');
const jwt = require('./jwt');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (out[k] === undefined) out[k] = v;
      else out[k] = [].concat(out[k], v);
    } else out._.push(a);
  }
  return out;
}

const many = (v) => (v === undefined || v === true ? [] : [].concat(v));

function ask(question, { silent = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (silent) rl._writeToOutput = () => {};
    rl.question(question, (answer) => { rl.close(); if (silent) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'keygen') {
    const pem = jwt.generatePem();
    console.log(pem);
    console.log('One-line form for an environment variable:\n');
    console.log(`AUTH_OIDC_PRIVATE_KEY="${pem.trim().replace(/\n/g, '\\n')}"`);
    return;
  }

  // Everything else needs the database, with auth considered enabled.
  const env = { ...process.env, AUTH_ENABLED: '1' };
  const config = loadConfig(env);
  const db = await createDb({ env, prefix: 'AUTH_', schema: false });
  try {
    await migrate(db);
    if (cmd === 'migrate') return;
    const audit = createAudit(db);
    const service = createService({ db, config, mailer: { send: async () => {} }, audit });
    const clients = createClients({ db, config });

    if (cmd === 'owner:bootstrap') {
      if (!config.ownerEmail) throw new Error('Set AUTH_OWNER_EMAIL first.');
      const existing = await service.findUserByEmail(config.ownerEmail);
      let password = process.env.AUTH_BOOTSTRAP_PASSWORD || '';
      if (!password && !existing) password = await ask(`New password for ${config.ownerEmail}: `, { silent: true });
      const user = await service.bootstrapOwner({ email: config.ownerEmail, name: args.name === true ? null : args.name, password: password || null });
      console.log(`Owner ready: ${user.email} (${user.id}). Next: npm run auth -- owner:totp`);
    } else if (cmd === 'owner:totp') {
      const user = await service.findUserByEmail(config.ownerEmail);
      if (!user) throw new Error('Run owner:bootstrap first.');
      if (user.totp_enabled_at && !args.reset) throw new Error('TOTP is already on. Pass --reset to replace it (this ends every owner session).');
      if (args.reset) {
        await db.run('UPDATE auth_users SET totp_enabled_at = NULL, totp_secret_enc = NULL WHERE id = ?', [user.id]);
        await service.revokeAllSessions(user.id);
        await audit.record({ action: 'MFA_DISABLED', subjectId: user.id, detail: { via: 'cli', reason: 'reset' } });
      }
      const { secret, uri } = await service.beginTotpEnrollment({ ...user, totp_enabled_at: null }, { allowOwner: true });
      console.log(`Add this key to your authenticator app:\n\n  ${secret.replace(/(.{4})/g, '$1 ').trim()}\n\n  ${uri}\n`);
      console.log('Then: npm run auth -- owner:totp:confirm <6-digit code>');
    } else if (cmd === 'owner:totp:confirm') {
      const user = await service.findUserByEmail(config.ownerEmail);
      await service.confirmTotpEnrollment(user, args._[1]);
      await audit.record({ action: 'OWNER_TOTP_ENROLLED', subjectId: user.id, detail: { via: 'cli' } });
      console.log('Two-step sign-in is on for the owner account.');
    } else if (cmd === 'client:add') {
      const { clientId, secret } = await clients.register({
        clientId: args.id, name: args.name === true ? undefined : args.name, kind: args.kind, tier: args.tier,
        feature: args.feature && args.feature !== true ? String(args.feature).toUpperCase() : null,
        redirectUris: many(args.redirect), postLogoutRedirectUris: many(args['post-logout']),
        backchannelLogoutUri: args.backchannel && args.backchannel !== true ? args.backchannel : null,
      });
      await audit.record({ action: 'CLIENT_REGISTERED', detail: { client: clientId, kind: args.kind, tier: args.tier } });
      console.log(`client_id:     ${clientId}\nclient_secret: ${secret}\n\nStore the secret in that application's environment now; it is not shown again.`);
    } else if (cmd === 'client:rotate') {
      const secret = await clients.rotateSecret(args._[1]);
      console.log(`New client_secret for ${args._[1]}: ${secret}`);
    } else if (cmd === 'client:list') {
      console.table(await clients.list());
    } else {
      console.log('Commands: migrate, keygen, owner:bootstrap, owner:totp, owner:totp:confirm, client:add, client:rotate, client:list');
      process.exitCode = 2;
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
