/*
 * Spam/ham report core: shared by the Classic and the Modern zimlet.
 *
 * Plain ES5 syntax so the Classic client can load it unchanged. Browser
 * APIs used: Promise, TextDecoder, TextEncoder, btoa, atob.
 * All server access goes through an injected transport (see reportOne).
 */
var ZsrCore = (function () {
    'use strict';

    var DEFAULTS = {
        reportAddress: 'anti-spam@oetiker.ch',
        reportTeam: 'O+P SpamFilter Patrol',
        serverName: '',
        hamStripHeaders: 'X-Spam-Flag,X-Spam-Status,X-Spam-Level,X-Spam-Score,' +
            'X-Spam-Rule-Report,X-Spam-Checker-Version,X-Spam-RelaysUntrusted,' +
            'X-Spam-Report,X-Spam-Prev-Subject',
        hamStripSubject: [
            '^\\[\\*\\*\\* SPAM -?[0-9.]+ \\*\\*\\*\\]\\s*',
            '^\\*\\*\\*\\s*SPAM\\s*\\*\\*\\*\\s*',
            '^\\[SPAM\\]\\s*'
        ].join('\n')
    };

    function prop(props, name) {
        var v = props && props[name];
        if (v === undefined || v === null || String(v).trim() === '') {
            return DEFAULTS[name];
        }
        return String(v);
    }

    function parseConfig(props) {
        var headers = prop(props, 'hamStripHeaders').split(',')
            .map(function (h) { return h.trim().toLowerCase(); })
            .filter(function (h) { return h !== ''; });
        var patterns = prop(props, 'hamStripSubject').split(/\r?\n/)
            .map(function (p) { return p.trim(); })
            .filter(function (p) { return p !== ''; })
            .map(function (p) {
                try {
                    return new RegExp(p);
                } catch (e) {
                    throw new Error('hamStripSubject: invalid pattern: ' + p);
                }
            });
        return {
            reportAddress: prop(props, 'reportAddress').trim(),
            reportTeam: prop(props, 'reportTeam').trim(),
            serverName: (props && props.serverName ? String(props.serverName) : '').trim(),
            stripHeaders: headers,
            stripSubject: patterns
        };
    }

    // Paths of the system folders a reported mail can come from.
    var FOLDER_PATHS = { '2': '/Inbox', '3': '/Trash', '4': '/Junk' };

    function domainOf(address) {
        var s = String(address);
        return s.substring(s.lastIndexOf('@') + 1).toLowerCase();
    }

    /*
     * Body lines follow Zimbra's built-in spam classification report, so
     * filters at the report address that sort on "Classified-As: ham"
     * keep working. The subject is our own:
     * "[ZHR] SPAM Report <server> <account>" or "[ZHR] HAM Report ...".
     *
     * ctx: {account, client: 'classic'|'modern', hostname, msgId,
     *       folderId, now: Date, dir: 'spam'|'ham', content: 'full'|'headers',
     *       headersAid (content 'headers' only)}
     * Returns the JSON SOAP Body for SendMsgRequest.
     */
    function buildReportRequest(cfg, ctx) {
        var domain = domainOf(ctx.account);
        var server = cfg.serverName || ctx.hostname;
        var folder = String(ctx.folderId);
        var spam = ctx.dir === 'spam';
        var headers = ctx.content === 'headers';
        var body = [
            'Classified-By: ' + ctx.account,
            'Classified-As: ' + (spam ? 'spam' : 'ham'),
            'Action: move',
            'Source-Folder: ' + (FOLDER_PATHS[folder] || folder),
            'Destination-Folder: ' + (spam ? '/Junk' : '/Inbox'),
            'Destination-Mailbox: ',
            'Reported-Via: ' + ctx.client,
            'Reported-At: ' + ctx.now.toISOString(),
            'Report-Content: ' + (headers ? 'headers' : 'full'),
            ''
        ].join('\n');
        return {
            SendMsgRequest: {
                _jsns: 'urn:zimbraMail',
                noSave: 1,
                m: {
                    e: [{ t: 't', a: cfg.reportAddress }],
                    su: { _content: '[ZHR] ' + (spam ? 'SPAM' : 'HAM') + ' Report ' +
                        server + ' ' + ctx.account },
                    header: [
                        { name: 'X-ZSR-Type', _content: spam ? 'spam' : 'ham' },
                        { name: 'X-ZSR-Domain', _content: domain },
                        { name: 'X-ZSR-Server', _content: server }
                    ],
                    mp: [{ ct: 'text/plain', content: { _content: body } }],
                    attach: headers ? { aid: ctx.headersAid } : { m: [{ id: ctx.msgId }] }
                }
            }
        };
    }

    /* ---- byte strings: one char per byte, codes 0-255 ---- */

    function bytesToBinary(u8) {
        var out = [];
        var CHUNK = 8192;
        for (var i = 0; i < u8.length; i += CHUNK) {
            out.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK)));
        }
        return out.join('');
    }

    function binaryToBytes(s) {
        var u8 = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) {
            u8[i] = s.charCodeAt(i) & 0xff;
        }
        return u8;
    }

    /* ---- RFC 2047 ---- */

    var ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

    function decodeWordBytes(enc, text) {
        if (enc === 'B' || enc === 'b') {
            return binaryToBytes(atob(text));
        }
        var q = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, function (m, h) {
            return String.fromCharCode(parseInt(h, 16));
        });
        return binaryToBytes(q);
    }

    // Returns the decoded text, or null if a word cannot be decoded.
    function decodeWords(value) {
        var joined = value.replace(/(\?=)[ \t]+(?==\?)/g, '$1');
        try {
            return joined.replace(ENCODED_WORD, function (m, charset, enc, text) {
                var cs = charset.split('*')[0];
                return new TextDecoder(cs).decode(decodeWordBytes(enc, text));
            });
        } catch (e) {
            return null;
        }
    }

    // UTF-8 B-encoded words of at most 45 bytes each, never splitting a character.
    function encodeWords(text, ending) {
        if (text === '') {
            return '';
        }
        var enc = new TextEncoder();
        var words = [];
        var cur = '';
        var curLen = 0;
        var chars = Array.from ? Array.from(text) : text.split('');
        for (var i = 0; i < chars.length; i++) {
            var n = enc.encode(chars[i]).length;
            if (curLen + n > 45 && cur !== '') {
                words.push(cur);
                cur = '';
                curLen = 0;
            }
            cur += chars[i];
            curLen += n;
        }
        words.push(cur);
        // One word per line keeps every line far below the 998-byte limit.
        return words.map(function (w) {
            return '=?UTF-8?B?' + btoa(bytesToBinary(enc.encode(w))) + '?=';
        }).join((ending || '\r\n') + ' ');
    }

    /* ---- cleaning ---- */

    function applyPatterns(value, patterns) {
        for (var i = 0; i < patterns.length; i++) {
            value = value.replace(patterns[i], '');
        }
        return value;
    }

    // Returns the rewritten subject field, or null if nothing changed.
    function cleanSubjectField(field, cfg) {
        var endMatch = /\r?\n/.exec(field);
        var ending = endMatch ? endMatch[0] : '';
        var unfolded = field.replace(/\r?\n(?=[ \t])/g, '').replace(/\r?\n$/, '');
        var value = unfolded.substring(unfolded.indexOf(':') + 1).replace(/^[ \t]+/, '');
        var cleaned = applyPatterns(value, cfg.stripSubject);
        if (cleaned === value) {
            if (value.indexOf('=?') < 0) {
                return null;
            }
            var decoded = decodeWords(value);
            if (decoded === null) {
                return null;
            }
            var stripped = applyPatterns(decoded, cfg.stripSubject);
            if (stripped === decoded) {
                return null;
            }
            cleaned = encodeWords(stripped, ending);
        }
        return 'Subject: ' + cleaned + ending;
    }

    /*
     * Removes the configured spam markers from the top-level header block.
     * Everything else, including the body, is kept byte for byte.
     */
    function cleanMessage(u8, cfg) {
        var s = bytesToBinary(u8);
        var pos = 0;
        var bodyStart = s.length;
        var fields = [];
        while (pos < s.length) {
            var nl = s.indexOf('\n', pos);
            var end = nl < 0 ? s.length : nl + 1;
            var line = s.substring(pos, end);
            if (line === '\n' || line === '\r\n') {
                bodyStart = pos;
                break;
            }
            if ((line.charAt(0) === ' ' || line.charAt(0) === '\t') && fields.length > 0) {
                fields[fields.length - 1] += line;
            } else {
                fields.push(line);
            }
            pos = end;
        }

        var changed = false;
        var out = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var colon = f.indexOf(':');
            var name = colon < 0 ? '' : f.substring(0, colon).trim().toLowerCase();
            if (name !== '' && cfg.stripHeaders.indexOf(name) >= 0) {
                changed = true;
                continue;
            }
            if (name === 'subject') {
                var subj = cleanSubjectField(f, cfg);
                if (subj !== null) {
                    out.push(subj);
                    changed = true;
                    continue;
                }
            }
            out.push(f);
        }
        if (!changed) {
            return { bytes: u8, changed: false };
        }
        return { bytes: binaryToBytes(out.join('') + s.substring(bodyStart)), changed: true };
    }

    /*
     * The top-level header block of a raw message: everything before the
     * first empty line, line endings kept. Without an empty line the whole
     * input is the header block.
     */
    function headerBlock(u8) {
        var s = bytesToBinary(u8);
        var pos = 0;
        while (pos < s.length) {
            var nl = s.indexOf('\n', pos);
            if (nl < 0) {
                break;
            }
            var line = s.substring(pos, nl + 1);
            if (line === '\n' || line === '\r\n') {
                return u8.subarray(0, pos);
            }
            pos = nl + 1;
        }
        return u8;
    }

    var REMOVED_TEXT = 'The content of this mail was removed: only its headers were reported.';
    var MIME_DROP = ['content-type', 'content-transfer-encoding', 'content-disposition'];

    /*
     * An intact mail with the original headers and no content, for
     * "headers only" reports: the top-level MIME headers are replaced by
     * text/plain (the original Content-Type is kept as
     * X-ZSR-Original-Content-Type) and the body is one line of REMOVED_TEXT.
     * Line endings follow the original.
     */
    function headersOnlyMessage(u8) {
        var s = bytesToBinary(headerBlock(u8));
        var eol = s.indexOf('\r\n') >= 0 || s.indexOf('\n') < 0 ? '\r\n' : '\n';
        var fields = [];
        var pos = 0;
        while (pos < s.length) {
            var nl = s.indexOf('\n', pos);
            var end = nl < 0 ? s.length : nl + 1;
            var line = s.substring(pos, end);
            if ((line.charAt(0) === ' ' || line.charAt(0) === '\t') && fields.length > 0) {
                fields[fields.length - 1] += line;
            } else {
                fields.push(line);
            }
            pos = end;
        }
        var out = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            if (!/\n$/.test(f)) {
                f += eol;
            }
            var colon = f.indexOf(':');
            var name = colon < 0 ? '' : f.substring(0, colon).trim().toLowerCase();
            if (name === 'content-type') {
                out.push('X-ZSR-Original-Content-Type:' + f.substring(colon + 1));
            } else if (MIME_DROP.indexOf(name) < 0) {
                out.push(f);
            }
        }
        out.push('Content-Type: text/plain; charset=us-ascii' + eol, eol, REMOVED_TEXT + eol);
        return binaryToBytes(out.join(''));
    }

    /* ---- flow ---- */

    var NS = 'urn:zimbraMail';
    var FOLDER_INBOX = '2';
    var FOLDER_TRASH = '3';
    var FOLDER_JUNK = '4';

    // Answer of /service/upload?fmt=raw,extended: 200,'null',[{"aid":"…",…}]
    function parseUploadResponse(text) {
        var t = String(text);
        var status = parseInt(t, 10);
        var bracket = t.indexOf('[');
        var aid = null;
        if (status === 200 && bracket >= 0) {
            try {
                var list = JSON.parse(t.substring(bracket));
                aid = list.length > 0 ? list[0].aid : null;
            } catch (e) {
                aid = null;
            }
        }
        if (!aid) {
            throw new Error('upload failed: ' + t);
        }
        return aid;
    }

    function isShared(id) {
        return String(id).indexOf(':') >= 0;
    }

    function keepFlags(f) {
        return String(f || '').replace(/[^uf]/g, '');
    }

    /* ---- spam and ham reports ---- */

    var FOLDER_SENT = '5';
    var FOLDER_DRAFTS = '6';

    function direction(folder) {
        var l = String(folder);
        if (l === FOLDER_SENT || l === FOLDER_DRAFTS) {
            return null;
        }
        return l === FOLDER_JUNK ? 'ham' : 'spam';
    }

    // Newest message of a conversation outside Trash, Sent and Drafts.
    function newestCandidate(msgs) {
        var best = null;
        for (var i = 0; i < msgs.length; i++) {
            var l = String(msgs[i].l);
            if (l === FOLDER_TRASH || l === FOLDER_SENT || l === FOLDER_DRAFTS) {
                continue;
            }
            if (best === null || Number(msgs[i].d) > Number(best.d)) {
                best = msgs[i];
            }
        }
        return best;
    }

    /*
     * items: [{type: 'msg', id} | {type: 'conv', id, msgId?}]
     * One message per conversation: msgId if given, a virtual conversation
     * -N is message N, else the newest candidate (see newestCandidate).
     * Resolves to {entries: [{id, dir, info}], skipped: [{id, reason}]},
     * reason 'shared', 'own' or 'empty'. SOAP faults reject.
     */
    function classify(transport, items) {
        var entries = [];
        var skipped = [];
        var seen = [];

        function addMsg(id) {
            if (seen.indexOf(id) >= 0) {
                return null;
            }
            seen.push(id);
            return transport.soap('GetMsgRequest', { _jsns: NS, m: { id: id } })
                .then(function (resp) {
                    var info = resp && resp.m && resp.m[0];
                    if (!info) {
                        throw new Error('message ' + id + ' not found');
                    }
                    var dir = direction(info.l);
                    if (dir === null) {
                        skipped.push({ id: id, reason: 'own' });
                    } else {
                        entries.push({ id: id, dir: dir, info: info });
                    }
                });
        }

        return items.reduce(function (p, item) {
            return p.then(function () {
                var id = String(item.id);
                if (isShared(id)) {
                    skipped.push({ id: id, reason: 'shared' });
                    return null;
                }
                if (item.type !== 'conv') {
                    return addMsg(id);
                }
                if (item.msgId !== undefined && item.msgId !== null && item.msgId !== '') {
                    return addMsg(String(item.msgId));
                }
                if (id.charAt(0) === '-') {
                    return addMsg(id.substring(1));
                }
                return transport.soap('GetConvRequest', { _jsns: NS, c: { id: id } })
                    .then(function (resp) {
                        var msgs = (resp && resp.c && resp.c[0] && resp.c[0].m) || [];
                        var best = newestCandidate(msgs);
                        if (best === null) {
                            skipped.push({ id: id, reason: 'empty' });
                            return null;
                        }
                        return addMsg(String(best.id));
                    });
            });
        }, Promise.resolve()).then(function () {
            return { entries: entries, skipped: skipped };
        });
    }

    /*
     * entry: {id, dir, info} from classify; content: 'full'|'headers'.
     * ctx: {account, client, hostname, now}
     * transport.upload(bytes, filename, contentType) -> Promise<aid>
     * Never rejects; resolves to
     * {id, dir, ok, reportSent, stored, step?, error?, uncleaned?}.
     */
    function reportOne(transport, cfg, ctx, entry, content) {
        var id = String(entry.id);
        var info = entry.info || {};
        var dir = entry.dir;
        var result = { id: id, dir: dir, ok: false, reportSent: false, stored: false };
        var headers = content === 'headers';
        var step = 'fetch';
        var raw = null;

        function moveTo(folder) {
            return transport.soap('MsgActionRequest',
                { _jsns: NS, action: { id: id, op: 'move', l: folder } });
        }

        function storeHam() {
            step = 'clean';
            var cleaned = cleanMessage(raw, cfg);
            if (!cleaned.changed) {
                // Nothing to remove: move the original itself.
                step = 'move';
                return moveTo(FOLDER_INBOX);
            }
            step = 'upload';
            return transport.upload(cleaned.bytes, 'ham-' + id + '.eml', 'message/rfc822').then(
                function (aid) {
                    step = 'store';
                    var m = { l: FOLDER_INBOX };
                    var f = keepFlags(info.f);
                    if (f) { m.f = f; }
                    if (info.tn) { m.tn = info.tn; }
                    if (info.d) { m.d = info.d; }
                    m.aid = aid;
                    return transport.soap('AddMsgRequest', { _jsns: NS, m: m })
                        .then(function (resp) {
                            // Trash the original only when the copy exists.
                            if (!(resp && resp.m && resp.m[0] && resp.m[0].id)) {
                                throw new Error('copy was not stored');
                            }
                            result.stored = true;
                            step = 'trash';
                            return moveTo(FOLDER_TRASH);
                        });
                },
                function (e) {
                    // Upload refused (e.g. over zimbraFileUploadMaxSize):
                    // move the original to the Inbox unchanged.
                    step = 'move';
                    result.uncleaned = e && e.message ? e.message : String(e);
                    return moveTo(FOLDER_INBOX);
                });
        }

        var start = (headers || dir === 'ham') ?
            transport.fetchRaw(id).then(function (bytes) { raw = bytes; }) :
            Promise.resolve();

        return start
            .then(function () {
                step = 'report';
                if (!headers) {
                    return null;
                }
                // Named like a forwarded mail: its subject, no file suffix.
                var name = String(info.su || '').replace(/[\r\n]+/g, ' ').trim() || 'headers';
                return transport.upload(headersOnlyMessage(raw), name, 'message/rfc822');
            })
            .then(function (headersAid) {
                var rctx = { account: ctx.account, client: ctx.client, hostname: ctx.hostname,
                    now: ctx.now || new Date(), msgId: id, folderId: info.l, dir: dir,
                    content: headers ? 'headers' : 'full', headersAid: headersAid };
                return transport.soap('SendMsgRequest',
                    buildReportRequest(cfg, rctx).SendMsgRequest);
            })
            .then(function () {
                result.reportSent = true;
                if (dir === 'spam') {
                    step = 'move';
                    return moveTo(FOLDER_JUNK);
                }
                return storeHam();
            })
            .then(function () {
                result.ok = true;
                return result;
            }, function (e) {
                result.ok = false;
                result.step = step;
                result.error = e && e.message ? e.message : String(e);
                return result;
            });
    }

    // Reports the entries one after the other.
    function reportAll(transport, cfg, ctx, entries, content) {
        var results = [];
        return entries.reduce(function (p, entry) {
            return p.then(function () {
                return reportOne(transport, cfg, ctx, entry, content).then(function (r) {
                    results.push(r);
                });
            });
        }, Promise.resolve()).then(function () { return results; });
    }

    function summarize(results) {
        var s = { spam: 0, ham: 0, uncleaned: [], problems: [] };
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            if (r.ok) {
                s[r.dir === 'spam' ? 'spam' : 'ham']++;
                if (r.uncleaned) {
                    s.uncleaned.push(r.uncleaned);
                }
            } else {
                s.problems.push({ id: r.id, step: r.step, error: r.error,
                    stored: !!r.stored, reportSent: !!r.reportSent });
            }
        }
        return s;
    }

    /* ---- texts ---- */

    var STRINGS_EN = {
        titleSpam: 'Send SPAM',
        titleHam: 'Send false positive (HAM)',
        titleMixed: 'Send SPAM|HAM',
        textOne: 'This mail will be sent to the {team} ({address}). ' +
            'The information is used to improve spam detection.',
        textMany: '{n} mails will be sent to the {team} ({address}): ' +
            '{spam} as SPAM, {ham} as HAM. The information is used to improve spam detection.',
        headersOnly: 'Headers only',
        wholeMail: 'Whole mail',
        cancel: 'Cancel',
        send: 'Send',
        doneSpam: '{n} sent as SPAM and moved to Junk',
        doneHam: '{n} sent as HAM and moved to Inbox',
        uncleaned: '{n} moved without cleaning (upload failed: {errors})',
        failed: 'Report: {done} sent; failed: {list}',
        hintStored: 'copy is in Inbox; delete the original in Junk by hand',
        hintSent: 'report was sent, mail left in place',
        nothing: 'Nothing to report (own sent mail, drafts and shared mail are skipped)',
        busy: 'Report is already running',
        errorPrefix: 'Report: '
    };

    // Replaces {name} by fields[name]; unknown names stay as they are.
    function format(template, fields) {
        return String(template).replace(/\{([A-Za-z]+)\}/g, function (m, name) {
            return Object.prototype.hasOwnProperty.call(fields, name) ?
                String(fields[name]) : m;
        });
    }

    function str(strings, key) {
        var v = strings && strings[key];
        return typeof v === 'string' && v !== '' ? v : STRINGS_EN[key];
    }

    function dialogText(entries, cfg, strings) {
        var spam = 0;
        var ham = 0;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].dir === 'spam') { spam++; } else { ham++; }
        }
        var title = ham === 0 ? 'titleSpam' : (spam === 0 ? 'titleHam' : 'titleMixed');
        var text = entries.length === 1 ?
            format(str(strings, 'textOne'), { address: cfg.reportAddress, team: cfg.reportTeam }) :
            format(str(strings, 'textMany'), { n: entries.length, spam: spam, ham: ham,
                address: cfg.reportAddress, team: cfg.reportTeam });
        return { title: str(strings, title), text: text };
    }

    function statusText(summary, strings) {
        if (summary.problems.length > 0) {
            var lines = [];
            for (var i = 0; i < summary.problems.length; i++) {
                var p = summary.problems[i];
                var line = p.id + ': ' + p.step + ' - ' + p.error;
                if (p.stored) {
                    line += ' (' + str(strings, 'hintStored') + ')';
                } else if (p.reportSent) {
                    line += ' (' + str(strings, 'hintSent') + ')';
                }
                lines.push(line);
            }
            return { message: format(str(strings, 'failed'),
                { done: summary.spam + summary.ham, list: lines.join('; ') }), failure: true };
        }
        var parts = [];
        if (summary.spam > 0) {
            parts.push(format(str(strings, 'doneSpam'), { n: summary.spam }));
        }
        if (summary.ham > 0) {
            parts.push(format(str(strings, 'doneHam'), { n: summary.ham }));
        }
        if (parts.length === 0) {
            return { message: str(strings, 'nothing'), failure: false };
        }
        var message = parts.join(', ');
        if (summary.uncleaned.length > 0) {
            message += '; ' + format(str(strings, 'uncleaned'),
                { n: summary.uncleaned.length, errors: summary.uncleaned.join(', ') });
        }
        return { message: message, failure: false };
    }

    return {
        DEFAULTS: DEFAULTS,
        parseConfig: parseConfig,
        buildReportRequest: buildReportRequest,
        bytesToBinary: bytesToBinary,
        binaryToBytes: binaryToBytes,
        cleanMessage: cleanMessage,
        parseUploadResponse: parseUploadResponse,
        headerBlock: headerBlock,
        headersOnlyMessage: headersOnlyMessage,
        REMOVED_TEXT: REMOVED_TEXT,
        classify: classify,
        reportOne: reportOne,
        reportAll: reportAll,
        summarize: summarize,
        format: format,
        dialogText: dialogText,
        statusText: statusText,
        STRINGS_EN: STRINGS_EN
    };
}());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZsrCore;
}
