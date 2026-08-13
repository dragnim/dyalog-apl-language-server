# Dyalog APL language server

Syntax highlighting, glyph completion, hover documentation and diagnostics for
Dyalog APL, in any editor that speaks the Language Server Protocol.

> **Status: experimental preview.** Working, but early. See
> [Limitations](#limitations) for what it does not attempt.

Requires Node 18 or later. It does **not** require a Dyalog interpreter, so it
works before you have installed one.

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

**Syntax highlighting.** Comments, character literals, numbers, system names,
control structures, labels and dfn arguments, with primitives coloured by
category so functions and operators are visually distinct. It does not impose an
editor font.

**Glyph completion.** Type `` ` `` for the glyph list, filtered as you type, so
`` `r `` gives `⍴`. Type it twice for a name search, so ` ``rho ` also gives `⍴`.
Completions carry the official glyph name and the monadic and dyadic meanings.

**System name completion.** Typing `⎕` offers system names with descriptions.

**Control structure completion.** Typing `:` at the start of a statement offers
`:If`, `:EndFor` and the rest.

**Hover.** The glyph name, its monadic and dyadic meanings, and the keystroke
that produces it. Works on `⎕`-names too.

**Diagnostics.** Unbalanced brackets and unclosed character literals. Brackets
inside comments and strings are ignored, the doubled-quote escape is handled, and
brackets balance across the whole file so multi-line array notation does not
produce false errors.

## Installing

### VS Code

Download the `.vsix` from the [latest release][releases], then either:

```
code --install-extension dyalog-apl-language-server-0.5.0.vsix
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

```
npm install
npm run build            # compile TypeScript into out/
npm test                 # smoke test and grammar checks
npm run smoke            # drive the server over stdio and print its replies
npm run grammar          # check every rule in the syntax grammar
npm run gen:keyboard     # regenerate the keyboard tables
```

`npm run smoke` acts as an editor, sending real LSP requests and printing the
replies, which is the quickest way to see the server working without an editor
involved. In VS Code, F5 launches a second window with the extension loaded.

`npm run grammar` is worth running after any change to the grammar: if a single
regex in it is invalid, VS Code silently loads no grammar at all and reports no
error, which looks identical to highlighting not being implemented.

### Layout

```
src/server.ts        the server: completion, hover, diagnostics
src/glyphs.ts        glyph, system name and control word data
src/keyboard.ts      generated prefix keyboard tables, 13 locales
src/extension.ts     the VS Code client, which only launches the server
syntaxes/            the TextMate grammar
bin/                 stdio entry point for other editors
tools/gen-keyboard.mjs   generates src/keyboard.ts
test/smoke.mjs       a minimal LSP client
test/highlight.mjs   checks the grammar assigns the expected scopes
```

Everything editor-specific is confined to `src/extension.ts`, which does nothing
but start a process.

### Data sources

Glyph characters are checked against RIDE's `src/bq.js`, which is generated from
Dyalog's IME definitions. Official glyph names and the monadic and dyadic
function names come from Dyalog's "Nomenclature: Functions and Operators" cheat
sheet, which documents v16.0 — anything added since wants checking against a
current source.

`src/keyboard.ts` is generated, not hand-written. RIDE stores four strings per
keyboard locale in `src/kbds.js`, indexed by scancode — unshifted, shifted, APL,
APL shifted — and derives its prefix map by pairing them.
`tools/gen-keyboard.mjs` performs the same walk for all thirteen locales.

Two tables remain hand-maintained and should eventually be generated: the alias
lists used by name search, and the system name list, which is partial.

Hover deliberately contains no documentation links, since hand-written URLs rot.
That wants a generated index of the documentation site.

## Acknowledgements

Gil Athoraya got here first: `OptimaSystems/apl-language-server` and
`vscode-apl-language-client` (2018) implement LSP for APL inside a Dyalog
process. This project is a separate implementation rather than a fork, and
shares no code with it.

## Licence

MIT. See [LICENSE](LICENSE).

[releases]: https://github.com/dragnim/dyalog-apl-language-server/releases
