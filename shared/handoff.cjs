// Phone handoff, format v2. See docs/HANDOFF-v2.md in the Xochi Pocket repo (writing-studio-lite).
// This desktop copy is the original: Xochi Pocket keeps an identical copy in shared/ and a test checks they match.
//
// Everything here is pure: it takes records in and returns plans out, and
// never touches the database or the file system. main.cjs does the saving.
// That keeps the tricky part (who wins when both sides changed) testable
// without Electron or SQLite.
const crypto = require('node:crypto');

const STORY_FORMAT = 'writing-studio-story-v1';
const HANDOFF_V1 = 'writing-studio-handoff-v1';
const HANDOFF_V2 = 'writing-studio-handoff-v2';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ITEMS = 1000;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_TAGS = 50; // handoff tags remembered per record
const REFERENCE_KINDS = ['Character', 'Location', 'Worldbuilding'];

// Used for titles and notes only. Scene prose is kept byte-for-byte (studio-dev
// ROADMAP, "Exact source"): no newline, spacing or Markdown changes on import.
function normalizeText(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function sceneOrder(a, b) { return (a.order || 0) - (b.order || 0); }

// ---------------------------------------------------------------------------
// Desktop -> phone
// ---------------------------------------------------------------------------
function buildStoryExport(records, story, { now = Date.now(), exportId = crypto.randomUUID() } = {}) {
  if (typeof story !== 'string' || !story) throw Error('Choose a story before exporting.');
  const mine = records.filter((r) => r.project === story && r.canon !== 'Discarded');
  const scenes = mine.filter((r) => r.kind === 'Scene').sort(sceneOrder).map((r) => ({
    id: r.id, version: r.version, title: r.title || '', order: r.order || 0,
    status: r.status || 'Draft', bodyFormat: bodyFormatOf(r.bodyFormat), body: r.body || '', scratch: r.scratch || '',
  }));
  const references = mine.filter((r) => REFERENCE_KINDS.includes(r.kind)).map((r) => ({
    id: r.id, kind: r.kind, title: r.title || '', bodyFormat: bodyFormatOf(r.bodyFormat), body: r.body || '',
  }));
  return { format: STORY_FORMAT, exportId, exportedAt: new Date(now).toISOString(), story, scenes, references };
}

// ---------------------------------------------------------------------------
// Phone -> desktop: parsing and validation
// ---------------------------------------------------------------------------
function text(value, field, { required = false, exact = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw Error(`Handoff is missing "${field}".`);
    return '';
  }
  if (typeof value !== 'string') throw Error(`Handoff field "${field}" must be text.`);
  if (value.length > MAX_TEXT) throw Error(`Handoff field "${field}" is too long.`);
  return exact ? value : normalizeText(value);
}
const FORMATS = ['markdown', 'rough'];
const bodyFormatOf = (value) => (value === 'markdown' ? 'markdown' : 'rough');

function list(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw Error(`Handoff field "${field}" must be a list.`);
  if (value.length > MAX_ITEMS) throw Error(`Handoff has too many ${field} (max ${MAX_ITEMS}).`);
  return value;
}

// Returns one normalized shape for both v1 and v2 files.
function parseHandoff(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) throw Error('Handoff file is too large.');
  let x;
  try { x = JSON.parse(String(raw).replace(/^\uFEFF/, '')); } catch { throw Error('This file is not valid JSON.'); }
  if (!x || typeof x !== 'object') throw Error('Not a Studio handoff file');

  if (x.format === HANDOFF_V1) {
    if (typeof x.prose !== 'string' || typeof x.story !== 'string') throw Error('Not a Studio handoff file');
    return {
      version: 1, handoffId: typeof x.handoffId === 'string' ? x.handoffId : '', story: x.story, device: '',
      scenes: [{ sceneId: null, baseVersion: null,
        title: text(x.scene, 'scene').replace(/\.(docx|json|txt)$/i, '') || 'Imported scene',
        prose: text(x.prose, 'prose', { exact: true }), scratch: text(x.resumeNote, 'resumeNote'),
        bodyFormat: x.bodyFormat === 'markdown' ? 'markdown' : null }],
      captures: [],
    };
  }

  if (x.format !== HANDOFF_V2) {
    if (x.format === STORY_FORMAT) throw Error('That is a story export for the phone, not a handoff back from it.');
    throw Error('Not a Studio handoff file');
  }
  const handoffId = text(x.handoffId, 'handoffId', { required: true });
  if (!handoffId.trim()) throw Error('Handoff is missing "handoffId".');
  const story = text(x.story, 'story', { required: true });
  if (!story.trim()) throw Error('Handoff is missing "story".');
  const scenes = list(x.scenes, 'scenes').map((s, i) => {
    if (!s || typeof s !== 'object') throw Error(`Scene ${i + 1} in the handoff is not valid.`);
    const sceneId = s.sceneId === undefined || s.sceneId === null ? null : text(s.sceneId, 'sceneId');
    const baseVersion = s.baseVersion === undefined || s.baseVersion === null ? null : s.baseVersion;
    if (baseVersion !== null && !Number.isSafeInteger(baseVersion)) throw Error(`Scene ${i + 1}: "baseVersion" must be a whole number.`);
    if (sceneId && baseVersion === null) throw Error(`Scene ${i + 1} has a sceneId but no baseVersion.`);
    if (s.bodyFormat !== undefined && s.bodyFormat !== null && !FORMATS.includes(s.bodyFormat)) throw Error(`Scene ${i + 1}: "bodyFormat" must be "markdown" or "rough".`);
    // phoneId: the phone's own id for a scene made there, so the story file can link the two later.
    const phoneId = typeof s.phoneId === 'string' && s.phoneId.length <= 200 ? s.phoneId : null;
    return { sceneId, baseVersion, phoneId, title: text(s.title, 'title'), prose: text(s.prose, 'prose', { required: true, exact: true }),
      bodyFormat: s.bodyFormat || null,
      scratch: s.scratch === undefined || s.scratch === null ? null : text(s.scratch, 'scratch') };
  });
  const captures = list(x.captures, 'captures').map((c, i) => {
    if (!c || typeof c !== 'object') throw Error(`Capture ${i + 1} in the handoff is not valid.`);
    return { text: text(c.text, 'text', { required: true }) };
  }).filter((c) => c.text.trim());
  if (!scenes.length && !captures.length) throw Error('This handoff has no scenes or captures in it.');
  return { version: 2, handoffId, story, device: text(x.device, 'device'), scenes, captures };
}

// ---------------------------------------------------------------------------
// Phone -> desktop: deciding what happens
// ---------------------------------------------------------------------------
// `story` must already be resolved to an existing desktop story name (studio-dev
// matches names ignoring case/spacing and asks when nothing matches); pass it in
// via options.story, otherwise handoff.story is used as-is.
// Returns { story, ops, summary }. Each op is either
//   { type: 'update', record, snapshot: true }  -> keep a revision of the old text, then save
//   { type: 'create', entry }                   -> save as a new record
function planImport(handoff, records, { now = Date.now(), story = handoff.story } = {}) {
  const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  const from = handoff.device ? ` from ${handoff.device}` : '';
  const summary = { updated: 0, created: 0, conflicts: 0, skipped: 0, captures: 0, alreadyImported: 0 };
  const ops = [];

  if (handoff.version === 1 && handoff.handoffId && records.some((r) => r.handoffId === handoff.handoffId)) {
    throw Error('This handoff was already imported.');
  }
  const applied = new Set(records.flatMap((r) => r.handoffItems || []));
  const byId = new Map(records.map((r) => [r.id, r]));
  const touched = new Set();
  let nextOrder = records.filter((r) => r.project === story && r.kind === 'Scene')
    .reduce((m, s) => Math.max(m, (s.order || 0) + 1), 0);
  const tag = (kind, i) => (handoff.version === 2 ? [`${handoff.handoffId}:${kind}${i}`] : []);
  const base = (extra) => ({ project: story, links: [], canon: 'Possibility', origin: handoff.version === 2 ? 'Phone handoff' : '', ...extra });

  handoff.scenes.forEach((s, i) => {
    const [key] = tag('s', i);
    if (key && applied.has(key)) { summary.alreadyImported++; return; }
    const tags = key ? [key] : [];
    // A scene made on the phone has no desktop id until a story file goes back, so the phone may
    // send it again in the meantime: find the copy made last time by the phone's own id.
    const existing = s.sceneId ? byId.get(s.sceneId)
      : s.phoneId ? records.find((r) => r.phoneId === s.phoneId && r.kind === 'Scene' && r.project === story) : null;
    const title = s.title.trim();

    if (!existing) {
      const note = s.sceneId ? `Imported${from} ${stamp}. The original scene was not found on this computer, so this is a new scene.` : '';
      // phoneSync: the new record is version 1, made from this phone scene with no desktop version.
      ops.push({ type: 'create', entry: base({ kind: 'Scene', title: title || 'Phone scene', body: s.prose, bodyFormat: bodyFormatOf(s.bodyFormat),
        scratch: [note, s.scratch || ''].filter(Boolean).join('\n\n'), status: 'Draft', order: nextOrder++,
        handoffItems: tags, ...(!s.sceneId && s.phoneId ? { phoneId: s.phoneId, phoneSync: { from: null, to: 1 } } : {}),
        ...(handoff.version === 1 && handoff.handoffId ? { handoffId: handoff.handoffId } : {}) }) });
      summary.created++;
      return;
    }

    const sameText = existing.body === s.prose && (!title || title === existing.title) &&
      (!s.bodyFormat || s.bodyFormat === bodyFormatOf(existing.bodyFormat)) &&
      (s.scratch === null || s.scratch === (existing.scratch || ''));
    if (sameText) { summary.skipped++; return; }

    // Also clean: the phone is still working from the same story file, and the only change here
    // since then is the phone's own last handoff (phoneSync records it). Any desktop edit moves
    // the version on, so it no longer matches and the phone text becomes a copy instead.
    const synced = existing.phoneSync && existing.phoneSync.from === s.baseVersion && existing.phoneSync.to === existing.version;
    const clean = existing.kind === 'Scene' && existing.project === story &&
      (existing.version === s.baseVersion || synced) && !touched.has(existing.id);
    if (clean) {
      touched.add(existing.id);
      ops.push({ type: 'update', snapshot: true, record: { ...existing, title: title || existing.title, body: s.prose,
        bodyFormat: s.bodyFormat || existing.bodyFormat,
        scratch: s.scratch === null ? existing.scratch : s.scratch,
        phoneSync: { from: s.baseVersion, to: (existing.version || 0) + 1 },
        handoffItems: [...(existing.handoffItems || []), ...tags].slice(-MAX_TAGS) } });
      summary.updated++;
      return;
    }

    const note = `Phone copy${from}, imported ${stamp}. "${existing.title}" changed on this computer after it was sent ` +
      'to the phone, so both versions were kept. Compare them, keep what you want, then discard this one.';
    ops.push({ type: 'create', entry: base({ kind: 'Scene', title: `${title || existing.title} (phone copy)`, body: s.prose,
      bodyFormat: bodyFormatOf(s.bodyFormat || existing.bodyFormat),
      scratch: [note, s.scratch || ''].filter(Boolean).join('\n\n'), status: 'Draft',
      order: (existing.project === story ? (existing.order || 0) : nextOrder++) + 0.5, handoffItems: tags }) });
    summary.conflicts++;
  });

  handoff.captures.forEach((c, i) => {
    const [key] = tag('c', i);
    if (key && applied.has(key)) { summary.alreadyImported++; return; }
    const body = c.text.trim();
    ops.push({ type: 'create', entry: base({ kind: 'Capture', title: body.split('\n')[0].slice(0, 60) || 'Quick thought',
      body, bodyFormat: 'rough', scratch: '', status: 'Idea', order: 0, origin: 'Phone', handoffItems: key ? [key] : [] }) });
    summary.captures++;
  });

  if (!ops.length && summary.alreadyImported && !summary.skipped) throw Error('This handoff was already imported.');
  return { story, ops, summary };
}

function describe(summary) {
  const parts = [];
  if (summary.updated) parts.push(`${summary.updated} scene${summary.updated > 1 ? 's' : ''} updated`);
  if (summary.created) parts.push(`${summary.created} new scene${summary.created > 1 ? 's' : ''}`);
  if (summary.conflicts) parts.push(`${summary.conflicts} kept as phone cop${summary.conflicts > 1 ? 'ies' : 'y'} (changed on both)`);
  if (summary.captures) parts.push(`${summary.captures} idea${summary.captures > 1 ? 's' : ''} captured`);
  if (summary.skipped) parts.push(`${summary.skipped} unchanged`);
  if (summary.alreadyImported) parts.push(`${summary.alreadyImported} already imported earlier`);
  return parts.length ? parts.join(', ') + '.' : 'Nothing to import.';
}

module.exports = { buildStoryExport, parseHandoff, planImport, describe, normalizeText,
  STORY_FORMAT, HANDOFF_V1, HANDOFF_V2 };
