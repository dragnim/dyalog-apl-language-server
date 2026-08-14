/**
 * The Localise Variable code action.
 *
 * Adds a name to the local list of the traditional function or operator that
 * encloses the cursor, turning
 *
 *   ∇R←Foo X          into    ∇R←Foo X;Temp
 *
 * and nothing else. Localisation changes where a name is bound, not how it is
 * spelled, so exactly one insertion is produced and no use of the variable is
 * touched.
 *
 * SYNTAX, from Dyalog's programming reference guide rather than assumed:
 *
 * - Locals are declared on line [0] after the signature as `;name;name`
 *   (`.../traditional-functions-and-operators/model-syntax.md` for the signature
 *   forms, which this reuses through symbols.ts).
 * - `locals-lines.md` documents *Locals Lines*: a line "anywhere between line [0]
 *   and the first executable statement" that "is identified by starting with a
 *   semicolon, prefixed optionally by whitespace", may carry a trailing comment,
 *   and may be interspersed with blank lines and comments. Its names "are
 *   localised on entry to the function exactly as if they were specified as
 *   locals on line [0]".
 *
 *   That second point is why this cannot simply read the header: a name already
 *   localised three lines further down is still localised, and offering to
 *   localise it again would produce a duplicate. Both places are read.
 *
 * ELIGIBILITY is deliberately narrow. The action appears only when the name is
 * assigned to at statement level inside that definition. A name that merely
 * appears — `R←Helper X` — is not offered, because nothing in the source says
 * whether `Helper` is a variable of this function or a function defined
 * elsewhere, and localising a function reference would silently break the call.
 * An assignment is the one piece of evidence that makes the name variable-like,
 * and it is exactly the case where localising it changes behaviour for the
 * better: in a tradfn, assigning to a name that is not localised writes to the
 * global.
 */

import { scanLines, NAME_CHARS, NAME_FIRST_CHARS } from './scanner';
import {
  extractSymbols,
  parseHeader,
  splitLines,
  type AplSymbol,
  type SourceRange
} from './symbols';
import { nameAt } from './names';

export type LocaliseRefusalReason =
  /** The cursor is not on a plain name. */
  | 'no-name-at-cursor'
  /** A ⎕name, or something qualified by one. */
  | 'system-name'
  /** A qualified path; only a simple name can be localised. */
  | 'qualified-name'
  /** A colon word. */
  | 'control-word'
  /** The selection covers more than one name. */
  | 'selection-not-a-name'
  /** Not inside a traditional function or operator. */
  | 'not-in-tradfn'
  /** The header could not be read with confidence. */
  | 'unreadable-header'
  /** Already a result, argument, operand, the operation itself, or a local. */
  | 'already-bound'
  /** Nothing in the definition assigns to it, so it may not be a variable. */
  | 'no-assignment-evidence';

export interface LocaliseRefusal {
  refused: LocaliseRefusalReason;
  detail: string;
}

export const isLocaliseRefusal = (value: unknown): value is LocaliseRefusal =>
  typeof value === 'object' && value !== null && 'refused' in value;

export interface LocalisePlan {
  /** The name being localised, as the source spells it. */
  name: string;
  /** Where `;name` is inserted: the end of the header's code. */
  insertAt: { line: number; character: number };
  /** Exactly `;name`. */
  insertText: string;
  /** The enclosing definition's own name, for the action title. */
  definitionName: string;
  /** The occurrence the cursor was on. */
  candidateRange: SourceRange;
}

export interface LocaliseRequest {
  /** Live text of the document being edited. */
  text: string;
  /** The cursor, or a selection. */
  range: SourceRange;
}

const refuse = (refused: LocaliseRefusalReason, detail: string): LocaliseRefusal => ({
  refused,
  detail
});

const nameChar = new RegExp(`[${NAME_CHARS}]`, 'u');
const nameStart = new RegExp(`[${NAME_FIRST_CHARS}]`, 'u');
const NAME_GLOBAL = new RegExp(`[${NAME_FIRST_CHARS}][${NAME_CHARS}]*`, 'gu');

/** Every symbol in a document, flattened. */
function allSymbols(symbols: AplSymbol[]): AplSymbol[] {
  return symbols.flatMap(symbol => [symbol, ...allSymbols(symbol.children)]);
}

const containsLine = (symbol: AplSymbol, line: number): boolean =>
  symbol.range.start.line <= line && line <= symbol.range.end.line;

/**
 * The names assigned to on one line of masked code, including the distributed
 * form `(a b c)←y` that Dyalog's own locals example uses, and the indexed form
 * `x[i]←y`, which assigns to `x`.
 */
export function assignmentTargets(code: string): string[] {
  const targets: string[] = [];

  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '←') continue;

    // Walk left over blanks to whatever is being assigned to.
    let end = i - 1;
    while (end >= 0 && (code[end] === ' ' || code[end] === '\t')) end--;
    if (end < 0) continue;

    // An indexed assignment targets the name before the brackets.
    if (code[end] === ']') {
      let depth = 0;
      let j = end;
      for (; j >= 0; j--) {
        if (code[j] === ']') depth++;
        else if (code[j] === '[') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < 0) continue;
      end = j - 1;
      while (end >= 0 && (code[end] === ' ' || code[end] === '\t')) end--;
      if (end < 0) continue;
    }

    // A distributed assignment targets every name in the parenthesised list.
    if (code[end] === ')') {
      let depth = 0;
      let j = end;
      for (; j >= 0; j--) {
        if (code[j] === ')') depth++;
        else if (code[j] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j < 0) continue;
      const inside = code.slice(j + 1, end);
      // Only a blank-delimited list of names is a distributed assignment; an
      // expression in there is something else entirely.
      if (new RegExp(`^\\s*(?:[${NAME_FIRST_CHARS}][${NAME_CHARS}]*\\s+)*[${NAME_FIRST_CHARS}][${NAME_CHARS}]*\\s*$`, 'u').test(inside)) {
        targets.push(...(inside.match(NAME_GLOBAL) ?? []));
      }
      continue;
    }

    if (!nameChar.test(code[end])) continue;
    let start = end;
    while (start > 0 && nameChar.test(code[start - 1])) start--;
    if (!nameStart.test(code[start])) continue;
    targets.push(code.slice(start, end + 1));
  }

  return targets;
}

interface HeaderFacts {
  /** Result, arguments, operands, the operation itself and any line-[0] locals. */
  bound: Set<string>;
  /** Column just past the last code character, before any trailing comment. */
  insertColumn: number;
  /** The operation's own name. */
  operationName: string;
}

/** Reads what line [0] binds, and where a new local would go. */
function readHeader(code: string): HeaderFacts | undefined {
  const parsed = parseHeader(code);
  if (!parsed) return undefined;

  // A diamond on the header line is not a form this edits.
  if (code.includes('⋄')) return undefined;

  const bound = new Set<string>(code.match(NAME_GLOBAL) ?? []);

  // The insertion point is the end of the code, so a trailing comment — masked
  // to blanks by the scanner — and its spacing both survive untouched.
  let insertColumn = code.length;
  while (insertColumn > 0 && /\s/.test(code[insertColumn - 1])) insertColumn--;

  return { bound, insertColumn, operationName: parsed.name };
}

/**
 * Names localised on Locals Lines, and where they stop.
 *
 * A Locals Line starts with `;` after optional whitespace. They may be
 * interspersed with blank and comment-only lines, and end at the first
 * executable statement.
 */
function readLocalsLines(
  masked: { text: string; code: string }[],
  from: number,
  to: number
): { bound: Set<string>; firstStatement: number } {
  const bound = new Set<string>();
  let line = from;

  for (; line < to; line++) {
    const code = masked[line].code;
    const trimmed = code.trim();

    if (trimmed === '') continue; // blank, or a comment-only line
    if (!trimmed.startsWith(';')) break; // the first executable statement

    for (const name of code.match(NAME_GLOBAL) ?? []) bound.add(name);
  }

  return { bound, firstStatement: line };
}

/** Brace depth at the start of each line of a region, plus a per-line walker. */
function braceDepths(masked: { code: string }[], from: number, to: number): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (let line = from; line < to; line++) {
    depths.push(depth);
    for (const char of masked[line].code) {
      if (char === '{') depth++;
      else if (char === '}') depth--;
    }
  }
  return depths;
}

/** The brace depth at a column, given the depth at the start of the line. */
function depthAtColumn(code: string, column: number, lineDepth: number): number {
  let depth = lineDepth;
  for (let i = 0; i < column && i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') depth--;
  }
  return depth;
}

/**
 * Whether the cursor's name can be localised, and the edit if it can.
 *
 * Refuses in every case it cannot establish: see LocaliseRefusalReason. A
 * refused action simply does not appear in the editor's menu.
 */
export function planLocalise(request: LocaliseRequest): LocalisePlan | LocaliseRefusal {
  const lines = splitLines(request.text);
  const masked = scanLines(request.text);
  const { line, character } = request.range.start;

  if (lines[line] === undefined) {
    return refuse('no-name-at-cursor', 'There is nothing at that position.');
  }

  const reference = nameAt(lines[line], character, line);
  if (!reference) return refuse('no-name-at-cursor', 'The cursor is not on a name.');
  if (reference.systemQualified) {
    return refuse('system-name', 'System names are not localised by this action.');
  }
  if (reference.qualifiers.length > 0 || reference.rootQualified || reference.parentLevels > 0) {
    return refuse('qualified-name', 'Only a simple name can be localised.');
  }

  // A colon immediately before makes this a control word, not a name.
  const cursorCode = masked[line].code;
  if (
    reference.range.start.character > 0 &&
    cursorCode[reference.range.start.character - 1] === ':'
  ) {
    return refuse('control-word', 'Control words cannot be localised.');
  }

  // A selection must correspond exactly to the one name, not span tokens.
  const selectionIsRange =
    request.range.start.line !== request.range.end.line ||
    request.range.start.character !== request.range.end.character;
  if (selectionIsRange) {
    const exact =
      request.range.start.line === reference.range.start.line &&
      request.range.end.line === reference.range.end.line &&
      request.range.start.character === reference.range.start.character &&
      request.range.end.character === reference.range.end.character;
    if (!exact) {
      return refuse('selection-not-a-name', 'The selection does not cover exactly one name.');
    }
  }

  // The enclosing traditional definition. A dfn uses lexical locals rather than
  // a header list, so it is not this action's business.
  const enclosing = allSymbols(extractSymbols(request.text))
    .filter(symbol => symbol.kind === 'tradfn' || symbol.kind === 'tradop')
    .filter(symbol => containsLine(symbol, line))
    // Innermost, if definitions ever nest.
    .sort((a, b) => b.range.start.line - a.range.start.line)[0];

  if (!enclosing) {
    return refuse(
      'not-in-tradfn',
      'Localising a name this way applies to traditional functions and operators.'
    );
  }

  const headerLine = enclosing.range.start.line;
  const header = readHeader(masked[headerLine].code);
  if (!header) {
    return refuse('unreadable-header', 'That definition header cannot be read with confidence.');
  }

  const bodyFrom = headerLine + 1;
  const bodyTo = enclosing.range.end.line + 1;
  const localsLines = readLocalsLines(masked, bodyFrom, bodyTo);

  if (header.bound.has(reference.name) || localsLines.bound.has(reference.name)) {
    return refuse(
      'already-bound',
      `${reference.name} is already a result, argument, operand or local of ${header.operationName}.`
    );
  }

  // Assignment at statement level is the evidence that this is a variable of
  // this definition. Inside a dfn every assignment is already local, so those
  // do not count and the cursor itself must be at statement level too.
  const depths = braceDepths(masked, bodyFrom, bodyTo);
  let assigned = false;
  for (let index = 0; index < depths.length; index++) {
    const bodyLine = bodyFrom + index;
    const code = masked[bodyLine].code;
    if (depths[index] !== 0) continue;
    for (const target of assignmentTargets(code)) {
      if (target === reference.name) {
        assigned = true;
        break;
      }
    }
    if (assigned) break;
  }

  if (!assigned) {
    return refuse(
      'no-assignment-evidence',
      `Nothing in ${header.operationName} assigns to ${reference.name}, so it may not be a ` +
        'variable of this definition.'
    );
  }

  if (line >= bodyFrom && line < bodyTo) {
    const depth = depthAtColumn(
      masked[line].code,
      reference.range.start.character,
      depths[line - bodyFrom]
    );
    if (depth !== 0) {
      return refuse(
        'no-assignment-evidence',
        'Names inside a dfn are already local to it.'
      );
    }
  }

  return {
    name: reference.name,
    insertAt: { line: headerLine, character: header.insertColumn },
    insertText: `;${reference.name}`,
    definitionName: header.operationName,
    candidateRange: reference.range
  };
}

/** Applies a plan to source text. Used by tests and by nothing else. */
export function applyLocalise(text: string, plan: LocalisePlan): string {
  const lines = splitLines(text);
  const target = lines[plan.insertAt.line];
  lines[plan.insertAt.line] =
    target.slice(0, plan.insertAt.character) +
    plan.insertText +
    target.slice(plan.insertAt.character);
  return lines.join('\n');
}
