# Xochi Lite / Pocket — plan for version 0.1

Status: **approved 2026-11-05, with the suggested defaults for all six decisions.**
The plan now lives in `C:\WritingStudio\xochi-pocket` (writing-studio-lite).
Based on the ChatGPT brief "Xochi Pocket, Development Brief v0.1" (2026-11-05) and on reading
the desktop code. The desktop app was only read, never changed.

The goal, from the brief: open, write for five minutes, close, and trust it's there.

---

## 1. What the desktop code shows

Read from `studio-dev` on branch `feature/drag-windows`, with its uncommitted work.

| Fact | Where | What it means for the phone |
|---|---|---|
| A scene has one of four formats: `rough`, `manuscript`, `markdown`, or no label (`plain`). | `model.cjs` `formatOf` | The phone has to keep the label it was given, even for formats it can't edit. |
| Rough and Manuscript store their styles as six invisible characters, `U+E000`–`U+E005`: italic on/off, bold on/off, title, scene break. A typed `*` stays a `*`. | `prose-format.cjs` | The phone uses the same characters. This is the main compatibility risk (section 5). |
| That file is 1.3 KB, has no dependencies and works anywhere. | `prose-format.cjs` | The phone can use an exact copy, with a test that it still matches the desktop. |
| Rough and Manuscript are on `main`, which is your normal app, and `prose-format.cjs` there is identical to the test copy's. | git history | The phone follows a released format. If the desktop ever changes it, the phone copy has to follow. |
| The editor is CodeMirror 6, and the stored text is always the source. Formatting only changes how it's drawn. | `src/markdown-editor.js` | The same idea carries over. The desktop editor itself is desktop-specific (26 KB: merge, scene breaks, Markdown live view, review), so the phone gets its own smaller editor. |
| Copying and pasting strips the hidden characters, so they never leak into other apps. | `markdown-editor.js` clipboard filters | The phone does the same. |
| Rough deliberately shows no spelling marks. Spelling is turned on for review. | `markdown-editor.js` `spellingFor` | This conflicts with the brief's spell-check item. A decision for you (section 2). |
| The page is Times New Roman from Windows, with a 48px first-line indent, and line height 2. | `style.css` | Android has no Times New Roman, so the phone ships a look-alike font. |
| Dyslexia comfort: page `#e0cfa0`, text `#33302b`, selection `#c9b98c`, letter spacing `.12em`, word spacing `.2em`. Screen only. | `style.css` | The phone copies these values exactly. |
| Nothing is ever hard-deleted; scenes are marked Discarded. | `model.cjs`, renderer | The phone discards too, and doesn't delete. |
| The desktop already has a phone file format, but it isn't wired in. | `xochilite/docs/HANDOFF-v2.md`, `xochilite/shared/handoff.cjs` | Use and fix this format rather than inventing a new one. |

**This PC has no Android tools yet:** no Java, Android SDK, `adb` or Gradle. Node and git are
installed.

---

## 2. Decisions

Decided 2026-11-05: the suggestion in each item below was accepted.

1. **Name:** Xochi Pocket, Xochi Lite, or something else? *Suggestion: Xochi Pocket for the app,
   and keep the repo name.*
2. **Spelling in Rough:** the desktop keeps Rough quiet. *Suggestion: match the desktop. No
   underlines in Rough, the keyboard's own suggestions still work, and a "Check spelling" button
   turns underlines on for that scene.*
3. **Stories on the phone:** *Suggestion: in 0.1, stories come from the desktop (several at
   once are fine). Creating a new story on the phone comes in 0.2.*
   **Changed 2026-11-06:** the phone can also start its own stories in 0.1, because the desktop
   can't export a story file yet.
4. **Discard instead of delete:** *Suggestion: yes. A discarded scene is hidden on the phone and
   can be brought back.*
5. **Where the repo lives:** the `xochilite` folder currently sits untracked inside the desktop
   test copy. *Suggestion: move it to its own folder, `C:\WritingStudio\xochi-pocket`, as the
   local copy of `writing-studio-lite`, so the two apps' git never mix.*
6. **Who it's for:** *Suggestion: just you, installed straight onto your S24 Ultra. No Play
   Store.*

---

## 3. Architecture

Kept small on purpose.

| Part | Choice | Why |
|---|---|---|
| App shell | **Capacitor** (Android only) | The same web technology as the desktop, so the format code is shared and doesn't need rewriting. |
| Language | **Plain JavaScript**, bundled with **esbuild** | It matches the desktop, and the shared files can be used unchanged. TypeScript can come later if it helps. |
| Editor | **CodeMirror 6**, at the same versions as the desktop | It is proven with the hidden-character format. It has to pass the keyboard tests in milestone 2, otherwise the fallback below applies. |
| Screens | Plain HTML/CSS: Home, Scenes, Editor, Files | Four screens, no framework. |
| Storage | **One file per scene** in the app's private folder, written safely (write to a temp file, then swap it in). The last few versions are kept as recovery copies. | Simpler than SQLite on a phone, and nothing can be half-saved. The text is stored byte for byte. Can move to SQLite later if it's ever needed. |
| Saving | About a second after typing stops, and **straight away** when the app goes to the background, the screen locks, or the app is closed | Covers the "phone call interrupts you" case. |
| Files in and out | Android's file picker and Share sheet (Storage Access Framework) | Reaches OneDrive with no login. |
| Font | **Tinos** (free, Apache licence), bundled | Same letter widths as Times New Roman, so a page looks the same. |

**Shared code from the desktop**, copied and never edited by hand:
- `prose-format.cjs`, copied exactly. A test compares its fingerprint with the desktop's copy, so
  any desktop change shows up straight away.
- A few small helpers from `model.cjs` (`formatOf`, `stripMarkers`, `wordCount`), each copied
  with a note saying where it came from.

**If CodeMirror fails the keyboard tests:** the fallback is a plain text box that shows the
hidden styles as visible marks, such as `_italic_`, and turns them back into the hidden
characters on save. It's less pretty, but exact. This is decided by testing on your S24, not
guessed in advance.

---

## 4. File format

Use the existing two files from `HANDOFF-v2.md`:
- **Story file** (`writing-studio-story-v1`), desktop to phone.
- **Handoff file** (`writing-studio-handoff-v2`), phone to desktop.

These fixes are needed before relying on them. All of them are in `xochilite/shared`, phone side:
1. **Format labels:** `handoff.cjs` turns `manuscript` and unlabeled (`plain`) scenes into `rough`.
   The phone has to carry all four labels unchanged, and never send a different label unless you
   switch it on purpose.
2. **Discarding:** v2 has no way to say "discarded on the phone". In 0.1, discarding only hides
   a scene on the phone, and the desktop copy is untouched. Sending discards over is for later.
3. **Ideas without a story:** v2 needs a story name. Ideas you catch on the phone without one go
   into the handoff of whichever story you export next. You'll be asked which.

**Decided 2026-11-06: JSON is how the two apps talk. The phone also exports `.docx`, as a
copy for your own records.**
- Phone to desktop now: a `writing-studio-handoff-v1` JSON file per scene. The desktop on
  `main` already imports it, exactly, as a new scene, with no desktop change. A v2 handoff, which
  updates scenes in place, comes later.
- Desktop to phone: the desktop's `.docx` manuscript can't be split back into scenes, so this
  needs "Export story for phone…" on the desktop. That's the one desktop change this plan needs,
  and it waits for approval.
- `.docx` export from the phone is a records copy only: it loses blank lines, scene breaks and
  notes when it goes through Word.

Tests 8 and 9 in the brief (Android to Windows and back) need the desktop to read these files.
That's a **desktop change, and it waits for your approval.** It's the work I undid earlier:
two menu items and an import step in `main.cjs` and `renderer.cjs`, plus one save option in
`store.cjs`. Until then,
the phone can export plain `.txt` scenes, which the desktop already imports as new scenes.

---

## 5. Data-loss risks

| Risk | How it's handled |
|---|---|
| Android keyboards (Samsung Keyboard, Gboard) split or drop the invisible style characters while composing words, deleting or using autocorrect. | Milestone 2 tests this on the S24 with both keyboards. Hidden characters are treated as one unit when deleting. Every save checks the opening and closing marks pair up, and keeps the previous copy if they don't. |
| Android kills the app in the background before it saves. | Save the moment the app is hidden, before Android can kill it. Recovery copies on top. |
| A save is interrupted halfway (battery dies). | Write to a temp file, then swap it in, so the old file stays whole until the new one is complete. |
| Text quietly changes: line endings, trailing spaces, blank lines, Unicode. | Stored byte for byte. The 10 tests from the brief run on every build, plus a check that opening and closing a scene without typing changes nothing. |
| A format label changes on the way back to the desktop. | Labels are carried unchanged (fix 1 above), with a test. |
| The same scene edited on both devices. | Already handled by v2: the desktop keeps both, and the phone's text becomes a "(phone copy)". |
| Importing the same story file twice on the phone, over newer phone edits. | The phone asks first, and never replaces a scene that has unsent changes. |
| The desktop format changes later. | The fingerprint test on `prose-format.cjs` fails, and the phone copy is updated. |

---

## 6. Milestones

Each milestone ends with something you can try on the phone.

0. **Setup (you plus me).** You install Android Studio, which brings Java and the Android SDK, and
   turn on USB debugging on the S24. I set up the repo folder, Capacitor and a test that runs on
   the PC.
1. **First prototype**, as the brief asks. One scene: type, close, swipe the app away, reopen,
   and the exact text is back. It also survives a restart and battery saver. Plain text only.
2. **Rough page.** Font, indent, italic and bold buttons, undo and redo, and word count. This is
   **the keyboard test on the S24 with Samsung Keyboard and Gboard**, and decides CodeMirror or
   the fallback.
3. **Stories and scenes.** Start a story on the phone or open a story file, a scene list, rename,
   discard, scene notes, reopen at the last cursor position, and Quick Capture from Home.
4. **Focus Mode, Dyslexia comfort and text size.** Each independent. Switching never changes the
   text.
5. **Export.** Through the Share sheet or file picker to OneDrive: a handoff JSON file for the
   desktop, and `.docx` for your records.
6. **Desktop import.** *Only after you approve the desktop change.* Round-trip tests 8 and 9.

Version 0.1 is milestones 1 to 5, with 6 when approved. Sending discards to the desktop is 0.2.

## 7. Testing
- **On the PC** (`node --test`), every change: the 10 text-preservation cases, saving and
  reopening, the hidden characters, format labels, and the `prose-format.cjs` fingerprint.
- **On the S24**, each milestone: a short written checklist covering both keyboards, rotating
  the screen, locking it, a phone call interruption, swiping the app away, and one-handed use.
- **Desktop round trip**: only in milestone 6.

## 8. Not in 0.1
The brief's list stands: no AI, no Ollama, no cloud sync or Microsoft login, no manuscript
assembly, no worldbuilding or character editing, no timeline, no multiple windows, no Word
export, no big formatting menus, no gamification.
