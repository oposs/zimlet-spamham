'use strict';
// Zimbra compiles all zimlet scripts into one bundle with Rhino (ES3 parser,
// yuicompressor 2.4.2). A single ES3 syntax error breaks the bundle and with
// it the messages of every zimlet of the account. ES3 does not allow reserved
// words as property names, e.g. promise.catch(...) or {default: 1}.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['core/zsr-core.js', 'classic/ch_oetiker_report_spam_ham_classic.js'];

const RESERVED = ('break case catch class const continue debugger default delete do ' +
  'else enum export extends false finally for function if import in instanceof new ' +
  'null return super switch this throw true try typeof var void while with ' +
  'abstract boolean byte char double final float goto implements int interface ' +
  'long native package private protected public short static synchronized throws ' +
  'transient volatile').split(' ');

function stripStringsAndComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

for (const file of FILES) {
  test(`${file}: no reserved word used as property name`, () => {
    const src = stripStringsAndComments(
      fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    const words = RESERVED.join('|');
    const access = new RegExp(`\\.\\s*(${words})\\b`, 'g');
    const key = new RegExp(`[{,]\\s*(${words})\\s*:`, 'g');
    const hits = [];
    let m;
    while ((m = access.exec(src))) { hits.push('.' + m[1]); }
    while ((m = key.exec(src))) { hits.push(m[1] + ':'); }
    assert.deepEqual(hits, []);
  });
}
