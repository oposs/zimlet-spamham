'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

const ctx = {
  account: 'Anna@Example.CH', client: 'classic', hostname: 'zimbra.example.ch',
  msgId: '257', folderId: '4', now: new Date('2026-11-18T10:00:00Z'),
  dir: 'ham', content: 'full'
};
const json = (x) => JSON.parse(JSON.stringify(x));
const build = (over, props) => Z.buildReportRequest(Z.parseConfig(props || {}),
  Object.assign({}, ctx, over)).SendMsgRequest;

test('report request: ham full', () => {
  const r = build({});
  assert.equal(r._jsns, 'urn:zimbraMail');
  assert.equal(r.noSave, 1);
  const m = r.m;
  // Body lines as in Zimbra's built-in spam report, so the
  // existing sorting at the report address keeps working.
  assert.equal(m.su._content, '[HAM Report Full] zimbra.example.ch Anna@Example.CH');
  assert.deepEqual(json(m.header), [
    { name: 'X-ZSR-Type', _content: 'ham' },
    { name: 'X-ZSR-Domain', _content: 'example.ch' },
    { name: 'X-ZSR-Server', _content: 'zimbra.example.ch' }
  ]);
  assert.deepEqual(json(m.e), [{ t: 't', a: 'anti-spam@oetiker.ch' }]);
  assert.deepEqual(json(m.attach), { m: [{ id: '257' }] });
  assert.equal(m.mp[0].ct, 'text/plain');
  assert.equal(m.mp[0].content._content,
    'Classified-By: Anna@Example.CH\n' +
    'Classified-As: ham\n' +
    'Action: move\n' +
    'Source-Folder: /Junk\n' +
    'Destination-Folder: /Inbox\n' +
    'Destination-Mailbox: \n' +
    'Reported-Via: classic\n' +
    'Reported-At: 2026-11-18T10:00:00.000Z\n' +
    'Report-Content: full\n');
});

test('report request: spam full', () => {
  const m = build({ dir: 'spam', folderId: '2', msgId: '7' }, {}).m;
  assert.equal(m.su._content, '[SPAM Report Full] zimbra.example.ch Anna@Example.CH');
  assert.equal(m.header[0]._content, 'spam');
  const body = m.mp[0].content._content;
  assert.match(body, /^Classified-As: spam$/m);
  assert.match(body, /^Source-Folder: \/Inbox$/m);
  assert.match(body, /^Destination-Folder: \/Junk$/m);
  assert.match(body, /^Report-Content: full$/m);
  assert.deepEqual(json(m.attach), { m: [{ id: '7' }] });
});

test('report request: ham headers', () => {
  const m = build({ content: 'headers', headersAid: 'h1' }).m;
  assert.equal(m.su._content, '[HAM Report Header] zimbra.example.ch Anna@Example.CH');
  const body = m.mp[0].content._content;
  assert.match(body, /^Destination-Folder: \/Inbox$/m);
  assert.match(body, /^Report-Content: headers$/m);
  assert.deepEqual(json(m.attach), { aid: 'h1' });
});

test('report request: spam headers', () => {
  const m = build({ dir: 'spam', folderId: '2', content: 'headers', headersAid: 'h2' }).m;
  assert.equal(m.su._content, '[SPAM Report Header] zimbra.example.ch Anna@Example.CH');
  assert.match(m.mp[0].content._content, /^Report-Content: headers$/m);
  assert.deepEqual(json(m.attach), { aid: 'h2' });
});

test('source folder: system folders by path, others by id', () => {
  const body = (folderId) => build({ folderId }).m.mp[0].content._content;
  assert.match(body('2'), /^Source-Folder: \/Inbox$/m);
  assert.match(body('3'), /^Source-Folder: \/Trash$/m);
  assert.match(body('257'), /^Source-Folder: 257$/m);
});

test('configured server name wins', () => {
  const r = build({}, { serverName: 'mail1' });
  assert.equal(r.m.su._content, '[HAM Report Full] mail1 Anna@Example.CH');
  assert.equal(r.m.header[2]._content, 'mail1');
});
