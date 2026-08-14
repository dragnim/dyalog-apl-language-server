/**
 * Tests for the Localise Variable code action.
 * Run with: npm run localise
 *
 * Where an action is offered, the edit is applied and the whole resulting source
 * compared — asserting that an edit object exists proves nothing about where it
 * lands. Most of the rest checks that the action stays away.
 *
 * Requires `npm run build` first.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let planLocalise, applyLocalise, isLocaliseRefusal, assignmentTargets;
try {
  ({ planLocalise, applyLocalise, isLocaliseRefusal, assignmentTargets } = require(
    path.join(root, 'out', 'analysis', 'localise.js')
  ));
} catch (error) {
  console.error('out/analysis/localise.js is missing. Run `npm run build` first.');
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

/**
 * Plans a localisation with the cursor at the ⎸ marker. A second ⎹ marker makes
 * it a selection from ⎸ to ⎹.
 */
function planAt(source) {
  const lines = source.split('\n');
  const line = lines.findIndex(l => l.includes('⎸'));
  if (line === -1) throw new Error('the fixture has no ⎸ cursor marker');
  const character = lines[line].indexOf('⎸');

  let endLine = line;
  let endCharacter = character;
  const withoutStart = source.replace('⎸', '');
  const endLines = withoutStart.split('\n');
  const marked = endLines.findIndex(l => l.includes('⎹'));
  if (marked !== -1) {
    endLine = marked;
    endCharacter = endLines[marked].indexOf('⎹');
  }

  const text = withoutStart.replace('⎹', '');
  return {
    text,
    plan: planLocalise({
      text,
      range: {
        start: { line, character },
        end: { line: endLine, character: endCharacter }
      }
    })
  };
}

/** Plans, applies and returns the resulting source. */
function localised(source) {
  const { text, plan } = planAt(source);
  if (isLocaliseRefusal(plan)) return plan;
  return applyLocalise(text, plan);
}

const refusalOf = source => {
  const { plan } = planAt(source);
  return isLocaliseRefusal(plan) ? plan.refused : `offered:${plan.name}`;
};

// ------------------------------------------------------ assignment detection

section('assignment targets');

const assignments = [
  ['Temp←X+1', ['Temp']],
  ['  Temp ← X', ['Temp']],
  ['(a b c d)←y', ['a', 'b', 'c', 'd']],
  ['x[i]←y', ['x']],
  ['R←Helper X', ['R']],
  ['R←X', ['R']],
  ['a←b←1', ['a', 'b']],
  ['x+1', []],
  ['(f g)y', []]
];
for (const [code, expected] of assignments) {
  const got = assignmentTargets(code);
  check(
    `${JSON.stringify(code)} assigns ${JSON.stringify(expected)}`,
    JSON.stringify(got) === JSON.stringify(expected),
    JSON.stringify(got)
  );
}

// ------------------------------------------------------------ basic action

section('basic localisation');

let result = localised(['∇R←Foo X', ' Te⎸mp←X+1', ' R←Temp×2', '∇'].join('\n'));
check(
  'the header gains ;Temp and nothing else changes',
  result === ['∇R←Foo X;Temp', ' Temp←X+1', ' R←Temp×2', '∇'].join('\n'),
  JSON.stringify(result)
);

let planned = planAt(['∇R←Foo X', ' Te⎸mp←X+1', '∇'].join('\n')).plan;
check('the plan names the variable', planned.name === 'Temp');
check('and the enclosing definition', planned.definitionName === 'Foo');
check(
  'the insertion is at the end of the header',
  planned.insertAt.line === 0 && planned.insertAt.character === 8,
  JSON.stringify(planned.insertAt)
);
check('the inserted text is exactly ;Temp', planned.insertText === ';Temp');
check(
  'and it reports the occurrence it was invoked on',
  planned.candidateRange.start.line === 1 && planned.candidateRange.start.character === 1,
  JSON.stringify(planned.candidateRange)
);

section('an existing local list is appended to, not reordered');

result = localised(['∇R←Foo X;A;B', ' Te⎸mp←X', ' R←Temp', '∇'].join('\n'));
check(
  'A and B keep their order and Temp goes last',
  result === ['∇R←Foo X;A;B;Temp', ' Temp←X', ' R←Temp', '∇'].join('\n'),
  JSON.stringify(result)
);

section('a trailing comment and its spacing survive');

result = localised(['∇R←Foo X   ⍝ a comment', ' Te⎸mp←X', '∇'].join('\n'));
check(
  'the local is inserted before the comment',
  result === ['∇R←Foo X;Temp   ⍝ a comment', ' Temp←X', '∇'].join('\n'),
  JSON.stringify(result)
);

result = localised(['∇R←Foo X;A ⍝ locals', ' Te⎸mp←X', '∇'].join('\n'));
check(
  'and after an existing local',
  result === ['∇R←Foo X;A;Temp ⍝ locals', ' Temp←X', '∇'].join('\n'),
  JSON.stringify(result)
);

section('header spacing is preserved');

result = localised(['∇ R ← Foo X', ' Te⎸mp←X', '∇'].join('\n'));
check(
  'a generously spaced header is not reformatted',
  result === ['∇ R ← Foo X;Temp', ' Temp←X', '∇'].join('\n'),
  JSON.stringify(result)
);

// ----------------------------------------------------------- already bound

section('names the header already binds');

const bound = [
  ['an existing local', ['∇R←Foo X;Temp', ' Te⎸mp←X', '∇'].join('\n')],
  ['a right argument', ['∇R←Foo Temp', ' Te⎸mp←1', '∇'].join('\n')],
  ['a left argument', ['∇R←Temp Foo X', ' Te⎸mp←1', '∇'].join('\n')],
  ['the result', ['∇Temp←Foo X', ' Te⎸mp←1', '∇'].join('\n')],
  ['a shy result', ['∇{Temp}←Foo X', ' Te⎸mp←1', '∇'].join('\n')],
  ['a result namelist member', ['∇(A Temp)←Foo X', ' Te⎸mp←1', '∇'].join('\n')],
  ['an argument namelist member', ['∇R←Foo(A Temp)', ' Te⎸mp←1', '∇'].join('\n')],
  ['the function name itself', ['∇R←Te⎸mp X', ' Temp←1', '∇'].join('\n')]
];
for (const [label, source] of bound) {
  check(`${label} is refused`, refusalOf(source) === 'already-bound', refusalOf(source));
}

section('Locals Lines are read too (locals-lines.md)');

// "A Locals Line may appear anywhere between line [0] and the first executable
// statement", and its names are localised as if they were on line [0].
check(
  'a name localised on a Locals Line is already bound',
  refusalOf(['∇ r←foo y;a;b', '  ;Temp;d', ' Te⎸mp←1', '∇'].join('\n')) === 'already-bound'
);
check(
  'even with blank and comment lines interspersed',
  refusalOf(
    ['∇ r←foo y;a', '', ' ⍝ a note', '  ;Temp   ⍝ more locals', ' Te⎸mp←1', '∇'].join('\n')
  ) === 'already-bound'
);
check(
  'a semicolon line after the first statement is not a Locals Line',
  refusalOf(['∇ r←foo y', ' r←1', '  ;Temp', ' Te⎸mp←1', '∇'].join('\n')) === 'offered:Temp',
  refusalOf(['∇ r←foo y', ' r←1', '  ;Temp', ' Te⎸mp←1', '∇'].join('\n'))
);

// --------------------------------------------------- assignment evidence

section('assignment evidence is required');

check(
  'a plain assignment offers the action',
  refusalOf(['∇R←Foo X', ' Te⎸mp←X+1', '∇'].join('\n')) === 'offered:Temp'
);
check(
  'a distributed assignment offers it',
  refusalOf(['∇ r←foo y;a;b', ' (a b Te⎸mp d)←y', '∇'].join('\n')) === 'offered:Temp',
  refusalOf(['∇ r←foo y;a;b', ' (a b Te⎸mp d)←y', '∇'].join('\n'))
);
check(
  'an indexed assignment offers it',
  refusalOf(['∇R←Foo X', ' Te⎸mp[1]←X', '∇'].join('\n')) === 'offered:Temp'
);
check(
  'a name only used, never assigned, is refused',
  refusalOf(['∇R←Foo X', ' R←Hel⎸per X', '∇'].join('\n')) === 'no-assignment-evidence',
  'nothing says whether Helper is a variable here or a function elsewhere'
);
check(
  'a name that is only an argument to something is refused',
  refusalOf(['∇R←Foo X', ' R←X+Coun⎸t', '∇'].join('\n')) === 'no-assignment-evidence'
);

section('assignments inside a dfn do not count');

// In a dfn every assignment is already local to the dfn, so adding it to the
// enclosing tradfn header would be pointless.
check(
  'a name assigned only inside a dfn is refused',
  refusalOf(['∇R←Foo X', ' R←{Te⎸mp←⍵ ⋄ Temp}X', '∇'].join('\n')) === 'no-assignment-evidence',
  refusalOf(['∇R←Foo X', ' R←{Te⎸mp←⍵ ⋄ Temp}X', '∇'].join('\n'))
);
check(
  'but a statement-level assignment elsewhere still counts',
  refusalOf(['∇R←Foo X', ' Temp←1', ' R←{Te⎸mp}X', '∇'].join('\n')) === 'no-assignment-evidence',
  'the cursor is inside the dfn, where the name is already local'
);

// -------------------------------------------------------- not applicable

section('things that are not localisable names');

check('a system name', refusalOf(['∇R←Foo X', ' ⎕I⎸O←0', '∇'].join('\n')) === 'system-name');
check(
  'a primitive',
  refusalOf(['∇R←Foo X', ' R←⎸⍴X', '∇'].join('\n')) === 'no-name-at-cursor',
  refusalOf(['∇R←Foo X', ' R←⎸⍴X', '∇'].join('\n'))
);
check(
  'a control word',
  refusalOf(['∇R←Foo X', ' :I⎸f X', ' :EndIf', '∇'].join('\n')) === 'control-word',
  refusalOf(['∇R←Foo X', ' :I⎸f X', ' :EndIf', '∇'].join('\n'))
);
check(
  'a qualified name',
  refusalOf(['∇R←Foo X', ' #.Stats.Te⎸mp←1', '∇'].join('\n')) === 'qualified-name',
  refusalOf(['∇R←Foo X', ' #.Stats.Te⎸mp←1', '∇'].join('\n'))
);

section('comments and character literals');

check(
  'a name only in a comment',
  refusalOf(['∇R←Foo X', ' ⍝ Te⎸mp is slow', '∇'].join('\n')) === 'no-name-at-cursor'
);
check(
  'a name only in a character literal',
  refusalOf(['∇R←Foo X', " t←'Te⎸mp'", '∇'].join('\n')) === 'no-name-at-cursor'
);
check(
  'an assignment that exists only in a comment is not evidence',
  refusalOf(['∇R←Foo X', ' ⍝ Temp←1', ' R←X+Te⎸mp', '∇'].join('\n')) === 'no-assignment-evidence',
  refusalOf(['∇R←Foo X', ' ⍝ Temp←1', ' R←X+Te⎸mp', '∇'].join('\n'))
);

section('not inside a traditional definition');

check(
  'a named dfn is refused',
  refusalOf(['Foo←{', ' Te⎸mp←⍵', ' Temp', '}'].join('\n')) === 'not-in-tradfn',
  refusalOf(['Foo←{', ' Te⎸mp←⍵', ' Temp', '}'].join('\n'))
);
check(
  'a bare assignment at file level is refused',
  refusalOf(['Te⎸mp←1'].join('\n')) === 'not-in-tradfn',
  refusalOf(['Te⎸mp←1'].join('\n'))
);
check(
  'a :Namespace header is refused',
  refusalOf([':Namespace Uti⎸ls', ':EndNamespace'].join('\n')) === 'not-in-tradfn',
  refusalOf([':Namespace Uti⎸ls', ':EndNamespace'].join('\n'))
);

section('malformed headers');

check(
  'an unreadable header offers nothing rather than guessing',
  refusalOf(['∇ 123', ' Te⎸mp←1', '∇'].join('\n')) === 'not-in-tradfn',
  refusalOf(['∇ 123', ' Te⎸mp←1', '∇'].join('\n'))
);

// ------------------------------------------------------- operators

section('traditional operators');

// From Dyalog's model syntax: (A op) Y is a monadic operator.
result = localised(['∇R←(LO Twice)Y', ' Te⎸mp←LO Y', ' R←LO Temp', '∇'].join('\n'));
check(
  'a monadic operator header gains the local',
  result === ['∇R←(LO Twice)Y;Temp', ' Temp←LO Y', ' R←LO Temp', '∇'].join('\n'),
  JSON.stringify(result)
);
check(
  'the operator name is reported, not an operand',
  planAt(['∇R←(LO Twice)Y', ' Te⎸mp←LO Y', '∇'].join('\n')).plan.definitionName === 'Twice'
);
check(
  'an operand is already bound',
  refusalOf(['∇R←(L⎸O Twice)Y', ' LO←1', '∇'].join('\n')) === 'already-bound',
  refusalOf(['∇R←(L⎸O Twice)Y', ' LO←1', '∇'].join('\n'))
);
result = localised(['∇R←X(A Dyadic B)Y', ' Te⎸mp←Y', '∇'].join('\n'));
check(
  'a dyadic operator with a left argument works too',
  result === ['∇R←X(A Dyadic B)Y;Temp', ' Temp←Y', '∇'].join('\n'),
  JSON.stringify(result)
);

// -------------------------------------------------- picking the right one

section('the enclosing definition is the right one');

const twoFunctions = [
  '∇R←First X',
  ' Temp←X',
  ' R←Temp',
  '∇',
  '',
  '∇R←Second X',
  ' Te⎸mp←X',
  ' R←Temp',
  '∇'
].join('\n');
result = localised(twoFunctions);
check(
  'only the second header is edited',
  result ===
    [
      '∇R←First X',
      ' Temp←X',
      ' R←Temp',
      '∇',
      '',
      '∇R←Second X;Temp',
      ' Temp←X',
      ' R←Temp',
      '∇'
    ].join('\n'),
  JSON.stringify(result)
);

const insideClass = [
  ':Class Widget',
  '    ∇R←Render X',
  '     Temp←X',
  '    ∇',
  '    ∇R←Resize X',
  '     Te⎸mp←X',
  '    ∇',
  ':EndClass'
].join('\n');
result = localised(insideClass);
check(
  'inside a class, the right method header is edited',
  result ===
    [
      ':Class Widget',
      '    ∇R←Render X',
      '     Temp←X',
      '    ∇',
      '    ∇R←Resize X;Temp',
      '     Temp←X',
      '    ∇',
      ':EndClass'
    ].join('\n'),
  JSON.stringify(result)
);

// -------------------------------------------------------- cursor and selection

section('cursor positions');

for (const [label, source] of [
  ['first character', ['∇R←Foo X', ' ⎸Temp←X', '∇'].join('\n')],
  ['middle', ['∇R←Foo X', ' Te⎸mp←X', '∇'].join('\n')],
  ['last character', ['∇R←Foo X', ' Tem⎸p←X', '∇'].join('\n')],
  ['just past the end', ['∇R←Foo X', ' Temp⎸←X', '∇'].join('\n')]
]) {
  check(`the cursor at the ${label} offers the action`, refusalOf(source) === 'offered:Temp',
    refusalOf(source));
}

section('selections');

check(
  'a selection covering exactly the name is accepted',
  refusalOf(['∇R←Foo X', ' ⎸Temp⎹←X', '∇'].join('\n')) === 'offered:Temp',
  refusalOf(['∇R←Foo X', ' ⎸Temp⎹←X', '∇'].join('\n'))
);
check(
  'a selection spanning more than the name is refused',
  refusalOf(['∇R←Foo X', ' ⎸Temp←X⎹', '∇'].join('\n')) === 'selection-not-a-name',
  refusalOf(['∇R←Foo X', ' ⎸Temp←X⎹', '∇'].join('\n'))
);
check(
  'a selection covering only part of the name is refused',
  refusalOf(['∇R←Foo X', ' ⎸Te⎹mp←X', '∇'].join('\n')) === 'selection-not-a-name',
  refusalOf(['∇R←Foo X', ' ⎸Te⎹mp←X', '∇'].join('\n'))
);

// ---------------------------------------------------------------- Unicode

section('legal non-ASCII names use the shared rules');

result = localised(['∇R←Foo X', ' Ca⎸fé←X+1', ' R←Café', '∇'].join('\n'));
check(
  'Café can be localised',
  result === ['∇R←Foo X;Café', ' Café←X+1', ' R←Café', '∇'].join('\n'),
  JSON.stringify(result)
);
result = localised(['∇R←Foo X', ' A∆⎸B⍙C←X', '∇'].join('\n'));
check(
  '∆ and ⍙ names work',
  result === ['∇R←Foo X;A∆B⍙C', ' A∆B⍙C←X', '∇'].join('\n'),
  JSON.stringify(result)
);
check(
  'and an already-localised Café is recognised',
  refusalOf(['∇R←Foo X;Café', ' Ca⎸fé←1', '∇'].join('\n')) === 'already-bound'
);

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} localise checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} localise checks passed.`);
