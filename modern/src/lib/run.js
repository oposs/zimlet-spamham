// Report flow of the Modern zimlet, without UI: the components call
// prepare() on click, show the dialog from its model and call send().
const { itemsFromProps } = require('./items.js');
const { createTransport } = require('./transport.js');
const { readConfig } = require('./config.js');
const { stringsFor } = require('./strings.js');

function errText(e) {
	return e && e.message ? e.message : String(e);
}

function createRunner({ context, core, fetchFn }) {
	let running = false;

	const account = () => (typeof context.getAccount === 'function' && context.getAccount()) || {};
	const batch = () => context.zimbraBatchClient || {};
	const origin = () => String(context.zimbraOrigin || batch().origin || '');

	// The language the client UI is shown in: <html lang> of the client
	// (the zimlet runs in a frame, so the parent document first), then the
	// account preference, then the browser.
	function locale() {
		const docLang = (w) => {
			try {
				return (w && w.document && w.document.documentElement &&
					w.document.documentElement.lang) || '';
			} catch (e) {
				return '';
			}
		};
		const win = typeof window !== 'undefined' ? window : null;
		const prefs = account().prefs || {};
		return docLang(win && win.parent) || docLang(win) || prefs.zimbraPrefLocale ||
			(typeof navigator !== 'undefined' && navigator.language) || 'en';
	}

	function hostname() {
		const m = /^[a-z]+:\/\/([^/:]+)/i.exec(origin());
		if (m) {
			return m[1];
		}
		return (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
	}

	function transport() {
		return createTransport({
			batchClient: batch(),
			origin: origin(),
			csrfToken: context.csrfToken || batch().csrfToken
		}, fetchFn, core);
	}

	// Let the lists drop the moved mails; a failed refresh is harmless.
	function refresh() {
		try {
			const apollo = typeof context.getApolloClient === 'function' && context.getApolloClient();
			let p = null;
			if (apollo && typeof apollo.refetchQueries === 'function') {
				p = apollo.refetchQueries({ include: 'active' });
			} else if (apollo && typeof apollo.reFetchObservableQueries === 'function') {
				p = apollo.reFetchObservableQueries(true);
			}
			if (p && typeof p.then === 'function') {
				p.then(null, () => {});
			}
		} catch (e) {
			// ignored
		}
	}

	function strings() {
		return stringsFor(locale(), core);
	}

	// Resolves to {entries, model, strings} or {message, failure}.
	function prepare(props) {
		const s = strings();
		if (running) {
			return Promise.resolve({ message: s.busy, failure: false });
		}
		let cfg;
		try {
			cfg = readConfig(account(), core);
		} catch (e) {
			return Promise.resolve({ message: s.errorPrefix + errText(e), failure: true });
		}
		if (!cfg.reportAddress) {
			return Promise.resolve({ message: s.noAddress, failure: true });
		}
		const items = itemsFromProps(props || {});
		if (items.length === 0) {
			return Promise.resolve({ message: s.nothing, failure: false });
		}
		return Promise.resolve()
			.then(() => core.classify(transport(), items))
			.then((found) => {
				if (found.entries.length === 0) {
					return { message: s.nothing, failure: false };
				}
				const t = core.dialogText(found.entries, cfg, s);
				return {
					entries: found.entries,
					strings: s,
					model: {
						title: t.title,
						text: t.text,
						headersOnly: s.headersOnly,
						wholeMail: s.wholeMail,
						cancel: s.cancel,
						send: s.send
					}
				};
			}, (e) => ({ message: s.errorPrefix + errText(e), failure: true }));
	}

	// Resolves to {message, failure}; never rejects.
	function send(entries, content) {
		const s = strings();
		if (running) {
			return Promise.resolve({ message: s.busy, failure: false });
		}
		running = true;
		const ctx = {
			account: account().name,
			client: 'modern',
			hostname: hostname(),
			now: new Date()
		};
		return Promise.resolve()
			.then(() => core.reportAll(transport(), readConfig(account(), core), ctx, entries, content))
			.then((results) => core.statusText(core.summarize(results), s),
				(e) => ({ message: s.errorPrefix + errText(e), failure: true }))
			.then((st) => {
				running = false;
				refresh();
				return st;
			});
	}

	return { prepare, send, busy: () => running, strings };
}

module.exports = { createRunner };
