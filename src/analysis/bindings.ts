/**
 * What a traditional definition's header binds, and where.
 *
 * The header forms come from Dyalog's model syntax table, already parsed by
 * symbols.ts; this adds the roles and the positions. Locals Lines come from
 * `locals-lines.md`: a line "anywhere between line [0] and the first executable
 * statement" that "is identified by starting with a semicolon, prefixed
 * optionally by whitespace", whose names "are localised on entry to the function
 * exactly as if they were specified as locals on line [0]".
 *
 * Extracted so that the two consumers agree by construction. Localise Variable
 * needs to know whether a name is already bound; semantic tokens need to know
 * *how* it is bound, so it can be coloured as a parameter rather than a local.
 * Both read this, and there is no second header parser.
 */

import { NAME_FIRST_CHARS, NAME_CHARS } from './scanner';
import { parseHeader, topLevelItems, type ScannedLineLike, type SourceRange } from './symbols';

/** How a header binds a name. */
export type BindingRole =
  /** The explicit result, `R←` or `{R}←`, or a member of a result namelist. */
  | 'result'
  /** A left or right argument, or an operator's operand. */
  | 'parameter'
  /** A `;`-localised name, on line [0] or on a Locals Line. */
  | 'local';

export interface NameBinding {
  name: string;
  role: BindingRole;
  range: SourceRange;
}

export interface HeaderBindings {
  /** The operation's own name. */
  operationName: string;
  operationKind: 'tradfn' | 'tradop';
  operationRange: SourceRange;
  /** Results, parameters and locals, in source order within each role. */
  bindings: NameBinding[];
}

const NAME_GLOBAL = new RegExp(`[${NAME_FIRST_CHARS}][${NAME_CHARS}]*`, 'gu');

const rangeOn = (line: number, start: number, length: number): SourceRange => ({
  start: { line, character: start },
  end: { line, character: start + length }
});

/** Every name in a fragment, with its column, relative to `offset`. */
function namesIn(text: string, offset: number, line: number, role: BindingRole): NameBinding[] {
  const found: NameBinding[] = [];
  for (const match of text.matchAll(NAME_GLOBAL)) {
    found.push({
      name: match[0],
      role,
      range: rangeOn(line, offset + (match.index ?? 0), match[0].length)
    });
  }
  return found;
}

/**
 * Reads line [0] of a traditional definition. `code` is the masked line, so a
 * trailing comment has already been blanked out and cannot contribute names.
 *
 * Returns undefined for any header this cannot read with confidence — the same
 * bar symbols.ts sets, since it is the same parse.
 */
export function analyseHeader(code: string, line: number): HeaderBindings | undefined {
  const parsed = parseHeader(code);
  if (!parsed) return undefined;
  if (code.includes('⋄')) return undefined; // a one-liner is not a form this reads

  const delAt = code.indexOf('∇');
  const bindings: NameBinding[] = [];

  // ---- locals, everything after the first semicolon
  let signature = code.slice(delAt + 1);
  let signatureOffset = delAt + 1;
  const semi = signature.indexOf(';');
  if (semi !== -1) {
    bindings.push(
      ...namesIn(signature.slice(semi), signatureOffset + semi, line, 'local')
    );
    signature = signature.slice(0, semi);
  }

  // ---- the result, everything before the first ←
  const arrow = signature.indexOf('←');
  if (arrow !== -1) {
    bindings.push(...namesIn(signature.slice(0, arrow), signatureOffset, line, 'result'));
    signatureOffset += arrow + 1;
    signature = signature.slice(arrow + 1);
  }

  const items = topLevelItems(signature, signatureOffset);
  if (!items || items.length === 0 || items.length > 3) return undefined;

  // Three items means a left argument is present, so the operation is second.
  const operationIndex = items.length === 3 ? 1 : 0;
  const operation = items[operationIndex];

  for (const [index, item] of items.entries()) {
    if (index === operationIndex) {
      // An operator's operands sit inside the same parentheses as its name; the
      // middle name is the operator itself and is not a binding.
      if (item.type === 'paren') {
        for (const binding of namesIn(item.text, item.column + 1, line, 'parameter')) {
          if (binding.range.start.character === parsed.nameColumn) continue;
          bindings.push(binding);
        }
      }
      continue;
    }
    // A brace is `{X}`, an ambivalent left argument; a paren here is a namelist.
    // Either way every name in it is bound as an argument.
    const offset = item.type === 'name' ? item.column : item.column + 1;
    bindings.push(...namesIn(item.text, offset, line, 'parameter'));
  }

  return {
    operationName: parsed.name,
    operationKind: parsed.kind,
    operationRange: rangeOn(line, parsed.nameColumn, parsed.name.length),
    bindings
  };
}

/**
 * Names localised on Locals Lines, and the line the first executable statement
 * begins on. Blank and comment-only lines may be interspersed.
 */
export function localsLineBindings(
  masked: ScannedLineLike[],
  from: number,
  to: number
): { bindings: NameBinding[]; firstStatement: number } {
  const bindings: NameBinding[] = [];
  let line = from;

  for (; line < to; line++) {
    const code = masked[line].code;
    const trimmed = code.trim();
    if (trimmed === '') continue; // blank, or a comment-only line
    if (!trimmed.startsWith(';')) break; // the first executable statement
    bindings.push(...namesIn(code, 0, line, 'local'));
  }

  return { bindings, firstStatement: line };
}

/** Every name a definition binds, whatever the role. */
export function boundNames(
  header: HeaderBindings,
  localsLines: NameBinding[] = []
): Set<string> {
  const names = new Set<string>([header.operationName]);
  for (const binding of header.bindings) names.add(binding.name);
  for (const binding of localsLines) names.add(binding.name);
  return names;
}
