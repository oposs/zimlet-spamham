# Runs npm with the Node version of modern/mise.toml; CI passes RUN= and
# provides that Node itself.
RUN ?= mise exec --

.PHONY: test classic modern clean

CLASSIC_FILES = classic/ch_oetiker_report_spam_ham_classic.xml classic/config_template.xml \
	classic/ch_oetiker_report_spam_ham_classic.js core/zsr-core.js \
	classic/ch_oetiker_report_spam_ham_classic.properties classic/ch_oetiker_report_spam_ham_classic_de.properties \
	classic/ch_oetiker_report_spam_ham_classic.css classic/report.png

MODERN_JS = modern/build/index.js
MODERN_SRC = $(shell find modern/src -type f) core/zsr-core.js modern/package.json modern/zimlet.config.js
MODERN_FILES = modern/ch_oetiker_report_spam_ham_modern.xml modern/config_template.xml \
	$(MODERN_JS) \
	modern/ch_oetiker_report_spam_ham_modern.properties modern/ch_oetiker_report_spam_ham_modern_de.properties

test:
	node --test 'test/*.test.js'

classic: dist/ch_oetiker_report_spam_ham_classic.zip

modern: dist/ch_oetiker_report_spam_ham_modern.zip

dist/ch_oetiker_report_spam_ham_classic.zip: $(CLASSIC_FILES)
	mkdir -p dist
	rm -f $@
	zip -j $@ $(CLASSIC_FILES)

# The Modern zimlet is a zimlet-cli project (Node 24 via modern/mise.toml).
# Its zip carries our own XML and config_template.xml: `zimlet package`
# writes a descriptor without the config template.
modern/node_modules: modern/package.json modern/package-lock.json
	cd modern && $(RUN) npm ci --no-audit --no-fund
	touch $@

$(MODERN_JS): $(MODERN_SRC) modern/node_modules
	cd modern && $(RUN) npm run build

dist/ch_oetiker_report_spam_ham_modern.zip: $(MODERN_FILES)
	mkdir -p dist
	rm -f $@
	zip -j $@ $(MODERN_FILES)

clean:
	rm -rf dist build modern/build
