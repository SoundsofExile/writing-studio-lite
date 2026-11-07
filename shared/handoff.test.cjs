// Tests for handoff.cjs. Needs only Node, not Electron or SQLite:
//   node --test handoff.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStoryExport, parseHandoff, planImport, describe } = require('./handoff.cjs');

const NOW = Date.parse('2026-11-05T08:00:00Z');

function records() {
  return [
    { id: 's1', version: 3, project: 'Veil', kind: 'Scene', title: 'One', body: 'First scene.', scratch: 'note', order: 0, status: 'Draft', canon: 'Possibility', bodyFormat: 'markdown' },
    { id: 's2', version: 7, project: 'Veil', kind: 'Scene', title: 'Two', body: 'Second scene.', scratch: '', order: 1, status: 'Draft', canon: 'Confirmed' },
    { id: 's3', version: 1, project: 'Veil', kind: 'Scene', title: 'Cut', body: 'Gone.', order: 2, canon: 'Discarded' },
    { id: 'c1', version: 2, project: 'Veil', kind: 'Character', title: 'Mara', body: 'Archivist.', canon: 'Confirmed' },
    { id: 't1', version: 1, project: 'Veil', kind: 'Thread', title: 'Flood', body: 'Open question.' },
    { id: 'x1', version: 1, project: 'Other', kind: 'Scene', title: 'Elsewhere', body: 'Other story.', order: 0 },
  ];
}

// Minimal stand-in for Store.save so tests can apply a plan and re-import.
function apply(recs, plan) {
  let n = 0;
  for (const op of plan.ops) {
    if (op.type === 'update') {
      const i = recs.findIndex((r) => r.id === op.record.id);
      assert.equal(recs[i].version, op.record.version, 'update must carry the stored version');
      recs[i] = { ...op.record, version: op.record.version + 1 };
    } else recs.push({ ...op.entry, id: 'new' + n++, version: 1 });
  }
  return recs;
}

const v2 = (extra) => JSON.stringify({ format: 'writing-studio-handoff-v2', handoffId: 'h1', story: 'Veil', device: 'phone', ...extra });

test('story export: scenes in order, discarded and other stories left out, references read-only', () => {
  const x = buildStoryExport(records(), 'Veil', { now: NOW, exportId: 'e1' });
  assert.equal(x.format, 'writing-studio-story-v1');
  assert.deepEqual(x.scenes.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(x.scenes[0], { id: 's1', version: 3, title: 'One', order: 0, status: 'Draft', bodyFormat: 'markdown', body: 'First scene.', scratch: 'note' });
  assert.equal(x.scenes[1].bodyFormat, 'rough', 'missing label means rough');
  assert.deepEqual(x.references.map((r) => r.id), ['c1']);
  assert.throws(() => buildStoryExport(records(), ''), /Choose a story/);
});

test('round trip: export, edit on phone, import updates in place with a forced revision', () => {
  const recs = records();
  const exp = buildStoryExport(recs, 'Veil', { now: NOW });
  const s = exp.scenes[1];
  const h = parseHandoff(v2({ scenes: [{ sceneId: s.id, baseVersion: s.version, title: s.title, prose: s.body + ' More from the phone.', scratch: 'stopped here' }] }));
  const plan = planImport(h, recs, { now: NOW });
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].type, 'update');
  assert.equal(plan.ops[0].snapshot, true);
  assert.equal(plan.ops[0].record.body, 'Second scene. More from the phone.');
  assert.equal(plan.ops[0].record.scratch, 'stopped here');
  assert.equal(plan.ops[0].record.canon, 'Confirmed', 'other fields untouched');
  assert.deepEqual(plan.summary, { updated: 1, created: 0, conflicts: 0, skipped: 0, captures: 0, alreadyImported: 0 });
});

test('conflict: desktop changed after export -> desktop untouched, phone copy placed after it', () => {
  const recs = records();
  recs[1] = { ...recs[1], version: 8, body: 'Edited on the PC.' };
  const h = parseHandoff(v2({ scenes: [{ sceneId: 's2', baseVersion: 7, title: 'Two', prose: 'Edited on the phone.' }] }));
  const plan = planImport(h, recs, { now: NOW });
  assert.equal(plan.ops.length, 1);
  const e = plan.ops[0].entry;
  assert.equal(plan.ops[0].type, 'create');
  assert.equal(e.title, 'Two (phone copy)');
  assert.equal(e.body, 'Edited on the phone.');
  assert.equal(e.order, 1.5);
  assert.match(e.scratch, /changed on this computer/);
  assert.equal(plan.summary.conflicts, 1);
});

test('identical text is skipped; missing scene and null sceneId become new scenes at the end', () => {
  const h = parseHandoff(v2({ scenes: [
    { sceneId: 's1', baseVersion: 3, title: 'One', prose: 'First scene.', scratch: 'note' },
    { sceneId: 'gone', baseVersion: 2, title: 'Lost', prose: 'Text.' },
    { sceneId: null, baseVersion: null, title: '', prose: 'Brand new.' },
  ] }));
  const plan = planImport(h, records(), { now: NOW });
  assert.equal(plan.summary.skipped, 1);
  assert.equal(plan.summary.created, 2);
  const [lost, fresh] = plan.ops.map((o) => o.entry);
  assert.equal(lost.order, 3); assert.match(lost.scratch, /not found/);
  assert.equal(fresh.order, 4); assert.equal(fresh.title, 'Phone scene'); assert.equal(fresh.project, 'Veil');
});

test('same scene twice in one handoff: first updates, second becomes a phone copy', () => {
  const h = parseHandoff(v2({ scenes: [
    { sceneId: 's1', baseVersion: 3, title: 'One', prose: 'Take A' },
    { sceneId: 's1', baseVersion: 3, title: 'One', prose: 'Take B' },
  ] }));
  const plan = planImport(h, records(), { now: NOW });
  assert.deepEqual(plan.ops.map((o) => o.type), ['update', 'create']);
  assert.equal(plan.ops[1].entry.body, 'Take B');
});

test('captures become Idea inbox entries', () => {
  const plan = planImport(parseHandoff(v2({ captures: [{ text: 'the flood records were forged\nmore' }, { text: '   ' }] })), records(), { now: NOW });
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].entry.kind, 'Capture');
  assert.equal(plan.ops[0].entry.title, 'the flood records were forged');
  assert.equal(plan.ops[0].entry.origin, 'Phone');
});

test('re-importing the same handoff after applying it changes nothing', () => {
  const recs = records();
  const raw = v2({ scenes: [{ sceneId: 's2', baseVersion: 7, title: 'Two', prose: 'Phone text' }, { sceneId: null, title: 'New', prose: 'x' }], captures: [{ text: 'idea' }] });
  apply(recs, planImport(parseHandoff(raw), recs, { now: NOW }));
  assert.equal(recs.find((r) => r.id === 's2').body, 'Phone text');
  assert.throws(() => planImport(parseHandoff(raw), recs, { now: NOW }), /already imported/);
});

test('a later handoff from the updated scene is clean, and so is the phone carrying on from the same story file', () => {
  const recs = records();
  const first = v2({ handoffId: 'a', scenes: [{ sceneId: 's1', baseVersion: 3, prose: 'v2 text' }] });
  apply(recs, planImport(parseHandoff(first), recs, { now: NOW }));
  // The phone kept writing without a new story file: still based on version 3.
  const again = v2({ handoffId: 'b', scenes: [{ sceneId: 's1', baseVersion: 3, prose: 'more phone text' }] });
  assert.equal(planImport(parseHandoff(again), recs).summary.updated, 1);
  const fresh = v2({ handoffId: 'c', scenes: [{ sceneId: 's1', baseVersion: 4, prose: 'v3 text' }] });
  assert.equal(planImport(parseHandoff(fresh), recs).summary.updated, 1);
});

test('after a desktop edit, the phone carrying on from the old story file is a conflict', () => {
  const recs = records();
  apply(recs, planImport(parseHandoff(v2({ handoffId: 'a', scenes: [{ sceneId: 's1', baseVersion: 3, prose: 'v2 text' }] })), recs, { now: NOW }));
  const s1 = recs.find((r) => r.id === 's1');
  Object.assign(s1, { body: 'edited on the desktop', version: s1.version + 1 });
  const again = v2({ handoffId: 'b', scenes: [{ sceneId: 's1', baseVersion: 3, prose: 'more phone text' }] });
  assert.equal(planImport(parseHandoff(again), recs).summary.conflicts, 1);
});

test('a scene made on the phone keeps its phone id on the desktop', () => {
  const plan = planImport(parseHandoff(v2({ scenes: [{ sceneId: null, phoneId: 'p1', title: 'New', prose: 'x' }] })), records(), { now: NOW });
  assert.equal(plan.ops[0].entry.phoneId, 'p1');
});

test('a phone scene sent again before the desktop sends a story file back updates its copy', () => {
  const recs = records();
  apply(recs, planImport(parseHandoff(v2({ handoffId: 'a', scenes: [{ sceneId: null, phoneId: 'p1', title: 'Bus', prose: 'one' }] })), recs, { now: NOW }));
  const again = planImport(parseHandoff(v2({ handoffId: 'b', scenes: [{ sceneId: null, phoneId: 'p1', title: 'Bus', prose: 'one, two' }] })), recs, { now: NOW });
  assert.deepEqual([again.summary.updated, again.summary.created], [1, 0]);
});

test('v1 (ChatGPT) handoffs still import as a new scene and still block duplicates', () => {
  const raw = JSON.stringify({ format: 'writing-studio-handoff-v1', handoffId: 'old1', story: 'Veil', scene: 'Draft.docx', prose: 'Hello\r\nworld', resumeNote: 'here' });
  const recs = records();
  const plan = planImport(parseHandoff(raw), recs, { now: NOW });
  const e = plan.ops[0].entry;
  assert.equal(e.title, 'Draft'); assert.equal(e.body, 'Hello\r\nworld', 'prose kept byte-for-byte'); assert.equal(e.scratch, 'here');
  assert.equal(e.bodyFormat, 'rough');
  assert.equal(e.handoffId, 'old1');
  apply(recs, plan);
  assert.throws(() => planImport(parseHandoff(raw), recs), /already imported/);
});

test('bad files are rejected with readable messages', () => {
  assert.throws(() => parseHandoff('{nope'), /not valid JSON/);
  assert.throws(() => parseHandoff('{"format":"something-else"}'), /Not a Studio handoff/);
  assert.throws(() => parseHandoff(JSON.stringify(buildStoryExport(records(), 'Veil'))), /story export for the phone/);
  assert.throws(() => parseHandoff(v2({ handoffId: '' , scenes: [{ prose: 'x' }] })), /handoffId/);
  assert.throws(() => parseHandoff(v2({ scenes: [{ sceneId: 's1', prose: 'x' }] })), /no baseVersion/);
  assert.throws(() => parseHandoff(v2({ scenes: [{ sceneId: 's1', baseVersion: '3', prose: 'x' }] })), /whole number/);
  assert.throws(() => parseHandoff(v2({ scenes: [{ title: 'no prose' }] })), /missing "prose"/);
  assert.throws(() => parseHandoff(v2({ scenes: [], captures: [] })), /no scenes or captures/);
});

test('summary text', () => {
  assert.equal(describe({ updated: 1, created: 2, conflicts: 1, skipped: 0, captures: 3, alreadyImported: 0 }),
    '1 scene updated, 2 new scenes, 1 kept as phone copy (changed on both), 3 ideas captured.');
});

test('prose is stored exactly; bodyFormat carried, validated and kept on update', () => {
  const prose = '  *Mara* lied.\r\n\r\n1984. was a year\t ';
  const h = parseHandoff(v2({ scenes: [{ sceneId: null, title: 'Exact', prose, bodyFormat: 'markdown' }, { sceneId: 's1', baseVersion: 3, prose: 'changed' }] }));
  const plan = planImport(h, records(), { now: NOW });
  assert.equal(plan.ops[0].entry.body, prose);
  assert.equal(plan.ops[0].entry.bodyFormat, 'markdown');
  assert.equal(plan.ops[1].record.bodyFormat, 'markdown', 'update keeps existing label when phone sends none');
  assert.throws(() => parseHandoff(v2({ scenes: [{ prose: 'x', bodyFormat: 'html' }] })), /bodyFormat/);
});

test('resolved story name from the desktop overrides the spelling in the file', () => {
  const plan = planImport(parseHandoff(v2({ story: 'veil ', scenes: [{ sceneId: null, prose: 'x' }] })), records(), { story: 'Veil' });
  assert.equal(plan.story, 'Veil');
  assert.equal(plan.ops[0].entry.project, 'Veil');
  assert.equal(plan.ops[0].entry.order, 3);
});
