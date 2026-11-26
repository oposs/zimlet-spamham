'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../core/zsr-core.js');

test('defaults', () => {
  const c = Z.parseConfig({});
  assert.equal(c.reportAddress, '');
  assert.equal(c.reportTeam, '');
  assert.equal(c.serverName, '');
  assert.ok(c.stripHeaders.includes('x-spam-flag'));
  assert.ok(c.stripHeaders.includes('x-spam-relaysuntrusted'));
  assert.equal(c.stripSubject.length, 3);
});

test('blank properties fall back to defaults', () => {
  const c = Z.parseConfig({ reportAddress: '  ', reportTeam: ' ', hamStripSubject: '' });
  assert.equal(c.reportAddress, '');
  assert.equal(c.reportTeam, '');
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

test('reportByDomain: account domain picks address and team', () => {
  const props = {
    reportAddress: 'spam@example.net',
    reportTeam: 'Example Desk',
    reportByDomain: 'Example.org  abuse@example.org  Org Abuse Team\n\nexample.com spam@example.com'
  };
  const org = Z.parseConfig(props, 'alice@EXAMPLE.ORG');
  assert.equal(org.reportAddress, 'abuse@example.org');
  assert.equal(org.reportTeam, 'Org Abuse Team');
  const com = Z.parseConfig(props, 'bob@example.com');
  assert.equal(com.reportAddress, 'spam@example.com');
  assert.equal(com.reportTeam, 'Example Desk', 'no team on the line: reportTeam');
  const other = Z.parseConfig(props, 'carol@example.ch');
  assert.equal(other.reportAddress, 'spam@example.net');
  assert.equal(other.reportTeam, 'Example Desk');
  assert.equal(Z.parseConfig(props).reportAddress, 'spam@example.net', 'no account: global values');
});

test('reportByDomain: invalid line throws naming it', () => {
  assert.throws(() => Z.parseConfig({ reportByDomain: 'example.org' }, 'a@example.org'),
    /reportByDomain: invalid line: example\.org/);
  assert.throws(() => Z.parseConfig({ reportByDomain: 'example.org nobody' }, 'a@example.ch'),
    /reportByDomain: invalid line: example\.org nobody/);
});

test('reportByDomain defaults to empty', () => {
  assert.equal(Z.DEFAULTS.reportByDomain, '');
});

test('report address and team default to empty', () => {
  assert.equal(Z.DEFAULTS.reportAddress, '');
  assert.equal(Z.DEFAULTS.reportTeam, '');
});

test('reportByDomain alone gives the address for its domain only', () => {
  const props = { reportByDomain: 'example.org abuse@example.org' };
  const org = Z.parseConfig(props, 'alice@example.org');
  assert.equal(org.reportAddress, 'abuse@example.org');
  assert.equal(org.reportTeam, '');
  assert.equal(Z.parseConfig(props, 'bob@example.com').reportAddress, '');
});
