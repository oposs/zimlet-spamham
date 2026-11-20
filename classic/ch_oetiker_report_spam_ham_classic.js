/*
 * Send SPAM|HAM button for the Zimbra Classic client. The logic is in
 * ZsrCore; this file adds the button, the dialog and the transport.
 */

function ch_oetiker_report_spam_ham_classic_HandlerObject() {
}

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype = new ZmZimletBase();
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype.constructor = ch_oetiker_report_spam_ham_classic_HandlerObject;

ch_oetiker_report_spam_ham_classic_HandlerObject.OP = 'ZHR_REPORT';
ch_oetiker_report_spam_ham_classic_HandlerObject.CONFIG_NAMES =
    ['reportAddress', 'serverName', 'hamStripHeaders', 'hamStripSubject'];
ch_oetiker_report_spam_ham_classic_HandlerObject.VIEWS = ['VIEW_CONVLIST', 'VIEW_TRAD', 'VIEW_CONV', 'VIEW_MSG'];

// Message keys of the properties files; ZsrCore.STRINGS_EN is the fallback.
ch_oetiker_report_spam_ham_classic_HandlerObject.STRING_KEYS = [
    'titleSpam', 'titleHam', 'titleMixed', 'textOne', 'textMany', 'headersOnly',
    'wholeMail', 'cancel', 'send', 'doneSpam', 'doneHam', 'uncleaned', 'failed',
    'hintStored', 'hintSent', 'nothing', 'busy', 'errorPrefix', 'button', 'tooltip'
];
ch_oetiker_report_spam_ham_classic_HandlerObject.DEFAULT_LABELS = {
    button: 'Send SPAM|HAM',
    tooltip: 'Send this mail to the {team} as SPAM, or as HAM when it is in Junk'
};

// Content-Disposition of an upload; non-ASCII names per RFC 2231.
ch_oetiker_report_spam_ham_classic_HandlerObject.contentDisposition = function (filename) {
    var name = String(filename).replace(/[\r\n]/g, '_');
    var ascii = name.replace(/["\\]|[^\x20-\x7e]/g, '_');
    var header = 'attachment; filename="' + ascii + '"';
    if (/[^\x20-\x7e]/.test(name)) {
        // RFC 2231: the real name, UTF-8 and percent-encoded.
        header += "; filename*=UTF-8''" + encodeURIComponent(name).replace(/['()*]/g, function (c) {
            return '%' + c.charCodeAt(0).toString(16).toUpperCase();
        });
    }
    return header;
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._strings = function () {
    var H = ch_oetiker_report_spam_ham_classic_HandlerObject;
    var out = {};
    for (var i = 0; i < H.STRING_KEYS.length; i++) {
        var key = H.STRING_KEYS[i];
        var v = null;
        try {
            v = this.getMessage ? this.getMessage(key) : null;
        } catch (e) {
            v = null;
        }
        if (typeof v !== 'string' || v === '' || v === key || v.indexOf('???') >= 0) {
            v = (typeof ZsrCore !== 'undefined' && ZsrCore.STRINGS_EN[key]) ||
                H.DEFAULT_LABELS[key];
        }
        out[key] = v;
    }
    return out;
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype.initializeToolbar =
function (app, toolbar, controller, viewId) {
    var self = this;
    var H = ch_oetiker_report_spam_ham_classic_HandlerObject;
    // app is the ZmApp object; the mail list and message view types are
    // enough to tell a mail toolbar.
    var viewType = appCtxt.getViewTypeFromId(viewId);
    var match = false;
    for (var i = 0; i < H.VIEWS.length; i++) {
        if (viewType === ZmId[H.VIEWS[i]]) {
            match = true;
        }
    }
    if (!match || toolbar.getOp(H.OP)) {
        return;
    }
    var s = this._strings();
    var team = ZsrCore.DEFAULTS.reportTeam;
    try {
        team = this._readConfig().reportTeam;
    } catch (e) {
        // a bad pattern is reported on click; the default name will do here
    }
    var button = toolbar.createOp(H.OP, {
        text: s.button,
        tooltip: ZsrCore.format(s.tooltip, { team: team }),
        image: 'ZhrReport',
        index: 1
    });
    this._buttons = this._buttons || [];
    this._buttons.push({ button: button, controller: controller });
    button.setEnabled(!this._busy && this._selected(controller).length > 0);
    button.addSelectionListener(new AjxListener(self, self._onReport, [controller]));
};

// Selected items; in the message view the shown message.
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._selected = function (controller) {
    var sel = controller && controller.getSelection ? controller.getSelection() : null;
    var out = [];
    var i;
    if (sel) {
        for (i = 0; i < sel.length; i++) {
            if (sel[i]) {
                out.push(sel[i]);
            }
        }
    }
    if (out.length === 0) {
        var msg = this._openMsg(controller);
        if (msg) {
            out.push(msg);
        }
    }
    return out;
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._openMsg = function (controller) {
    try {
        return controller && controller.getMsg ? controller.getMsg() : null;
    } catch (e) {
        return null;
    }
};

/*
 * Items for ZsrCore.classify. A conversation counts as the message open in
 * the reading pane when that message belongs to it.
 */
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._items = function (controller) {
    var sel = this._selected(controller);
    var open = this._openMsg(controller);
    var items = [];
    for (var i = 0; i < sel.length; i++) {
        var it = sel[i];
        if (it.type === ZmItem.CONV) {
            var item = { type: 'conv', id: String(it.id) };
            if (open && open.id && String(open.cid) === String(it.id)) {
                item.msgId = String(open.id);
            }
            items.push(item);
        } else {
            items.push({ type: 'msg', id: String(it.id) });
        }
    }
    return items;
};

/*
 * Zimbra calls this after it has set its own operations on every selection
 * change (ZmMailListController._resetOperations); parent is the toolbar or
 * action menu being reset.
 */
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype.onZmMailListController_resetOperations =
function (controller, parent) {
    var op = parent && parent.getOp ? parent.getOp(ch_oetiker_report_spam_ham_classic_HandlerObject.OP) : null;
    if (op) {
        op.setEnabled(!this._busy && this._selected(controller).length > 0);
    }
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._readConfig = function () {
    var props = {};
    var names = ch_oetiker_report_spam_ham_classic_HandlerObject.CONFIG_NAMES;
    for (var i = 0; i < names.length; i++) {
        props[names[i]] = this.getConfig(names[i]);
    }
    return ZsrCore.parseConfig(props);
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._transport = function () {
    // SOAP through the client's request manager, as the Zimlet guide
    // shows: it adds auth and CSRF, and processes the change notifications
    // of each response, so the mail list follows the moves.
    function soap(name, body) {
        return new Promise(function (resolve, reject) {
            var jsonObj = {};
            jsonObj[name] = body;
            var respName = name.replace(/Request$/, '') + 'Response';
            appCtxt.getAppController().sendRequest({
                jsonObj: jsonObj,
                asyncMode: true,
                noBusyOverlay: true,
                callback: new AjxCallback(null, function (result) {
                    var b = result.getResponse();
                    resolve(b ? b[respName] : undefined);
                }),
                errorCallback: new AjxCallback(null, function (ex) {
                    reject(new Error((ex && (ex.msg || ex.code)) || 'SOAP fault'));
                    // An expired session goes to Zimbra, which shows its
                    // login dialog; every other fault is reported by us.
                    var code = ex && ex.code;
                    return !(code === ZmCsfeException.SVC_AUTH_EXPIRED ||
                        code === ZmCsfeException.SVC_AUTH_REQUIRED);
                })
            });
        });
    }

    function fetchRaw(id) {
        return fetch('/service/home/~/?id=' + encodeURIComponent(id), {
            credentials: 'same-origin'
        }).then(function (res) {
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            return res.arrayBuffer();
        }).then(function (buf) {
            return new Uint8Array(buf);
        });
    }

    function upload(bytes, filename, contentType) {
        return fetch('/service/upload?fmt=raw,extended', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': contentType || 'message/rfc822',
                'Content-Disposition': ch_oetiker_report_spam_ham_classic_HandlerObject.contentDisposition(filename),
                'X-Zimbra-Csrf-Token': window.csrfToken
            },
            body: bytes
        }).then(function (res) {
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            return res.text();
        }).then(function (text) {
            return ZsrCore.parseUploadResponse(text);
        });
    }

    return { soap: soap, fetchRaw: fetchRaw, upload: upload };
};

// displayStatusMessage (ZmZimletBase) takes no level, so warnings and
// errors keep appCtxt.setStatusMsg with theirs. The toast renders HTML and
// error texts come from the server, so they are escaped.
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._status = function (msg, level) {
    msg = AjxStringUtil.htmlEncode(String(msg));
    if (level === ZmStatusView.LEVEL_INFO) {
        this.displayStatusMessage(msg);
    } else {
        appCtxt.setStatusMsg(msg, level);
    }
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._setBusy = function (busy) {
    this._busy = busy;
    var buttons = this._buttons || [];
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].button.setEnabled(!busy && this._selected(buttons[i].controller).length > 0);
    }
};

/*
 * model: {title, text, headersOnly, wholeMail, cancel, send}
 * Calls onSend('full'|'headers') when the user presses Send; Cancel or
 * closing the dialog calls nothing.
 */
ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._showDialog = function (model, onSend) {
    var enc = AjxStringUtil.htmlEncode;
    var name = Dwt.getNextId('ZhrContent_');
    var headersId = name + '_headers';
    var wholeId = name + '_whole';
    var dialog = new DwtDialog({
        parent: appCtxt.getShell(),
        title: model.title,
        standardButtons: [DwtDialog.OK_BUTTON, DwtDialog.CANCEL_BUTTON]
    });
    dialog.setContent(
        '<div class="ZhrDialog">' +
        '<p class="ZhrText">' + enc(model.text) + '</p>' +
        '<p class="ZhrChoice">' +
        '<label><input type="radio" name="' + name + '" id="' + headersId + '"> ' +
        enc(model.headersOnly) + '</label> ' +
        '<label><input type="radio" name="' + name + '" id="' + wholeId + '" checked> ' +
        enc(model.wholeMail) + '</label>' +
        '</p></div>');
    dialog.getButton(DwtDialog.OK_BUTTON).setText(model.send);
    dialog.getButton(DwtDialog.CANCEL_BUTTON).setText(model.cancel);
    dialog.setButtonListener(DwtDialog.OK_BUTTON, new AjxListener(null, function () {
        var headers = document.getElementById(headersId);
        var content = headers && headers.checked ? 'headers' : 'full';
        dialog.popdown();
        dialog.dispose();
        onSend(content);
    }));
    dialog.setButtonListener(DwtDialog.CANCEL_BUTTON, new AjxListener(null, function () {
        dialog.popdown();
        dialog.dispose();
    }));
    dialog.popup();
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._onReport = function (controller) {
    var self = this;
    var s = this._strings();
    function fail(e) {
        self._setBusy(false);
        self._status(s.errorPrefix + (e && e.message ? e.message : e),
            ZmStatusView.LEVEL_CRITICAL);
    }
    if (this._busy) {
        this._status(s.busy, ZmStatusView.LEVEL_INFO);
        return;
    }
    var cfg;
    try {
        cfg = this._readConfig();
    } catch (e) {
        this._status(s.errorPrefix + e.message, ZmStatusView.LEVEL_CRITICAL);
        return;
    }
    var items = this._items(controller);
    if (items.length === 0) {
        return;
    }
    var ctx = {
        account: appCtxt.getActiveAccount().name,
        client: 'classic',
        hostname: window.location.hostname,
        now: new Date()
    };
    var transport = this._transport();

    // Busy while the selection is looked up, so a second click waits.
    this._setBusy(true);
    var lookup;
    try {
        lookup = ZsrCore.classify(transport, items);
    } catch (e) {
        fail(e);
        return;
    }
    lookup.then(function (found) {
        self._setBusy(false);
        if (found.entries.length === 0) {
            self._status(s.nothing, ZmStatusView.LEVEL_INFO);
            return;
        }
        var text = ZsrCore.dialogText(found.entries, cfg, s);
        self._showDialog({
            title: text.title,
            text: text.text,
            headersOnly: s.headersOnly,
            wholeMail: s.wholeMail,
            cancel: s.cancel,
            send: s.send
        }, function (content) {
            self._send(transport, cfg, ctx, found.entries, content, s);
        });
    }, fail);
};

ch_oetiker_report_spam_ham_classic_HandlerObject.prototype._send =
function (transport, cfg, ctx, entries, content, s) {
    var self = this;
    function fail(e) {
        self._setBusy(false);
        self._status(s.errorPrefix + (e && e.message ? e.message : e),
            ZmStatusView.LEVEL_CRITICAL);
    }
    if (this._busy) {
        this._status(s.busy, ZmStatusView.LEVEL_INFO);
        return;
    }
    this._setBusy(true);
    var run;
    try {
        ctx.now = new Date();
        run = ZsrCore.reportAll(transport, cfg, ctx, entries, content);
    } catch (e) {
        // Without this the buttons would stay disabled until a reload.
        fail(e);
        return;
    }
    run.then(function (results) {
        self._setBusy(false);
        var st = ZsrCore.statusText(ZsrCore.summarize(results), s);
        self._status(st.message, st.failure ? ZmStatusView.LEVEL_WARNING : ZmStatusView.LEVEL_INFO);
    }, fail);
};
