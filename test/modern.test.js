'use strict';
// Logic of the Modern shell (modern/src/lib), tested without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core/zsr-core.js');
const { itemsFromProps } = require('../modern/src/lib/items.js');
const { createTransport } = require('../modern/src/lib/transport.js');
const { readConfig } = require('../modern/src/lib/config.js');
const { stringsFor } = require('../modern/src/lib/strings.js');
const { createRunner } = require('../modern/src/lib/run.js');

const ORIGIN = 'https://zimbra.example.ch';

/* ---- items ---- */

test('itemsFromProps: selection wins over the open mail', () => {
  assert.deepEqual(itemsFromProps({ selectedMails: [{ id: '5' }], emailData: { id: '9' } }), [{ type: 'msg', id: '5' }]);
});

test('itemsFromProps: virtual conversation is a message, Conversation is conv', () => {
  assert.deepEqual(itemsFromProps({ selectedMails: [{ id: '-123' }, { id: '40', __typename: 'Conversation' }, { id: '' }] }),
    [{ type: 'msg', id: '123' }, { type: 'conv', id: '40' }]);
});

test('itemsFromProps: empty selection uses emailData', () => {
  assert.deepEqual(itemsFromProps({ selectedMails: [], emailData: { id: '9' } }), [{ type: 'msg', id: '9' }]);
  assert.deepEqual(itemsFromProps({}), []);
});

/* ---- transport ---- */

function fakeFetch(answer) {
  const calls = [];
  const f = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve(answer(url, opts));
  };
  f.calls = calls;
  return f;
}

test('transport: soap through jsonRequest without _jsns', async () => {
  const reqs = [];
  const batch = { jsonRequest: (r) => { reqs.push(r); return Promise.resolve({ m: [{ id: '1' }] }); } };
  const t = createTransport({ batchClient: batch, origin: ORIGIN, csrfToken: 'c' }, fakeFetch(() => ({})), core);
  const resp = await t.soap('GetMsgRequest', { _jsns: 'urn:zimbraMail', m: { id: '1' } });
  assert.deepEqual(resp, { m: [{ id: '1' }] });
  assert.deepEqual(reqs, [{ name: 'GetMsg', namespace: 'urn:zimbraMail', body: { m: { id: '1' } }, singleRequest: true }]);
});

test('transport: fetchRaw is byte-safe', async () => {
  const bytes = new Uint8Array(256).map((_, i) => i);
  const f = fakeFetch(() => ({ ok: true, arrayBuffer: () => Promise.resolve(bytes.buffer) }));
  const t = createTransport({ batchClient: {}, origin: ORIGIN, csrfToken: 'c' }, f, core);
  const got = await t.fetchRaw('7');
  assert.deepEqual(Array.from(got), Array.from(bytes));
  assert.equal(f.calls[0].url, ORIGIN + '/service/home/~/?id=7');
  assert.equal(f.calls[0].opts.credentials, 'include');
});

test('transport: upload URL, headers, file name and content type', async () => {
  const f = fakeFetch(() => ({ ok: true, text: () => Promise.resolve("200,'null',[{\"aid\":\"a1\"}]") }));
  const t = createTransport({ batchClient: {}, origin: ORIGIN, csrfToken: 'c' }, f, core);
  assert.equal(await t.upload(new Uint8Array(1), 'x"y\r\n.eml', 'message/rfc822'), 'a1');
  const c = f.calls[0];
  assert.equal(c.url, ORIGIN + '/service/upload?fmt=raw,extended');
  assert.equal(c.opts.method, 'POST');
  assert.equal(c.opts.headers['Content-Type'], 'message/rfc822');
  assert.equal(c.opts.headers['Content-Disposition'], 'attachment; filename="x_y__.eml"');
  assert.equal(c.opts.headers['X-Zimbra-Csrf-Token'], 'c');
  await t.upload(new Uint8Array(1), 'Grüsse', 'message/rfc822');
  assert.equal(f.calls[1].opts.headers['Content-Disposition'],
    'attachment; filename="Gr_sse"; filename*=UTF-8\'\'Gr%C3%BCsse');
  f.calls.splice(1, 1);
  await t.upload(new Uint8Array(1), 'h.eml');
  assert.equal(f.calls[1].opts.headers['Content-Type'], 'message/rfc822');
  const bad = createTransport({ batchClient: {}, origin: ORIGIN, csrfToken: 'c' }, fakeFetch(() => ({ ok: false, status: 413 })), core);
  await assert.rejects(bad.upload(new Uint8Array(1), 'a'), /HTTP 413/);
});

/* ---- config ---- */

const zimletEntry = (name, props) => ({
  zimlet: [{ name }],
  zimletConfig: [{ name, global: [{ property: props }] }]
});

test('config: our entry is used, others are ignored', () => {
  const account = { zimlets: { zimlet: [
    zimletEntry('other', [{ name: 'reportAddress', content: 'no@example.ch' }]),
    zimletEntry('ch_oetiker_report_spam_ham_modern', [{ name: 'reportAddress', content: 'spam@example.ch' }])
  ] } };
  assert.equal(readConfig(account, core).reportAddress, 'spam@example.ch');
  assert.equal(readConfig({ zimlets: { zimlet: [zimletEntry('other', [{ name: 'reportAddress', content: 'no@x' }])] } }, core).reportAddress,
    'anti-spam@oetiker.ch');
  assert.equal(readConfig({}, core).reportAddress, 'anti-spam@oetiker.ch');
});

/* ---- strings ---- */

test('strings: German for de locales, English otherwise', () => {
  assert.equal(stringsFor('de_CH', core).cancel, 'Abbrechen');
  assert.equal(stringsFor('de', core).send, 'Senden');
  assert.equal(stringsFor('en_US', core).cancel, 'Cancel');
  assert.equal(stringsFor(undefined, core).cancel, 'Cancel');
  const de = stringsFor('de_DE', core);
  for (const k of Object.keys(core.STRINGS_EN)) assert.equal(typeof de[k], 'string', k);
  assert.equal(de.button, 'Send SPAM|HAM');
});

/* ---- runner ---- */

// Fake Modern context: jsonRequest per name, Apollo client, account.
function fakeContext(opts) {
  opts = opts || {};
  const reqs = [];
  const refetch = [];
  const ctx = {
    zimbraOrigin: ORIGIN,
    csrfToken: 'c',
    getAccount: () => ({ name: 'a@example.ch', prefs: { zimbraPrefLocale: opts.locale || 'en_US' } }),
    getApolloClient: () => opts.apollo || { refetchQueries: (o) => { refetch.push(o); return Promise.resolve(); } },
    zimbraBatchClient: {
      jsonRequest: (r) => {
        reqs.push(r);
        if (opts.fail === r.name) return Promise.reject(new Error(r.name + ' boom'));
        if (r.name === 'GetMsg') return Promise.resolve({ m: [{ id: r.body.m.id, l: (opts.folders || {})[r.body.m.id] || '2', d: 1 }] });
        return Promise.resolve({});
      }
    }
  };
  return { ctx, reqs, refetch, names: () => reqs.map((r) => r.name) };
}
const noFetch = () => Promise.reject(new Error('no fetch'));

test('prepare: inbox mail gives a SPAM dialog model', async () => {
  const f = fakeContext({ folders: { 1: '2' } });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  assert.equal(p.entries.length, 1);
  assert.equal(p.model.title, 'Send SPAM');
  assert.equal(p.model.text, 'This mail will be sent to the O+P SpamFilter Patrol (anti-spam@oetiker.ch). The information is used to improve spam detection.');
  assert.equal(p.model.send, 'Send');
  assert.equal(p.model.wholeMail, 'Whole mail');
});

test('prepare: German locale gives German texts', async () => {
  const f = fakeContext({ folders: { 1: '4' }, locale: 'de_CH' });
  const p = await createRunner({ context: f.ctx, core, fetchFn: noFetch }).prepare({ emailData: { id: '1' } });
  assert.equal(p.model.cancel, 'Abbrechen');
  assert.match(p.model.text, /^Diese Mail wird an die O\+P SpamFilter Patrol/);
});

test('prepare: only Sent gives the nothing text', async () => {
  const f = fakeContext({ folders: { 1: '5' } });
  const p = await createRunner({ context: f.ctx, core, fetchFn: noFetch }).prepare({ selectedMails: [{ id: '1' }] });
  assert.deepEqual(p, { message: core.STRINGS_EN.nothing, failure: false });
});

test('prepare: lookup fault is reported', async () => {
  const f = fakeContext({ fail: 'GetMsg' });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  assert.equal(p.failure, true); assert.match(p.message, /^Report: GetMsg boom$/);
  assert.equal(r.busy(), false);
});

test('send: spam whole mail moves to Junk and refreshes', async () => {
  const f = fakeContext({ folders: { 1: '2' } });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  const s = await r.send(p.entries, 'full');
  assert.deepEqual(f.names(), ['GetMsg', 'SendMsg', 'MsgAction']);
  assert.equal(f.reqs[2].body.action.l, '4');
  assert.match(f.reqs[1].body.m.mp[0].content._content, /^Reported-Via: modern$/m);
  assert.equal(f.reqs[1].body.m.su._content, '[ZHR] SPAM Report zimbra.example.ch a@example.ch');
  assert.deepEqual(s, { message: '1 sent as SPAM and moved to Junk', failure: false });
  assert.deepEqual(f.refetch, [{ include: 'active' }]);
  assert.equal(r.busy(), false);
});

test('send: a fault gives failure', async () => {
  const f = fakeContext({ folders: { 1: '2' }, fail: 'SendMsg' });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  const s = await r.send(p.entries, 'full');
  assert.equal(s.failure, true);
  assert.match(s.message, /^Report: 0 sent; failed: 1: report - SendMsg boom$/);
});

test('send: refresh fallback is used and its throw ignored', async () => {
  let used = 0;
  const f = fakeContext({ folders: { 1: '2' }, apollo: { reFetchObservableQueries: () => { used++; throw new Error('x'); } } });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  const s = await r.send(p.entries, 'full');
  assert.equal(used, 1); assert.equal(s.failure, false);
});

test('cancel sends nothing', async () => {
  const f = fakeContext({ folders: { 1: '2' } });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  await r.prepare({ selectedMails: [{ id: '1' }] });
  assert.deepEqual(f.names(), ['GetMsg']);
  assert.equal(r.busy(), false);
});

test('busy: a second send while the first runs sends nothing', async () => {
  const f = fakeContext({ folders: { 1: '2' } });
  const r = createRunner({ context: f.ctx, core, fetchFn: noFetch });
  const p = await r.prepare({ selectedMails: [{ id: '1' }] });
  const first = r.send(p.entries, 'full');
  assert.equal(r.busy(), true);
  const second = await r.send(p.entries, 'full');
  assert.deepEqual(second, { message: 'Report is already running', failure: false });
  await first;
  assert.equal(f.names().filter((n) => n === 'SendMsg').length, 1);
  const third = await r.prepare({ selectedMails: [{ id: '1' }] });
  assert.ok(third.entries);
});

test('locale: the UI language (html lang of the client) wins over the account pref', async () => {
  const f = fakeContext({ folders: { 1: '2' }, locale: 'de_CH' });
  const saved = globalThis.window;
  globalThis.window = { parent: { document: { documentElement: { lang: 'en_US' } } } };
  try {
    const p = await createRunner({ context: f.ctx, core, fetchFn: noFetch }).prepare({ emailData: { id: '1' } });
    assert.equal(p.model.cancel, 'Cancel');
  } finally {
    if (saved === undefined) delete globalThis.window; else globalThis.window = saved;
  }
});

test('readConfig applies reportByDomain for the account', () => {
  const core = require('../core/zsr-core.js');
  const account = {
    name: 'x@example.org',
    zimlets: { zimlet: [zimletEntry('ch_oetiker_report_spam_ham_modern', [
      { name: 'reportByDomain', content: 'example.org abuse@example.org Org Team' }])] }
  };
  const cfg = readConfig(account, core);
  assert.equal(cfg.reportAddress, 'abuse@example.org');
  assert.equal(cfg.reportTeam, 'Org Team');
});
