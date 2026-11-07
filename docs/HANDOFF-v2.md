# Xochi Lite ⇄ Xochi Writing Studio — handoff format v2

Two small JSON files carry writing between the desktop app and a phone app.
You move them by hand (OneDrive, USB, email to yourself — anything).

    Desktop ──"Export story for phone…"──▶  <story>.story.json  ──▶ Phone
    Phone   ──"Export for desktop"───────▶  <story>.handoff.json ──▶ Desktop "Import draft…"

The desktop never trusts the phone blindly and never silently loses text.
The worst case is always "you get two copies to compare", never "one copy vanished".

---

## 1. Story file (desktop → phone)

    {
      "format": "writing-studio-story-v1",
      "exportId": "6f1c…",                  // random, unique per export
      "exportedAt": "2026-11-05T08:40:00.000Z",
      "story": "The Veil Age",
      "scenes": [
        {
          "id": "a1b2…",                     // desktop record id — phone must send it back unchanged
          "version": 14,                     // desktop record version at export — phone must send it back unchanged
          "title": "The archivist lies",
          "order": 2,
          "status": "Draft",
          "bodyFormat": "markdown",          // "markdown" or "rough"
          "body": "Scene prose…\nParagraphs kept as newlines.",
          "scratch": "Where I stopped…"
        }
      ],
      "references": [                        // read-only on the phone
        { "id": "c3d4…", "kind": "Character", "title": "Mara", "bodyFormat": "rough", "body": "…" }
      ]
    }

- Scenes: every Scene in the story except ones marked Discarded, in scene order.
- References: Character, Location and Worldbuilding entries, for lookup only.
  The phone never sends references back.
- `body` is the exact stored source. For `markdown` scenes it contains Markdown markers;
  the phone shows them formatted but must save the source text, not rendered text.

## 2. Handoff file (phone → desktop)

    {
      "format": "writing-studio-handoff-v2",
      "handoffId": "9e8d…",                  // random, unique per handoff file
      "createdAt": "2026-11-05T11:02:00.000Z",
      "device": "Tony's phone",              // optional, shown in notes
      "story": "The Veil Age",               // must match the desktop story name exactly
      "basedOnExport": "6f1c…",              // optional: exportId the phone started from
      "scenes": [
        {
          "sceneId": "a1b2…",                // from the story file, or null for a brand-new scene
          "baseVersion": 14,                 // from the story file, or null for a brand-new scene
          "title": "The archivist lies",
          "bodyFormat": "markdown",          // optional: omit to keep the desktop label
          "prose": "Full scene text, not a diff.",
          "scratch": "Optional notes / where I stopped"
        }
      ],
      "captures": [
        { "text": "idea: the flood records were forged", "createdAt": "2026-11-05T10:15:00.000Z" }
      ]
    }

- Only include scenes the phone actually changed or created.
- A scene made on the phone carries `"phoneId"` (the phone's own scene id) instead of a `sceneId`.
  The desktop keeps it and puts it in later story files, so the phone links the two instead of
  making a second copy.
- The phone remembers what it sent. When a later story file has a newer desktop version of a scene
  the phone hasn't touched since sending, the phone takes the desktop's copy.
- `prose` is always the complete scene text, and is stored **exactly** as sent:
  no newline, spacing, punctuation or Markdown changes (studio-dev "Exact source" rule).
- `story` is matched by the desktop the same way as v1 handoffs (ignoring capitals and
  extra spaces; it asks if nothing matches).

## 3. What the desktop does with each scene

| Situation | Result |
|---|---|
| `sceneId` is null | New scene at the end of the story, remembering the phone's `phoneId`. If a scene with that `phoneId` is already here (the phone sent it before a story file went back), that scene is updated instead, by the rules below. |
| Scene exists, desktop `version` still equals `baseVersion` | Updated in place. A revision of the old text is saved first, so the History button can bring it back. |
| Scene exists, and the only change since `baseVersion` is the phone's own last handoff | Updated in place too. The desktop records `phoneSync: { from: baseVersion, to: newVersion }` on each phone update, so the phone can keep writing and sending from the same story file. Any desktop edit moves the version past `to`, and the next phone text becomes a copy. |
| Scene exists, but the desktop copy changed since export | **Conflict.** Desktop scene untouched. Phone text becomes a new scene "Title (phone copy)" placed right after it, with a note in its scratchpad. |
| Scene exists and the phone text is identical | Skipped, nothing to do. |
| `sceneId` not found (deleted or wrong file) | New scene, with a note in its scratchpad. |
| Captures | Each becomes an Idea-inbox entry (origin "Phone", Rough). |

New scenes use the handoff's `bodyFormat`, or Rough if none is given.

Re-importing the same handoff file is harmless: each scene and capture is tagged
with `handoffId:index`, and already-applied items are skipped.

## 4. Compatibility

- v1 handoff files (`writing-studio-handoff-v1`, the ChatGPT format) still import
  exactly as before: always a new scene.
- Unknown extra fields are ignored, so a phone app can add fields without breaking import.
- Limits: 20 MB per file, 1,000 scenes and 1,000 captures per handoff.
