#!/usr/bin/env node
/**
 * Copies the browser builds of @capacitor/core, @capacitor/app and
 * @capacitor/browser into bkesari/www/vendor/, so the start screen loads them
 * as plain scripts (no bundler). Run after a Capacitor upgrade:
 * `npm run vendor` (`npm run sync:bkesari` does it too). The copies are kept
 * in the repository so `npx cap sync` alone builds a working app;
 * test/bkesari-shell.test.js fails when they differ from node_modules.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const VENDOR_FILES = {
  'capacitor.js': '@capacitor/core/dist/capacitor.js',
  'app.js': '@capacitor/app/dist/plugin.js',
  'browser.js': '@capacitor/browser/dist/plugin.js',
};

const target = join(here, '..', 'bkesari', 'www', 'vendor');
mkdirSync(target, { recursive: true });
for (const [name, source] of Object.entries(VENDOR_FILES)) {
  copyFileSync(require.resolve(source), join(target, name));
  console.log(`bkesari/www/vendor/${name} <- ${source}`);
}
