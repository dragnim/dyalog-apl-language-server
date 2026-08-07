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
 *   set, but that repository carries no licence, so adopting it needs a
 *   two-line permission request rather than a copy-paste.
 *
 * Deliberately excluded: ¤, ∥ and Á, which RIDE lists but which are not
 * Dyalog primitives, and the circled letters used for IME name entry.
 */

export interface Glyph {
  /** The character itself. */
  g: string;
  /** Dyalog's official name for the glyph, as distinct from what it does. */
  glyphName: string;
  /** Searchable aliases, for name-based completion. */
  names: string[];
  /** Monadic (one argument) meaning, if any. */
  mon?: string;
  /** Dyadic (two argument) meaning, if any. */
  dya?: string;
  /** Meaning as an operator, if it is one. */
  op?: string;
}

export const GLYPHS: Glyph[] = [
  { g: '+', glyphName: 'Plus', names: ['plus', 'add', 'conjugate'], mon: 'Conjugate', dya: 'Plus' },
  { g: '-', glyphName: 'Minus', names: ['minus', 'subtract', 'negate'], mon: 'Negate', dya: 'Minus' },
  { g: '×', glyphName: 'Times', names: ['times', 'multiply', 'signum', 'direction'], mon: 'Direction', dya: 'Times' },
  { g: '÷', glyphName: 'Divide', names: ['divide', 'reciprocal'], mon: 'Reciprocal', dya: 'Divide' },
  { g: '⌊', glyphName: 'Downstile', names: ['downstile', 'floor', 'minimum'], mon: 'Floor', dya: 'Minimum' },
  { g: '⌈', glyphName: 'Upstile', names: ['upstile', 'ceiling', 'maximum'], mon: 'Ceiling', dya: 'Maximum' },
  { g: '|', glyphName: 'Stile', names: ['stile', 'magnitude', 'residue', 'modulo'], mon: 'Magnitude', dya: 'Residue' },
  { g: '*', glyphName: 'Star', names: ['star', 'power', 'exponential'], mon: 'Exponential', dya: 'Power' },
  { g: '⍟', glyphName: 'Log', names: ['log', 'logarithm', 'circlestar'], mon: 'Natural Logarithm', dya: 'Logarithm' },
  { g: '○', glyphName: 'Circle', names: ['circle', 'pi', 'circular', 'trigonometric'], mon: 'Pi Times', dya: 'Circular Functions' },
  { g: '!', glyphName: 'Exclamation Mark', names: ['exclamation', 'factorial', 'binomial'], mon: 'Factorial', dya: 'Binomial' },
  { g: '∧', glyphName: 'Logical AND', names: ['and', 'lcm'], dya: 'Lowest Common Multiple / And' },
  { g: '∨', glyphName: 'Logical OR', names: ['or', 'gcd'], dya: 'Greatest Common Divisor / Or' },
  { g: '⍲', glyphName: 'Logical NAND', names: ['nand'], dya: 'Nand' },
  { g: '⍱', glyphName: 'Logical NOR', names: ['nor'], dya: 'Nor' },
  { g: '<', glyphName: 'Less Than', names: ['lessthan'], dya: 'Less Than' },
  { g: '≤', glyphName: 'Less Than Or Equal To', names: ['lessorequal'], dya: 'Less Than Or Equal To' },
  { g: '=', glyphName: 'Equal', names: ['equal'], dya: 'Equal To' },
  { g: '≥', glyphName: 'Greater Than Or Equal To', names: ['greaterorequal'], dya: 'Greater Than Or Equal To' },
  { g: '>', glyphName: 'Greater Than', names: ['greaterthan'], dya: 'Greater Than' },
  { g: '≠', glyphName: 'Not Equal', names: ['notequal', 'uniquemask'], mon: 'Unique Mask', dya: 'Not Equal To' },
  { g: '~', glyphName: 'Tilde', names: ['tilde', 'not', 'without'], mon: 'Not', dya: 'Without' },
  { g: '?', glyphName: 'Question Mark', names: ['query', 'roll', 'deal', 'random'], mon: 'Roll', dya: 'Deal' },
  { g: '∊', glyphName: 'Epsilon', names: ['epsilon', 'membership', 'enlist', 'in'], mon: 'Enlist', dya: 'Membership' },
  { g: '⍷', glyphName: 'Epsilon Underbar', names: ['epsilonunderbar', 'find'], dya: 'Find' },
  { g: ',', glyphName: 'Comma', names: ['comma', 'ravel', 'catenate', 'laminate'], mon: 'Ravel', dya: 'Catenate / Laminate' },
  { g: '⍪', glyphName: 'Comma Bar', names: ['commabar', 'table', 'catenatefirst'], mon: 'Table', dya: 'Catenate First / Laminate' },
  { g: '⌷', glyphName: 'Squad', names: ['squad', 'index', 'materialise'], mon: 'Materialise', dya: 'Index' },
  { g: '⍳', glyphName: 'Iota', names: ['iota', 'indexgenerator', 'indexof'], mon: 'Index Generator', dya: 'Index Of' },
  { g: '⍸', glyphName: 'Iota Underbar', names: ['iotaunderbar', 'where', 'intervalindex'], mon: 'Where', dya: 'Interval Index' },
  { g: '⍴', glyphName: 'Rho', names: ['rho', 'shape', 'reshape'], mon: 'Shape', dya: 'Reshape' },
  { g: '↑', glyphName: 'Up Arrow', names: ['uparrow', 'mix', 'take'], mon: 'Mix', dya: 'Take' },
  { g: '↓', glyphName: 'Down Arrow', names: ['downarrow', 'split', 'drop'], mon: 'Split', dya: 'Drop' },
  { g: '⊣', glyphName: 'Left Tack', names: ['lefttack', 'same', 'left'], mon: 'Same', dya: 'Left' },
  { g: '⊢', glyphName: 'Right Tack', names: ['righttack', 'same', 'right'], mon: 'Same', dya: 'Right' },
  { g: '⊤', glyphName: 'Down Tack', names: ['downtack', 'encode', 'antibase'], dya: 'Encode' },
  { g: '⊥', glyphName: 'Up Tack', names: ['uptack', 'decode', 'base'], dya: 'Decode' },
  { g: '⌽', glyphName: 'Circle Stile', names: ['circlestile', 'reverse', 'rotate'], mon: 'Reverse', dya: 'Rotate' },
  { g: '⊖', glyphName: 'Circle Bar', names: ['circlebar', 'reversefirst', 'rotatefirst'], mon: 'Reverse First', dya: 'Rotate First' },
  { g: '⍉', glyphName: 'Circle Backslash', names: ['transpose', 'circlebackslash'], mon: 'Transpose', dya: 'Dyadic Transpose' },
  { g: '⍋', glyphName: 'Grade Up', names: ['gradeup', 'deltastile'], mon: 'Grade Up', dya: 'Dyadic Grade Up' },
  { g: '⍒', glyphName: 'Grade Down', names: ['gradedown', 'delstile'], mon: 'Grade Down', dya: 'Dyadic Grade Down' },
  { g: '⌹', glyphName: 'Domino', names: ['domino', 'matrixinverse', 'matrixdivide'], mon: 'Matrix Inverse', dya: 'Matrix Divide' },
  { g: '≡', glyphName: 'Equal Underbar', names: ['equalunderbar', 'depth', 'match'], mon: 'Depth', dya: 'Match' },
  { g: '≢', glyphName: 'Equal Underbar Slash', names: ['notmatch', 'tally', 'natch'], mon: 'Tally', dya: 'Not Match' },
  { g: '⊂', glyphName: 'Left Shoe', names: ['leftshoe', 'enclose', 'partitionedenclose'], mon: 'Enclose', dya: 'Partitioned Enclose' },
  { g: '⊆', glyphName: 'Left Shoe Underbar', names: ['leftshoeunderbar', 'nest', 'partition'], mon: 'Nest', dya: 'Partition' },
  { g: '⊃', glyphName: 'Right Shoe', names: ['rightshoe', 'first', 'pick', 'disclose'], mon: 'First', dya: 'Pick' },
  { g: '∩', glyphName: 'Up Shoe', names: ['upshoe', 'intersection', 'cap'], dya: 'Intersection' },
  { g: '∪', glyphName: 'Down Shoe', names: ['downshoe', 'union', 'unique', 'cup'], mon: 'Unique', dya: 'Union' },
  { g: '⍎', glyphName: 'Hydrant', names: ['execute', 'hydrant', 'downtackjot'], mon: 'Execute', dya: 'Dyadic Execute' },
  { g: '⍕', glyphName: 'Thorn', names: ['format', 'thorn', 'uptackjot'], mon: 'Format', dya: 'Format by Specification' },
  { g: '/', glyphName: 'Slash', names: ['slash', 'reduce', 'replicate', 'compress'], mon: 'Replicate', op: 'Reduce' },
  { g: '⌿', glyphName: 'Slash Bar', names: ['slashbar', 'reducefirst', 'replicatefirst'], mon: 'Replicate First', op: 'Reduce First' },
  { g: '\\', glyphName: 'Backslash', names: ['backslash', 'scan', 'expand'], mon: 'Expand', op: 'Scan' },
  { g: '⍀', glyphName: 'Backslash Bar', names: ['backslashbar', 'scanfirst', 'expandfirst'], mon: 'Expand First', op: 'Scan First' },
  { g: '¨', glyphName: 'Diaeresis', names: ['each', 'diaeresis', 'map'], op: 'Each' },
  { g: '⍤', glyphName: 'Jot Diaeresis', names: ['jotdiaeresis', 'rank', 'atop'], op: 'Rank, or Atop with a function right operand' },
  { g: '⍥', glyphName: 'Circle Diaeresis', names: ['circlediaeresis', 'over'], op: 'Over' },
  { g: '⍛', glyphName: 'Jot Underbar', names: ['jotunderbar', 'behind', 'reversecompose'], op: 'Behind' },
  { g: '⌸', glyphName: 'Quad Equal', names: ['quadequal', 'key', 'group'], op: 'Key' },
  { g: '⌺', glyphName: 'Quad Diamond', names: ['quaddiamond', 'stencil'], op: 'Stencil' },
  { g: '⍨', glyphName: 'Tilde Diaeresis', names: ['tildediaeresis', 'commute', 'selfie', 'swap'], op: 'Commute, or Constant with an array operand' },
  { g: '⍣', glyphName: 'Star Diaeresis', names: ['stardiaeresis', 'power', 'poweroperator', 'fixedpoint'], op: 'Power' },
  { g: '.', glyphName: 'Dot', names: ['dot', 'innerproduct', 'outerproduct'], op: 'Inner or Outer Product' },
  { g: '∘', glyphName: 'Jot', names: ['jot', 'compose', 'beside', 'bind'], op: 'Compose' },
  { g: '⍠', glyphName: 'Quad Colon', names: ['quadcolon', 'variant', 'option'], op: 'Variant' },
  { g: '@', glyphName: 'At', names: ['at', 'substitute', 'amend'], op: 'At' },
  { g: '&', glyphName: 'Ampersand', names: ['ampersand', 'spawn'], op: 'Spawn' },
  { g: '⌶', glyphName: 'I-Beam', names: ['ibeam'], op: 'I-Beam' },
  { g: '←', glyphName: 'Left Arrow', names: ['leftarrow', 'assign', 'gets'], mon: 'Assignment' },
  { g: '→', glyphName: 'Right Arrow', names: ['rightarrow', 'branch', 'goto'], mon: 'Branch' },
  { g: '⍺', glyphName: 'Alpha', names: ['alpha', 'leftarg'], mon: 'Left argument of a dfn' },
  { g: '⍵', glyphName: 'Omega', names: ['omega', 'rightarg'], mon: 'Right argument of a dfn' },
  { g: '⍶', glyphName: 'Alpha Underbar', names: ['alphaunderbar'], mon: 'Left operand of a dop' },
  { g: '⍹', glyphName: 'Omega Underbar', names: ['omegaunderbar'], mon: 'Right operand of a dop' },
  { g: '∇', glyphName: 'Del', names: ['del', 'recurse', 'selfreference'], mon: 'Recursive reference, or a defined function' },
  { g: '⍫', glyphName: 'Del Tilde', names: ['deltilde'], mon: 'Locked defined function' },
  { g: '⍝', glyphName: 'Lamp', names: ['comment', 'lamp'], mon: 'Comment to end of line' },
  { g: '⋄', glyphName: 'Diamond', names: ['diamond', 'statementseparator'], mon: 'Statement separator' },
  { g: '⎕', glyphName: 'Quad', names: ['quad', 'evaluatedinput'], mon: 'System name prefix, or evaluated input' },
  { g: '⍞', glyphName: 'Quote Quad', names: ['quotequad', 'characterinput'], mon: 'Character input and output' },
  { g: '⍬', glyphName: 'Zilde', names: ['zilde', 'empty'], mon: 'Empty numeric vector' },
  { g: '¯', glyphName: 'Macron', names: ['macron', 'highminus', 'negative'], mon: 'Negative number prefix' },
  { g: '∆', glyphName: 'Delta', names: ['delta'], mon: 'Valid in names' },
  { g: '⍙', glyphName: 'Delta Underbar', names: ['deltaunderbar'], mon: 'Valid in names' }
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

export const CONTROL_WORDS = [
  ':If', ':AndIf', ':OrIf', ':ElseIf', ':Else', ':EndIf',
  ':While', ':Until', ':EndWhile',
  ':Repeat', ':EndRepeat',
  ':For', ':In', ':InEach', ':EndFor',
  ':Select', ':Case', ':CaseList', ':EndSelect',
  ':Trap', ':EndTrap',
  ':With', ':EndWith',
  ':Hold', ':EndHold',
  ':Return', ':Leave', ':Continue', ':GoTo',
  ':Namespace', ':EndNamespace', ':Class', ':EndClass',
  ':Field', ':Property', ':EndProperty', ':Access', ':Implements',
  ':Section', ':EndSection'
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
  const parts = [glyph.mon, glyph.dya, glyph.op].filter(Boolean);
  return parts.length ? `${glyph.glyphName} — ${parts.join(' / ')}` : glyph.glyphName;
}
