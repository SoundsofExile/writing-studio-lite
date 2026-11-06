# Xochi Pocket

Android companion to Xochi Writing Studio. Light on purpose: open, write for five minutes,
close, and trust it's there. The desktop app stays the home of everything.

The plan is [docs/PLAN-v0.1.md](docs/PLAN-v0.1.md) (approved 2026-11-05). The file contract with
the desktop is [docs/HANDOFF-v2.md](docs/HANDOFF-v2.md).

## Where things are
- `src/` — the app. `main.js` is the screen, `scene-store.js` saves scenes safely,
  `fs-capacitor.js` reaches the phone's storage.
- `www/` — the page Android shows. `npm run build` writes `www/app.js`.
- `shared/` — code shared with the desktop. `prose-format.cjs` is an exact copy of the desktop's
  file on `main` and must not be edited here. `handoff.cjs` is the phone file format.
- `test/` — tests that run on the PC. They only ever write to the system temp folder.
- `android/` — the Android project, made by Capacitor.

## Status
Milestone 1 prototype: one plain-text scene that saves a second after typing stops and straight
away when the app is hidden. Tried on the S24 Ultra on 2026-11-06: typed, swiped away, reopened,
and the text came back exactly (checked byte for byte over USB). Not yet tried: locking mid-
sentence, Home before "Saved", a restart, or the stress text (blank lines, emoji, accents).

## Commands
- `npm test` — all PC tests.
- `npm run build` — bundle the app into `www/`.
- `npm run phone` — build, copy into the Android project and run on the connected phone.
  Needs the Android SDK, Java 21 (Temurin 21; `android/gradle.properties` points Gradle at it,
  since Capacitor 8 plugins won't build with Java 25) and USB debugging on the phone.

## The desktop app
https://github.com/SoundsofExile/writing-studio is read for reference only. Desktop support for
phone files isn't wired in, and any desktop change waits for approval.
