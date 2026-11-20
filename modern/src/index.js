// Entry of the Modern zimlet: registers the Send SPAM|HAM item in the
// mail "More" menu.
import createReportItem from './components/report-item';

export default function Zimlet(context) {
	const { plugins } = context;
	const exports = {};

	exports.init = function init() {
		plugins.register('slot::action-menu-mail-more', createReportItem(context));
	};
	return exports;
}
