'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

const cfg = Z.parseConfig({});
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
// Binary string (one char per byte) -> bytes and back.
const bin = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const str = (u8) => Buffer.from(u8).toString('latin1');
const clean = (s) => { const r = Z.cleanMessage(bin(s), cfg); return { text: str(r.bytes), changed: r.changed }; };

const BODY = 'Body line\r\n\r\nX-Spam-Flag: YES\r\n\xE4\xF6\xFC end\r\n';

test('byte string round trip', () => {
  const all = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(Z.binaryToBytes(Z.bytesToBinary(all)), all);
});

test('CRLF: markers removed, rest byte-identical', () => {
  const head = 'Received: from a\r\n by b\r\n' +
    'X-Spam-Flag: YES\r\n' +
    'From: x@y.ch\r\n' +
    'X-Spam-Status: Yes, score=7\r\n\ttests=A,B\r\n' +
    'Subject: [*** SPAM 7.3 ***] Hello\r\n' +
    'To: a@b.ch\r\n';
  const r = clean(head + '\r\n' + BODY);
  assert.equal(r.changed, true);
  assert.equal(r.text,
    'Received: from a\r\n by b\r\n' +
    'From: x@y.ch\r\n' +
    'Subject: Hello\r\n' +
    'To: a@b.ch\r\n' +
    '\r\n' + BODY);
});

test('LF only: endings stay LF', () => {
  const r = clean('X-Spam-Level: ***\nSubject: [*** SPAM 5 ***] Hi\nFrom: x@y\n\nbody\n');
  assert.equal(r.text, 'Subject: Hi\nFrom: x@y\n\nbody\n');
});

test('header name case-insensitive', () => {
  assert.equal(clean('x-spam-FLAG: YES\r\nFrom: a\r\n\r\nb').text, 'From: a\r\n\r\nb');
});

test('body with 8-bit bytes and marker-like lines untouched', () => {
  const s = 'Subject: [*** SPAM 9.9 ***] T\r\n\r\n' + BODY;
  assert.equal(clean(s).text, 'Subject: T\r\n\r\n' + BODY);
});

test('raw prefix before encoded word', () => {
  const ew = '=?UTF-8?B?' + b64('äbc') + '?=';
  assert.equal(clean('Subject: [*** SPAM 5.1 ***] ' + ew + '\r\n\r\nx').text,
    'Subject: ' + ew + '\r\n\r\nx');
});

test('prefix inside encoded word is decoded, stripped, re-encoded', () => {
  const s = 'Subject: =?UTF-8?B?' + b64('***SPAM*** äbc') + '?=\r\n\r\nx';
  assert.equal(clean(s).text, 'Subject: =?UTF-8?B?' + b64('äbc') + '?=\r\n\r\nx');
});

test('Q-encoded ISO-8859-1 word split over two words', () => {
  const s = 'Subject: =?ISO-8859-1?Q?***SPAM***_=E4?=\r\n =?ISO-8859-1?Q?bc?=\r\n\r\nx';
  assert.equal(clean(s).text, 'Subject: =?UTF-8?B?' + b64('äbc') + '?=\r\n\r\nx');
});

test('folded subject', () => {
  assert.equal(clean('Subject: [*** SPAM 9 ***]\r\n Hello\r\n\r\nx').text, 'Subject: Hello\r\n\r\nx');
});

test('no markers: unchanged', () => {
  const s = 'From: a\r\nSubject: =?UTF-8?B?' + b64('äbc') + '?=\r\n\r\n' + BODY;
  const r = clean(s);
  assert.equal(r.changed, false);
  assert.equal(r.text, s);
});

test('message without body separator', () => {
  assert.equal(clean('X-Spam-Flag: YES\r\nFrom: a\r\n').text, 'From: a\r\n');
});

test('long re-encoded subject is folded, every line within 998 bytes', () => {
  const s = 'Subject: =?UTF-8?B?' + b64('***SPAM*** ' + 'ä'.repeat(400)) + '?=\r\n\r\nx';
  const r = clean(s);
  assert.equal(r.changed, true);
  const header = r.text.split('\r\n\r\n')[0];
  const lines = header.split('\r\n');
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.length <= 998, 'line of ' + l.length);
  for (const l of lines.slice(1)) assert.match(l, /^ =\?UTF-8\?B\?/);
  const words = header.replace(/^Subject: /, '').split(/\r\n /);
  const text = words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.equal(text, 'ä'.repeat(400));
});

test('LF subject is folded with LF', () => {
  const s = 'Subject: =?UTF-8?B?' + b64('***SPAM*** ' + 'ä'.repeat(40)) + '?=\n\nx';
  const header = clean(s).text.split('\n\n')[0];
  assert.ok(header.indexOf('\r') < 0);
  assert.ok(header.indexOf('\n ') > 0);
});

test('unknown charset: subject left unchanged', () => {
  const s = 'Subject: =?X-UNKNOWN?B?' + b64('***SPAM*** abc') + '?=\r\n\r\nx';
  assert.deepEqual(clean(s), { text: s, changed: false });
});
