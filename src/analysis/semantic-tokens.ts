/**
 * Semantic tokens: the static meaning the TextMate grammar cannot know.
 *
 * The grammar keeps doing the lexical work — comments, literals, numbers,
 * primitives, colon words, punctuation — and this adds only what the server has
 * actually established. So there is no token for `+`, `⍴`, `⎕IO`, `:If`, `⍺` or
 * `⍵`: colouring those here would be a second, worse lexer.
 *
 * What it does know, and the grammar cannot:
 *
 *   - that `Twice` in `∇R←(LO Twice)Y` is an *operator* and `Mean` is a function
 *   - that `X` is a parameter, `Temp` a local and `R` a result, and which body
 *     occurrences are which
 *   - that `Stats` in `#.Stats.Mean` really is a namespace, rather than the left
 *     operand of an inner product
 *   - that a `Mean` shadowed by an argument of the same name is that argument,
 *     not the project function it otherwise resolves to
 *
 * ORDER OF PRECEDENCE. Header bindings win over project identity, because that is
 * what APL does: a localised or argument name shadows anything outside. Only names
 * left unexplained by the enclosing definition are put to the project resolver,
 * and a name that resolves to nothing gets no token at all.
 *
 * All positions are computed from masked code, so nothing inside a comment or a
 * character literal can ever produce a token.
 */

import { scanLines, NAME_CHARS, NAME_FIRST_CHARS } from './scanner';
import { extractSymbols, type AplSymbol } from './symbols';
import { analyseHeader, localsLineBindings, type NameBinding } from './bindings';
import { resolveEntity } from './definitions';
import type { ProjectModel } from './project';

/**
 * The legend, in protocol order. Indexes are what gets encoded, so this array is
 * protocol-facing: append only, never reorder.
 */
export const TOKEN_TYPES = [
  'namespace',
  'class',
  'interface',
  'function',
  'operator',
  'variable',
  'parameter'
] as const;

/** Likewise fixed: each modifier is a bit position in the encoded value. */
export const TOKEN_MODIFIERS = ['declaration', 'definition'] as const;

export type SemanticTokenType = (typeof TOKEN_TYPES)[number];
export type SemanticTokenModifier = (typeof TOKEN_MODIFIERS)[number];

export interface SemanticOccurrence {
  line: number;
  startCharacter: number;
  length: number;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
}

export interface SemanticTokensRequest {
  /** Live text of the document being highlighted. */
  text: string;
  /** Its path on disk, absent for an untitled document. */
  file?: string;
  project: ProjectModel;
  liveText?: (file: string) => string | undefined;
}

/** A definition's own name is both declared and defined here. */
const DEFINING: SemanticTokenModifier[] = ['declaration', 'definition'];
/** A binding site introduces a name without defining a callable thing. */
const BINDING: SemanticTokenModifier[] = ['declaration'];

const SYMBOL_TOKEN: Record<AplSymbol['kind'], SemanticTokenType> = {
  tradfn: 'function',
  tradop: 'operator',
  dfn: 'function',
  namespace: 'namespace',
  class: 'class',
  interface: 'interface'
};

/** The same kinds document symbols and workspace symbols use, so nothing disagrees. */
const OBJECT_TOKEN: Record<string, SemanticTokenType | undefined> = {
  function: 'function',
  operator: 'operator',
  namespace: 'namespace',
  class: 'class',
  interface: 'interface',
  array: 'variable',
  // A generic .apl or .dyalog file's class is not stated by its extension, so
  // there is nothing confident to say about a reference to it.
  code: undefined
};

const ROLE_TOKEN: Record<NameBinding['role'], SemanticTokenType> = {
  result: 'variable',
  parameter: 'parameter',
  local: 'variable'
};

const NAME_OCCURRENCE = new RegExp(`[${NAME_FIRST_CHARS}][${NAME_CHARS}]*`, 'gu');

function flatten(symbols: AplSymbol[]): AplSymbol[] {
  return symbols.flatMap(symbol => [symbol, ...flatten(symbol.children)]);
}

/** One traditional definition and everything its header binds. */
interface Definition {
  symbol: AplSymbol;
  /** Bound name to the role it plays, for the whole definition. */
  roles: Map<string, NameBinding['role']>;
  /** The binding sites themselves, which are declarations. */
  sites: NameBinding[];
  headerLine: number;
  bodyFrom: number;
  bodyTo: number;
}

export function semanticOccurrences(request: SemanticTokensRequest): SemanticOccurrence[] {
  const masked = scanLines(request.text);
  const symbols = flatten(extractSymbols(request.text));
  const occurrences: SemanticOccurrence[] = [];

  /** Positions already spoken for, so nothing is classified twice. */
  const claimed = new Set<string>();
  const key = (line: number, character: number): string => `${line}:${character}`;

  const emit = (
    line: number,
    startCharacter: number,
    length: number,
    type: SemanticTokenType,
    modifiers: SemanticTokenModifier[]
  ): void => {
    if (claimed.has(key(line, startCharacter))) return;
    claimed.add(key(line, startCharacter));
    occurrences.push({ line, startCharacter, length, type, modifiers });
  };

  // ---- every definition's own name
  for (const symbol of symbols) {
    emit(
      symbol.selectionRange.start.line,
      symbol.selectionRange.start.character,
      symbol.name.length,
      SYMBOL_TOKEN[symbol.kind],
      DEFINING
    );
  }

  // ---- what each traditional definition's header binds
  const definitions: Definition[] = [];
  for (const symbol of symbols) {
    if (symbol.kind !== 'tradfn' && symbol.kind !== 'tradop') continue;

    const headerLine = symbol.range.start.line;
    const header = analyseHeader(masked[headerLine]?.code ?? '', headerLine);
    if (!header) continue;

    const bodyFrom = headerLine + 1;
    const bodyTo = symbol.range.end.line + 1;
    const localsLines = localsLineBindings(masked, bodyFrom, Math.min(bodyTo, masked.length));

    const sites = [...header.bindings, ...localsLines.bindings];
    const roles = new Map<string, NameBinding['role']>();
    for (const site of sites) if (!roles.has(site.name)) roles.set(site.name, site.role);

    definitions.push({ symbol, roles, sites, headerLine, bodyFrom, bodyTo });

    for (const site of sites) {
      emit(
        site.range.start.line,
        site.range.start.character,
        site.name.length,
        ROLE_TOKEN[site.role],
        BINDING
      );
    }
  }

  /** The innermost traditional definition covering a line, if any. */
  const definitionAt = (line: number): Definition | undefined => {
    let best: Definition | undefined;
    for (const definition of definitions) {
      if (line < definition.symbol.range.start.line) continue;
      if (line > definition.symbol.range.end.line) continue;
      if (!best || definition.symbol.range.start.line > best.symbol.range.start.line) {
        best = definition;
      }
    }
    return best;
  };

  // ---- every remaining name occurrence
  for (let line = 0; line < masked.length; line++) {
    const code = masked[line].code;

    for (const match of code.matchAll(NAME_OCCURRENCE)) {
      const startCharacter = match.index ?? 0;
      const name = match[0];
      if (claimed.has(key(line, startCharacter))) continue;

      // A ⎕name is a system name; the grammar already colours it.
      if (startCharacter > 0 && code[startCharacter - 1] === '⎕') continue;
      // A colon before it makes it a control word, likewise the grammar's job.
      if (startCharacter > 0 && code[startCharacter - 1] === ':') continue;

      // A name the enclosing definition binds *is* that binding, whatever else
      // of the same spelling exists in the project. APL shadows; so do we.
      const enclosing = definitionAt(line);
      const role = enclosing?.roles.get(name);
      if (role !== undefined) {
        emit(line, startCharacter, name.length, ROLE_TOKEN[role], []);
        continue;
      }

      // Otherwise ask the resolver. Anything it cannot settle gets no token.
      const entity = resolveEntity({
        text: request.text,
        file: request.file,
        position: { line, character: startCharacter },
        project: request.project,
        liveText: request.liveText
      });
      if (!entity) continue;

      const type =
        entity.kind === 'symbol'
          ? SYMBOL_TOKEN[entity.symbol.kind]
          : entity.kind === 'namespace'
            ? 'namespace'
            : OBJECT_TOKEN[entity.object.kind];
      if (type === undefined) continue;

      emit(line, startCharacter, name.length, type, []);
    }
  }

  // LSP requires ascending line, then ascending character.
  occurrences.sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.startCharacter - b.startCharacter
  );
  return occurrences;
}

/** The encoded value of a modifier set, for tests and for the encoder. */
export function encodeModifiers(modifiers: readonly SemanticTokenModifier[]): number {
  let bits = 0;
  for (const modifier of modifiers) bits |= 1 << TOKEN_MODIFIERS.indexOf(modifier);
  return bits;
}
