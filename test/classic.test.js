'use strict';
// Loads the Classic handler with minimal stand-ins for the Zimbra client
// globals and checks when the toolbar button is created. Zimbra calls
// initializeToolbar(app, toolbar, controller, viewId) with the ZmApp object
// as app (ZmBaseController: notifyZimlets("initializeToolbar",
// [this._app, tb, this, view])).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const VIEW_TYPES = { CLV: 'CLV', TV: 'TV', CV: 'CV', MSG: 'MSG', CNS: 'CNS', COMPOSE: 'COMPOSE' };

function load() {
  const ctx = {
    ZmZimletBase: function () {},
    AjxListener: function (obj, fn, args) { this.obj = obj; this.fn = fn; this.args = args; },
    AjxCallback: function (obj, fn, args) {
      this.run = function () {
        return fn.apply(obj, (args || []).concat(Array.prototype.slice.call(arguments)));
      };
    },
    ZmCsfeException: { SVC_AUTH_EXPIRED: 'service.AUTH_EXPIRED', SVC_AUTH_REQUIRED: 'service.AUTH_REQUIRED' },
    ZmApp: { MAIL: 'Mail', CONTACTS: 'Contacts' },
    ZmId: { VIEW_CONVLIST: 'CLV', VIEW_TRAD: 'TV', VIEW_CONV: 'CV', VIEW_MSG: 'MSG' },
    ZmStatusView: { LEVEL_INFO: 1, LEVEL_WARNING: 2, LEVEL_CRITICAL: 3 },
    ZmItem: { CONV: 'CONV', MSG: 'MSG' },
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,
    btoa: btoa, atob: atob, setTimeout: setTimeout,
    AjxStringUtil: { htmlEncode: function (t) { return t; } },
    appCtxt: {
      getViewTypeFromId: function (viewId) {
        return VIEW_TYPES[String(viewId).split('-')[0]] || '';
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'core', 'zsr-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'classic', 'ch_oetiker_report_spam_ham_classic.js'), 'utf8'), ctx);
  return ctx;
}

function fakeToolbar() {
  const ops = {};
  return {
    created: [],
    getOp: function (id) { return ops[id] || null; },
    createOp: function (id, params) {
      const b = {
        id: id, params: params, enabled: true,
        addSelectionListener: function () {},
        setEnabled: function (on) { this.enabled = on; }
      };
      ops[id] = b;
      this.created.push(b);
      return b;
    }
  };
}

function app(name) {
  return { getName: function () { return name; } };
}

function run(appObj, viewId) {
  const ctx = load();
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  const tb = fakeToolbar();
  h.initializeToolbar(appObj, tb, {}, viewId);
  return tb;
}

for (const viewId of ['CLV-main', 'TV-main', 'CV-1', 'MSG-2', 'CLV']) {
  test(`button is created in mail view ${viewId}`, () => {
    const tb = run(app('Mail'), viewId);
    assert.equal(tb.created.length, 1);
    assert.equal(tb.created[0].id, 'ZHR_REPORT');
  });
}

test('no button in compose or contacts views', () => {
  assert.equal(run(app('Mail'), 'COMPOSE-1').created.length, 0);
  assert.equal(run(app('Contacts'), 'CNS-main').created.length, 0);
});

test('button is created only once per toolbar', () => {
  const ctx = load();
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  const tb = fakeToolbar();
  h.initializeToolbar(app('Mail'), tb, {}, 'CLV-main');
  h.initializeToolbar(app('Mail'), tb, {}, 'CLV-main');
  assert.equal(tb.created.length, 1);
});

// Stand-in for the client's request manager (ZmRequestMgr.sendRequest):
// callback.run(result) with result.getResponse() = Body; on a fault
// errorCallback.run(ex, params), whose true return suppresses Zimbra's
// own error dialog.
function withSendRequest(ctx, answer) {
  const sent = [];
  ctx.appCtxt.getAppController = function () {
    return {
      sendRequest: function (params) {
        sent.push(params);
        Promise.resolve().then(function () {
          const a = answer(params);
          if (a.fault) {
            sent.handled = params.errorCallback.run(a.fault, params);
          } else {
            params.callback.run({ getResponse: function () { return a.body; } });
          }
        });
        return 'req-1';
      }
    };
  };
  return sent;
}

test('SOAP goes through the client request manager', async () => {
  const ctx = load();
  const sent = withSendRequest(ctx, function () {
    return { body: { GetMsgResponse: { m: [{ id: '1' }] } } };
  });
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  const body = { _jsns: 'urn:zimbraMail', m: { id: '1' } };
  const resp = await h._transport().soap('GetMsgRequest', body);
  assert.deepEqual(resp, { m: [{ id: '1' }] });
  assert.equal(sent.length, 1);
  // jsonObj is built inside the vm context: compare as JSON.
  assert.equal(JSON.stringify(sent[0].jsonObj), JSON.stringify({ GetMsgRequest: body }));
  assert.equal(sent[0].asyncMode, true);
  assert.equal(sent[0].noBusyOverlay, true);
});

test('SOAP fault rejects and suppresses the Zimbra error dialog', async () => {
  const ctx = load();
  const sent = withSendRequest(ctx, function () {
    return { fault: { code: 'mail.NO_SUCH_MSG', msg: 'no such message: 9' } };
  });
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  await assert.rejects(h._transport().soap('GetMsgRequest', {}), /no such message: 9/);
  assert.equal(sent.handled, true);
});

test('expired session is left to Zimbra (login dialog)', async () => {
  const ctx = load();
  const sent = withSendRequest(ctx, function () {
    return { fault: { code: 'service.AUTH_EXPIRED', msg: 'auth credentials have expired' } };
  });
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  await assert.rejects(h._transport().soap('GetMsgRequest', {}), /expired/);
  assert.equal(sent.handled, false);
});

test('info goes through displayStatusMessage, warnings keep their level', () => {
  const ctx = load();
  const shown = [];
  ctx.appCtxt.setStatusMsg = function (m, level) { shown.push(['set', m, level]); };
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  h.displayStatusMessage = function (m) { shown.push(['display', m]); };
  h._status('ok', ctx.ZmStatusView.LEVEL_INFO);
  h._status('bad', ctx.ZmStatusView.LEVEL_WARNING);
  assert.deepEqual(shown, [['display', 'ok'], ['set', 'bad', 2]]);
});

// Controller stand-in: selected items {id, folderId, type?} and the open message.
function controller(items, openMsg) {
  return {
    getSelection: function () { return items; },
    getMsg: function () { return openMsg || null; }
  };
}
const msg = (id) => ({ id: String(id), type: 'MSG' });

const GERMAN = { doneSpam: '{n} als SPAM gesendet und nach Junk verschoben' };

// Handler with a real ZsrCore, a fake server and a recorded dialog.
// folders maps message id -> folder; dialog: 'full'|'headers'|null (cancel).
function setup(opts) {
  opts = opts || {};
  const ctx = load();
  const status = [];
  ctx.appCtxt.setStatusMsg = function (m, level) { status.push([m, level]); };
  ctx.appCtxt.getActiveAccount = function () { return { name: 'a@example.ch' }; };
  ctx.window = { location: { hostname: 'zimbra.example.ch' }, csrfToken: 't' };
  const uploads = [];
  ctx.fetch = function (url, o) {
    if (url.indexOf('/service/upload') === 0) {
      uploads.push(o.headers['Content-Type']);
      return Promise.resolve({ ok: true, text: function () { return Promise.resolve("200,'null',[{\"aid\":\"h1\"}]"); } });
    }
    const raw = 'Subject: x\r\n\r\nbody';
    return Promise.resolve({ ok: true, arrayBuffer: function () { return Promise.resolve(new TextEncoder().encode(raw).buffer); } });
  };
  const sent = withSendRequest(ctx, function (params) {
    const name = Object.keys(params.jsonObj)[0];
    const body = params.jsonObj[name];
    if (name === 'GetMsgRequest') {
      return { body: { GetMsgResponse: { m: [{ id: body.m.id, l: (opts.folders || {})[body.m.id] || '2', d: 1 }] } } };
    }
    if (name === 'GetConvRequest') {
      return { body: { GetConvResponse: { c: [{ id: body.c.id, m: opts.convMsgs || [] }] } } };
    }
    return { body: {} };
  });
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  h.getConfig = function () { return ''; };
  h.getMessage = function (k) { return (opts.messages || {})[k] || k; };
  h.displayStatusMessage = function (m) { status.push([m, ctx.ZmStatusView.LEVEL_INFO]); };
  const dialogs = [];
  h._showDialog = function (model, onSend) {
    dialogs.push(JSON.parse(JSON.stringify(model)));
    if (opts.dialog) onSend(opts.dialog);
  };
  const tb = fakeToolbar();
  h.initializeToolbar(app('Mail'), tb, controller([]), 'CLV-main');
  const names = () => sent.map((p) => Object.keys(p.jsonObj)[0]);
  return { ctx, h, tb, button: tb.created[0], status, dialogs, sent, names, uploads };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test('button label and icon come from the messages', () => {
  const b = setup();
  assert.equal(b.button.params.text, 'Send SPAM|HAM');
  assert.equal(b.button.params.image, 'ZhrReport');
  assert.equal(b.button.params.index, 1);
  assert.equal(b.button.params.tooltip,
    'Send this mail to the O+P SpamFilter Patrol as SPAM, or as HAM when it is in Junk');
  const g = setup({ messages: { button: 'Melden', tooltip: 'Tipp' } });
  assert.equal(g.button.params.text, 'Melden');
  assert.equal(g.button.params.tooltip, 'Tipp');
});

test('button is enabled with any selection', () => {
  const b = setup();
  assert.equal(b.button.enabled, false);
  b.h.onZmMailListController_resetOperations(controller([{ id: '1', folderId: '2' }]), b.tb);
  assert.equal(b.button.enabled, true);
  b.h.onZmMailListController_resetOperations(controller([]), b.tb);
  assert.equal(b.button.enabled, false);
  b.h._busy = true;
  b.h.onZmMailListController_resetOperations(controller([{ id: '1', folderId: '2' }]), b.tb);
  assert.equal(b.button.enabled, false);
});

test('message view: the open message counts as selection', () => {
  const b = setup();
  b.h.onZmMailListController_resetOperations(controller([], msg(5)), b.tb);
  assert.equal(b.button.enabled, true);
});

test('click classifies and shows the dialog', async () => {
  const b = setup({ folders: { 1: '2' } });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.deepEqual(b.dialogs, [{ title: 'Send SPAM',
    text: 'This mail will be sent to the O+P SpamFilter Patrol (anti-spam@oetiker.ch). The information is used to improve spam detection.',
    headersOnly: 'Headers only', wholeMail: 'Whole mail', cancel: 'Cancel', send: 'Send' }]);
  assert.ok(!b.names().includes('SendMsgRequest'));
});

test('mixed counts in dialog', async () => {
  const b = setup({ folders: { 1: '4', 2: '2' } });
  b.h._onReport(controller([msg(1), msg(2)]));
  await settle();
  assert.equal(b.dialogs[0].title, 'Send SPAM|HAM');
  assert.equal(b.dialogs[0].text,
    '2 mails will be sent to the O+P SpamFilter Patrol (anti-spam@oetiker.ch): 1 as SPAM, 1 as HAM. The information is used to improve spam detection.');
});

test('send whole mail', async () => {
  const b = setup({ folders: { 1: '2' }, dialog: 'full' });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.deepEqual(b.names(), ['GetMsgRequest', 'SendMsgRequest', 'MsgActionRequest']);
  assert.equal(JSON.stringify(b.sent[1].jsonObj.SendMsgRequest.m.attach), '{"m":[{"id":"1"}]}');
  assert.equal(b.sent[2].jsonObj.MsgActionRequest.action.l, '4');
  assert.deepEqual(b.status, [['1 sent as SPAM and moved to Junk', 1]]);
  assert.equal(b.h._busy, false);
});

test('send headers only', async () => {
  const b = setup({ folders: { 1: '2' }, dialog: 'headers' });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.deepEqual(b.uploads, ['message/rfc822']);
  assert.equal(JSON.stringify(b.sent[1].jsonObj.SendMsgRequest.m.attach), '{"aid":"h1"}');
});

test('cancel sends nothing and leaves the button usable', async () => {
  const b = setup({ folders: { 1: '2' }, dialog: null });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.equal(b.dialogs.length, 1);
  assert.deepEqual(b.names(), ['GetMsgRequest']);
  assert.equal(b.h._busy, false);
  b.h.onZmMailListController_resetOperations(controller([msg(1)]), b.tb);
  assert.equal(b.button.enabled, true);
});

test('nothing to report', async () => {
  const b = setup({ folders: { 1: '5' } });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.equal(b.dialogs.length, 0);
  assert.deepEqual(b.status, [['Nothing to report (own sent mail, drafts and shared mail are skipped)', 1]]);
});

test('conversation uses the open message', () => {
  const b = setup();
  const items = b.h._items(controller([{ id: '40', type: 'CONV' }], { id: '41', cid: '40' }));
  assert.equal(JSON.stringify(items), '[{"type":"conv","id":"40","msgId":"41"}]');
  const other = b.h._items(controller([{ id: '40', type: 'CONV' }], { id: '51', cid: '50' }));
  assert.equal(JSON.stringify(other), '[{"type":"conv","id":"40"}]');
});

test('German messages are used', async () => {
  const b = setup({ folders: { 1: '2' }, dialog: 'full', messages: GERMAN });
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.deepEqual(b.status, [['1 als SPAM gesendet und nach Junk verschoben', 1]]);
});

test('a failed report is a warning with the hint', async () => {
  const b = setup({ folders: { 1: '2' }, dialog: 'full' });
  const orig = b.ctx.appCtxt.getAppController;
  b.ctx.appCtxt.getAppController = function () {
    const c = orig();
    const send = c.sendRequest;
    c.sendRequest = function (params) {
      if (params.jsonObj.MsgActionRequest) {
        Promise.resolve().then(() => params.errorCallback.run({ code: 'x', msg: 'denied' }, params));
        return 'r';
      }
      return send(params);
    };
    return c;
  };
  b.h._onReport(controller([msg(1)]));
  await settle();
  assert.deepEqual(b.status, [['Report: 0 sent; failed: 1: move - denied (report was sent, mail left in place)', 2]]);
});

test('a second click while running says busy', () => {
  const b = setup();
  b.h._busy = true;
  b.h._onReport(controller([msg(1)]));
  assert.deepEqual(b.status, [['Report is already running', 1]]);
  assert.equal(b.sent.length, 0);
});

test('a synchronous throw clears the busy flag and reports the error', () => {
  const b = setup();
  b.ctx.ZsrCore.classify = function () { throw new Error('boom'); };
  b.h._onReport(controller([msg(1)]));
  assert.equal(b.h._busy, false);
  assert.deepEqual(b.status, [['Report: boom', 3]]);
});

test('status text is HTML-escaped', () => {
  const b = setup();
  b.ctx.AjxStringUtil = { htmlEncode: function (t) { return String(t).replace(/</g, '&lt;').replace(/>/g, '&gt;'); } };
  b.h._status('bad <addr>', b.ctx.ZmStatusView.LEVEL_WARNING);
  b.h._status('ok <x>', b.ctx.ZmStatusView.LEVEL_INFO);
  assert.deepEqual(b.status, [['bad &lt;addr&gt;', 2], ['ok &lt;x&gt;', 1]]);
});

test('upload sends the content type and a safe file name', async () => {
  const ctx = load();
  let headers;
  ctx.window = { csrfToken: 't' };
  ctx.fetch = function (url, opts) {
    headers = opts.headers;
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve("200,'null',[{\"aid\":\"a\"}]"); } });
  };
  const h = new ctx.ch_oetiker_report_spam_ham_classic_HandlerObject();
  await h._transport().upload(new Uint8Array(0), 'ham-"a\\b\r\n.eml', 'text/rfc822-headers');
  assert.equal(headers['Content-Disposition'], 'attachment; filename="ham-_a_b__.eml"');
  assert.equal(headers['Content-Type'], 'text/rfc822-headers');
  await h._transport().upload(new Uint8Array(0), 'Grüsse "x"', 'message/rfc822');
  assert.equal(headers['Content-Disposition'],
    'attachment; filename="Gr_sse _x_"; filename*=UTF-8\'\'Gr%C3%BCsse%20%22x%22');
});
