# Scope and architectural principles

This document is the durable statement of what this project is, what it will
never be, and the principles that govern how features are added. It is the
source of truth for those questions; the README summarises, and issues link
here rather than restating.

## What this is

> Static developer tooling for Dyalog APL, available in any editor that
> supports LSP, with no Dyalog installation required.

Or informally: APL editing intelligence without the IDE.

A user should be able to clone an APL repository, open it in a compatible
editor, and immediately get useful APL-aware tooling without installing,
configuring or launching Dyalog.

## The permanent rule

**The language server must never require or attach to a Dyalog interpreter.**

This is not a limitation of the current stage that a later version lifts. It is
a permanent architectural constraint and one of the project's main reasons to
exist. Every feature is designed within it.

Everything the server knows is derived from:

- source files
- workspace structure
- `]Link` conventions
- generated Dyalog language data
- lexical analysis
- static project analysis

## Relationship to `dyalog-labs/vscode-apl`

These are not competing implementations of the same product. They answer
different questions.

| | This project | `dyalog-labs/vscode-apl` |
| --- | --- | --- |
| Answers | How do I get good Dyalog APL source tooling wherever I edit code, even when Dyalog isn't installed? | How do I use Dyalog interactively inside VS Code? |
| Pipeline | source + workspace → language server → LSP → any editor | VS Code → extension → RIDE → interpreter |
| Concerns | editing, navigation, understanding source, refactoring, static diagnostics, documentation, project structure | execution, REPL, tracing, debugging, runtime state, live values |
| Dyalog | not required | integral |

Someone wanting a live Dyalog development environment in VS Code should use
`vscode-apl`. It is the right tool for that, and this project should not try to
become a second one.

This project is the better fit for a user who does not use VS Code, does not
have Dyalog installed, is reading or reviewing an APL codebase rather than
executing it, is contributing a small change, is learning APL, is working in a
container or remote environment where Dyalog is unavailable, or simply wants
lightweight language tooling rather than a complete development environment.

The same server should behave equivalently in VS Code, Neovim, Zed, Helix,
Emacs and Sublime Text.

## Out of scope

Do not add:

- RIDE protocol support
- interpreter discovery, launching, or attaching
- REPL functionality or expression execution
- runtime value inspection or runtime autocomplete
- debugging, or Debug Adapter Protocol support
- interpreter-backed name-class analysis
- interpreter-backed `]Link` discovery

Keeping these out is also what prevents the server gradually turning into an
APL IDE implemented inside an LSP process.

**Note on generators.** This rule governs the shipped server, not the
maintainer's toolbox. A build-time generator that reads an authoritative source
— including a running Dyalog — and emits a table that is checked into the
repository does not breach it, because the shipped server still requires
nothing. `tools/gen-keyboard.mjs` is the established pattern.

## Principles

### The source tree is the authority

Behaviour should follow what is represented in the repository, so that analysis
is reproducible: two developers opening the same commit get the same project
understanding, regardless of what happens to be loaded in someone's interpreter
workspace. That matters most for code review, CI, remote editing, and reading
unfamiliar repositories.

### Say "unknown" rather than guess

The absence of an interpreter must never be papered over by guessing. In
`foo bar baz`, there may be no way to know whether each name is an array,
function or operator.

The server should distinguish between facts derivable lexically, facts
derivable from project structure, and things that genuinely cannot be known
statically — and return no result for the third. Correctly saying "unknown" is
better language tooling than confidently reporting something false.

This applies particularly to undefined-name diagnostics, function/array
distinctions, semantic highlighting, references, rename, localisation and
unused-name analysis.

### Progressive static understanding

Capability grows by understanding progressively more of the project:

```
characters → tokens → files → definitions → scopes → ]Link project
                                                   → cross-file relationships
```

Each stage should improve what can safely be inferred without abandoning the
zero-interpreter model.

### Generate, don't curate

Where an authoritative upstream source exists, generate from it:

```
authoritative upstream source → generator → project data
```

rather than maintaining large tables by hand. `src/keyboard.ts` is generated
from RIDE's `kbds.js`; doing so replaced 52 hand-typed guesses, corrected one
that was wrong, and filled 28 entries left blank. Glyph aliases, system names
and documentation mappings are the outstanding candidates.

Generated data should be checked into the repository or produced during the
release process.

### Keep editor-specific code minimal

The VS Code extension should continue to do little beyond launching the server.
Language features belong in the server, so that every editor benefits:

| Feature | Implementation |
| --- | --- |
| Go to definition | LSP definition |
| Find references | LSP references |
| Rename | LSP rename |
| Document outline | LSP document symbols |
| Workspace search | LSP workspace symbols |
| Localise variable | LSP code action |
| Documentation | LSP hover / completion |
| Diagnostics | LSP diagnostics |

Avoid editor-specific implementations unless no suitable LSP mechanism exists.

### Diagnostics expand carefully

The current diagnostics — unbalanced delimiters, unterminated character
literals — are appropriate because they can be determined confidently without
evaluating APL. Each new diagnostic must pass the same test:

> Can this be determined from the source and project structure with a
> sufficiently low risk of false positives?

Later candidates include malformed tradfn headers, unmatched control
structures, duplicate statically identifiable definitions, unresolved `]Link`
names where the mapping is unambiguous, and unused locals where scope is
unambiguous.

Do not chase a large diagnostic count at the expense of accuracy.

## Positioning

Preferred description:

> Static developer tooling for Dyalog APL, available in any editor that
> supports LSP, with no Dyalog installation required.

Shorter:

> Dyalog APL language intelligence for any editor. No interpreter required.

Zero-runtime should read as a benefit rather than an apology: immediate
installation, no Dyalog configuration, editor independence, portability, and
predictable behaviour based on repository state rather than mutable workspace
state.

Avoid positioning this as "a better alternative to APL for VS Code". It is not
trying to beat `vscode-apl` at its own job; it is solving a different problem.
