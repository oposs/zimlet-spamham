// Texts of the Modern zimlet: English from ZsrCore.STRINGS_EN, German here.
// Same wording as the Classic properties files.
const DE = {
	button: 'Send SPAM|HAM',
	titleSpam: 'Send SPAM',
	titleHam: 'Send false positive (HAM)',
	titleMixed: 'Send SPAM|HAM',
	textOne: 'Diese Mail wird an die {team} ({address}) gesendet. ' +
		'Die Information wird verwendet, um die Spam-Erkennung zu verbessern.',
	textMany: '{n} Mails werden an die {team} ({address}) gesendet: ' +
		'{spam} als SPAM, {ham} als HAM. Die Information wird verwendet, um die ' +
		'Spam-Erkennung zu verbessern.',
	headersOnly: 'Nur Header',
	wholeMail: 'Ganze Mail',
	cancel: 'Abbrechen',
	send: 'Senden',
	doneSpam: '{n} als SPAM gesendet und nach Junk verschoben',
	doneHam: '{n} als HAM gesendet und in den Posteingang verschoben',
	uncleaned: '{n} ohne Bereinigung verschoben (Upload fehlgeschlagen: {errors})',
	failed: 'Meldung: {done} gesendet; fehlgeschlagen: {list}',
	hintStored: 'Kopie liegt im Posteingang; bitte das Original im Junk-Ordner von Hand löschen',
	hintSent: 'Meldung wurde gesendet, Mail bleibt liegen',
	nothing: 'Nichts zu melden (eigene gesendete Mails, Entwürfe und geteilte Mails werden übersprungen)',
	busy: 'Meldung läuft bereits',
	errorPrefix: 'Meldung: '
};

const EN_EXTRA = { button: 'Send SPAM|HAM' };

// locale: 'de', 'de_CH', 'en_US', ...
function stringsFor(locale, core) {
	const de = /^de\b|^de[_-]/i.test(String(locale || ''));
	return Object.assign({}, core.STRINGS_EN, EN_EXTRA, de ? DE : {});
}

module.exports = { stringsFor };
