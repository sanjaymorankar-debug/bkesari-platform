# bkesari mobile apps (Android and iOS)

Three apps, one per project, each a [Capacitor](https://capacitorjs.com) shell
around that project's own site. Each app opens the project's address on
bkesari.com and uses **that project's own sign-in**: the LadWani app knows
nothing of a TaskList account, exactly like the web.

| App | Folder | App ID | Opens | Accent |
|---|---|---|---|---|
| LadWani | `apps/ladwani` | `com.bkesari.ladwani` | https://bkesari.com/ladwani/ | maroon `#7C2D12` |
| bkesari Education | `apps/education` | `com.bkesari.education` | https://bkesari.com/edu/ | teal `#0F766E` |
| TaskList | `apps/tasklist` | `com.bkesari.tasklist` | https://bkesari.com/tasklist/ | indigo `#4338CA` |

`www/index.html` in each is only the screen shown when the site cannot be
reached. Everything else, the Kesari design, the three languages, the screens
and TaskList's offline queue, comes from the site, so a deploy reaches the apps
without a store release.

## Status (17 Nov 2026): Kesari 1.1.0

The apps show the new design with no store release: the screens, the icon set,
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

### Status (3 Nov 2026)

**Not built yet.** This repository's cloud session has no Android SDK (Google's
download host is blocked there), no emulator (no KVM) and no macOS/Xcode, and
release signing must use the owner's own keys. Build on the Mac:

## Build on the Mac (once)

```bash
cd mobile
npm install
npm run add:android    # needs Android Studio (SDK 35) and JDK 17
npm run add:ios        # needs Xcode 16 and CocoaPods
npm run assets         # every icon and splash size, from apps/<app>/assets (@capacitor/assets)
npm run sync
```

### Android release candidate

1. `cd apps/<app>/android && ./gradlew bundleRelease` (or Android Studio → Build → Generate Signed Bundle).
2. Sign with the upload key kept on the Mac (`~/keys/bkesari-upload.jks`, never committed).
   Create it once with `keytool -genkeypair -v -keystore ~/keys/bkesari-upload.jks -alias bkesari -keyalg RSA -keysize 4096 -validity 10000`.
3. Test on a device or the Android Emulator (Pixel 6, API 35, and a low-end
   profile: 2 GB RAM, network throttled to 3G) before uploading to Play Console's internal track.
4. Record `versionCode` / `versionName` in the tracker (docs/FEATURE_STATUS_*.xlsx, sheet *Mobile apps*).

### iOS release candidate

1. `open apps/<app>/ios/App/App.xcworkspace`, set the team and bundle ID, then Product → Archive.
2. Test on the iOS Simulator (iPhone SE 3rd gen and iPhone 16) and a real device via TestFlight.
3. Record the build number in the tracker.

Apple reviews apps that only wrap a website closely (App Store guideline 4.2). The
apps add value through offline screens and, next, push reminders for TaskList;
keep those in the submission notes.

## Pointing a build at the test server

Change `server.url` in `capacitor.config.json` to `https://test.bkesari.com/<path>`
and run `npx cap sync` in that app's folder. Never ship a store build that points at test.
