# Dyalog APL language server

Static Dyalog APL language intelligence for any LSP editor. No interpreter
required.

> **Status: experimental preview.** Working, but early. See
> [Limitations](#limitations) for what it does not attempt.

Requires Node 22 or later. It does **not** require a Dyalog interpreter, so it
works before you have installed one.

**Glyph completion, hover documentation and diagnostics** are provided by the
language server over LSP, and reach every editor equally. So will the navigation
and refactoring features that come next.

**Syntax highlighting is separate.** It comes from the TextMate grammar in
`syntaxes/`, which the VS Code extension bundles — the server does not implement
LSP semantic tokens, so highlighting is editor integration rather than something
LSP delivers. Most editors already have APL syntax support of their own; the
grammar can also be pointed at directly by anything that reads TextMate
grammars. Making highlighting an LSP feature is tracked in
[#15](https://github.com/dragnim/dyalog-apl-language-server/issues/15).

Everything it knows is derived from your source tree, so it behaves identically
on any machine and in any LSP-capable editor. Not requiring an interpreter is a
permanent design rule rather than an early-stage limitation — see
[docs/SCOPE.md](docs/SCOPE.md).

For interactive Dyalog inside VS Code — REPL, tracing, debugging and runtime
values — [`dyalog-labs/vscode-apl`](https://github.com/dyalog-labs/vscode-apl)
is the tool for that. The two are complementary: it is the interpreter-integrated
VS Code environment, this is static language intelligence for any editor.

## Which APL

Dyalog APL specifically. The dialect-specific parts it knows about are the system
names (`⎕NGET`, `⎕JSON`, `⎕SHELL`), the control structures (`:If`, `:EndFor`),
the `]Link` file extensions, and the Dyalog prefix keyboard.

Other implementations share many primitives, so hover documentation on `⍴` or `⌽`
would be broadly correct elsewhere, but the rest would not. Supporting another
dialect means a variant of `src/glyphs.ts` and a decision about how much the two
share. Pull requests welcome.

Recognised file extensions: `.apl`, `.aplf`, `.apla`, `.aplc`, `.apli`, `.apln`,
`.aplo`, `.dyalog`.

## Features

Everything in this section is delivered over LSP, so every editor gets it,
except syntax highlighting where noted.

**Glyph completion.** Type `` ` `` for the glyph list, filtered as you type, so
`` `r `` gives `⍴`. Type it twice for a name search: ` ``rho `, ` ``shape ` and
` ``reshape ` all give `⍴`. Completions carry the official glyph name and the
monadic and dyadic meanings.

**System name completion.** Typing `⎕` offers system names with descriptions.

**Control structure completion.** Typing `:` at the start of a statement offers
the 48 colon words that may begin one, each with a description. `:In` and
`:InEach` are offered only inside a `:For`, which is the only place Dyalog
permits them.

**Hover.** The glyph name, its monadic and dyadic meanings, and the keystroke
that produces it. Works on `⎕`-names too.

**Document outline.** Traditional functions and operators, named dfns, and
explicit `:Namespace`, `:Class` and `:Interface` scripts appear in the editor's
outline, breadcrumbs and symbol navigation, with definitions nested inside the
script that contains them. Operators are distinguished from functions by their
header, so `∇R←(LO Over)Y` is reported as an operator. Only constructs whose
name can be read off the source with certainty are listed: an ordinary
assignment like `x←1` is not a symbol, because nothing in the file says what
`x` is.

**Diagnostics.** Unbalanced brackets and unclosed character literals. Brackets
inside comments and strings are ignored, the doubled-quote escape is handled, and
brackets balance across the whole file so multi-line array notation does not
produce false errors.

**Project awareness.** The server understands the static structure of
`]Link`-style source trees, mapping directories and supported APL files into a
namespace and object model without a running interpreter: `Foo/Bar.aplf` is
`#.Foo.Bar`. Directories are unscripted namespaces, file extensions give the
object's name class, and a script that declares its own name takes that name.
It follows `.linkconfig` settings such as `flatten`, decodes `caseCode`
filenames, and refuses to guess where a source tree is contradictory.

This is infrastructure rather than a feature you can see yet. It is what
go-to-definition, find references, rename and workspace symbols will be built
on; none of those is implemented, and the server advertises no capability for
them.

**Syntax highlighting — VS Code, via the bundled grammar rather than LSP.**
Comments, character literals, numbers, system names, control structures, labels
and dfn arguments, with primitives coloured by category so functions and
operators are visually distinct. It does not impose an editor font.

## Installing

### VS Code

Download the `.vsix` from the [latest release][releases], then either:

```
code --install-extension dyalog-apl-language-server-<version>.vsix
```

or, in VS Code, open the Extensions panel, choose **Install from VSIX…** from
its `...` menu, and select the file.

Not published to the VS Code Marketplace.

### Other editors

The server speaks LSP over stdio, so any LSP client can drive it. Clone the
repository and run `npm install && npm run build`, then point your editor at
`bin/dyalog-apl-language-server.js`.

Neovim:

```lua
vim.lsp.start({
  name = 'dyalog-apl',
  cmd = { 'node', '/path/to/dyalog-apl-language-server/bin/dyalog-apl-language-server.js' },
  root_dir = vim.fn.getcwd(),
})
```

Helix, Zed, Emacs (eglot) and Sublime take the same command.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `dyalogApl.prefixKey` | `` ` `` | Character that starts glyph completion. Typed twice, it searches by name. |
| `dyalogApl.keyboardLocale` | `en_US` | Keyboard layout the prefix keys follow. Thirteen locales available. |
| `dyalogApl.diagnostics` | `true` | Report unbalanced brackets and unclosed character literals. |

Layouts differ by locale: `≢` is prefix-`@` on a British keyboard and prefix-`"`
on a US one.

`prefixKey` must be a single character that is not a letter, digit or space;
anything else is rejected with a warning and the default is used. Because the key
is registered as an editor completion trigger when the server starts, changing it
restarts the server — the VS Code extension does that for you, and other clients
need a reload. The other two settings take effect immediately.

## Limitations

Without a running interpreter the server cannot know what a name *is*. In
`foo bar baz`, whether `foo` is a function or an array depends on things that may
not be in the file. So there is no go-to-definition, no rename, and no
"this is not a function" diagnostic. Everything it does report is something the
interpreter would also reject.

That ceiling is raised by understanding more of the project statically, not by
consulting an interpreter. Following `]Link` conventions and treating a
directory as a namespace gives go-to-definition, find-references, rename and
unused-name warnings across a project — all inferred from the repository, still
with no interpreter involved.

Attaching to a Dyalog process is not a planned stage and will not become one.
Where something genuinely cannot be determined from the source, the server is
meant to report nothing rather than guess. See [docs/SCOPE.md](docs/SCOPE.md).

The language id is `apl` rather than `dyalog-apl`, so that existing editor
settings and file associations keep working. Installing this alongside another
extension that also claims `apl` will result in two grammars competing for the
same language; use one or the other.

## Development

Requires Node 22 or later, the same as the server itself. No Dyalog
installation is needed to build, test or run anything here.

```
npm ci
npm run build            # compile TypeScript into out/
npm test                 # all three suites below
npm run smoke            # LSP assertions, driving the server over stdio
npm run grammar          # the grammar assigns the scopes it should
npm run controlwords     # colon words and grammar have not drifted apart
npm run symbols          # static symbol extraction, tested directly
npm run project          # ]Link project model, against temporary source trees
npm run gen:keyboard     # regenerate the keyboard tables from pinned RIDE
npm run gen:grammar      # regenerate the grammar's keyword rule
```

`npm test` needs `npm run build` first, since two of the suites read the
compiled output. CI runs the whole sequence on Linux, Windows and macOS.

`npm run smoke` acts as an editor, sending real LSP requests over stdio and
asserting on the replies, so it is both the quickest way to see the server
working and the thing that catches regressions.

`npm run grammar` is worth running after any change to the grammar: if a single
regex in it is invalid, VS Code silently loads no grammar at all and reports no
error, which looks identical to highlighting not being implemented.

The project version lives only in `package.json`. The server reads it at
runtime for its `initialize` reply, and a test asserts the two agree.

### Layout

```
src/server.ts          the LSP surface: completion, hover, symbols, diagnostics
src/analysis/scanner.ts  lexical masking of comments and character literals
src/analysis/symbols.ts  static extraction of the named things in a file
src/analysis/project.ts  the ]Link source tree as namespaces and objects
src/glyphs.ts          glyph and system name data
src/control-words.ts   the authoritative colon word list, with contexts
src/keyboard.ts        generated prefix keyboard tables, 13 locales
src/extension.ts       the VS Code client, which only launches the server
syntaxes/              the TextMate grammar; its keyword rule is generated
bin/                   stdio entry point for other editors
tools/gen-keyboard.mjs   generates src/keyboard.ts from pinned RIDE data
tools/gen-grammar.mjs    generates the grammar's keyword rule
test/smoke.mjs         LSP client with assertions
test/highlight.mjs     checks the grammar assigns the expected scopes
test/controlwords.mjs  checks the two colon word consumers stay in step
test/symbols.mjs       checks symbol extraction directly
test/project.mjs       indexes temporary source trees and checks the mapping
```

Everything editor-specific is confined to `src/extension.ts`, which does little
but start a process.

`src/analysis/` is the static analysis layer, and knows nothing about LSP: it
takes source text or a directory and returns plain data with line and character
positions, so `server.ts` only has to adapt it. That is deliberate, because
workspace symbols (#13) and go-to-definition (#10) will need the same
extraction without the LSP types coming with it. `scanner.ts` is the single place that understands where
comments and character literals begin and end; both symbol extraction and the
bracket diagnostics read through it, so `x←'}'` cannot close a dfn and a bracket
in a comment cannot be reported as unbalanced.

### Data sources

Generated data is preferred to hand-maintained tables wherever an authoritative
upstream exists — see the principle in [docs/SCOPE.md](docs/SCOPE.md).
Third party provenance and licence notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

`src/keyboard.ts` is generated, not hand-written. RIDE stores four strings per
keyboard locale in `src/kbds.js`, indexed by scancode — unshifted, shifted, APL,
APL shifted — and derives its prefix map by pairing them.
`tools/gen-keyboard.mjs` performs the same walk for all thirteen locales. The
upstream commit is **pinned**, so regenerating from a given project commit always
produces the same file; moving to a newer RIDE revision means bumping the SHA in
the generator and committing the regenerated output with it.

`src/control-words.ts` is the single source for Dyalog's colon words, audited
against Dyalog's own documentation and cross-checked against RIDE's
`src/syntax_info.js`. The grammar's keyword rule is generated from it, and
`npm run controlwords` fails if the two disagree — they had already drifted
before this was in place.

Glyph characters are checked against RIDE's `src/bq.js`, which is generated from
Dyalog's IME definitions. Official glyph names and the monadic and dyadic
function names come from Dyalog's "Nomenclature: Functions and Operators" cheat
sheet, which documents v16.0 — anything added since wants checking against a
current source.

Two tables remain hand-maintained and should eventually be generated: the alias
lists used by name search, and the system name list, which is partial. RIDE is
MIT licensed, so its fuller alias set can be adopted by preserving the notice.

Hover deliberately contains no documentation links, since hand-written URLs rot.
That wants a generated index of the documentation site.

The `]Link` mapping in `src/analysis/project.ts` was verified against
[Dyalog/link](https://github.com/Dyalog/link) rather than assumed: the
extension-to-name-class table comes from `StartupSession/Link/Utils.apln`, the
array sub-extensions from `docs/Usage/Arrays.md`, case codes from
`docs/API/Link.CaseCode.md`, and the rules for directories, duplicate
definitions and filename mismatches from `docs/Discussion/TechDetails.md` and
`docs/API/Link.Create.md`. The provenance is recorded in that file's header so
it can be re-checked against a later Link release.

## Acknowledgements

Gil Athoraya got here first: `OptimaSystems/apl-language-server` and
`vscode-apl-language-client` (2018) implement LSP for APL inside a Dyalog
process. This project is a separate implementation rather than a fork, and
shares no code with it.

## Licence

MIT. See [LICENSE](LICENSE).

[releases]: https://github.com/dragnim/dyalog-apl-language-server/releases
