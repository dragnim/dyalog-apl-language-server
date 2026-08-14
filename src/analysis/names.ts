/**
 * Finding the APL name a cursor is on.
 *
 * Separate from definition resolution because find references (#11) and rename
 * (#12) will need exactly the same lexical question answered, and the answer is
 * fiddlier than it looks: APL names take ∆ and ⍙ as well as letters, `.` is
 * three different things depending on what is to its left, `#` and `##` are
 * namespace markers rather than names, and a name inside a comment or a
 * character literal is not a reference at all.
 *
 * That last point is handled by masking through src/analysis/scanner.ts rather
 * than by a second attempt at quote and comment parsing.
 *
 * NAMESPACE SYNTAX, from Dyalog's programming reference guide,
 * introduction/namespaces/namespace-syntax.md:
 *
 *   "An explicit reference requires that you identify the object by its full or
 *    relative pathname using a '.' syntax"
 *   "# is the top level or 'Root' namespace"
 *   "## is the parent or space containing the current namespace"
 *   "⎕SE is a system namespace"
 *
 * The same page is explicit that `.` is read by looking at the class of what
 * precedes it — a ref means a namespace reference, a function means inner
 * product. Statically we cannot know the class of an arbitrary expression, so a
 * dotted path is only ever treated as a namespace reference when the project
 * model can show that each qualifier really is a namespace. See
 * resolveDefinition in definitions.ts.
 */

import { scanLine, NAME_CHARS, NAME_FIRST_CHARS } from './scanner';
import type { SourceRange } from './symbols';

// The legal-name character set lives in scanner.ts, taken from Dyalog's
// "Legal Names" table. See the note there about the discontinuous ranges.
const NAME_START = new RegExp(`[${NAME_FIRST_CHARS}]`, 'u');
const NAME_PART = new RegExp(`[${NAME_CHARS}]`, 'u');

export interface NameReference {
  /** The single segment the cursor is on, e.g. `Bar` in `#.Foo.Bar`. */
  name: string;
  /**
   * The qualifier segments to its left, outermost first and excluding any `#`
   * or `##` marker. `#.Foo.Bar` gives ['Foo'], a bare `Bar` gives [].
   */
  qualifiers: string[];
  /** The path began at the root, `#.`. */
  rootQualified: boolean;
  /** How many `##.` markers preceded it. */
  parentLevels: number;
  /**
   * The path begins with a ⎕name such as `⎕SE.`, or the cursor is on a ⎕name
   * itself. Never navigable to source.
   */
  systemQualified: boolean;
  /** Where the segment under the cursor sits on the line. */
  range: SourceRange;
}

const at = (line: number, character: number) => ({ line, character });

/**
 * The name reference at `character` on one line of source, or undefined when
 * the cursor is not on a name.
 *
 * A cursor immediately after a name counts as being on it, which is what an
 * editor does when you put the caret at the end of a word and press the
 * go-to-definition key.
 */
export function nameAt(lineText: string, character: number, lineNumber = 0): NameReference | undefined {
  const code = scanLine(lineText).code;

  // Anything masked out is inside a comment or a character literal.
  let index = character;
  if (index >= code.length || !NAME_PART.test(code[index] ?? '')) index = character - 1;
  if (index < 0 || index >= code.length) return undefined;
  if (!NAME_PART.test(code[index])) return undefined;

  let start = index;
  while (start > 0 && NAME_PART.test(code[start - 1])) start--;
  let end = index + 1;
  while (end < code.length && NAME_PART.test(code[end])) end++;

  // A name may not begin with a digit; if it does, this is a number.
  if (!NAME_START.test(code[start])) return undefined;

  const name = code.slice(start, end);

  // A ⎕name is a system name, not project source.
  if (start > 0 && code[start - 1] === '⎕') {
    return {
      name,
      qualifiers: [],
      rootQualified: false,
      parentLevels: 0,
      systemQualified: true,
      range: { start: at(lineNumber, start), end: at(lineNumber, end) }
    };
  }

  const qualifiers: string[] = [];
  let rootQualified = false;
  let parentLevels = 0;
  let systemQualified = false;

  // Walk left through `segment.` groups.
  let cursor = start;
  for (;;) {
    if (cursor === 0 || code[cursor - 1] !== '.') break;
    let position = cursor - 2;

    if (position >= 0 && code[position] === '#') {
      if (position > 0 && code[position - 1] === '#') {
        parentLevels++;
        cursor = position - 1;
        // A ## may itself be preceded by another ##. or a #.
        continue;
      }
      rootQualified = true;
      cursor = position;
      break;
    }

    if (position < 0 || !NAME_PART.test(code[position])) break;

    let segmentStart = position;
    while (segmentStart > 0 && NAME_PART.test(code[segmentStart - 1])) segmentStart--;
    if (!NAME_START.test(code[segmentStart])) break;

    // ⎕SE.Foo and friends are system space, never source.
    if (segmentStart > 0 && code[segmentStart - 1] === '⎕') {
      systemQualified = true;
      break;
    }

    qualifiers.unshift(code.slice(segmentStart, position + 1));
    cursor = segmentStart;
  }

  return {
    name,
    qualifiers,
    rootQualified,
    parentLevels,
    systemQualified,
    range: { start: at(lineNumber, start), end: at(lineNumber, end) }
  };
}

/**
 * Whether a name is bound locally in this source, and so cannot be taken to
 * mean a project object.
 *
 * Deliberately blunt, and deliberately biased towards saying yes: an assignment
 * anywhere in the file, a tradfn argument, a result name, or a `;`-localised
 * name all count. Inside a dfn every assignment is local, and in a tradfn a
 * localised name shadows anything outside, so treating any of these as a
 * shadow is the conservative reading. A false yes costs a navigation; a false
 * no sends the user to the wrong file.
 */
export function isLocallyBound(name: string, lines: string[]): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = new RegExp(`(^|[^A-Za-z0-9_∆⍙])${escaped}\\s*←`);

  for (const raw of lines) {
    const code = scanLine(raw).code;
    if (assignment.test(code)) return true;

    // A ∇ header: arguments, result and ;-locals are all bound names.
    const trimmed = code.trim();
    if (!trimmed.startsWith('∇')) continue;
    const names: string[] =
      trimmed.slice(1).match(new RegExp(`[${NAME_FIRST_CHARS}][${NAME_CHARS}]*`, 'gu')) ?? [];
    if (names.includes(name)) return true;
  }
  return false;
}
