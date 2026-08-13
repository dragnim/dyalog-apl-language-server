/**
 * Static extraction of the named things in a single APL source file.
 *
 * Deliberately not a parser. It recognises the constructs whose names can be
 * read off the source with certainty — tradfn and tradop headers, named dfn
 * assignments, and explicit :Namespace / :Class / :Interface scripts — and says
 * nothing about anything else. In particular it does not guess at what ordinary
 * names are: in `foo bar baz` there is no way to know statically whether those
 * are arrays, functions or operators, so none of them becomes a symbol. See the
 * "say unknown rather than guess" principle in docs/SCOPE.md.
 *
 * This layer knows nothing about LSP. It returns plain data with zero-based
 * line and character positions, so that the same extraction can be reused by
 * workspace symbols (#13) and by the project model (#1) later without dragging
 * vscode-languageserver into them. server.ts adapts the result.
 *
 * HEADER GRAMMAR. The tradfn/tradop distinction is not guesswork; it comes from
 * Dyalog's model syntax table (Dyalog/documentation,
 * programming-reference-guide/.../traditional-functions-and-operators/model-syntax.md):
 *
 *   functions   f | f Y | X f Y | {X} f Y          , each optionally R← or {R}←
 *   operators   (A op) Y | X (A op) Y | {X}(A op)Y , likewise
 *               (A op B) Y | X (A op B) Y | ...
 *
 * So an operator is exactly a header whose operation position is a parenthesised
 * group of two or three names, and the operator's own name is the middle one.
 *
 * The one thing that could confuse that is a namelist, since it is also a
 * parenthesised list of names. Dyalog's namelists.md is explicit that only the
 * *right argument and the result* may be namelists — never the left argument —
 * so a parenthesised group can only be mistaken for an operator when it sits
 * after the operation. Counting the top-level items disambiguates completely:
 * with three items the operation is the second, otherwise it is the first.
 * `IDN←Date2IDN(Year Month Day)` therefore reads as a function, not an operator.
 */

import { scanLines, splitLines, NAME_PATTERN, type ScannedLine } from './scanner';

export type AplSymbolKind = 'tradfn' | 'tradop' | 'dfn' | 'namespace' | 'class' | 'interface';

export interface Position {
  line: number;
  character: number;
}

export interface SourceRange {
  start: Position;
  end: Position;
}

export interface AplSymbol {
  name: string;
  kind: AplSymbolKind;
  /** The whole construct. */
  range: SourceRange;
  /** Just the name, for the editor to select when navigating. */
  selectionRange: SourceRange;
  /** Short label shown beside the name, e.g. the header. */
  detail?: string;
  children: AplSymbol[];
}

const NAME_RE = new RegExp(NAME_PATTERN);
const NAME_RE_G = new RegExp(NAME_PATTERN, 'g');

/** :Namespace / :Class / :Interface and the enders that may close them. */
const SCRIPT_BLOCKS: { open: RegExp; close: RegExp; kind: AplSymbolKind }[] = [
  { open: /^:Namespace\b/i, close: /^:(EndNamespace|End)\b/i, kind: 'namespace' },
  { open: /^:Class\b/i, close: /^:(EndClass|End)\b/i, kind: 'class' },
  { open: /^:Interface\b/i, close: /^:(EndInterface|End)\b/i, kind: 'interface' }
];

const ANY_SCRIPT_OPEN = /^:(Namespace|Class|Interface)\b/i;
const ANY_SCRIPT_CLOSE = /^:(EndNamespace|EndClass|EndInterface|End)\b/i;

const at = (line: number, character: number): Position => ({ line, character });
const range = (sl: number, sc: number, el: number, ec: number): SourceRange => ({
  start: at(sl, sc),
  end: at(el, ec)
});

// ------------------------------------------------------------------ headers

interface HeaderItem {
  /** 'name', 'paren' or 'brace'. */
  type: 'name' | 'paren' | 'brace';
  text: string;
  /** Column of the item's first character within the line. */
  column: number;
}

/**
 * Splits the signature part of a header into its top-level items, keeping the
 * column of each so a name can be pointed at afterwards.
 */
function topLevelItems(text: string, offset: number): HeaderItem[] | undefined {
  const items: HeaderItem[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === ' ' || char === '\t') {
      i++;
      continue;
    }

    if (char === '(' || char === '{') {
      const closer = char === '(' ? ')' : '}';
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === char) depth++;
        else if (text[j] === closer) {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) return undefined; // unbalanced: not a header we understand
      items.push({
        type: char === '(' ? 'paren' : 'brace',
        text: text.slice(i + 1, j),
        column: offset + i
      });
      i = j + 1;
      continue;
    }

    const match = new RegExp(`^${NAME_PATTERN}`).exec(text.slice(i));
    if (!match) return undefined; // something we do not recognise; say nothing
    items.push({ type: 'name', text: match[0], column: offset + i });
    i += match[0].length;
  }

  return items;
}

export interface ParsedHeader {
  name: string;
  kind: 'tradfn' | 'tradop';
  /** Column of the name within the line. */
  nameColumn: number;
}

/**
 * Reads a tradfn or tradop header. `line` is the masked code of the line, which
 * must begin (after optional blanks) with ∇. Returns undefined when the header
 * is anything this cannot identify with confidence.
 */
export function parseHeader(line: string): ParsedHeader | undefined {
  const delAt = line.indexOf('∇');
  if (delAt === -1) return undefined;

  // Locals are declared with semicolons and are not part of the signature.
  let body = line.slice(delAt + 1);
  const semi = body.indexOf(';');
  if (semi !== -1) body = body.slice(0, semi);

  // A trailing diamond would make this a one-liner; the signature ends there.
  const diamond = body.indexOf('⋄');
  if (diamond !== -1) body = body.slice(0, diamond);

  let offset = delAt + 1;

  // Strip the result specification, which is everything up to the first ←.
  const arrow = body.indexOf('←');
  if (arrow !== -1) {
    offset += arrow + 1;
    body = body.slice(arrow + 1);
  }

  if (body.trim() === '') return undefined;

  const items = topLevelItems(body, offset);
  if (!items || items.length === 0 || items.length > 3) return undefined;

  // Three items means a left argument is present, so the operation is second.
  const operation = items[items.length === 3 ? 1 : 0];

  if (operation.type === 'name') {
    return { name: operation.text, kind: 'tradfn', nameColumn: operation.column };
  }

  if (operation.type === 'paren') {
    // (A op) or (A op B): the operator's own name is the middle one.
    const names = operation.text.match(NAME_RE_G) ?? [];
    if (names.length !== 2 && names.length !== 3) return undefined;
    const opName = names[1];
    // +1 for the opening parenthesis this item's column points at.
    const within = operation.text.indexOf(opName, operation.text.indexOf(names[0]) + names[0].length);
    if (within === -1) return undefined;
    return { name: opName, kind: 'tradop', nameColumn: operation.column + 1 + within };
  }

  return undefined; // a brace in operation position is not a thing
}

// -------------------------------------------------------------- extraction

/** True when this line opens a tradfn or tradop. */
function headerOn(lines: ScannedLine[], index: number): ParsedHeader | undefined {
  const code = lines[index].code;
  if (!/^\s*∇/.test(code)) return undefined;
  return parseHeader(code);
}

/** The line index of the ∇ that closes a definition opened at `from`, or -1. */
function findClosingDel(lines: ScannedLine[], from: number, limit: number): number {
  for (let i = from + 1; i < limit; i++) {
    if (lines[i].code.trim() === '∇') return i;
  }
  return -1;
}

/**
 * The line index closing a script block opened at `from`, or -1.
 *
 * Tradfn bodies are skipped wholesale, because a `:End` inside one belongs to a
 * control structure in that function and must not be mistaken for the end of
 * the enclosing class or namespace.
 */
function findScriptEnd(lines: ScannedLine[], from: number, limit: number): number {
  let depth = 1;
  for (let i = from + 1; i < limit; i++) {
    if (headerOn(lines, i)) {
      const close = findClosingDel(lines, i, limit);
      if (close === -1) continue;
      i = close;
      continue;
    }
    const trimmed = lines[i].code.trim();
    if (ANY_SCRIPT_OPEN.test(trimmed)) depth++;
    else if (ANY_SCRIPT_CLOSE.test(trimmed)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Matches the closing brace of a dfn that opens at `startLine`/`startCol`. */
function findDfnEnd(
  lines: ScannedLine[],
  startLine: number,
  startCol: number,
  limit: number
): Position | undefined {
  let depth = 0;
  for (let i = startLine; i < limit; i++) {
    const code = lines[i].code;
    for (let col = i === startLine ? startCol : 0; col < code.length; col++) {
      if (code[col] === '{') depth++;
      else if (code[col] === '}') {
        depth--;
        if (depth === 0) return at(i, col + 1);
      }
    }
  }
  return undefined;
}

const DFN_ASSIGNMENT = new RegExp(`^\\s*(${NAME_PATTERN})\\s*←\\s*\\{`);

/**
 * Walks `[from, limit)` and returns the symbols found at that level, together
 * with children for script blocks.
 */
function extractRange(lines: ScannedLine[], from: number, limit: number): AplSymbol[] {
  const symbols: AplSymbol[] = [];
  let i = from;

  while (i < limit) {
    const scanned = lines[i];
    const code = scanned.code;
    const trimmed = code.trim();

    // ---- :Namespace / :Class / :Interface
    const block = SCRIPT_BLOCKS.find(b => b.open.test(trimmed));
    if (block) {
      const keywordEnd = code.indexOf(trimmed) + trimmed.indexOf(' ');
      const afterKeyword = trimmed.replace(/^:\w+\s*/i, '');
      // `:Class Widget: Base` — inheritance follows a colon, the name precedes it.
      const nameMatch = NAME_RE.exec(afterKeyword.split(':')[0] ?? '');
      const end = findScriptEnd(lines, i, limit);

      if (nameMatch && keywordEnd !== -1) {
        const nameColumn = code.indexOf(nameMatch[0], code.search(/:\w/) + 1);
        const lastLine = end === -1 ? i : end;
        symbols.push({
          name: nameMatch[0],
          kind: block.kind,
          range: range(i, code.search(/\S/), lastLine, lines[lastLine].text.length),
          selectionRange:
            nameColumn === -1
              ? range(i, code.search(/\S/), i, trimmed.length)
              : range(i, nameColumn, i, nameColumn + nameMatch[0].length),
          detail: trimmed.split(/\s+/)[0],
          children: end === -1 ? [] : extractRange(lines, i + 1, end)
        });
      }
      // An unterminated block gets no children and does not swallow the rest of
      // the file: carry on from the next line so later symbols still appear.
      i = end === -1 ? i + 1 : end + 1;
      continue;
    }

    // ---- ∇ tradfn / tradop
    const header = headerOn(lines, i);
    if (header) {
      const close = findClosingDel(lines, i, limit);
      const lastLine = close === -1 ? i : close;
      symbols.push({
        name: header.name,
        kind: header.kind,
        range: range(i, code.search(/\S/), lastLine, lines[lastLine].text.length),
        selectionRange: range(i, header.nameColumn, i, header.nameColumn + header.name.length),
        detail: scanned.text.trim().replace(/\s+/g, ' '),
        children: []
      });
      i = close === -1 ? i + 1 : close + 1;
      continue;
    }

    // ---- Name←{ ... } dfn
    const dfn = DFN_ASSIGNMENT.exec(code);
    if (dfn) {
      const braceCol = code.indexOf('{', code.indexOf('←'));
      const end = findDfnEnd(lines, i, braceCol, limit);
      const nameColumn = code.indexOf(dfn[1]);
      const startCol = code.search(/\S/);
      if (end) {
        symbols.push({
          name: dfn[1],
          kind: 'dfn',
          range: range(i, startCol, end.line, end.character),
          selectionRange: range(i, nameColumn, i, nameColumn + dfn[1].length),
          detail: '{}',
          children: []
        });
        i = end.line + 1;
      } else {
        // Brace never closes. The name is still certain, so the symbol is
        // reported, but the extent is not invented: it covers the opening line
        // only, and scanning continues so nothing later is hidden.
        symbols.push({
          name: dfn[1],
          kind: 'dfn',
          range: range(i, startCol, i, scanned.text.length),
          selectionRange: range(i, nameColumn, i, nameColumn + dfn[1].length),
          detail: '{}',
          children: []
        });
        i++;
      }
      continue;
    }

    i++;
  }

  return symbols;
}

/** Every symbol in a document, nested where the source makes nesting explicit. */
export function extractSymbols(source: string): AplSymbol[] {
  const lines = scanLines(source);
  return extractRange(lines, 0, lines.length);
}

/** Exposed for tests that want to reason about line counts. */
export { splitLines };
