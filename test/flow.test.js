'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

const cfg = Z.parseConfig({});
const ctx = { account: 'a@example.ch', client: 'classic', hostname: 'h', now: new Date(0) };
const RAW_TEXT = 'X-Spam-Flag: YES\r\nSubject: [*** SPAM 6 ***] Hi\r\n\r\nbody';
const RAW = Uint8Array.from(Buffer.from(RAW_TEXT, 'latin1'));
const INFO = { id: '257', l: '4', f: 'uaf', tn: 'work', d: 1700000000000 };
const ham = (id, info) => ({ id: id || '257', dir: 'ham', info: Object.assign({}, INFO, { id: id || '257' }, info) });
const spam = (id) => ({ id: id || '30', dir: 'spam', info: { id: id || '30', l: '2', su: 'Win big' } });

// Fake transport recording every call; `fail` names a step to reject.
// opts.folders maps message id -> folder for GetMsgRequest.
function fake(opts) {
  opts = opts || {};
  const calls = [];
  let uploads = 0;
  const t = {
    calls,
    soap(name, body) {
      calls.push({ name, body });
      if (opts.fail === name) return Promise.reject(new Error(name + ' boom'));
      if (name === 'GetMsgRequest') {
        const id = body.m.id;
        const l = (opts.folders && opts.folders[id]) || '4';
        return Promise.resolve({ m: [{ id, l, d: 1 }] });
      }
      if (name === 'GetConvRequest') return Promise.resolve({ c: [{ id: body.c.id, m: opts.convMsgs || [] }] });
      if (name === 'AddMsgRequest') return Promise.resolve(opts.addResp !== undefined ? opts.addResp : { m: [{ id: '900' }] });
      return Promise.resolve({});
    },
    fetchRaw(id) {
      calls.push({ name: 'fetchRaw', id });
      return opts.fail === 'fetchRaw' ? Promise.reject(new Error('net')) : Promise.resolve(opts.raw || RAW);
    },
    upload(bytes, filename, contentType) {
      calls.push({ name: 'upload', bytes, filename, contentType });
      uploads++;
      if (opts.fail === 'upload' || (opts.fail === 'upload2' && uploads === 2)) {
        return Promise.reject(new Error('up'));
      }
      return Promise.resolve('aid-' + uploads);
    }
  };
  return t;
}
const names = (t) => t.calls.map((c) => c.name);
const txt = (u8) => Buffer.from(u8).toString('latin1');
const json = (x) => JSON.parse(JSON.stringify(x));

/* ---- classify ---- */

test('classify: junk is ham, inbox is spam', async () => {
  const t = fake({ folders: { 1: '4', 2: '2' } });
  const r = await Z.classify(t, [{ type: 'msg', id: '1' }, { type: 'msg', id: '2' }]);
  assert.deepEqual(r.entries.map((e) => ({ id: e.id, dir: e.dir })), [{ id: '1', dir: 'ham' }, { id: '2', dir: 'spam' }]);
  assert.equal(r.entries[0].info.l, '4');
  assert.deepEqual(json(r.skipped), []);
});

test('classify: sent and drafts are skipped as own', async () => {
  const t = fake({ folders: { 1: '5', 2: '6' } });
  const r = await Z.classify(t, [{ type: 'msg', id: '1' }, { type: 'msg', id: '2' }]);
  assert.deepEqual(json(r.entries), []);
  assert.deepEqual(json(r.skipped), [{ id: '1', reason: 'own' }, { id: '2', reason: 'own' }]);
});

test('classify: trash selected on its own is spam', async () => {
  const r = await Z.classify(fake({ folders: { 1: '3' } }), [{ type: 'msg', id: '1' }]);
  assert.equal(r.entries[0].dir, 'spam');
});

test('classify: shared id skipped without a call', async () => {
  const t = fake();
  const r = await Z.classify(t, [{ type: 'msg', id: 'abc:12' }, { type: 'conv', id: 'abc:13' }]);
  assert.deepEqual(names(t), []);
  assert.deepEqual(json(r.skipped), [{ id: 'abc:12', reason: 'shared' }, { id: 'abc:13', reason: 'shared' }]);
});

test('classify: conversation with msgId uses that message', async () => {
  const t = fake({ folders: { 22: '2' } });
  const r = await Z.classify(t, [{ type: 'conv', id: '20', msgId: '22' }]);
  assert.deepEqual(names(t), ['GetMsgRequest']);
  assert.equal(r.entries[0].id, '22'); assert.equal(r.entries[0].dir, 'spam');
});

test('classify: virtual conversation is its message', async () => {
  const t = fake({ folders: { 7: '4' } });
  const r = await Z.classify(t, [{ type: 'conv', id: '-7' }]);
  assert.deepEqual(names(t), ['GetMsgRequest']);
  assert.equal(r.entries[0].id, '7');
});

test('classify: conversation picks newest eligible', async () => {
  const t = fake({
    folders: { 14: '4' },
    convMsgs: [{ id: '11', l: '2', d: 100 }, { id: '12', l: '3', d: 300 }, { id: '13', l: '5', d: 400 }, { id: '14', l: '4', d: 200 }]
  });
  const r = await Z.classify(t, [{ type: 'conv', id: '10' }]);
  assert.deepEqual(json(t.calls[0].body), { _jsns: 'urn:zimbraMail', c: { id: '10' } });
  assert.deepEqual(r.entries.map((e) => [e.id, e.dir]), [['14', 'ham']]);
});

test('conversation without candidate is skipped', async () => {
  const t = fake({ convMsgs: [{ id: '11', l: '3', d: 1 }, { id: '12', l: '5', d: 2 }, { id: '13', l: '6', d: 3 }] });
  const r = await Z.classify(t, [{ type: 'conv', id: '10' }]);
  assert.deepEqual(json(r.entries), []);
  assert.deepEqual(json(r.skipped), [{ id: '10', reason: 'empty' }]);
  assert.deepEqual(names(t), ['GetConvRequest']);
});

test('classify: the same message twice counts once', async () => {
  const r = await Z.classify(fake(), [{ type: 'msg', id: '1' }, { type: 'conv', id: '-1' }]);
  assert.equal(r.entries.length, 1);
});

/* ---- headerBlock ---- */

const hb = (s) => txt(Z.headerBlock(Uint8Array.from(Buffer.from(s, 'latin1'))));
test('headerBlock: CRLF', () => assert.equal(hb('A: 1\r\nB: 2\r\n\r\nbody'), 'A: 1\r\nB: 2\r\n'));
test('headerBlock: LF', () => assert.equal(hb('A: 1\nB: 2\n\nbody'), 'A: 1\nB: 2\n'));
test('headerBlock: no body', () => assert.equal(hb('A: 1\r\nB: 2'), 'A: 1\r\nB: 2'));
test('headerBlock: folded header kept', () => assert.equal(hb('A: 1\r\n x\r\n\r\nb'), 'A: 1\r\n x\r\n'));

/* ---- headersOnlyMessage ---- */

const hom = (s) => txt(Z.headersOnlyMessage(Uint8Array.from(Buffer.from(s, 'latin1'))));
const CT = 'Content-Type: text/plain; charset=us-ascii';

test('headersOnlyMessage: MIME headers replaced, original type kept, no body', () => {
  const out = hom('From: a\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed;\r\n boundary="x"\r\n' +
    'Content-Transfer-Encoding: 7bit\r\nSubject: s\r\n\r\n--x\r\nsecret\r\n--x--\r\n');
  assert.equal(out, 'From: a\r\nMIME-Version: 1.0\r\nX-ZSR-Original-Content-Type: multipart/mixed;\r\n boundary="x"\r\n' +
    'Subject: s\r\n' + CT + '\r\n\r\n' + Z.REMOVED_TEXT + '\r\n');
  assert.ok(!out.includes('secret'));
});

test('headersOnlyMessage: LF mail stays LF, Content-Disposition dropped', () => {
  assert.equal(hom('From: a\ncontent-type: text/html\nContent-Disposition: inline\n\n<b>x</b>'),
    'From: a\nX-ZSR-Original-Content-Type: text/html\n' + CT + '\n\n' + Z.REMOVED_TEXT + '\n');
});

test('headersOnlyMessage: mail without body or final line break', () => {
  assert.equal(hom('From: a\r\nSubject: s'), 'From: a\r\nSubject: s\r\n' + CT + '\r\n\r\n' + Z.REMOVED_TEXT + '\r\n');
});

/* ---- SPAM ---- */

test('spam whole mail: report then move to Junk', async () => {
  const t = fake();
  const r = await Z.reportOne(t, cfg, ctx, spam('30'), 'full');
  assert.deepEqual(names(t), ['SendMsgRequest', 'MsgActionRequest']);
  assert.equal(t.calls[0].body.m.su._content, '[ZHR] SPAM Report h a@example.ch');
  assert.deepEqual(json(t.calls[0].body.m.attach), { m: [{ id: '30' }] });
  assert.deepEqual(json(t.calls[1].body), { _jsns: 'urn:zimbraMail', action: { id: '30', op: 'move', l: '4' } });
  assert.deepEqual(json(r), { id: '30', dir: 'spam', ok: true, reportSent: true, stored: false });
});

test('spam headers only: a mail without content is uploaded as message/rfc822', async () => {
  const t = fake();
  const r = await Z.reportOne(t, cfg, ctx, spam('30'), 'headers');
  assert.deepEqual(names(t), ['fetchRaw', 'upload', 'SendMsgRequest', 'MsgActionRequest']);
  const up = t.calls[1];
  assert.equal(txt(up.bytes), 'X-Spam-Flag: YES\r\nSubject: [*** SPAM 6 ***] Hi\r\n' +
    'Content-Type: text/plain; charset=us-ascii\r\n\r\n' + Z.REMOVED_TEXT + '\r\n');
  assert.ok(!txt(up.bytes).includes('body'));
  assert.equal(up.filename, 'Win big');
  assert.equal(up.contentType, 'message/rfc822');
  assert.deepEqual(json(t.calls[2].body.m.attach), { aid: 'aid-1' });
  assert.match(t.calls[2].body.m.mp[0].content._content, /^Report-Content: headers$/m);
  assert.equal(r.ok, true);
});

test('spam headers only: upload failure stops before the report', async () => {
  const t = fake({ fail: 'upload' });
  const r = await Z.reportOne(t, cfg, ctx, spam('30'), 'headers');
  assert.deepEqual(names(t), ['fetchRaw', 'upload']);
  assert.equal(r.ok, false); assert.equal(r.step, 'report'); assert.equal(r.reportSent, false);
});

test('spam move fails', async () => {
  const t = fake({ fail: 'MsgActionRequest' });
  const r = await Z.reportOne(t, cfg, ctx, spam('30'), 'full');
  assert.equal(r.ok, false); assert.equal(r.step, 'move'); assert.equal(r.reportSent, true);
  assert.match(r.error, /boom/);
});

/* ---- HAM ---- */

test('ham happy path', async () => {
  const t = fake();
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.deepEqual(names(t), ['fetchRaw', 'SendMsgRequest', 'upload', 'AddMsgRequest', 'MsgActionRequest']);
  assert.deepEqual(json(r), { id: '257', dir: 'ham', ok: true, reportSent: true, stored: true });
  assert.equal(t.calls[1].body.m.attach.m[0].id, '257');
  assert.match(t.calls[1].body.m.mp[0].content._content, /^Source-Folder: \/Junk$/m);
  assert.equal(txt(t.calls[2].bytes), 'Subject: Hi\r\n\r\nbody');
  assert.equal(t.calls[2].contentType, 'message/rfc822');
  assert.deepEqual(json(t.calls[3].body.m), { l: '2', f: 'uf', tn: 'work', d: 1700000000000, aid: 'aid-1' });
  assert.equal(t.calls[3].body._jsns, 'urn:zimbraMail');
  assert.deepEqual(json(t.calls[4].body.action), { id: '257', op: 'move', l: '3' });
});

test('ham: no flags and no tags', async () => {
  const t = fake();
  await Z.reportOne(t, cfg, ctx, ham('1', { f: undefined, tn: undefined }), 'full');
  assert.deepEqual(json(t.calls[3].body.m), { l: '2', d: 1700000000000, aid: 'aid-1' });
});

test('ham headers only still stores the cleaned copy', async () => {
  const t = fake();
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'headers');
  assert.deepEqual(names(t), ['fetchRaw', 'upload', 'SendMsgRequest', 'upload', 'AddMsgRequest', 'MsgActionRequest']);
  assert.equal(t.calls[1].contentType, 'message/rfc822');
  assert.equal(t.calls[1].filename, 'headers');
  assert.deepEqual(json(t.calls[2].body.m.attach), { aid: 'aid-1' });
  assert.equal(t.calls[3].contentType, 'message/rfc822');
  assert.equal(t.calls[4].body.m.aid, 'aid-2');
  assert.equal(r.ok, true); assert.equal(r.stored, true);
});

test('ham: report fails, nothing else happens', async () => {
  const t = fake({ fail: 'SendMsgRequest' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.deepEqual(names(t), ['fetchRaw', 'SendMsgRequest']);
  assert.equal(r.ok, false); assert.equal(r.reportSent, false); assert.equal(r.step, 'report');
  assert.match(r.error, /boom/);
});

test('ham: fetch fails before anything is sent', async () => {
  const t = fake({ fail: 'fetchRaw' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.deepEqual(names(t), ['fetchRaw']);
  assert.equal(r.step, 'fetch'); assert.equal(r.reportSent, false);
});

test('ham: store fails, original stays', async () => {
  const t = fake({ fail: 'AddMsgRequest' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.ok(!names(t).includes('MsgActionRequest'));
  assert.equal(r.ok, false); assert.equal(r.reportSent, true); assert.equal(r.step, 'store');
  assert.equal(r.stored, false);
});

test('ham: trash fails after the copy was stored', async () => {
  const t = fake({ fail: 'MsgActionRequest' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.equal(r.ok, false); assert.equal(r.step, 'trash');
  assert.equal(r.reportSent, true); assert.equal(r.stored, true);
});

test('ham: nothing to clean, original moved to Inbox, no copy', async () => {
  const t = fake({ raw: Uint8Array.from(Buffer.from('Subject: Hi\r\n\r\nb')) });
  const r = await Z.reportOne(t, cfg, ctx, ham('7'), 'full');
  assert.deepEqual(names(t), ['fetchRaw', 'SendMsgRequest', 'MsgActionRequest']);
  assert.deepEqual(json(t.calls[2].body.action), { id: '7', op: 'move', l: '2' });
  assert.equal(r.ok, true);
});

for (const [name, resp] of [['empty response', {}], ['no response', null], ['message without id', { m: [{}] }]]) {
  test(`ham: AddMsgRequest without a stored message, original stays (${name})`, async () => {
    const t = fake({ addResp: resp });
    const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
    assert.equal(names(t).filter((n) => n === 'MsgActionRequest').length, 0);
    assert.equal(r.ok, false); assert.equal(r.step, 'store'); assert.equal(r.stored, false);
  });
}

test('ham: upload fails, original moved to Inbox unchanged', async () => {
  const t = fake({ fail: 'upload' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.deepEqual(names(t), ['fetchRaw', 'SendMsgRequest', 'upload', 'MsgActionRequest']);
  assert.deepEqual(json(t.calls[3].body.action), { id: '257', op: 'move', l: '2' });
  assert.deepEqual(json(r), { id: '257', dir: 'ham', ok: true, reportSent: true, stored: false, uncleaned: 'up' });
});

test('ham headers only: cleaned upload fails, original moved to Inbox', async () => {
  const t = fake({ fail: 'upload2' });
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'headers');
  assert.equal(r.ok, true); assert.equal(r.uncleaned, 'up');
});

test('ham: upload and the fallback move fail, step is move', async () => {
  const t = fake({ fail: 'upload' });
  const soap = t.soap;
  t.soap = function (name, body) {
    if (name === 'MsgActionRequest') { t.calls.push({ name, body }); return Promise.reject(new Error('mv')); }
    return soap.call(t, name, body);
  };
  const r = await Z.reportOne(t, cfg, ctx, ham(), 'full');
  assert.equal(r.ok, false); assert.equal(r.step, 'move'); assert.equal(r.reportSent, true);
  assert.match(r.error, /mv/);
});

/* ---- reportAll ---- */

test('mixed selection', async () => {
  const t = fake();
  const rs = await Z.reportAll(t, cfg, ctx, [ham('1'), spam('2')], 'full');
  assert.deepEqual(rs.map((r) => [r.id, r.dir, r.ok]), [['1', 'ham', true], ['2', 'spam', true]]);
  const moves = t.calls.filter((c) => c.name === 'MsgActionRequest').map((c) => [c.body.action.id, c.body.action.l]);
  assert.deepEqual(moves, [['1', '3'], ['2', '4']]);
  assert.ok(names(t).indexOf('AddMsgRequest') < names(t).indexOf('MsgActionRequest'));
});

test('reportAll goes on after a failure', async () => {
  const t = fake({ fail: 'SendMsgRequest' });
  const rs = await Z.reportAll(t, cfg, ctx, [spam('1'), spam('2')], 'full');
  assert.deepEqual(rs.map((r) => r.ok), [false, false]);
  assert.equal(names(t).filter((n) => n === 'SendMsgRequest').length, 2);
});

test('parseUploadResponse', () => {
  assert.equal(Z.parseUploadResponse("200,'null',[{\"aid\":\"x:y\",\"s\":3}]"), 'x:y');
  assert.throws(() => Z.parseUploadResponse("500,'null'"), /upload failed/);
  assert.throws(() => Z.parseUploadResponse("200,'null',[]"), /upload failed/);
});
