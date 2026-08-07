# Dyalog APL language server — v0.5 (experimental preview)

> **Status: experimental.** This is a working proof of concept, not a finished
> tool. It does three things well and deliberately does not attempt the rest —
> see "What it deliberately does not do". 

## Which APL?

**Dyalog APL specifically.** APL is a family of languages, not one language, and
the parts of it this server knows about are the Dyalog parts: the system names
(`⎕NGET`, `⎕JSON`, `⎕SHELL`), the control structures (`:If`, `:EndFor`), the
`]Link` file extensions, and the Dyalog prefix keyboard.

Other implementations — GNU APL, APL2, APLX, Dzaima/APL, ngn/apl, and the wider
array family such as BQN, Kap and Uiua — share many primitives, so hover
documentation on `⍴` or `⌽` would be broadly right in any of them. Everything
else would be wrong in ways that are worse than absent. Supporting another
dialect properly means a variant of `src/glyphs.ts` and a decision about how much
the two share, which is a real piece of work rather than a config flag. Pull
requests welcome from anyone who wants their dialect in here.

## What this is

A standalone language server for Dyalog APL. It needs Node, and it does not need a
Dyalog interpreter installed. That is the point: someone who has never written a
line of APL can install this, open a file, and get glyph completion, hover
documentation and syntax errors before they have downloaded anything else.

Not a fork of the 2018 work. That server is APL code running inside a Dyalog
v17 process, shipped as a workspace, so there was nothing to carry across
architecturally. See "Credit and things to reuse" below for what should be
taken from it.

## What works right now

**Glyph completion.** Type `` ` `` and the glyph list appears, filtered as you
type, so `` `r `` gives `⍴`. Type `` `` `` (twice) and you get a name search
instead, so ` ``rho ` also gives `⍴`. Every completion carries the Dyalog name
and the monadic and dyadic meanings.

**System name completion.** Typing `⎕` offers system names with descriptions.

**Control structure completion.** Typing `:` at the start of a statement offers
`:If`, `:EndFor` and the rest.

**Hover.** Put the cursor on a glyph and get its name, its monadic meaning, its
dyadic meaning, and the keystroke to type it. Works on `⎕`-names too.

**Syntax highlighting.** Comments, character literals, numbers, system names,
control structures, labels, dfn arguments, and the primitives coloured by
category so that functions and operators are visually distinct. Written from
scratch rather than adapted from existing grammars, so its provenance is clean.

It deliberately does **not** force an editor font. Choosing the font is the
user's business, and prior extensions that imposed one drew complaints.

**Diagnostics.** Unbalanced brackets and unclosed character literals, reported
as squiggles. It correctly ignores brackets inside comments and strings, and
handles the doubled-quote escape. Brackets balance across the whole file rather
than per line, so multi-line array notation does not produce false errors.

## Running it

```
npm install
npm run build
npm run smoke     # drives the server over stdio and prints what it answers
npm run grammar   # checks every rule in the syntax grammar
npm run gen:keyboard  # regenerates the keyboard tables from RIDE
npm test          # both of the above
```

`npm run grammar` is worth keeping in the habit: if one regex in the grammar is
invalid, VS Code silently loads no grammar at all, with no error anywhere. The
failure looks exactly like "highlighting isn't implemented yet".

`npm run smoke` is the fastest way to see it working — it acts as an editor,
sends real LSP requests, and prints the replies. No editor required.

In VS Code: open this folder and press F5. That launches a second VS Code with
the extension loaded. Open any `.apl` or `.aplf` file.

In Neovim, to demonstrate the editor-agnostic claim:

```lua
vim.lsp.start({
  name = 'dyalog-apl',
  cmd = { 'node', '/path/to/dyalog-apl-language-server/bin/dyalog-apl-language-server.js' },
  root_dir = vim.fn.getcwd(),
})
```

Helix, Zed, Emacs (eglot) and Sublime take the same command. Nothing in the
server knows which editor it is talking to.

## What it deliberately does not do

Without a running interpreter the server cannot know what a name *is*. In
`foo bar baz`, whether `foo` is a function or an array depends on things that
may not be in the file. So there is no go-to-definition, no rename, and no
"this is not a function" diagnostic yet. Everything it currently reports is
something the interpreter would also reject.

That ceiling is raised in two later stages, neither of which requires throwing
away any of this:

1. **Project awareness.** Follow `]Link` conventions and treat a directory as a
   namespace. That gives go-to-definition, find-references, rename and
   unused-name warnings across a real project, still with no interpreter.
2. **Optional interpreter attach.** When a Dyalog process is available, ask it
   for real name classes and values. Deep features light up; the zero-install
   path keeps working for everyone else.

## Where the data comes from, and what is still unverified

Verified against Dyalog's own sources:

- **Glyph characters** checked against RIDE's `src/bq.js`, which is generated
  from Dyalog's IME definitions. This caught a real bug: an earlier version used
  ∈ (U+2208) for membership where Dyalog uses ∊ (U+220A), so hover silently did
  nothing on real source. The same check found sixteen missing glyphs, including
  `≡`, `≢`, `⊆`, `⊤`, `⊥`, `@` and the ASCII primitives.
- **Official glyph names and function names** from Dyalog's "Nomenclature:
  Functions and Operators" cheat sheet, so hover says Circle Backslash and
  Dyadic Transpose rather than something informal. That sheet documents v16.0,
  so anything newer — Over, Behind, monadic Not Equal as Unique Mask — is not
  covered by it and wants re-checking against a current source.

- **The prefix keyboard mapping** is generated, not typed. RIDE stores four
  strings per keyboard locale in `src/kbds.js`, indexed by scancode — unshifted,
  shifted, APL, APL shifted — and builds its backtick map by pairing them.
  `tools/gen-keyboard.mjs` performs the same walk and emits `src/keyboard.ts`
  for all thirteen locales. Regenerate with `npm run gen:keyboard`.

  This replaced 52 hand-typed guesses. For the record, 49 were right, `⍀` was
  wrong (it is prefix-`.`, not prefix-`\`), two were meaningless, and 28 glyphs
  with real keys had been left blank. Which is roughly the accuracy you should
  expect from anything hand-typed, and the argument for generating it.

  Layouts genuinely differ between locales: `≢` is prefix-`@` on a British
  keyboard and prefix-`"` on a US one. The default is `en_US`; change it with
  `dyalogApl.keyboardLocale`.

Still unverified:

- **Documentation links.** Still none, on purpose. Hover gives names and
  meanings but links nowhere, because hand-pasted URLs rot. This wants a
  generated index of the documentation site.
- **The alias lists** used by name search are written from scratch. RIDE ships a
  better set at `src/bq.js`.

The system name list is partial for the same reason: the interpreter knows the
full set, so it should be generated rather than curated.

## Credit and things to reuse

The prior art is Gil Athoraya's `OptimaSystems/apl-language-server` and its
companion `vscode-apl-language-client`, both from 2018. 

## Layout

```
syntaxes/          the TextMate grammar, for syntax highlighting
src/keyboard.ts    GENERATED prefix keyboard tables, 13 locales
tools/             the generator for the above
src/glyphs.ts      glyph, system name and control word data
src/server.ts      the server: completion, hover, diagnostics
src/extension.ts   the VS Code client, which only launches the server
bin/               stdio entry point for every other editor
test/smoke.mjs     a minimal LSP client, for checking the server works
test/highlight.mjs checks the grammar assigns the scopes it should
```

`src/server.ts` is the part that matters and is under 300 lines. Everything
editor-specific lives in `src/extension.ts`, which is 50 lines and does nothing
but start a process.

## Open decisions

- **Licence.** MIT.
- **The language id is `apl`, not `dyalog-apl`.** The editor displays "Dyalog
  APL", but the underlying id stays generic so that existing editor settings and
  file associations keep working. The consequence is that installing this
  alongside another extension that also claims `apl` — Optima Systems'
  `vscode-apl-language`, for instance — means two grammars competing for the same
  language and unpredictable highlighting. Install one or the other.
- **The VS Code Marketplace.** Deliberately not published there yet. A stale
  marketplace listing is worse than no listing — see "Credit and things to
  reuse" for why this is not a hypothetical. Installable `.vsix` files are
  attached to GitHub releases instead, which reach people who are looking
  without misleading people who are not.
- **Who maintains it.** Still the real question. A language server is not a
  project with an end date; it needs someone across interpreter releases. The
  state of the 2018 attempt is the evidence of what happens otherwise.

## Contributing

Issues and pull requests welcome. The two most useful contributions, in order:

1. `]Link` project awareness, which unlocks go-to-definition, find-references
   and rename without needing an interpreter.
2. Document outline: implement `textDocument/documentSymbol` so the breadcrumb
   bar and Ctrl+Shift+O work. Needs tradfn header and dfn assignment parsing,
   no interpreter required. A good first contribution.
