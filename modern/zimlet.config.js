// zimlet-cli build hook: called with the webpack config.
const path = require('node:path');

module.exports = function (config) {
	// Our own entry: see src/compat-entry.js.
	config.entry = path.resolve(__dirname, 'src/compat-entry.js');
};
