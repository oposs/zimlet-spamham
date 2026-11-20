'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

const cfg = Z.parseConfig({ reportAddress: 'spam@example.ch' });
const E = Z.STRINGS_EN;
const ent = (dir) => ({ id: '1', dir: dir, info: {} });
const ok = (dir, extra) => Object.assign({ id: '1', dir, ok: true, reportSent: true, stored: dir === 'ham' }, extra);

test('format keeps unknown placeholders', () => {
  assert.equal(Z.format('{a} and {b}', { a: 1 }), '1 and {b}');
  assert.equal(Z.format('{n}/{n}', { n: 0 }), '0/0');
});

test('dialogText: titles', () => {
  assert.equal(Z.dialogText([ent('spam')], cfg, E).title, 'Send SPAM');
  assert.equal(Z.dialogText([ent('ham'), ent('ham')], cfg, E).title, 'Send false positive (HAM)');
  assert.equal(Z.dialogText([ent('ham'), ent('spam')], cfg, E).title, 'Send SPAM|HAM');
});

test('dialogText: one and many', () => {
  assert.equal(Z.dialogText([ent('spam')], cfg, E).text,
    'This mail will be sent to the O+P SpamFilter Patrol (spam@example.ch). The information is used to improve spam detection.');
  assert.equal(Z.dialogText([ent('spam'), ent('ham'), ent('spam')], cfg, E).text,
    '3 mails will be sent to the O+P SpamFilter Patrol (spam@example.ch): 2 as SPAM, 1 as HAM. The information is used to improve spam detection.');
});

test('summarize counts and problems', () => {
  const s = Z.summarize([ok('spam'), ok('ham', { uncleaned: 'too big' }),
    { id: '9', dir: 'spam', ok: false, step: 'move', error: 'x', reportSent: true, stored: false }]);
  assert.equal(s.spam, 1); assert.equal(s.ham, 1);
  assert.deepEqual(s.uncleaned, ['too big']);
  assert.deepEqual(JSON.parse(JSON.stringify(s.problems)), [{ id: '9', step: 'move', error: 'x', stored: false, reportSent: true }]);
});

const st = (results, strings) => Z.statusText(Z.summarize(results), strings || E);

test('statusText: spam only', () => {
  assert.deepEqual(st([ok('spam'), ok('spam')]), { message: '2 sent as SPAM and moved to Junk', failure: false });
});

test('statusText: ham only', () => {
  assert.equal(st([ok('ham')]).message, '1 sent as HAM and moved to Inbox');
});

test('statusText: both', () => {
  assert.equal(st([ok('ham'), ok('spam')]).message,
    '1 sent as SPAM and moved to Junk, 1 sent as HAM and moved to Inbox');
});

test('statusText: uncleaned', () => {
  assert.equal(st([ok('ham', { uncleaned: 'e1' }), ok('ham', { uncleaned: 'e2' })]).message,
    '2 sent as HAM and moved to Inbox; 2 moved without cleaning (upload failed: e1, e2)');
});

test('statusText: problem with stored hint', () => {
  const r = st([ok('spam'), { id: '7', dir: 'ham', ok: false, step: 'trash', error: 'denied', reportSent: true, stored: true }]);
  assert.equal(r.failure, true);
  assert.equal(r.message,
    'Report: 1 sent; failed: 7: trash - denied (copy is in Inbox; delete the original in Junk by hand)');
});

test('statusText: problem with sent hint, and without hint', () => {
  const r = st([{ id: '7', dir: 'spam', ok: false, step: 'move', error: 'x', reportSent: true, stored: false },
    { id: '8', dir: 'spam', ok: false, step: 'report', error: 'y', reportSent: false, stored: false }]);
  assert.equal(r.message,
    'Report: 0 sent; failed: 7: move - x (report was sent, mail left in place); 8: report - y');
});

test('statusText: nothing', () => {
  assert.deepEqual(st([]), { message: E.nothing, failure: false });
});

test('a German table is used, missing keys fall back to English', () => {
  const de = { doneSpam: '{n} als SPAM gesendet und nach Junk verschoben' };
  assert.equal(st([ok('spam'), ok('ham')], de).message,
    '1 als SPAM gesendet und nach Junk verschoben, 1 sent as HAM and moved to Inbox');
  assert.equal(Z.dialogText([ent('spam')], cfg, de).title, 'Send SPAM');
});

test('English table has every key', () => {
  for (const k of ['titleSpam', 'titleHam', 'titleMixed', 'textOne', 'textMany', 'headersOnly',
    'wholeMail', 'cancel', 'send', 'doneSpam', 'doneHam', 'uncleaned', 'failed', 'hintStored',
    'hintSent', 'nothing', 'busy', 'errorPrefix']) {
    assert.equal(typeof E[k], 'string', k);
  }
});

test('dialogText: the recipient team name comes from the config', () => {
  const c = Z.parseConfig({ reportAddress: 'abuse@example.org', reportTeam: 'Example Abuse Desk' });
  assert.equal(Z.dialogText([ent('spam')], c, E).text,
    'This mail will be sent to the Example Abuse Desk (abuse@example.org). The information is used to improve spam detection.');
  assert.equal(Z.parseConfig({}).reportTeam, 'O+P SpamFilter Patrol');
});
