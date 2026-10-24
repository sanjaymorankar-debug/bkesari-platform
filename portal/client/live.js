/* ============================================================
   Browser side of Neon Realtime for the Task Tracker (portal/realtime.js
   is the server side). `npm run build` bundles this file with esbuild
   into portal/public/tasks/live.js, which the page loads as a plain
   script; it exposes window.bkLive.

   The subscription is only a change signal. The page decides what to
   re-fetch, so every row it shows still comes through /tasks/api.

   Sealed queries expire, so this fetches a fresh one shortly before each
   expiry and renews the subscription with it -- the same timing Neon's
   React bindings use.
   ============================================================ */
import { createRealtimeClient } from '@neon/realtime/client';

const RENEW_EARLY_MS = 10_000;
const RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * @param {object} o
 * @param {() => Promise<{url: string, sealed: object} | null>} o.fetchLive
 *        resolves null when the server has no Realtime configured
 * @param {() => void} o.onChange  something in the tracker changed
 * @param {(status: string, error?: Error) => void} [o.onStatus]
 * @returns {Promise<{ stop(): void } | null>}
 */
async function watchTracker({ fetchLive, onChange, onStatus = () => {} }) {
  const first = await fetchLive();
  if (!first) return null;

  const client = createRealtimeClient({ url: first.url });
  const subscription = client.subscribe(first.sealed, { materialize: false });

  // The first `rows` update is the initial result, not a change. Any later
  // one replaces the whole result (after a reconnect, say), and the rows may
  // have moved in the gap, so it counts as a change.
  let initial = true;
  subscription.onUpdate((update) => {
    if (update.type === 'rows' && initial) { initial = false; return; }
    onChange();
  });
  subscription.onStateChange((state) => onStatus(state.status, state.error));

  let timer;
  let stopped = false;
  let retry = RETRY_MS;
  const schedule = (delay) => { clearTimeout(timer); if (!stopped) timer = setTimeout(renew, delay); };

  async function renew() {
    let next;
    try {
      next = await fetchLive();
    } catch (err) {
      // Signed out, or no longer allowed: stop rather than retry forever.
      if (err && (err.status === 401 || err.status === 403)) return stop();
      retry = Math.min(retry * 2, MAX_RETRY_MS);
      return schedule(retry);
    }
    if (!next) return stop();
    retry = RETRY_MS;
    try {
      await subscription.renew(next.sealed);
    } catch {
      // A failed renewal leaves the subscription in `error`, which is final.
      return stop();
    }
    schedule(Math.max(0, next.sealed.expiresAt - Date.now() - RENEW_EARLY_MS));
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    subscription.unsubscribe();
    client.close();
  }

  schedule(Math.max(0, first.sealed.expiresAt - Date.now() - RENEW_EARLY_MS));
  window.addEventListener('pagehide', stop);
  return { stop };
}

window.bkLive = { watchTracker };
