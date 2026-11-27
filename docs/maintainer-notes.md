# Maintainer notes

## Modern zimlet entry

The Modern zimlet is a `@zimbra/zimlet-cli` project. Its entry is replaced
by `modern/src/compat-entry.js` (see `modern/zimlet.config.js`): Zimbra
10.1.21 calls `new` on the function passed to `zimlet()`, which fails for
the arrow function zimlet-cli 20 generates.

zimlet-cli translates the JSX of `modern/src`, binds `preact` and the
`@zimbra-client` imports to the modules the client has already loaded, and
writes one `modern/build/index.js` in the module format the client loads.
Only that file goes into the package.

## Modern build with pnpm

CI runs the Modern project through repo-infra's `ri-ci-node-pnpm` piece in
`modern/`, which calls the scripts `check`, `test` and `build` of
`modern/package.json` in that order. `test` builds first and then runs the
whole suite in `test/`, because `test/modern-build.test.js` reads the
bundle; `check` runs the ES3 test, which needs no build. pnpm runs no
dependency install scripts unless allowed: `modern/pnpm-workspace.yaml`
allows the one of esbuild, which zimlet-cli builds with.

## Classic files stay ES3

Zimbra compiles all Classic zimlets of an account into one bundle with
yuicompressor 2.4.2. One syntax error it does not accept, such as
`promise.catch(...)` or a reserved word as a property name, breaks the
bundle and every zimlet of the account shows `${msg.label}`.
`test/es3.test.js` guards this; the real check is
`java -jar /opt/zimbra/lib/jars/yuicompressor-2.4.2-zimbra.jar --type js <file>`.

## Config template versions

`zmzimletctl deploy` replaces a stored configuration only when the version
in `config_template.xml` is higher than the stored one. The config version
therefore changes only when the shipped properties change
(`test/template.test.js`); a zimlet release alone keeps the values an
administrator set with `zmzimletctl configure`.

## Releases

The release flow writes the release version into both `package.json`
files and the `version` of both zimlet XML
files (`.github/repo-infra.json`). The web client caches zimlets by that
version, so every deployed package needs a new one.
