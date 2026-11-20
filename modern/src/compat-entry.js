// Replaces @zimbra/zimlet-cli's dist/entry.js (see zimlet.config.js).
// Zimbra 10.1.21's Modern client keeps the function given to zimlet() and
// later calls `new fn(context)`. zimlet-cli 20 builds its own entry with
// esbuild for ES2022, which leaves an arrow function there ("h is not a
// constructor"). This copy passes a plain function; returning an object
// from it makes `new` yield that object.
(function () {
	function init() {
		zimlet(function (context) {
			var zimbra = context.zimbra;
			global.shims = context.shims;
			global.zimbra = zimbra;
			global.config = context.config;
			global.plugins = context.plugins;
			global.components = context.components;
			global.store = context.store;
			global.ZIMLET_STYLES = [];
			global.meta = context.meta;
			var entry = require('zimlet-cli-entrypoint');
			var r = (entry && entry.default) || entry;
			var instance = typeof r === 'function' ? r(context) : r;
			context.styles.set(global.ZIMLET_STYLES.join('\n'));
			return instance;
		});
	}
	init();
	if (module.hot) {
		module.hot.accept('zimlet-cli-entrypoint', init);
	}
}());
