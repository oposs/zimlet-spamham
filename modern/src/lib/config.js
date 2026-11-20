// Global properties of this zimlet's configuration from the account
// (GetInfo zimlets), parsed by ZsrCore.
const NAME = 'ch_oetiker_report_spam_ham_modern';

function zimletName(entry) {
	const z = entry && entry.zimlet && entry.zimlet[0];
	const c = entry && entry.zimletConfig && entry.zimletConfig[0];
	return (z && z.name) || (c && c.name) || '';
}

function readConfig(account, core) {
	const list = (account && account.zimlets && account.zimlets.zimlet) || [];
	const props = {};
	for (const entry of list) {
		if (zimletName(entry) !== NAME) {
			continue;
		}
		const cfg = entry.zimletConfig && entry.zimletConfig[0];
		const global = cfg && cfg.global && cfg.global[0];
		for (const p of (global && global.property) || []) {
			if (p && p.name) {
				props[p.name] = p.content;
			}
		}
	}
	return core.parseConfig(props);
}

module.exports = { readConfig, NAME };
