/**
 * Glyph data.
 *
 * PROVENANCE, which matters here more than usual:
 *
 * - The glyph characters were checked against RIDE's `src/bq.js`, which is
 *   generated from Dyalog's own IME definitions. This caught a real bug: an
 *   earlier version of this file used ∈ (U+2208) for membership, where Dyalog
 *   uses ∊ (U+220A), so hover silently did nothing on real source.
 * - The official glyph names and the monadic and dyadic function names come
 *   from Dyalog's "Nomenclature: Functions and Operators" cheat sheet. That
 *   sheet documents v16.0, so anything added since — Over, Behind, monadic
 *   Not Equal as Unique Mask — is not covered by it and should be re-checked
 *   against a current source.
 * - The prefix keyboard mapping is NOT in this file. It lives in the generated
 *   src/keyboard.ts, derived from RIDE's own layout data by RIDE's own
 *   algorithm, for all thirteen keyboard locales. Regenerate it with
 *   `npm run gen:keyboard` rather than editing anything by hand.
 * - The alias lists below are written from scratch. RIDE ships a much better
 *   set in src/bq.js. Dyalog/ride is MIT licensed (Copyright (c) 2016-2023,
 *   Dyalog Ltd), so that set can be adopted by preserving the notice — see
 *   THIRD_PARTY_NOTICES.md and issue #4. No permission request is needed.
 * - The colon words are NOT in this file. They live in src/control-words.ts,
 *   which is also what the TextMate grammar's keyword rule is generated from.
 * - The `category` on each entry is this project's own metadata, not Dyalog
 *   terminology. Only `glyphName` and the monadic, dyadic and operator names are
 *   Dyalog's. Categories exist so that a glyph with no valence is not made to
 *   borrow one: `⍝` once carried mon: 'Comment to end of line', which rendered
 *   as "Monadic: Comment to end of line". See issue #16.
 *
 * Deliberately excluded: ¤, ∥ and Á, which RIDE lists but which are not
 * Dyalog primitives, and the circled letters used for IME name entry.
 */

/**
 * What a glyph *is*, as distinct from what it does with one or two arguments.
 *
 * This is the project's own metadata, not official Dyalog terminology — the
 * official name is `glyphName`. The categories exist so that a glyph which has
 * no valence at all is not forced to borrow one: `⍝` used to carry
 * `mon: 'Comment to end of line'`, which rendered as "Monadic: Comment to end of
 * line" and taught a beginner something false.
 *
 * A category does not exclude a valence. `/` is categorised as an operator
 * because Reduce is its distinctive role, and still carries `mon: 'Replicate'`,
 * because both are true. Mixed roles are modelled rather than flattened.
 */
export type GlyphCategory =
  /** A primitive function: has a monadic and/or dyadic meaning. */
  | 'function'
  /** A primitive operator, which takes a function or array operand. */
  | 'operator'
  /** Punctuation and special symbols: assignment, comment, separator, `¯`. */
  | 'syntax'
  /** The argument and operand symbols of a dfn or dop: ⍺ ⍵ ⍶ ⍹. */
  | 'argument'
  /** A literal constant, such as ⍬. */
  | 'constant'
  /** A character that is legal inside a name but means nothing on its own. */
  | 'name-character';

export interface Glyph {
  /** The character itself. */
  g: string;
  /** Dyalog's official name for the glyph, as distinct from what it does. */
  glyphName: string;
  /** Searchable aliases, for name-based completion. */
  names: string[];
  /** What the glyph is. See GlyphCategory. */
  category: GlyphCategory;
  /**
   * What it means, for glyphs that have no valence to describe. Used instead of
   * `mon` for syntax, arguments, constants and name characters.
   */
  description?: string;
  /** Monadic (one argument) meaning, if any. */
  mon?: string;
  /** Dyadic (two argument) meaning, if any. */
  dya?: string;
  /** Meaning as an operator, if it is one. */
  op?: string;
}

export const GLYPHS: Glyph[] = [
  { g: '+', glyphName: 'Plus', names: ['plus', 'add', 'conjugate'], category: 'function', mon: 'Conjugate', dya: 'Plus' },
  { g: '-', glyphName: 'Minus', names: ['minus', 'subtract', 'negate'], category: 'function', mon: 'Negate', dya: 'Minus' },
  { g: '×', glyphName: 'Times', names: ['times', 'multiply', 'signum', 'direction'], category: 'function', mon: 'Direction', dya: 'Times' },
  { g: '÷', glyphName: 'Divide', names: ['divide', 'reciprocal'], category: 'function', mon: 'Reciprocal', dya: 'Divide' },
  { g: '⌊', glyphName: 'Downstile', names: ['downstile', 'floor', 'minimum'], category: 'function', mon: 'Floor', dya: 'Minimum' },
  { g: '⌈', glyphName: 'Upstile', names: ['upstile', 'ceiling', 'maximum'], category: 'function', mon: 'Ceiling', dya: 'Maximum' },
  { g: '|', glyphName: 'Stile', names: ['stile', 'magnitude', 'residue', 'modulo'], category: 'function', mon: 'Magnitude', dya: 'Residue' },
  { g: '*', glyphName: 'Star', names: ['star', 'power', 'exponential'], category: 'function', mon: 'Exponential', dya: 'Power' },
  { g: '⍟', glyphName: 'Log', names: ['log', 'logarithm', 'circlestar'], category: 'function', mon: 'Natural Logarithm', dya: 'Logarithm' },
  { g: '○', glyphName: 'Circle', names: ['circle', 'pi', 'circular', 'trigonometric'], category: 'function', mon: 'Pi Times', dya: 'Circular Functions' },
  { g: '!', glyphName: 'Exclamation Mark', names: ['exclamation', 'factorial', 'binomial'], category: 'function', mon: 'Factorial', dya: 'Binomial' },
  { g: '∧', glyphName: 'Logical AND', names: ['and', 'lcm'], category: 'function', dya: 'Lowest Common Multiple / And' },
  { g: '∨', glyphName: 'Logical OR', names: ['or', 'gcd'], category: 'function', dya: 'Greatest Common Divisor / Or' },
  { g: '⍲', glyphName: 'Logical NAND', names: ['nand'], category: 'function', dya: 'Nand' },
  { g: '⍱', glyphName: 'Logical NOR', names: ['nor'], category: 'function', dya: 'Nor' },
  { g: '<', glyphName: 'Less Than', names: ['lessthan'], category: 'function', dya: 'Less Than' },
  { g: '≤', glyphName: 'Less Than Or Equal To', names: ['lessorequal'], category: 'function', dya: 'Less Than Or Equal To' },
  { g: '=', glyphName: 'Equal', names: ['equal'], category: 'function', dya: 'Equal To' },
  { g: '≥', glyphName: 'Greater Than Or Equal To', names: ['greaterorequal'], category: 'function', dya: 'Greater Than Or Equal To' },
  { g: '>', glyphName: 'Greater Than', names: ['greaterthan'], category: 'function', dya: 'Greater Than' },
  { g: '≠', glyphName: 'Not Equal', names: ['notequal', 'uniquemask'], category: 'function', mon: 'Unique Mask', dya: 'Not Equal To' },
  { g: '~', glyphName: 'Tilde', names: ['tilde', 'not', 'without'], category: 'function', mon: 'Not', dya: 'Without' },
  { g: '?', glyphName: 'Question Mark', names: ['query', 'roll', 'deal', 'random'], category: 'function', mon: 'Roll', dya: 'Deal' },
  { g: '∊', glyphName: 'Epsilon', names: ['epsilon', 'membership', 'enlist', 'in'], category: 'function', mon: 'Enlist', dya: 'Membership' },
  { g: '⍷', glyphName: 'Epsilon Underbar', names: ['epsilonunderbar', 'find'], category: 'function', dya: 'Find' },
  { g: ',', glyphName: 'Comma', names: ['comma', 'ravel', 'catenate', 'laminate'], category: 'function', mon: 'Ravel', dya: 'Catenate / Laminate' },
  { g: '⍪', glyphName: 'Comma Bar', names: ['commabar', 'table', 'catenatefirst'], category: 'function', mon: 'Table', dya: 'Catenate First / Laminate' },
  { g: '⌷', glyphName: 'Squad', names: ['squad', 'index', 'materialise'], category: 'function', mon: 'Materialise', dya: 'Index' },
  { g: '⍳', glyphName: 'Iota', names: ['iota', 'indexgenerator', 'indexof'], category: 'function', mon: 'Index Generator', dya: 'Index Of' },
  { g: '⍸', glyphName: 'Iota Underbar', names: ['iotaunderbar', 'where', 'intervalindex'], category: 'function', mon: 'Where', dya: 'Interval Index' },
  { g: '⍴', glyphName: 'Rho', names: ['rho', 'shape', 'reshape'], category: 'function', mon: 'Shape', dya: 'Reshape' },
  { g: '↑', glyphName: 'Up Arrow', names: ['uparrow', 'mix', 'take'], category: 'function', mon: 'Mix', dya: 'Take' },
  { g: '↓', glyphName: 'Down Arrow', names: ['downarrow', 'split', 'drop'], category: 'function', mon: 'Split', dya: 'Drop' },
  { g: '⊣', glyphName: 'Left Tack', names: ['lefttack', 'same', 'left'], category: 'function', mon: 'Same', dya: 'Left' },
  { g: '⊢', glyphName: 'Right Tack', names: ['righttack', 'same', 'right'], category: 'function', mon: 'Same', dya: 'Right' },
  { g: '⊤', glyphName: 'Down Tack', names: ['downtack', 'encode', 'antibase'], category: 'function', dya: 'Encode' },
  { g: '⊥', glyphName: 'Up Tack', names: ['uptack', 'decode', 'base'], category: 'function', dya: 'Decode' },
  { g: '⌽', glyphName: 'Circle Stile', names: ['circlestile', 'reverse', 'rotate'], category: 'function', mon: 'Reverse', dya: 'Rotate' },
  { g: '⊖', glyphName: 'Circle Bar', names: ['circlebar', 'reversefirst', 'rotatefirst'], category: 'function', mon: 'Reverse First', dya: 'Rotate First' },
  { g: '⍉', glyphName: 'Circle Backslash', names: ['transpose', 'circlebackslash'], category: 'function', mon: 'Transpose', dya: 'Dyadic Transpose' },
  { g: '⍋', glyphName: 'Grade Up', names: ['gradeup', 'deltastile'], category: 'function', mon: 'Grade Up', dya: 'Dyadic Grade Up' },
  { g: '⍒', glyphName: 'Grade Down', names: ['gradedown', 'delstile'], category: 'function', mon: 'Grade Down', dya: 'Dyadic Grade Down' },
  { g: '⌹', glyphName: 'Domino', names: ['domino', 'matrixinverse', 'matrixdivide'], category: 'function', mon: 'Matrix Inverse', dya: 'Matrix Divide' },
  { g: '≡', glyphName: 'Equal Underbar', names: ['equalunderbar', 'depth', 'match'], category: 'function', mon: 'Depth', dya: 'Match' },
  { g: '≢', glyphName: 'Equal Underbar Slash', names: ['notmatch', 'tally', 'natch'], category: 'function', mon: 'Tally', dya: 'Not Match' },
  { g: '⊂', glyphName: 'Left Shoe', names: ['leftshoe', 'enclose', 'partitionedenclose'], category: 'function', mon: 'Enclose', dya: 'Partitioned Enclose' },
  { g: '⊆', glyphName: 'Left Shoe Underbar', names: ['leftshoeunderbar', 'nest', 'partition'], category: 'function', mon: 'Nest', dya: 'Partition' },
  { g: '⊃', glyphName: 'Right Shoe', names: ['rightshoe', 'first', 'pick', 'disclose'], category: 'function', mon: 'First', dya: 'Pick' },
  { g: '∩', glyphName: 'Up Shoe', names: ['upshoe', 'intersection', 'cap'], category: 'function', dya: 'Intersection' },
  { g: '∪', glyphName: 'Down Shoe', names: ['downshoe', 'union', 'unique', 'cup'], category: 'function', mon: 'Unique', dya: 'Union' },
  { g: '⍎', glyphName: 'Hydrant', names: ['execute', 'hydrant', 'downtackjot'], category: 'function', mon: 'Execute', dya: 'Dyadic Execute' },
  { g: '⍕', glyphName: 'Thorn', names: ['format', 'thorn', 'uptackjot'], category: 'function', mon: 'Format', dya: 'Format by Specification' },
  { g: '/', glyphName: 'Slash', names: ['slash', 'reduce', 'replicate', 'compress'], category: 'operator', mon: 'Replicate', op: 'Reduce' },
  { g: '⌿', glyphName: 'Slash Bar', names: ['slashbar', 'reducefirst', 'replicatefirst'], category: 'operator', mon: 'Replicate First', op: 'Reduce First' },
  { g: '\\', glyphName: 'Backslash', names: ['backslash', 'scan', 'expand'], category: 'operator', mon: 'Expand', op: 'Scan' },
  { g: '⍀', glyphName: 'Backslash Bar', names: ['backslashbar', 'scanfirst', 'expandfirst'], category: 'operator', mon: 'Expand First', op: 'Scan First' },
  { g: '¨', glyphName: 'Diaeresis', names: ['each', 'diaeresis', 'map'], category: 'operator', op: 'Each' },
  { g: '⍤', glyphName: 'Jot Diaeresis', names: ['jotdiaeresis', 'rank', 'atop'], category: 'operator', op: 'Rank, or Atop with a function right operand' },
  { g: '⍥', glyphName: 'Circle Diaeresis', names: ['circlediaeresis', 'over'], category: 'operator', op: 'Over' },
  { g: '⍛', glyphName: 'Jot Underbar', names: ['jotunderbar', 'behind', 'reversecompose'], category: 'operator', op: 'Behind' },
  { g: '⌸', glyphName: 'Quad Equal', names: ['quadequal', 'key', 'group'], category: 'operator', op: 'Key' },
  { g: '⌺', glyphName: 'Quad Diamond', names: ['quaddiamond', 'stencil'], category: 'operator', op: 'Stencil' },
  { g: '⍨', glyphName: 'Tilde Diaeresis', names: ['tildediaeresis', 'commute', 'selfie', 'swap'], category: 'operator', op: 'Commute, or Constant with an array operand' },
  { g: '⍣', glyphName: 'Star Diaeresis', names: ['stardiaeresis', 'power', 'poweroperator', 'fixedpoint'], category: 'operator', op: 'Power' },
  { g: '.', glyphName: 'Dot', names: ['dot', 'innerproduct', 'outerproduct'], category: 'operator', op: 'Inner or Outer Product' },
  { g: '∘', glyphName: 'Jot', names: ['jot', 'compose', 'beside', 'bind'], category: 'operator', op: 'Compose' },
  { g: '⍠', glyphName: 'Quad Colon', names: ['quadcolon', 'variant', 'option'], category: 'operator', op: 'Variant' },
  { g: '@', glyphName: 'At', names: ['at', 'substitute', 'amend'], category: 'operator', op: 'At' },
  { g: '&', glyphName: 'Ampersand', names: ['ampersand', 'spawn'], category: 'operator', op: 'Spawn' },
  { g: '⌶', glyphName: 'I-Beam', names: ['ibeam'], category: 'operator', op: 'I-Beam' },
  { g: '←', glyphName: 'Left Arrow', names: ['leftarrow', 'assign', 'gets'], category: 'syntax', description: 'Assignment' },
  { g: '→', glyphName: 'Right Arrow', names: ['rightarrow', 'branch', 'goto'], category: 'syntax', description: 'Branch' },
  { g: '⍺', glyphName: 'Alpha', names: ['alpha', 'leftarg'], category: 'argument', description: 'Left argument of a dfn' },
  { g: '⍵', glyphName: 'Omega', names: ['omega', 'rightarg'], category: 'argument', description: 'Right argument of a dfn' },
  { g: '⍶', glyphName: 'Alpha Underbar', names: ['alphaunderbar'], category: 'argument', description: 'Left operand of a dop' },
  { g: '⍹', glyphName: 'Omega Underbar', names: ['omegaunderbar'], category: 'argument', description: 'Right operand of a dop' },
  { g: '∇', glyphName: 'Del', names: ['del', 'recurse', 'selfreference'], category: 'syntax', description: 'Recursive reference, or a defined function' },
  { g: '⍫', glyphName: 'Del Tilde', names: ['deltilde'], category: 'syntax', description: 'Locked defined function' },
  { g: '⍝', glyphName: 'Lamp', names: ['comment', 'lamp'], category: 'syntax', description: 'Comment to end of line' },
  { g: '⋄', glyphName: 'Diamond', names: ['diamond', 'statementseparator'], category: 'syntax', description: 'Statement separator' },
  { g: '⎕', glyphName: 'Quad', names: ['quad', 'evaluatedinput'], category: 'syntax', description: 'System name prefix, or evaluated input' },
  { g: '⍞', glyphName: 'Quote Quad', names: ['quotequad', 'characterinput'], category: 'syntax', description: 'Character input and output' },
  { g: '⍬', glyphName: 'Zilde', names: ['zilde', 'empty'], category: 'constant', description: 'Empty numeric vector' },
  { g: '¯', glyphName: 'Macron', names: ['macron', 'highminus', 'negative'], category: 'syntax', description: 'Negative number prefix' },
  { g: '∆', glyphName: 'Delta', names: ['delta'], category: 'name-character', description: 'Valid in names' },
  { g: '⍙', glyphName: 'Delta Underbar', names: ['deltaunderbar'], category: 'name-character', description: 'Valid in names' },
  { g: '_', glyphName: 'Underscore', names: ['underscore'], category: 'name-character', description: 'Valid in names' },
  { g: "'", glyphName: 'Quote', names: ['quote', 'apostrophe'], category: 'syntax', description: 'Delimits a character vector (string); write two in a row for a literal apostrophe' }
];

/**
 * A deliberately partial list of system names. This should also be generated
 * rather than maintained by hand — the interpreter knows the full set.
 */
export const SYSTEM_NAMES: { name: string; desc: string }[] = [
  { name: '⎕A', desc: 'Uppercase alphabet' },
  { name: '⎕AI', desc: 'Account information' },
  { name: '⎕AT', desc: 'Object attributes' },
  { name: '⎕AV', desc: 'Atomic vector' },
  { name: '⎕C', desc: 'Case fold / case convert' },
  { name: '⎕CR', desc: 'Character representation of a function' },
  { name: '⎕CSV', desc: 'Read or write comma separated values' },
  { name: '⎕D', desc: 'Digits' },
  { name: '⎕DR', desc: 'Data representation (type)' },
  { name: '⎕EX', desc: 'Expunge (erase) names' },
  { name: '⎕FIX', desc: 'Fix a script' },
  { name: '⎕FMT', desc: 'Format' },
  { name: '⎕IO', desc: 'Index origin (0 or 1)' },
  { name: '⎕JSON', desc: 'Convert to or from JSON' },
  { name: '⎕ML', desc: 'Migration level' },
  { name: '⎕NC', desc: 'Name class' },
  { name: '⎕NEW', desc: 'Create an instance of a class' },
  { name: '⎕NGET', desc: 'Read a text file' },
  { name: '⎕NL', desc: 'Name list' },
  { name: '⎕NPUT', desc: 'Write a text file' },
  { name: '⎕NR', desc: 'Nested representation of a function' },
  { name: '⎕NS', desc: 'Create a namespace' },
  { name: '⎕PP', desc: 'Print precision' },
  { name: '⎕R', desc: 'Replace (regular expressions)' },
  { name: '⎕S', desc: 'Search (regular expressions)' },
  { name: '⎕SE', desc: 'Session namespace' },
  { name: '⎕SHELL', desc: 'Run a command in the host shell' },
  { name: '⎕SIGNAL', desc: 'Signal an event' },
  { name: '⎕SRC', desc: 'Source of a scripted object' },
  { name: '⎕TRAP', desc: 'Event trap' },
  { name: '⎕TS', desc: 'Timestamp' },
  { name: '⎕UCS', desc: 'Unicode code points' },
  { name: '⎕VFI', desc: 'Verify and fix numeric input' },
  { name: '⎕VGET', desc: 'Get the value of a variable' },
  { name: '⎕VSET', desc: 'Set the value of a variable' },
  { name: '⎕WA', desc: 'Workspace available' },
  { name: '⎕WSID', desc: 'Workspace identification' }
];

const BY_CHAR = new Map<string, Glyph>();
for (const glyph of GLYPHS) {
  if (!BY_CHAR.has(glyph.g)) BY_CHAR.set(glyph.g, glyph);
}

/** Characters that should resolve to a different entry's documentation. */
const ALIASED_CHARS: Record<string, string> = {
  '\u2208': '\u220A' // ∈ as used by some other APLs, for Dyalog's ∊
};

export function glyphFor(char: string): Glyph | undefined {
  return BY_CHAR.get(ALIASED_CHARS[char] ?? char);
}

export function systemNameFor(name: string): { name: string; desc: string } | undefined {
  const upper = name.toUpperCase();
  return SYSTEM_NAMES.find(s => s.name.toUpperCase() === upper);
}

/**
 * Human-readable summary used for hover text and completion detail. `key` is the
 * character to type after the prefix key, looked up per keyboard locale.
 */
export function describe(glyph: Glyph, prefixKey: string, key?: string): string {
  const lines: string[] = [];
  lines.push(`**${glyph.g}** — ${glyph.glyphName}`);
  lines.push('');
  // A description stands on its own: it is what the glyph means, and labelling
  // it with a valence it does not have is how "Monadic: Comment to end of line"
  // used to happen.
  if (glyph.description) lines.push(glyph.description);
  if (glyph.mon) lines.push(`- Monadic: ${glyph.mon}`);
  if (glyph.dya) lines.push(`- Dyadic: ${glyph.dya}`);
  if (glyph.op) lines.push(`- Operator: ${glyph.op}`);
  if (key) {
    const combo = `${prefixKey}${key}`;
    // A backtick inside inline code needs a doubled fence and padding spaces.
    const code = combo.includes('`') ? `\`\` ${combo} \`\`` : `\`${combo}\``;
    lines.push('');
    lines.push(`Type it with ${code}`);
  }
  return lines.join('\n');
}

/** One-line version, for the right-hand side of a completion list. */
export function shortDescribe(glyph: Glyph): string {
  const parts = [glyph.description, glyph.mon, glyph.dya, glyph.op].filter(Boolean);
  return parts.length ? `${glyph.glyphName} — ${parts.join(' / ')}` : glyph.glyphName;
}
