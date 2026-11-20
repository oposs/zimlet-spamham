'use strict';
// Zimbra replaces the stored zimlet configuration on an upgrade only when
// the version in config_template.xml is higher than the stored one
// (ZimletUtil.deployZimlet). So the config version changes only when the
// shipped properties change; a zimlet release alone keeps an address set
// with `zmzimletctl configure`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../core/zsr-core.js');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'classic', 'config_template.xml'), 'utf8');

// Config version -> sha256 of the <global> block it shipped with. Add a
// line (with a higher version) whenever the properties change.
const SHIPPED = {
  '0.1.7': '956c17718de77afc9236604e432fbc93395601fb11f6d553526d0707334061c8',
  '0.1.8': '325120eae04cb61f036d0d67e84a1a8ee479950a0366a271b8ef0743cc41c35f'
};

function configVersion() {
  return /<zimletConfig\b[^>]*\bversion="([^"]+)"/.exec(TEMPLATE)[1];
}

function globalBlock() {
  return /<global>[\s\S]*<\/global>/.exec(TEMPLATE)[0];
}

function properties() {
  const props = {};
  const re = /<property name="([^"]+)">([\s\S]*?)<\/property>/g;
  let m;
  while ((m = re.exec(globalBlock())) !== null) {
    props[m[1]] = m[2];
  }
  return props;
}

test('template properties equal the core defaults', () => {
  const p = properties();
  assert.deepEqual(Object.keys(p).sort(), Object.keys(Z.DEFAULTS).sort());
  for (const name of Object.keys(Z.DEFAULTS)) {
    assert.equal(p[name], Z.DEFAULTS[name], name);
  }
});

test('config version changes exactly when the properties change', () => {
  const sha = crypto.createHash('sha256').update(globalBlock()).digest('hex');
  const known = SHIPPED[configVersion()];
  assert.ok(known, 'config version ' + configVersion() + ' is not listed in SHIPPED');
  assert.equal(sha, known,
    'the <global> block changed: raise the version in config_template.xml and add it to SHIPPED');
});

const MODERN = fs.readFileSync(path.join(__dirname, '..', 'modern', 'config_template.xml'), 'utf8');
// Modern config version -> sha256 of its <global> block.
const SHIPPED_MODERN = {
  '0.1.0': '956c17718de77afc9236604e432fbc93395601fb11f6d553526d0707334061c8',
  '0.1.1': '325120eae04cb61f036d0d67e84a1a8ee479950a0366a271b8ef0743cc41c35f'
};

test('modern template has the classic global block', () => {
  assert.equal(/<global>[\s\S]*<\/global>/.exec(MODERN)[0], globalBlock());
});

test('modern template name and version', () => {
  const m = /<zimletConfig name="([^"]+)" version="([^"]+)"/.exec(MODERN);
  assert.equal(m[1], 'ch_oetiker_report_spam_ham_modern');
  const sha = crypto.createHash('sha256')
    .update(/<global>[\s\S]*<\/global>/.exec(MODERN)[0]).digest('hex');
  assert.equal(SHIPPED_MODERN[m[2]], sha);
});
