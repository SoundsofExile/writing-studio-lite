// What the phone sends out. Two kinds of file, decided 2026-11-06:
// - writing-studio-handoff-v1 JSON, one per scene. The desktop on main imports it exactly, as a
//   new scene (main.cjs 'import'). This is how the two apps talk.
// - .docx, a copy for your own records only. Word can't carry blank lines, notes or the hidden
//   style characters, so it never goes back into either app.
// Nothing here touches the phone's files; main.js writes the results and opens the Share sheet.
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');
const { SCENE_BREAK, stripMarkers, parseLine } = require('../shared/prose-format.cjs');

const HANDOFF_V1 = 'writing-studio-handoff-v1';
const HANDOFF_V2 = 'writing-studio-handoff-v2';

const { fingerprint } = require('./fingerprint.js');

// One scene for the desktop. The prose goes byte for byte; the notes become the desktop's
// "where I stopped" note. bodyFormat is carried as it is: the desktop keeps markdown and reads
// the other labels as rough.
function sceneHandoff({ story, sceneId, title, text, notes = '', bodyFormat = 'rough' }, { now = Date.now() } = {}) {
  if (!String(story || '').trim()) throw new Error('The story needs a name before it can be sent.');
  const scene = String(title || '').trim() || 'Untitled scene';
  const id = `xochi-pocket-${sceneId}-${fingerprint([story, scene, text, notes, bodyFormat].join('\u0000'))}`;
  return {
    format: HANDOFF_V1, handoffId: id, story, scene, prose: text, resumeNote: notes, bodyFormat,
    source: 'Xochi Pocket', exportedAt: new Date(now).toISOString(),
  };
}

// Open ideas, sent as one Rough scene in the story you choose, a blank line between ideas.
// The desktop's v1 import only takes scenes; its Idea inbox needs the newer import.
function ideasHandoff(story, ideas, { now = Date.now() } = {}) {
  if (!ideas.length) throw new Error('There are no open ideas to send.');
  const d = new Date(now); // the phone's own date, not UTC
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const text = ideas.map((i) => i.text.replace(/\r\n?/g, '\n').trim()).join('\n\n');
  return sceneHandoff({ story, sceneId: 'ideas', title: `Ideas from phone ${day}`, text, bodyFormat: 'rough' }, { now });
}

// Handoff v2 (docs/HANDOFF-v2.md): the changed scenes and new ideas for one desktop story, in one
// file. A scene that came from the desktop carries the desktop's id and version, so the desktop
// updates it in place, or keeps both if it changed there too. Its format label stays the desktop's.
// A scene made on the phone arrives as a new scene. The same content always gets the same
// handoffId, so sending it twice can't make duplicates.
function storyHandoff({ story, scenes = [], captures = [], device = 'Xochi Pocket' }, { now = Date.now() } = {}) {
  if (!String(story || '').trim()) throw new Error('The story needs a name before it can be sent.');
  if (!scenes.length && !captures.length) throw new Error('There is nothing new to send.');
  const out = scenes.map((s) => ({
    sceneId: s.desktopId || null,
    baseVersion: s.desktopId ? (Number.isSafeInteger(s.desktopVersion) ? s.desktopVersion : 0) : null,
    title: String(s.title || '').trim() || 'Untitled scene',
    prose: s.text,
    scratch: s.notes || '',
    ...(s.desktopId ? {} : { phoneId: s.id, bodyFormat: s.bodyFormat === 'markdown' ? 'markdown' : 'rough' }),
  }));
  const ideas = captures.map((c) => ({ text: String(c.text), createdAt: c.createdAt || null }));
  return {
    format: HANDOFF_V2, handoffId: `xochi-pocket-${fingerprint(JSON.stringify([story, out, ideas]))}`,
    createdAt: new Date(now).toISOString(), device, source: 'Xochi Pocket', story, scenes: out, captures: ideas,
  };
}

// File names that work on Android, OneDrive and Windows.
function fileName(...parts) {
  const name = parts.map((p) => String(p || '').replace(/[\\/:*?"<>|\u0000-\u001f-]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' - ');
  return (name || 'Untitled').slice(0, 100).trim();
}

// ---- .docx, for records

const FONT = 'Times New Roman';
const SIZE = 24;
const BODY = { line: 480, after: 0 };
const run = (text, style = {}) => new TextRun({ text, font: FONT, size: SIZE, ...style });
const centered = (children, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { ...BODY, after }, children });

// Rough and Manuscript: the desktop's manuscript look (italic, bold, centered titles, # for
// breaks). Markdown and plain text: each line as it is.
function sceneParagraphs(text, bodyFormat) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (bodyFormat !== 'rough' && bodyFormat !== 'manuscript') {
    return lines.filter((l) => l.trim()).map((l) => new Paragraph({ spacing: BODY, indent: { firstLine: 720 }, children: [run(l)] }));
  }
  return lines.filter((l) => stripMarkers(l).trim() || l === SCENE_BREAK).map((line) => {
    const { kind, runs } = parseLine(line);
    if (kind === 'break') return centered([run('#')]);
    const children = runs.map((r) => run(r.text, { ...(r.italic ? { italics: true } : {}), ...(r.bold ? { bold: true } : {}) }));
    return kind === 'title' ? centered(children, 480) : new Paragraph({ spacing: BODY, indent: { firstLine: 720 }, children });
  });
}

// A story (or one scene) with each scene's name above it, since this copy is for finding things later.
function buildRecordsDoc(storyName, scenes) {
  const children = [centered([run(storyName, { bold: true })], 480)];
  scenes.forEach((s, i) => {
    children.push(new Paragraph({ pageBreakBefore: i > 0, spacing: { ...BODY, after: 240 }, children: [run(s.title || 'Untitled scene', { bold: true })] }));
    children.push(...sceneParagraphs(s.text, s.bodyFormat));
  });
  const page = { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };
  return new Document({ creator: 'Xochi Pocket', title: storyName, sections: [{ properties: { page }, children }] });
}

const recordsDocBase64 = (storyName, scenes) => Packer.toBase64String(buildRecordsDoc(storyName, scenes));

module.exports = { HANDOFF_V1, HANDOFF_V2, fingerprint, sceneHandoff, ideasHandoff, storyHandoff, fileName, buildRecordsDoc, recordsDocBase64 };
