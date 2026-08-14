/**
 * Tests for name extraction and definition resolution.
 * Run with: npm run definition
 *
 * Fixtures are real temporary trees indexed by the real project model, so these
 * exercise the same path the server does, minus the LSP envelope. The envelope
 * itself is covered by the definition section of test/smoke.mjs.
 *
 * Requires `npm run build` first.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let ProjectModel, resolveDefinition, nameAt, isLocallyBound;
try {
  ({ ProjectModel } = require(path.join(root, 'out', 'analysis', 'project.js')));
  ({ resolveDefinition } = require(path.join(root, 'out', 'analysis', 'definitions.js')));
  ({ nameAt, isLocallyBound } = require(path.join(root, 'out', 'analysis', 'names.js')));
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

const temporaries = [];
async function fixture(tree) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-definition-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

/** Resolves at the cursor marked by ⎸ in the given source. */
async function resolveAt(project, file, source, options = {}) {
  const lines = source.split('\n');
  const line = lines.findIndex(l => l.includes('⎸'));
  if (line === -1) throw new Error('the fixture has no ⎸ cursor marker');
  const character = lines[line].indexOf('⎸');
  const text = source.replace('⎸', '');
  return resolveDefinition({ text, file, position: { line, character }, project, ...options });
}

// ------------------------------------------------------------ name extraction

section('the name under the cursor');

const extraction = [
  ['Bar', 1, 'Bar', [], false, 0],
  ['Bar', 0, 'Bar', [], false, 0],
  ['Bar', 3, 'Bar', [], false, 0], // caret just past the end still counts
  ['x←Bar y', 3, 'Bar', [], false, 0],
  ['#.Foo.Bar', 8, 'Bar', ['Foo'], true, 0],
  ['#.Foo.Bar', 3, 'Foo', [], true, 0],
  ['Foo.Bar', 5, 'Bar', ['Foo'], false, 0],
  ['##.Bar', 4, 'Bar', [], false, 1],
  // Two levels up is written ##.##, not ####; ## is a single token.
  ['##.##.Bar', 7, 'Bar', [], false, 2],
  ['A∆B←1', 1, 'A∆B', [], false, 0],
  ['x⍙y←1', 1, 'x⍙y', [], false, 0],
  ['r←Foo.Bar.Baz', 11, 'Baz', ['Foo', 'Bar'], false, 0]
];
for (const [line, character, name, qualifiers, rootQualified, parentLevels] of extraction) {
  const reference = nameAt(line, character);
  check(
    `${JSON.stringify(line)} at ${character} → ${name}${qualifiers.length ? ` (under ${qualifiers.join('.')})` : ''}`,
    reference?.name === name &&
      JSON.stringify(reference?.qualifiers) === JSON.stringify(qualifiers) &&
      reference?.rootQualified === rootQualified &&
      reference?.parentLevels === parentLevels,
    `got ${JSON.stringify(reference)}`
  );
}

section('positions that are not names');
check('inside a comment', nameAt('⍝ Foo.Bar', 4) === undefined, JSON.stringify(nameAt('⍝ Foo.Bar', 4)));
check(
  'inside a character literal',
  nameAt("text←'Foo.Bar'", 8) === undefined,
  JSON.stringify(nameAt("text←'Foo.Bar'", 8))
);
check('on a primitive', nameAt('x←⍴y', 2) === undefined);
check('on a number', nameAt('x←123', 3) === undefined, JSON.stringify(nameAt('x←123', 3)));
check('on whitespace', nameAt('a   b', 2) === undefined || nameAt('a   b', 2)?.name !== undefined);
check('past the end of the line', nameAt('ab', 9) === undefined);

section('system names are never source');
check('⎕IO is system-qualified', nameAt('⎕IO←0', 2)?.systemQualified === true);
check('⎕SE.Foo is system-qualified', nameAt('⎕SE.Foo', 5)?.systemQualified === true);

section('local binding');
check(
  'an assignment binds the name',
  isLocallyBound('Bar', ['Bar←1', 'x←Bar']) === true
);
check(
  'a tradfn argument binds the name',
  isLocallyBound('X', ['∇R←Foo X', ' R←X', '∇']) === true
);
check(
  'a ;-localised name binds',
  isLocallyBound('tmp', ['∇R←Foo X;tmp', ' tmp←X', '∇']) === true
);
check(
  'an unrelated name does not bind',
  isLocallyBound('Bar', ['∇R←Foo X', ' R←Bar X', '∇']) === false
);
check(
  'an assignment inside a comment does not bind',
  isLocallyBound('Bar', ['⍝ Bar←1']) === false
);

// ------------------------------------------------------- cross-file project

section('root-qualified project references');

const projectTree = await fixture({
  'Foo/Bar.aplf': '∇R←Bar X\n R←X\n∇\n',
  'Foo/Caller.aplf': '∇R←Caller X\n R←X\n∇\n',
  'Foo/Sibling.aplf': '{⍵}\n',
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n',
  'Widget.aplc': ':Class Widget\n:EndClass\n',
  'IThing.apli': ':Interface IThing\n:EndInterface\n'
});
let project = await ProjectModel.index([projectTree]);
const caller = path.join(projectTree, 'Foo', 'Caller.aplf');
const barFile = path.join(projectTree, 'Foo', 'Bar.aplf');

let target = await resolveAt(project, caller, '∇R←Caller X\n R←#.Foo.B⎸ar X\n∇\n');
check('#.Foo.Bar navigates to Bar.aplf', target?.file === barFile, JSON.stringify(target));
check(
  'and lands on the name, not line 0',
  target?.selectionRange.start.line === 0 && target?.selectionRange.start.character === 3,
  JSON.stringify(target?.selectionRange)
);
check(
  'the whole definition is the enclosing range',
  target?.range.start.line === 0 && target?.range.end.line === 2,
  JSON.stringify(target?.range)
);

check(
  'a root-qualified name that does not exist resolves to nothing',
  (await resolveAt(project, caller, '∇R←Caller X\n R←#.Foo.Nope⎸ X\n∇\n')) === undefined
);
check(
  'a root-qualified name through a non-namespace resolves to nothing',
  (await resolveAt(project, caller, '∇R←Caller X\n R←#.Bar.Thi⎸ng X\n∇\n')) === undefined
);

section('nested namespaces');

const deepTree = await fixture({
  'A/B/Target.aplf': '∇R←Target X\n R←X\n∇\n',
  'A/Caller.aplf': '∇R←Caller X\n R←X\n∇\n'
});
const deepProject = await ProjectModel.index([deepTree]);
const deepCaller = path.join(deepTree, 'A', 'Caller.aplf');
target = await resolveAt(deepProject, deepCaller, '∇R←Caller X\n R←#.A.B.Targ⎸et X\n∇\n');
check(
  '#.A.B.Target navigates to A/B/Target.aplf',
  target?.file === path.join(deepTree, 'A', 'B', 'Target.aplf'),
  JSON.stringify(target)
);

// Relative from #.A: B is a namespace in the current space, so B.Target works.
target = await resolveAt(deepProject, deepCaller, '∇R←Caller X\n R←B.Targ⎸et X\n∇\n');
check(
  'the relative path B.Target resolves in the current namespace',
  target?.file === path.join(deepTree, 'A', 'B', 'Target.aplf'),
  JSON.stringify(target)
);

// ## is the parent of the current namespace.
const deepInner = path.join(deepTree, 'A', 'B', 'Target.aplf');
target = await resolveAt(deepProject, deepInner, '∇R←Target X\n R←##.Call⎸er X\n∇\n');
check(
  '##.Caller reaches the parent namespace',
  target?.file === deepCaller,
  JSON.stringify(target)
);
check(
  'a ## chain that walks above the root resolves to nothing',
  (await resolveAt(deepProject, deepCaller, '∇R←Caller X\n R←##.##.Not⎸hing X\n∇\n')) === undefined,
  'from #.A that is two levels up, which is above the root'
);

section('bare names');

// Same Link namespace, i.e. a sibling file in the same directory. Dyalog
// resolves an unqualified name in the current space, which this is.
target = await resolveAt(project, caller, '∇R←Caller X\n R←Ba⎸r X\n∇\n');
check(
  'a sibling in the same directory resolves',
  target?.file === barFile,
  JSON.stringify(target)
);

// The crucial negative: Utils is at the root, not in #.Foo, and Dyalog does not
// search enclosing namespaces for unqualified names.
check(
  'a name in an enclosing namespace does NOT resolve',
  (await resolveAt(project, caller, '∇R←Caller X\n R←Util⎸s X\n∇\n')) === undefined,
  'Dyalog resolves unqualified names in the current space, then ⎕PATH only'
);

check(
  'a name bound locally does not resolve to the project object',
  (await resolveAt(project, caller, '∇R←Caller X;Bar\n Bar←1\n R←Ba⎸r\n∇\n')) === undefined
);
check(
  'a tradfn argument does not resolve',
  (await resolveAt(project, caller, '∇R←Caller Bar\n R←Ba⎸r\n∇\n')) === undefined
);
check(
  'an unknown bare name resolves to nothing',
  (await resolveAt(project, caller, '∇R←Caller X\n R←Nowhe⎸re X\n∇\n')) === undefined
);

section('same-file definitions');

const sameFile = [
  'Helper←{⍵+1}',
  '∇R←Main X',
  ' R←Help⎸er X',
  '∇'
].join('\n');
target = await resolveAt(project, caller, sameFile);
check('a dfn defined in this file resolves', target !== undefined, JSON.stringify(target));
check('and reports no other file', target?.file === caller, JSON.stringify(target?.file));
check(
  'landing on the dfn name',
  target?.selectionRange.start.line === 0 && target?.selectionRange.start.character === 0,
  JSON.stringify(target?.selectionRange)
);

check(
  'two definitions of one name in a file resolve to nothing',
  (await resolveAt(
    project,
    caller,
    ['Dup←{⍵}', 'Dup←{⍵+1}', 'x←Du⎸p 1'].join('\n')
  )) === undefined
);

section('scripted objects');

target = await resolveAt(project, caller, '∇R←Caller X\n R←#.Wid⎸get\n∇\n');
check(
  'a class navigates to its declaration name',
  target?.file === path.join(projectTree, 'Widget.aplc') &&
    target?.selectionRange.start.line === 0 &&
    target?.selectionRange.start.character === 7,
  JSON.stringify(target)
);
target = await resolveAt(project, caller, '∇R←Caller X\n R←#.Uti⎸ls\n∇\n');
check(
  'a scripted namespace navigates to its name',
  target?.file === path.join(projectTree, 'Utils.apln') &&
    target?.selectionRange.start.character === 11,
  JSON.stringify(target)
);
target = await resolveAt(project, caller, '∇R←Caller X\n R←#.ITh⎸ing\n∇\n');
check(
  'an interface navigates to its name',
  target?.file === path.join(projectTree, 'IThing.apli'),
  JSON.stringify(target)
);

check(
  'a directory-backed namespace has no source to navigate to',
  (await resolveAt(project, caller, '∇R←Caller X\n R←#.Fo⎸o\n∇\n')) === undefined
);

section('a bare dfn whose name comes from the filename');

target = await resolveAt(project, caller, '∇R←Caller X\n R←Siblin⎸g X\n∇\n');
check(
  'it still navigates to the file',
  target?.file === path.join(projectTree, 'Foo', 'Sibling.aplf'),
  JSON.stringify(target)
);
check(
  'with a sensible destination at the start of the file',
  target?.selectionRange.start.line === 0 && target?.selectionRange.start.character === 0,
  JSON.stringify(target?.selectionRange)
);

section('comments and strings never navigate');

check(
  'a qualified name in a comment',
  (await resolveAt(project, caller, '∇R←Caller X\n ⍝ #.Foo.B⎸ar\n∇\n')) === undefined
);
check(
  'a qualified name in a character literal',
  (await resolveAt(project, caller, "∇R←Caller X\n t←'#.Foo.B⎸ar'\n∇\n")) === undefined
);
check(
  'a bare project name in a comment',
  (await resolveAt(project, caller, '∇R←Caller X\n ⍝ Ba⎸r does the thing\n∇\n')) === undefined
);
check(
  'a system name',
  (await resolveAt(project, caller, '∇R←Caller X\n ⎕I⎸O←0\n∇\n')) === undefined
);

section('cursor positions across a name');

for (const [label, source] of [
  ['first character', '∇R←Caller X\n R←⎸Bar X\n∇\n'],
  ['middle', '∇R←Caller X\n R←B⎸ar X\n∇\n'],
  ['last character', '∇R←Caller X\n R←Ba⎸r X\n∇\n'],
  ['just past the end', '∇R←Caller X\n R←Bar⎸ X\n∇\n']
]) {
  check(`cursor at the ${label} resolves`, (await resolveAt(project, caller, source))?.file === barFile);
}

// -------------------------------------------------------------- ambiguity

section('duplicate project objects');

const ambiguous = await fixture({
  'Thing.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Thing.apln': ':Namespace Thing\n:EndNamespace\n',
  'Caller.aplf': '∇R←Caller X\n R←X\n∇\n'
});
const ambiguousProject = await ProjectModel.index([ambiguous]);
const ambiguousCaller = path.join(ambiguous, 'Caller.aplf');
check(
  'two files defining one name resolve to nothing, not the first',
  (await resolveAt(ambiguousProject, ambiguousCaller, '∇R←Caller X\n R←#.Thi⎸ng X\n∇\n')) === undefined,
  'Link itself treats this as an error'
);
check(
  'and the bare form is equally refused',
  (await resolveAt(ambiguousProject, ambiguousCaller, '∇R←Caller X\n R←Thi⎸ng X\n∇\n')) === undefined
);

section('separate workspace roots stay separate');

const rootOne = await fixture({ 'Shared.aplf': '∇R←Shared X\n R←X\n∇\n', 'One.aplf': '{⍵}\n' });
const rootTwo = await fixture({ 'Other.aplf': '∇R←Other X\n R←X\n∇\n', 'Two.aplf': '{⍵}\n' });
const twoRoots = await ProjectModel.index([rootOne, rootTwo]);
target = await resolveAt(twoRoots, path.join(rootOne, 'One.aplf'), 'R←#.Share⎸d 1\n');
check(
  'a reference resolves within its own root',
  target?.file === path.join(rootOne, 'Shared.aplf'),
  JSON.stringify(target)
);
check(
  'and cannot reach into the other root',
  (await resolveAt(twoRoots, path.join(rootOne, 'One.aplf'), 'R←#.Othe⎸r 1\n')) === undefined,
  'roots are separate projects'
);

section('no workspace');

const noProject = await ProjectModel.index([]);
check(
  'a project reference resolves to nothing rather than throwing',
  (await resolveAt(noProject, path.join(os.tmpdir(), 'lone.aplf'), 'R←#.Foo.B⎸ar 1\n')) === undefined
);
check(
  'but a same-file definition still resolves',
  (await resolveAt(
    noProject,
    path.join(os.tmpdir(), 'lone.aplf'),
    ['Sq←{⍵*2}', 'x←S⎸q 4'].join('\n')
  )) !== undefined
);
check(
  'and an untitled document with no path still resolves in-file',
  (await resolveAt(noProject, undefined, ['Sq←{⍵*2}', 'x←S⎸q 4'].join('\n')))?.file === undefined
);

section('unsaved edits in another open file');

// The target file on disk defines Bar on line 0. The editor holds a version
// where it has moved down; navigation should land where the user can see it.
const movedText = '⍝ a new comment line\n⍝ and another\n∇R←Bar X\n R←X\n∇\n';
target = await resolveAt(project, caller, '∇R←Caller X\n R←#.Foo.B⎸ar X\n∇\n', {
  liveText: file => (file === barFile ? movedText : undefined)
});
check(
  'the destination follows the live buffer, not the stale file',
  target?.selectionRange.start.line === 2,
  `${JSON.stringify(target?.selectionRange)} — on disk it is line 0`
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} definition checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} definition checks passed.`);
