import { createElement } from 'preact';
import { useCallback } from 'preact/hooks';
import { ActionMenuItem } from '@zimbra-client/components';
import ReportDialog from '../report-dialog';
import style from './style.less';

const core = require('../../../../core/zsr-core.js');
const { createRunner } = require('../../lib/run.js');

const MODAL_ID = 'zhrReport';

// The "More" menu item; context is the zimlet context.
export default function createReportItem(context) {
	const runner = createRunner({
		context,
		core,
		fetchFn: (url, opts) => fetch(url, opts)
	});

	function dispatch(action) {
		if (context.store && action) {
			context.store.dispatch(action);
		}
	}

	function notify(message, failure) {
		const n = context.zimletRedux && context.zimletRedux.actions &&
			context.zimletRedux.actions.notifications;
		if (n) {
			const p = { message: String(message) };
			if (failure) {
				p.failure = true;
			}
			dispatch(n.notify(p));
		}
	}

	function modal(component) {
		const z = context.zimletRedux && context.zimletRedux.actions &&
			context.zimletRedux.actions.zimlets;
		if (z) {
			dispatch(component ? z.addModal({ id: MODAL_ID, modal: component }) :
				z.addModal({ id: MODAL_ID }));
		}
	}

	function open(props) {
		runner.prepare(props).then((p) => {
			if (!p.entries) {
				notify(p.message, p.failure);
				return;
			}
			const close = () => modal(null);
			const send = (content) => {
				close();
				runner.send(p.entries, content).then((st) => notify(st.message, st.failure));
			};
			modal(<ReportDialog model={p.model} onSend={send} onClose={close} />);
		});
	}

	return function ReportItem(props) {
		const onClick = useCallback(() => open(props), [props]);
		return (
			<ActionMenuItem onClick={onClick}>
				<span class={style.label}>{runner.strings().button}</span>
			</ActionMenuItem>
		);
	};
}
