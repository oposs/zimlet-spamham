# zimlet-spamham

"Send SPAM|HAM" for the Zimbra web clients (tested on Zimbra 10.1.21): a
toolbar button in the Classic client and an item in the "More" menu of the
Modern client.

A click opens a dialog that names the recipient and offers "Headers only"
or "Whole mail" (default). Every selected mail is then sent to a
configured anti-spam address, one report per mail:

- Mail in Junk is reported as HAM (false positive). A copy with the spam
  markers removed is stored in the Inbox and the original goes to Trash.
  A mail without markers is moved to the Inbox as it is.
- Mail in any other own folder is reported as SPAM and moved to Junk.
- Sent mail, drafts and mail in shared folders are skipped. Of a selected
  conversation, only the open message (else the newest one outside Trash,
  Sent and Drafts) is reported.

The report has the subject `[ZHR] SPAM Report <server> <account>` or
`[ZHR] HAM Report …`, the headers `X-ZSR-Type`, `X-ZSR-Domain` and
`X-ZSR-Server`, and a body in the format of Zimbra's own spam training
report (`Classified-As: spam|ham`, `Report-Content: full|headers`). The
reported mail is attached as `message/rfc822`; with "Headers only" it keeps
its original headers and its content is replaced by one line of text.

Texts are in English and German, chosen by the language of the web client.

The two clients need two zimlets:

| Client | Zimlet | Package |
|---|---|---|
| Classic | `ch_oetiker_report_spam_ham_classic` | `dist/ch_oetiker_report_spam_ham_classic.zip` |
| Modern | `ch_oetiker_report_spam_ham_modern` | `dist/ch_oetiker_report_spam_ham_modern.zip` |

## Build

Node 24 and npm 11 for the Modern zimlet (`modern/mise.toml` pins them for
[mise](https://mise.jdx.dev/)):

    make test classic modern

The Modern zimlet is a `@zimbra/zimlet-cli` project. Its entry is replaced
by `modern/src/compat-entry.js` (see `modern/zimlet.config.js`): Zimbra
10.1.21 calls `new` on the function passed to `zimlet()`, which fails for
the arrow function zimlet-cli 20 generates.

The Classic files must stay ES3: Zimbra compiles all Classic zimlets of an
account into one bundle with yuicompressor 2.4.2, and one syntax error
breaks every zimlet. `test/es3.test.js` guards this; the real check is
`java -jar /opt/zimbra/lib/jars/yuicompressor-2.4.2-zimbra.jar --type js <file>`.

## Prerequisites on the server

Allow the report headers once per server, otherwise `SendMsgRequest`
fails with `header 'X-ZSR-Type' not allowed`:

    zmprov mcf +zimbraCustomMimeHeaderNameAllowed X-ZSR-Type \
               +zimbraCustomMimeHeaderNameAllowed X-ZSR-Domain \
               +zimbraCustomMimeHeaderNameAllowed X-ZSR-Server
    zmprov fc config

To make this button the only way to report, leave Zimbra's own training
addresses empty; otherwise its Junk / Not Junk actions forward mail too:

    zmprov gcf zimbraSpamIsSpamAccount zimbraSpamIsNotSpamAccount

The HAM copy goes through `/service/upload`, which is limited by
`zimbraFileUploadMaxSize`. When the upload is refused, the original is
moved to the Inbox unchanged and the status message says so.

## Deploy

`zmzimletctl deploy` also enables the zimlet in COS `default`. Remove it
there and enable it in the COS that should have it:

    zmzimletctl deploy dist/<zimlet>.zip
    zmprov mc default -zimbraZimletAvailableZimlets +<zimlet>
    zmprov mc <cos> +zimbraZimletAvailableZimlets +<zimlet>
    zmprov fc cos; zmprov fc zimlet

A `zimbraZimletAvailableZimlets` value on an account replaces the whole COS
list, so enable zimlets per COS, not per account. Users reload the web
client (Ctrl+Shift+R) to see the change.

## Configure

The configuration is stored per zimlet name; configure both zimlets with
the same values:

    zmzimletctl getConfigTemplate dist/<zimlet>.zip > config_template.xml
    # edit config_template.xml
    zmzimletctl configure config_template.xml
    zmprov fc zimlet

| Property | Default | Meaning |
|---|---|---|
| `reportAddress` | `anti-spam@oetiker.ch` | Recipient of the reports |
| `reportTeam` | `O+P SpamFilter Patrol` | Recipient name shown in the dialog |
| `reportByDomain` | empty | Recipient per mail domain, see below |
| `serverName` | empty (host name of the web client) | Server name written into the report |
| `hamStripHeaders` | `X-Spam-Flag,X-Spam-Status,…` | Headers removed from the HAM copy |
| `hamStripSubject` | three SPAM subject patterns | Regexes, one per line, removed from the subject of the HAM copy |

`reportByDomain` holds one line per mail domain:
`<domain> <address> [team name]`. An account of a listed domain reports to
that address and sees that team name (`reportTeam` when the line has none);
all other accounts use `reportAddress` and `reportTeam`:

    <property name="reportByDomain">example.org abuse@example.org Example Abuse Desk
    example.com spam@example.com</property>

An invalid `reportByDomain` line or `hamStripSubject` pattern aborts the
click with an error message; nothing is sent.

`zmzimletctl deploy` replaces a stored configuration only when the version
in `config_template.xml` is higher than the stored one. That version is
raised only when the shipped properties change (`test/template.test.js`);
after such an upgrade configure the values again.

## Remove

    zmzimletctl undeploy ch_oetiker_report_spam_ham_classic
    zmzimletctl undeploy ch_oetiker_report_spam_ham_modern

## License

MIT, see [LICENSE](LICENSE).
