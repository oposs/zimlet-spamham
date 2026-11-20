'use strict';
// The Modern client loads a zimlet by calling zimlet(fn) and later runs
// `new fn(context)` (Zimbra 10.1.21, ZimletSDK _setup). An arrow function
// there fails with "h is not a constructor", so the built bundle must pass
// a plain function.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', 'modern', 'build', 'index.js');

test('modern bundle passes a constructible function to zimlet()', { skip: !fs.existsSync(BUILD) && 'no build (run make modern)' }, () => {
  const js = fs.readFileSync(BUILD, 'utf8');
  const calls = js.match(/\bzimlet\(([^)]{0,40})/g) || [];
  assert.ok(calls.length > 0, 'no zimlet() call in the bundle');
  for (const c of calls) {
    assert.match(c, /^zimlet\(function\b/, c);
  }
});

test('the handler can be constructed with new', { skip: !fs.existsSync(BUILD) && 'no build (run make modern)' }, () => {
  const vm = require('node:vm');
  let h = null;
  const sandbox = { zimlet: (fn) => { h = fn; }, console };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BUILD, 'utf8'), sandbox);
  assert.equal(typeof h, 'function');
  assert.doesNotThrow(() => { try { new h({ styles: { set() {} }, plugins: { register() {} } }); } catch (e) { if (/not a constructor/.test(e.message)) throw e; } });
});
