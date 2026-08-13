/**
 * Unit tests for the static symbol extraction in src/analysis/symbols.ts.
 * Run with: npm run symbols
 *
 * These drive the extraction layer directly, so a failure points at the parsing
 * rather than at the LSP plumbing. test/smoke.mjs separately exercises the real
 * textDocument/documentSymbol request over stdio.
 *
 * Requires `npm run build` first.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let extractSymbols, parseHeader, scanLine;
try {
  ({ extractSymbols, parseHeader } = require(path.join(root, 'out', 'analysis', 'symbols.js')));
  ({ scanLine } = require(path.join(root, 'out', 'analysis', 'scanner.js')));
} catch (error) {
  console.error('out/analysis is missing. Run `npm run build` first.');
  console.error(error.message);
  process.exit(1);
}

let checks = 0;
const failures = [];
function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(` FAIL  ${name}`);
    if (detail !== undefined) console.log(`         ${detail}`);
  }
}
const section = text => console.log(`\n\x1b[1m${text}\x1b[0m`);

/** Flattens to "kind:name" strings, depth-first, for compact assertions. */
const shape = symbols =>
  symbols.map(s => (s.children.length ? `${s.kind}:${s.name}(${shape(s.children).join(',')})` : `${s.kind}:${s.name}`));

// ------------------------------------------------------------- the scanner

section('scanner masking');
check(
  'a brace inside a character literal is masked',
  scanLine("x←'}'").code === 'x←   ',
  JSON.stringify(scanLine("x←'}'").code)
);
check(
  'a comment is masked but columns are preserved',
  scanLine('x←1 ⍝ }').code.length === 'x←1 ⍝ }'.length &&
    !scanLine('x←1 ⍝ }').code.includes('}')
);
check(
  'the doubled-quote escape does not end the literal',
  scanLine("a←'don''t' ⋄ b←2").code.includes('⋄') &&
    !scanLine("a←'don''t' ⋄ b←2").code.includes('n')
);
check(
  'an unterminated literal is reported at its opening column',
  scanLine("x←'oops").unterminatedStringAt === 2,
  String(scanLine("x←'oops").unterminatedStringAt)
);
check('a terminated literal reports nothing', scanLine("x←'ok'").unterminatedStringAt === -1);

// -------------------------------------------------------------- headers

section('tradfn headers (Dyalog model syntax)');

const fnHeaders = [
  ['∇Foo', 'Foo', 'niladic'],
  ['∇Foo X', 'Foo', 'monadic'],
  ['∇X Foo Y', 'Foo', 'dyadic'],
  ['∇R←Foo', 'Foo', 'niladic with result'],
  ['∇R←Foo X', 'Foo', 'monadic with result'],
  ['∇R←X Foo Y', 'Foo', 'dyadic with result'],
  ['∇{R}←Foo X', 'Foo', 'shy result'],
  ['∇R←{X} Foo Y', 'Foo', 'ambivalent'],
  ['∇{R}←{X} Foo Y', 'Foo', 'shy and ambivalent'],
  ['∇R←Foo X;local;other', 'Foo', 'with locals'],
  ['∇ R ← Foo X', 'Foo', 'generous spacing'],
  ['∇IDN←Date2IDN(Year Month Day)', 'Date2IDN', 'namelist right argument'],
  ['∇(Year Month Day)←Birthday age', 'Birthday', 'namelist result'],
  ['∇R←Foo X ⍝ a comment', 'Foo', 'trailing comment']
];
for (const [header, expected, label] of fnHeaders) {
  const parsed = parseHeader(scanLine(header).code);
  check(
    `${label}: ${header.trim()} → ${expected}`,
    parsed?.name === expected && parsed?.kind === 'tradfn',
    `got ${JSON.stringify(parsed)}`
  );
}

section('tradop headers');

// From Dyalog's model syntax: an operator's header puts (A op) or (A op B) in
// operation position, and the operator's own name is the middle one.
const opHeaders = [
  ['∇(A op)Y', 'op', 'monadic operator, monadic derived'],
  ['∇X(A op)Y', 'op', 'monadic operator, dyadic derived'],
  ['∇R←(A op)Y', 'op', 'with result'],
  ['∇R←X(A op B)Y', 'op', 'dyadic operator'],
  ['∇(A op B)Y', 'op', 'dyadic operator, no result'],
  ['∇{R}←{X}(A op B)Y', 'op', 'shy, ambivalent, dyadic operator'],
  ['∇ R ← (LO Each) R', 'Each', 'spaced'],
  ['∇R←(A op B)Y;tmp', 'op', 'with locals']
];
for (const [header, expected, label] of opHeaders) {
  const parsed = parseHeader(scanLine(header).code);
  check(
    `${label}: ${header.trim()} → ${expected}`,
    parsed?.name === expected && parsed?.kind === 'tradop',
    `got ${JSON.stringify(parsed)}`
  );
}

check(
  'a namelist argument is not mistaken for an operator',
  parseHeader(scanLine('∇IDN←Date2IDN(Year Month Day)').code)?.kind === 'tradfn',
  'only the right argument and result may be namelists, never the left'
);

section('headers that must not be recognised');
for (const bad of ['∇', '∇ ', '∇ 123', '∇R←', '∇(A op B C D)Y', 'Foo X']) {
  check(`${JSON.stringify(bad)} yields nothing`, parseHeader(scanLine(bad).code) === undefined,
    `got ${JSON.stringify(parseHeader(scanLine(bad).code))}`);
}

// ------------------------------------------------------------ whole files

section('traditional functions');

const tradfn = ['∇R←Average X', ' R←(+/X)÷≢X', '∇'].join('\n');
const [avg] = extractSymbols(tradfn);
check('one symbol is found', extractSymbols(tradfn).length === 1);
check('named Average', avg?.name === 'Average');
check('kind tradfn', avg?.kind === 'tradfn');
check('range covers header through closing ∇', avg?.range.start.line === 0 && avg?.range.end.line === 2,
  JSON.stringify(avg?.range));
check(
  'selection range points at the name, not the line',
  avg?.selectionRange.start.line === 0 &&
    tradfn.split('\n')[0].slice(avg.selectionRange.start.character, avg.selectionRange.end.character) ===
      'Average',
  JSON.stringify(avg?.selectionRange)
);

section('traditional operators');

const tradop = ['∇R←(LO Twice)Y', ' R←LO LO Y', '∇'].join('\n');
const [twice] = extractSymbols(tradop);
check('operator name extracted', twice?.name === 'Twice', JSON.stringify(twice?.name));
check('classified as tradop, not tradfn', twice?.kind === 'tradop', `got ${twice?.kind}`);
check(
  'selection range points at the operator name',
  tradop.split('\n')[0].slice(
    twice.selectionRange.start.character,
    twice.selectionRange.end.character
  ) === 'Twice',
  JSON.stringify(twice?.selectionRange)
);

section('named dfns');

const oneLine = 'Square←{⍵*2}';
const [square] = extractSymbols(oneLine);
check('single-line dfn found', square?.name === 'Square' && square?.kind === 'dfn');
check(
  'range spans the whole assignment',
  square?.range.start.character === 0 && square?.range.end.character === oneLine.length,
  JSON.stringify(square?.range)
);
check(
  'selection range is the name only',
  oneLine.slice(square.selectionRange.start.character, square.selectionRange.end.character) === 'Square'
);

const multi = ['Cube←{', '    x←⍵', '    x*3', '}'].join('\n');
const [cube] = extractSymbols(multi);
check('multiline dfn found', cube?.name === 'Cube');
check('range reaches the closing brace', cube?.range.end.line === 3, JSON.stringify(cube?.range));

section('braces in strings and comments do not close a dfn');

const tricky = ['Foo←{', "    x←'}'", '    ⍝ }', '    ⍵', '}', 'After←{⍵}'].join('\n');
const trickySymbols = extractSymbols(tricky);
check(
  'the dfn runs to the real closing brace',
  trickySymbols[0]?.name === 'Foo' && trickySymbols[0]?.range.end.line === 4,
  JSON.stringify(trickySymbols[0]?.range)
);
check(
  'the definition after it is still found',
  trickySymbols[1]?.name === 'After',
  shape(trickySymbols).join(' ')
);
check('exactly two symbols', trickySymbols.length === 2, shape(trickySymbols).join(' '));

section('namespaces and classes');

const ns = [':Namespace Utils', '', 'Bar←{⍵+1}', '', ':EndNamespace'].join('\n');
check('namespace with a child dfn', shape(extractSymbols(ns)).join('') === 'namespace:Utils(dfn:Bar)',
  shape(extractSymbols(ns)).join(' '));

const cls = [
  ':Class Widget',
  '    ∇R←Make X',
  '     R←X',
  '    ∇',
  '    Helper←{⍵}',
  ':EndClass'
].join('\n');
check(
  'class with a tradfn and a dfn as children',
  shape(extractSymbols(cls)).join('') === 'class:Widget(tradfn:Make,dfn:Helper)',
  shape(extractSymbols(cls)).join(' ')
);

check(
  'a derived class keeps only its own name',
  extractSymbols([':Class Widget: Base', ':EndClass'].join('\n'))[0]?.name === 'Widget',
  JSON.stringify(extractSymbols([':Class Widget: Base', ':EndClass'].join('\n'))[0]?.name)
);

check(
  'a generic :End closes a namespace',
  shape(extractSymbols([':Namespace N', 'F←{⍵}', ':End'].join('\n'))).join('') === 'namespace:N(dfn:F)'
);

check(
  'nested namespaces nest',
  shape(extractSymbols(
    [':Namespace Outer', ':Namespace Inner', 'F←{⍵}', ':EndNamespace', ':EndNamespace'].join('\n')
  )).join('') === 'namespace:Outer(namespace:Inner(dfn:F))',
  shape(extractSymbols(
    [':Namespace Outer', ':Namespace Inner', 'F←{⍵}', ':EndNamespace', ':EndNamespace'].join('\n')
  )).join(' ')
);

check(
  'an interface is recognised',
  extractSymbols([':Interface IThing', ':EndInterface'].join('\n'))[0]?.kind === 'interface'
);

section(':End inside a function body does not close the enclosing class');

const withControl = [
  ':Class Widget',
  '    ∇R←Check X',
  '     :If X>0',
  '      R←1',
  '     :End',
  '    ∇',
  '    After←{⍵}',
  ':EndClass'
].join('\n');
check(
  'the class still contains both members',
  shape(extractSymbols(withControl)).join('') === 'class:Widget(tradfn:Check,dfn:After)',
  shape(extractSymbols(withControl)).join(' ')
);

section('things that must not become symbols');

const negatives = [
  ['x←1', 'an ordinary assignment'],
  ['foo bar baz', 'bare names of unknown class'],
  ['count←count+1', 'an update'],
  ['⍝ :Class Fake', 'a class in a comment'],
  ["text←':Namespace Nope'", 'a namespace in a string'],
  ["src←'∇R←Ghost X'", 'a tradfn header in a string'],
  ['⍝ Foo←{⍵}', 'a dfn in a comment'],
  ['nums←1 2 3', 'a vector'],
  ['⍬', 'nothing at all']
];
for (const [source, label] of negatives) {
  const found = extractSymbols(source);
  check(`${label} yields no symbol`, found.length === 0, `got ${shape(found).join(' ')}`);
}

section('malformed constructs are handled without invention');

const unclosedDfn = ['Foo←{', '  ⍵', 'Bar←{⍵}'].join('\n');
const unclosed = extractSymbols(unclosedDfn);
check(
  'an unclosed dfn does not hide later symbols',
  unclosed.some(s => s.name === 'Bar'),
  shape(unclosed).join(' ')
);
check(
  'an unclosed dfn does not claim a range it cannot establish',
  unclosed[0]?.range.end.line === 0,
  JSON.stringify(unclosed[0]?.range)
);

const unclosedNs = [':Namespace N', 'F←{⍵}'].join('\n');
check(
  'an unterminated namespace claims no children',
  extractSymbols(unclosedNs)[0]?.children.length === 0,
  shape(extractSymbols(unclosedNs)).join(' ')
);
check(
  'and its contents are still reported at top level',
  extractSymbols(unclosedNs).some(s => s.name === 'F'),
  shape(extractSymbols(unclosedNs)).join(' ')
);

check(
  'a bare ∇ produces nothing',
  extractSymbols(['∇', '∇'].join('\n')).length === 0,
  shape(extractSymbols(['∇', '∇'].join('\n'))).join(' ')
);

section('a realistic file');

const realistic = [
  '⍝ A small utility namespace',
  ':Namespace Stats',
  '',
  '    ∇R←Mean X;n',
  '     n←≢X',
  '     R←(+/X)÷n',
  '    ∇',
  '',
  '    ∇R←(LO Over)Y',
  '     R←LO Y',
  '    ∇',
  '',
  '    Median←{',
  "        ⍝ not a } brace",
  '        s←⍵[⍋⍵]',
  '        s[⌈2÷⍨≢s]',
  '    }',
  '',
  '    threshold←0.5',
  '',
  ':EndNamespace'
].join('\n');
const real = extractSymbols(realistic);
check(
  'one namespace containing exactly its three definitions',
  shape(real).join('') === 'namespace:Stats(tradfn:Mean,tradop:Over,dfn:Median)',
  shape(real).join(' ')
);
check(
  'the plain variable is not a symbol',
  !JSON.stringify(real).includes('threshold')
);

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} symbol checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} symbol checks passed.`);
