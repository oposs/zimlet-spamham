'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

test('defaults', () => {
  const c = Z.parseConfig({});
  assert.equal(c.reportAddress, 'anti-spam@oetiker.ch');
  assert.equal(c.serverName, '');
  assert.ok(c.stripHeaders.includes('x-spam-flag'));
  assert.ok(c.stripHeaders.includes('x-spam-relaysuntrusted'));
  assert.equal(c.stripSubject.length, 3);
});

test('blank properties fall back to defaults', () => {
  const c = Z.parseConfig({ reportAddress: '  ', hamStripSubject: '' });
  assert.equal(c.reportAddress, 'anti-spam@oetiker.ch');
  assert.equal(c.stripSubject.length, 3);
});

test('strip headers are trimmed and lowercased', () => {
  assert.deepEqual(Z.parseConfig({ hamStripHeaders: ' X-A , x-b ' }).stripHeaders, ['x-a', 'x-b']);
});

test('subject patterns one per line, blanks dropped', () => {
  assert.equal(Z.parseConfig({ hamStripSubject: '^a\n\n^b' }).stripSubject.length, 2);
});

test('invalid pattern throws naming it', () => {
  assert.throws(() => Z.parseConfig({ hamStripSubject: '(' }), /hamStripSubject: invalid pattern: \(/);
});

test('default subject pattern matches gateway prefix', () => {
  const re = Z.parseConfig({}).stripSubject[0];
  assert.match('[*** SPAM 7.3 ***] Hello', re);
  assert.match('[*** SPAM -0.5 ***] Hello', re);
});

test('default strip list covers amavis report headers', () => {
  const h = Z.parseConfig({}).stripHeaders;
  assert.ok(h.indexOf('x-spam-report') >= 0);
  assert.ok(h.indexOf('x-spam-prev-subject') >= 0);
});
