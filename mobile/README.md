# bkesari mobile apps (Android and iOS)

Since decision **D-039** (17 Nov 2026) a person has **one bkesari ID**: they sign in once at
bkesari.com (Google first, the email code as fallback), then ask for access to each project and a
bkesari administrator approves it. The contract is `docs/design/bkesari-id.md`.

The mobile side is now **one app, bkesari** (`bkesari/`), a [Capacitor](https://capacitorjs.com)
shell that starts on its own screen with **Continue with Google**, then shows bkesari.com: the
project list with each project's access status (`/`), request access (`/access/request`) and the
profile (`/account`). The three earlier per-project shells (`apps/`, D-023) are kept and still work.

| App | Folder | App ID | URL scheme | Opens | Accent |
|---|---|---|---|---|---|
| **bkesari** | `bkesari` | `in.bkesari.app` | `in.bkesari.app` | its start screen, then https://bkesari.com/ | kesari `#C2560A` |
| LadWani | `apps/ladwani` | `com.bkesari.ladwani` | — | https://bkesari.com/ladwani/ | maroon `#7C2D12` |
| bkesari Education | `apps/education` | `com.bkesari.education` | — | https://bkesari.com/edu/ | teal `#0F766E` |
| TaskList | `apps/tasklist` | `com.bkesari.tasklist` | — | https://bkesari.com/tasklist/ | indigo `#4338CA` |

## Why one new app rather than updating the three

- **D-039 makes the hub the only sign-in.** The project list, the access status, the request form and
  the profile are hub pages that cover every project, so one app that opens the hub serves all of
  them. Three apps would each need the same Google sign-in and would each show the same project list.
- **Google sign-in needs native work** (the system browser and a URL scheme, below). It is done once.
- **One store listing and one review.** The start screen and the native sign-in are what the app adds
  over the website (App Store guideline 4.2).
- **No `server.url`.** The three shells load the site through `server.url`, which Capacitor documents
  as meant for live reload, not production. More importantly, the app's own code (the sign-in) runs
  only on the app's own page, so the bkesari app starts on `www/index.html` and the WebView then goes to
  bkesari.com (`server.allowNavigation`).

**The three earlier shells** still open their own project. With D-039 the hub sends a person who is
not signed in to its sign-in page inside them, where the **email code works**. **Continue with Google
does not work inside them**: Google refuses WebViews, and Capacitor hands `accounts.google.com` to the
system browser, which then holds the session, not the app. They are superseded by the bkesari app;
publish that one, and retire these or keep them for email sign-in only. Their configuration is unchanged.
Each now has a small `package.json`: without one the Capacitor CLI refuses to run in the folder
("needs to run at the root of an npm package"), so the `npm run add:android` / `add:ios` steps below
used to fail.

`bkesari/` sits beside `apps/` because `apps/` holds the per-project shells, and the repository's
`tests/mobile.test.js` (portal-tester) checks that it holds exactly those three.

## The bkesari app

### The start screen and sign-in

`bkesari/www/index.html` is the app's own page (`https://localhost/` on Android, `capacitor://localhost/`
on iOS). It offers:

- **Continue with Google**, the native flow below.
- **Sign in with an email code**, which opens the hub's own sign-in page (`/auth/sign-in?next=/`) in the WebView.
- **Your projects** (`/`), **Request access** (`/access/request`), **Your profile** (`/account`): hub pages,
  shown once the person has been on to the hub from this phone.

At the first launch the app shows this screen. Afterwards it opens the hub's home (`/`) directly; on
Android the back button from the first hub page comes back to it. Offline, the WebView shows
`www/offline.html`.

Continue with Google (Google refuses WebViews, so the sign-in runs in the system browser; same design
as GoKesari's app, `mobile/src/google-sign-in.ts` and `src/server/mobile-auth.ts` in that repository):

1. The app makes a random PKCE verifier (32 bytes, `crypto.getRandomValues`, base64url, 43 characters)
   and its challenge (base64url of SHA-256, 43 characters; SubtleCrypto, or the built-in SHA-256 where
   SubtleCrypto is missing). The verifier stays in the app (`localStorage`, at most 10 minutes, so it
   survives Android ending the app while the browser is open) and is used once.
2. It opens `https://bkesari.com/mobile-auth/start?app=in.bkesari.app&challenge=<challenge>` in the
   **system browser** (`@capacitor/browser`: Custom Tabs on Android, SFSafariViewController on iOS).
3. The hub signs in with Google and sends the browser to `in.bkesari.app://auth-callback?code=<code>`.
4. Android and iOS hand that link to the app (`@capacitor/app`, `appUrlOpen`; or `App.getLaunchUrl()`
   when the link starts the app). The app closes the browser.
5. The WebView loads `https://bkesari.com/mobile-auth/finish?code=<code>&verifier=<verifier>`; the hub
   sets its session cookie `bk_sid` in the WebView and redirects to `/`.

Another app that registers the same scheme can catch the code but cannot use it without the verifier.

The WebView's user agent ends in `bkesariApp/<version> (android)` or `bkesariApp/<version> (ios)`
(`appendUserAgent`), so the hub can tell it is inside the app.

### What the hub must provide

The hub side is built separately to `docs/design/bkesari-id.md` §1 ("Mobile"). For this app:

| | |
|---|---|
| Allowed app schemes | exactly `in.bkesari.app`. The three earlier app ids are **not** needed: those shells do not start the app flow. |
| `GET /mobile-auth/start?app=<scheme>&challenge=<c>` | Opened in the system browser. `<c>` is 43 characters of `[A-Za-z0-9_-]` (base64url SHA-256 of the verifier). Unknown app or bad challenge: an error page, nothing stored. |
| `/mobile-auth/complete` | Hands the code to `in.bkesari.app://auth-callback?code=<code>`, the code URL-encoded (printable ASCII, at most 2048 characters). **Recommended**: a small page that redirects by script *and* shows an "Open the bkesari app" button (GoKesari's `src/app/mobile-auth/browser-page.ts`), because SFSafariViewController asks before opening an app and Custom Tabs may hold back a redirect to an app. On failure the app also understands `in.bkesari.app://auth-callback?error=<reason>`. |
| `GET /mobile-auth/finish?code=<code>&verifier=<v>` | In the app's WebView. `<v>` is 43 characters of `[A-Za-z0-9_-]` (RFC 7636 allows `[A-Za-z0-9._~-]{43,128}`). Sets `bk_sid` and redirects to `/`. The code is bound to the user and the challenge and lasts two minutes. |
| `bk_sid` | A **persistent** cookie (`Max-Age` or `Expires` = the session's lifetime), from `/mobile-auth/finish` and from the email-code sign-in alike. Android's and iOS's WebViews drop a browser-session cookie when the phone ends the app, and the person would have to sign in at every launch. |
| `/`, `/access/request[?project=<key>]`, `/account`, `/auth/sign-in?next=<path>` | Ordinary pages in the WebView. Keep them on `bkesari.com` (no redirect to `www.` or another host): the app opens any other host in the system browser. |
| Inside the app (user agent contains `bkesariApp/`) | The sign-in page's **Continue with Google**, and "try again" on a failed `/mobile-auth/finish`, link to the app's start screen with `?google=1`: `https://localhost/?google=1` on Android (`(android)` in the user agent), `capacitor://localhost/?google=1` on iOS (`(ios)`). The start screen then starts the sign-in at once. Without this the email code still works in the app, but a Google tap on the hub's page sends the person to the system browser, which signs in the browser, not the app. |
| Other WebViews (the three earlier shells, in-app browsers) | Recommended: hide Continue with Google there (Google refuses them; an Android WebView has `; wv)` in its user agent). |

### Files

| File | What it is |
|---|---|
| `bkesari/capacitor.config.json` | App id, start screen (`https://localhost` / `capacitor://localhost`), `allowNavigation: ["bkesari.com"]`, offline page, user-agent token, iOS app-bound domains |
| `bkesari/www/index.html`, `www/js/start.js` | The start screen: Google, email code, the three hub routes |
| `bkesari/www/js/auth-core.js` | PKCE, start/finish URLs, callback link, allowed-scheme check, pending sign-in (no Capacitor, unit-tested) |
| `bkesari/www/config.js` | The site this build opens, the scheme, the version |
| `bkesari/www/offline.html` | Shown when bkesari.com cannot be reached |
| `bkesari/www/vendor/*.js` | The browser builds of `@capacitor/core`, `@capacitor/app` and `@capacitor/browser` (`npm run vendor` refreshes them; a test checks they match `node_modules`) |
| `bkesari/android/` | Android project (`npx cap add android`). `AndroidManifest.xml`: intent filter for `in.bkesari.app://auth-callback`, backups off (they would carry the WebView's `bk_sid` to another phone). `app/build.gradle`: `versionCode`, `versionName` |
| `bkesari/ios/` | iOS project (`npx cap add ios`, Swift Package Manager). `App/App/Info.plist`: `CFBundleURLTypes` (`in.bkesari.app`), `WKAppBoundDomains` (localhost, bkesari.com, test, dev). `App.xcodeproj`: `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` |
| `test/*.test.js` | `npm test` |

## Versions

| App | Version | Build | Status |
|---|---|---|---|
| bkesari | `1.1.0` | 1 | Not built yet (see "Build status") |
| LadWani, Education, TaskList | `1.0.0` | — | Not built yet; no native project in the repository |

`mobile/` goes from 1.0.0 to **1.1.0** with D-039. `in.bkesari.app` has never been built, so its first
build number is 1. Version = Android `versionName` = iOS `CFBundleShortVersionString`
(`MARKETING_VERSION`); build = Android `versionCode` = iOS `CFBundleVersion` (`CURRENT_PROJECT_VERSION`).
For every store upload raise the build (Play and App Store Connect refuse a build number they have seen),
and for a release raise the version in all of: `package.json`, `bkesari/package.json`,
`bkesari/www/config.js`, `appendUserAgent` in `bkesari/capacitor.config.json`,
`bkesari/android/app/build.gradle`, and both configurations in `bkesari/ios/App/App.xcodeproj`.
`npm test` fails when they disagree. Record them in the tracker too (docs/FEATURE_STATUS_*.xlsx, sheet *Mobile apps*).

## Build status (17 Nov 2026)

| Step | Result |
|---|---|
| `npm ci` (mobile/) | Passes (Capacitor 8.6.2, App 8.1.2, Browser 8.0.5, Splash Screen 8.0.2) |
| `npm run sync:bkesari` (`npx cap sync`) | Passes for Android and iOS, three plugins each |
| `npm test` | Passes |
| Android `./gradlew assembleDebug` | **Blocked in the cloud session.** Gradle 8.14.3 downloads, then `Could not GET 'https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/8.13.0/gradle-8.13.0.pom'. Received status code 403`: the session's network proxy refuses `dl.google.com` (403 on CONNECT), which serves both Google's Maven repository (Android Gradle Plugin, AndroidX) and the Android SDK (platform 36, build tools). There is no Android SDK and no emulator (no KVM) there. |
| iOS build | **Not possible in the cloud session**: it needs macOS and Xcode 16 (Linux container). |

## Build on the Mac

Needs Node 22, JDK 21 and Android Studio (SDK 36) for Android, Xcode 16 for iOS.

```bash
cd mobile
npm ci
npm test
npm run sync:bkesari                      # copies www/ and the plugins into both native projects

# Android debug build: bkesari/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:debug:bkesari

# iOS: Xcode resolves Capacitor through Swift Package Manager
cd bkesari && npx cap open ios            # set the team, then run on a simulator or a phone
```

The earlier shells, if still wanted (they have no native projects yet):

```bash
npm run add:android    # each app in apps/
npm run add:ios
npm run assets         # every icon and splash size for the three shells, from apps/<app>/assets
npm run sync
```

### Android release candidate

1. `cd bkesari/android && ./gradlew bundleRelease` (or Android Studio → Build → Generate Signed Bundle).
2. Sign with the upload key kept on the Mac (`~/keys/bkesari-upload.jks`, never committed).
   Create it once with `keytool -genkeypair -v -keystore ~/keys/bkesari-upload.jks -alias bkesari -keyalg RSA -keysize 4096 -validity 10000`.
3. Test on a device or the Android Emulator (Pixel 6, API 36, and a low-end
   profile: 2 GB RAM, network throttled to 3G) before uploading to Play Console's internal track.

### iOS release candidate

1. `open bkesari/ios/App/App.xcodeproj`, set the team, then Product → Archive.
2. Test on the iOS Simulator (iPhone SE 3rd gen and iPhone 16) and a real device via TestFlight.

### Sign-in checks on a device

1. Fresh install: the start screen. **Continue with Google** opens Google in a browser sheet, not the
   app's page; after choosing the account the app comes back (iOS first asks "Open in bkesari?") and
   shows the hub's projects with their access status.
2. Request access to a project; open the profile.
3. Close and reopen the app: it opens the projects directly. Android: back from there shows the start screen.
4. Sign out on the hub, then use the hub's Continue with Google inside the app: it comes back to the start
   screen and signs in (needs the hub's in-app link, above).
5. Android, Developer options → "Don't keep activities" on: Google sign-in still finishes.
6. Airplane mode: the offline page; Try again once back online.
7. Sign in with an email code inside the app.

## Pointing a build at the test server

- **bkesari**: set `site` in `bkesari/www/config.js` to `https://test.bkesari.com` and
  `server.allowNavigation` in `bkesari/capacitor.config.json` to `["test.bkesari.com"]`, then
  `npm run sync:bkesari`. test.bkesari.com's hub must accept the scheme `in.bkesari.app`.
- **The earlier shells**: change `server.url` in `capacitor.config.json` to `https://test.bkesari.com/<path>`
  and run `npx cap sync` in that app's folder.

Never ship a store build that points at test.

## Tests

`npm test` in `mobile/` (after `npm ci`):

- `test/bkesari-auth.test.js`: PKCE (RFC 7636 example, SubtleCrypto and the fallback agree with Node),
  the start and finish URLs, the callback link (look-alike schemes and hosts refused), the allowed-scheme
  check, the pending sign-in, and a round trip against a hub that binds the code to the challenge.
- `test/bkesari-start.test.js`: the start screen run with stand-ins for the page and the plugins: launch,
  Google, the link back, finish, the back button, `?google=1`, the launch link after Android ended the app,
  and the error paths.
- `test/bkesari-shell.test.js`: app id and scheme, Android and iOS registration, navigation, version and
  build numbers, the vendored scripts and each folder's `package.json` agree.

The repository's `tests/mobile.test.js` (portal-tester, `npm test` at the root) covers `apps/`.

## The three earlier shells on Kesari 1.1.0 (17 Nov 2026)

The three per-project shells (`apps/`) show the new design with no store release: the screens, the icon set,
the "Back to bkesari home" link, the project switcher and the footer all come
from the site. What lives in the apps themselves was updated for 1.1.0:

| What | Where | Made from |
|---|---|---|
| App icon (iOS; Android adaptive foreground + background) | `apps/<app>/assets/icon-only.png`, `icon-foreground.png`, `icon-background.png` | the project's icon from the Kesari icon set, white on its accent; the iOS icon carries the bkesari "b" |
| Splash (light, dark) | `apps/<app>/assets/splash.png`, `splash-dark.png` | the project icon tile, its name and bkesari.com |
| Offline screen | `apps/<app>/www/index.html` | Kesari 1.1.0 values, the project icon, "Try again" and "Back to bkesari home" |
| Splash settings | `capacitor.config.json` → `SplashScreen` | page background `#FAF8F5`, no spinner |

`node mobile/tools/render-assets.js` (from the repository root, needs Playwright)
redraws the PNGs from `packages/kesari-ui/src/icons.json`; `tests/mobile.test.js`
checks every app has them. `npm run assets` (below) turns them into every
Android density and iOS size.

### The bkesari app's icons and splash (17 Nov 2026)

`mobile/bkesari` shipped Capacitor's placeholder images. Its launcher icons (every Android
density: square, round and the adaptive foreground on `@color/ic_launcher_background` = saffron
`#C2560A`; the iOS 1024 px app icon) and its splash screens (Android portrait and landscape, iOS)
now carry the bkesari mark: a white "b" in Mukta, Kesari's face, on saffron, as in the site's
header. `node mobile/tools/render-bkesari-app.js` (from the repository root; Playwright and
Pillow) redraws them at the sizes and colour modes the native projects already use.
