// Items for ZsrCore.classify from the props of the Modern "More" menu.
// A single mail in the conversation list is the virtual conversation -<id>.
function itemsFromProps(props) {
	const sel = props && props.selectedMails;
	const list = sel && sel.length ? sel : (props && props.emailData ? [props.emailData] : []);
	const items = [];
	for (const it of list) {
		const raw = it && it.id;
		if (raw === undefined || raw === null || String(raw) === '') {
			continue;
		}
		const id = String(raw);
		if (id.charAt(0) === '-') {
			items.push({ type: 'msg', id: id.substring(1) });
		} else if (it.__typename === 'Conversation') {
			items.push({ type: 'conv', id });
		} else {
			items.push({ type: 'msg', id });
		}
	}
	return items;
}

module.exports = { itemsFromProps };
