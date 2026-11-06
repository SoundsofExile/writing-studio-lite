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
Milestone 2: one scene on the Rough page, in the desktop's dark colours. Tinos font, first-line
indent, italic and bold (inside a word they style the whole word), undo, redo, word count and a
Check spelling switch. The editor is CodeMirror 6, at the desktop's versions.

Tried on the S24 Ultra on 2026-11-06 with Samsung Keyboard and Gboard. Milestone 1: typed, swiped
away, reopened, and the text came back exactly. Milestone 2: styles saved in the desktop's format
(checked over USB). B in the middle of a word used to put hidden marks inside the word, which let
the line wrap there; it now styles the whole word. Not yet tried: locking mid-sentence, Home before
"Saved", a restart.

The app icon comes from `assets/icon-source.webp`; `npm run icon` rebuilds every size.

## Commands
- `npm test` — all PC tests.
- `npm run build` — bundle the app into `www/`.
- `npm run phone` — build, copy into the Android project and run on the connected phone.
  Needs the Android SDK, Java 21 (Temurin 21; `android/gradle.properties` points Gradle at it,
  since Capacitor 8 plugins won't build with Java 25) and USB debugging on the phone.

## The desktop app
https://github.com/SoundsofExile/writing-studio is read for reference only. Desktop support for
phone files isn't wired in, and any desktop change waits for approval.
