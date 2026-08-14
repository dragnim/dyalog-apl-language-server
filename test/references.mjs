/**
 * Tests for find references.
 * Run with: npm run references
 *
 * The decisive tests here are the ones where two definitions share a spelling.
 * If this were a text search they would pass by accident; because every
 * occurrence is resolved in its own context, they only pass if identity is
 * actually being proved.
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

let ProjectModel, findReferences;
try {
  ({ ProjectModel } = require(path.join(root, 'out', 'analysis', 'project.js')));
  ({ findReferences } = require(path.join(root, 'out', 'analysis', 'references.js')));
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-references-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

/**
 * Runs find references with the cursor at the ⎸ marker in `source`, which is
 * taken to be the live text of `file`.
 */
async function referencesAt(project, file, source, options = {}) {
  const lines = source.split('\n');
  const line = lines.findIndex(l => l.includes('⎸'));
  if (line === -1) throw new Error('the fixture has no ⎸ cursor marker');
  const character = lines[line].indexOf('⎸');
  const text = source.replace('⎸', '');
  return findReferences({
    text,
    file,
    position: { line, character },
    project,
    includeDeclaration: options.includeDeclaration ?? true,
    liveText: options.liveText
  });
}

/** Compact "relative/path:line:char" form, for readable assertions. */
const shape = (result, base) =>
  result.locations.map(l =>
    `${l.file === undefined ? '<current>' : path.relative(base, l.file).split(path.sep).join('/')}` +
    `:${l.range.start.line}:${l.range.start.character}`
  );

// --------------------------------------------------------- root-qualified

section('root-qualified references across files');

const stats = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/CallerA.aplf': '∇R←CallerA X\n R←#.Stats.Mean X\n R←#.Stats.Mean R\n∇\n',
  'Stats/CallerB.aplf': '∇R←CallerB X\n R←#.Stats.Mean X\n∇\n',
  'Other/Unrelated.aplf': '∇R←Unrelated X\n R←X\n∇\n'
});
let project = await ProjectModel.index([stats]);
const meanFile = path.join(stats, 'Stats', 'Mean.aplf');
const callerA = path.join(stats, 'Stats', 'CallerA.aplf');

let result = await referencesAt(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←#.Stats.Mean R\n∇\n'
);
check(
  'every genuine occurrence is found, declaration included',
  shape(result, stats).join(' ') ===
    'Stats/CallerA.aplf:1:11 Stats/CallerA.aplf:2:11 Stats/CallerB.aplf:1:11 Stats/Mean.aplf:0:3',
  shape(result, stats).join(' ')
);
check(
  'results are sorted by path, then line, then column',
  JSON.stringify(shape(result, stats)) === JSON.stringify([...shape(result, stats)].sort()),
  shape(result, stats).join(' ')
);
check(
  'two references on separate lines of one file are both reported',
  shape(result, stats).filter(s => s.startsWith('Stats/CallerA')).length === 2
);
check(
  'the range covers exactly the name',
  result.locations[0].range.end.character - result.locations[0].range.start.character === 4,
  JSON.stringify(result.locations[0].range)
);

section('includeDeclaration');

const withDeclaration = await referencesAt(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←#.Stats.Mean R\n∇\n',
  { includeDeclaration: true }
);
const withoutDeclaration = await referencesAt(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←#.Stats.Mean R\n∇\n',
  { includeDeclaration: false }
);
check(
  'the declaration is present when asked for',
  shape(withDeclaration, stats).includes('Stats/Mean.aplf:0:3')
);
check(
  'and absent when not',
  !shape(withoutDeclaration, stats).includes('Stats/Mean.aplf:0:3'),
  shape(withoutDeclaration, stats).join(' ')
);
check(
  'excluding it removes exactly one result',
  withDeclaration.locations.length - withoutDeclaration.locations.length === 1
);
check(
  'the declaration is flagged as such',
  withDeclaration.locations.filter(l => l.isDeclaration).length === 1
);

section('starting from the definition gives the same answer');

const fromDefinition = await referencesAt(project, meanFile, '∇R←Me⎸an X\n R←X\n∇\n');
check(
  'the same set is returned as when starting from a use',
  shape(fromDefinition, stats).join(' ') === shape(withDeclaration, stats).join(' '),
  `${shape(fromDefinition, stats).join(' ')}\n         vs ${shape(withDeclaration, stats).join(' ')}`
);

// ------------------------------------------------ the decisive isolation test

section('same spelling in different namespaces');

const twoMeans = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Caller.aplf': '∇R←Caller X\n R←Mean X\n R←#.Stats.Mean X\n∇\n',
  'Finance/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Finance/Caller.aplf': '∇R←Caller X\n R←Mean X\n R←#.Finance.Mean X\n∇\n'
});
const twoProject = await ProjectModel.index([twoMeans]);
const statsCaller = path.join(twoMeans, 'Stats', 'Caller.aplf');

result = await referencesAt(
  twoProject,
  statsCaller,
  '∇R←Caller X\n R←Me⎸an X\n R←#.Stats.Mean X\n∇\n'
);
const statsShape = shape(result, twoMeans);
check(
  '#.Stats.Mean finds only the Stats uses and its own declaration',
  statsShape.join(' ') === 'Stats/Caller.aplf:1:3 Stats/Caller.aplf:2:11 Stats/Mean.aplf:0:3',
  statsShape.join(' ')
);
check(
  'no Finance occurrence is included, though the spelling is identical',
  !statsShape.some(s => s.startsWith('Finance/')),
  statsShape.join(' ')
);

const financeCaller = path.join(twoMeans, 'Finance', 'Caller.aplf');
result = await referencesAt(
  twoProject,
  financeCaller,
  '∇R←Caller X\n R←Me⎸an X\n R←#.Finance.Mean X\n∇\n'
);
const financeShape = shape(result, twoMeans);
check(
  '#.Finance.Mean finds only the Finance uses',
  financeShape.join(' ') === 'Finance/Caller.aplf:1:3 Finance/Caller.aplf:2:13 Finance/Mean.aplf:0:3',
  financeShape.join(' ')
);
check(
  'the two result sets are disjoint',
  statsShape.every(s => !financeShape.includes(s))
);

// ------------------------------------------------------------ other forms

section('relative and parent qualification');

const nested = await fixture({
  'A/B/Target.aplf': '∇R←Target X\n R←##.Caller X\n∇\n',
  'A/Caller.aplf': '∇R←Caller X\n R←B.Target X\n R←X\n∇\n',
  'A/Second.aplf': '∇R←Second X\n R←B.Target X\n∇\n'
});
const nestedProject = await ProjectModel.index([nested]);
const nestedCaller = path.join(nested, 'A', 'Caller.aplf');

result = await referencesAt(
  nestedProject,
  nestedCaller,
  '∇R←Caller X\n R←B.Targ⎸et X\n R←X\n∇\n'
);
check(
  'a relative B.Target reference finds both callers and the declaration',
  shape(result, nested).join(' ') ===
    'A/B/Target.aplf:0:3 A/Caller.aplf:1:5 A/Second.aplf:1:5',
  shape(result, nested).join(' ')
);

const targetFile = path.join(nested, 'A', 'B', 'Target.aplf');
result = await referencesAt(nestedProject, targetFile, '∇R←Target X\n R←##.Call⎸er X\n∇\n');
check(
  '##.Caller resolves to the parent namespace object and finds its declaration',
  shape(result, nested).includes('A/Caller.aplf:0:3'),
  shape(result, nested).join(' ')
);

section('bare names in the same Link namespace');

result = await referencesAt(
  nestedProject,
  nestedCaller,
  '∇R←Caller X\n R←Second X\n R←X\n∇\n'.replace('Second', 'Seco⎸nd')
);
check(
  'a bare sibling reference finds the sibling declaration',
  shape(result, nested).includes('A/Second.aplf:0:3'),
  shape(result, nested).join(' ')
);

section('same-file references');

const sameFileSource = [
  'Helper←{⍵+1}',
  '∇R←Main X',
  ' R←Help⎸er X',
  ' R←Helper R',
  '∇'
].join('\n');
result = await referencesAt(nestedProject, nestedCaller, sameFileSource);
check(
  'a dfn defined and used in one file finds all three occurrences',
  shape(result, nested).join(' ') === 'A/Caller.aplf:0:0 A/Caller.aplf:2:3 A/Caller.aplf:3:3',
  shape(result, nested).join(' ')
);

// --------------------------------------------------------- what must not count

section('local binding stops false project references');

const shadowed = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'UsesArgument.aplf': '∇R←UsesArgument Mean\n R←Mean+1\n∇\n',
  'UsesLocal.aplf': '∇R←UsesLocal X;Mean\n Mean←1\n R←Mean\n∇\n',
  'RealUser.aplf': '∇R←RealUser X\n R←Mean X\n∇\n'
});
const shadowProject = await ProjectModel.index([shadowed]);
const realUser = path.join(shadowed, 'RealUser.aplf');

result = await referencesAt(shadowProject, realUser, '∇R←RealUser X\n R←Me⎸an X\n∇\n');
const shadowShape = shape(result, shadowed);
check(
  'the genuine use and the declaration are found',
  shadowShape.includes('RealUser.aplf:1:3') && shadowShape.includes('Mean.aplf:0:3'),
  shadowShape.join(' ')
);
check(
  'a tradfn argument named Mean is not a reference',
  !shadowShape.some(s => s.startsWith('UsesArgument.aplf')),
  shadowShape.join(' ')
);
check(
  'a ;-localised Mean is not a reference',
  !shadowShape.some(s => s.startsWith('UsesLocal.aplf')),
  shadowShape.join(' ')
);

section('comments and character literals');

const noisy = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Noisy.aplf': [
    '∇R←Noisy X',
    ' ⍝ Mean is slow',
    " msg←'Mean'",
    " msg←'call Mean twice: Mean'",
    ' R←Mean X',
    '∇'
  ].join('\n')
});
const noisyProject = await ProjectModel.index([noisy]);
result = await referencesAt(
  noisyProject,
  path.join(noisy, 'Noisy.aplf'),
  ['∇R←Noisy X', ' ⍝ Mean is slow', " msg←'Mean'", " msg←'call Mean twice: Mean'", ' R←Me⎸an X', '∇'].join('\n')
);
const noisyShape = shape(result, noisy);
check(
  'only the real use and the declaration are returned',
  noisyShape.join(' ') === 'Mean.aplf:0:3 Noisy.aplf:4:3',
  noisyShape.join(' ')
);
check(
  'nothing from the comment line',
  !noisyShape.some(s => s.startsWith('Noisy.aplf:1:')),
  noisyShape.join(' ')
);
check(
  'nothing from either character literal',
  !noisyShape.some(s => s.startsWith('Noisy.aplf:2:') || s.startsWith('Noisy.aplf:3:')),
  noisyShape.join(' ')
);

section('a same-spelling occurrence that cannot be proved');

// Unrelated/Mean.aplf defines a different #.Unrelated.Mean, and Unrelated/User
// refers to that one. Neither may appear in results for the root #.Mean.
const unprovable = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n',
  'Unrelated/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Unrelated/User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const unprovableProject = await ProjectModel.index([unprovable]);
result = await referencesAt(
  unprovableProject,
  path.join(unprovable, 'User.aplf'),
  '∇R←User X\n R←Me⎸an X\n∇\n'
);
check(
  'only the root Mean and its user are returned',
  shape(result, unprovable).join(' ') === 'Mean.aplf:0:3 User.aplf:1:3',
  shape(result, unprovable).join(' ')
);
check(
  'the identically spelled Unrelated.Mean and its user are excluded',
  !shape(result, unprovable).some(s => s.startsWith('Unrelated/')),
  'this is the evidence that resolution, not spelling, decides'
);

section('names that merely contain the target spelling');

const boundaries = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'MeanValue.aplf': '∇R←MeanValue X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←MeanValue X\n R←PreMean X\n R←Mean_2 X\n R←Mean X\n∇\n'
});
const boundaryProject = await ProjectModel.index([boundaries]);
result = await referencesAt(
  boundaryProject,
  path.join(boundaries, 'User.aplf'),
  ['∇R←User X', ' R←MeanValue X', ' R←PreMean X', ' R←Mean_2 X', ' R←Me⎸an X', '∇'].join('\n')
);
check(
  'only the whole-name occurrence counts',
  shape(result, boundaries).join(' ') === 'Mean.aplf:0:3 User.aplf:4:3',
  shape(result, boundaries).join(' ')
);
check(
  'MeanValue, PreMean and Mean_2 are not references to Mean',
  !shape(result, boundaries).some(s => s.startsWith('MeanValue.aplf')) &&
    !shape(result, boundaries).some(s => ['User.aplf:1:3', 'User.aplf:2:3', 'User.aplf:3:3'].includes(s)),
  shape(result, boundaries).join(' ')
);

section('an ambiguous target yields nothing');

const ambiguous = await fixture({
  'Thing.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Thing.apln': ':Namespace Thing\n:EndNamespace\n',
  'User.aplf': '∇R←User X\n R←Thing X\n∇\n'
});
const ambiguousProject = await ProjectModel.index([ambiguous]);
result = await referencesAt(
  ambiguousProject,
  path.join(ambiguous, 'User.aplf'),
  '∇R←User X\n R←Thi⎸ng X\n∇\n'
);
check(
  'two files defining one name gives no references at all',
  result.locations.length === 0 && result.target === undefined,
  shape(result, ambiguous).join(' ')
);

section('array source is not scanned');

const withArray = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Notes.mat.apla': 'Mean Mean Mean\nMean\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const arrayProject = await ProjectModel.index([withArray]);
result = await referencesAt(
  arrayProject,
  path.join(withArray, 'User.aplf'),
  '∇R←User X\n R←Me⎸an X\n∇\n'
);
check(
  'plain-text array data contributes no references',
  shape(result, withArray).join(' ') === 'Mean.aplf:0:3 User.aplf:1:3',
  shape(result, withArray).join(' ')
);

// ------------------------------------------------------------- environment

section('workspace roots stay separate');

const rootOne = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const rootTwo = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const twoRoots = await ProjectModel.index([rootOne, rootTwo]);
result = await referencesAt(
  twoRoots,
  path.join(rootOne, 'User.aplf'),
  '∇R←User X\n R←Me⎸an X\n∇\n'
);
check(
  'only the first root contributes',
  result.locations.every(l => l.file.startsWith(rootOne)),
  result.locations.map(l => l.file).join(' ')
);
check('and it found both occurrences there', result.locations.length === 2);

section('no workspace at all');

const noProject = await ProjectModel.index([]);
const lone = path.join(os.tmpdir(), 'apl-references-lone.aplf');
result = await referencesAt(
  noProject,
  lone,
  ['Sq←{⍵*2}', 'a←S⎸q 4', 'b←Sq 5'].join('\n')
);
check(
  'same-file references still work with no project',
  result.locations.length === 3,
  shape(result, os.tmpdir()).join(' ')
);
check(
  'an untitled document with no path still works',
  (await referencesAt(noProject, undefined, ['Sq←{⍵*2}', 'a←S⎸q 4'].join('\n'))).locations.length === 2
);

section('live buffers beat what is on disk');

// Disk has one use; the editor holds a version with a second one added.
const liveTree = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const liveProject = await ProjectModel.index([liveTree]);
const liveUser = path.join(liveTree, 'User.aplf');
const editedUser = '∇R←User X\n ⍝ inserted, unsaved\n R←Mean X\n R←Mean R\n∇\n';

result = await referencesAt(
  liveProject,
  path.join(liveTree, 'Mean.aplf'),
  '∇R←Me⎸an X\n R←X\n∇\n',
  { liveText: file => (file === liveUser ? editedUser : undefined) }
);
const liveShape = shape(result, liveTree);
check(
  'the unsaved extra reference is found',
  liveShape.filter(s => s.startsWith('User.aplf')).length === 2,
  liveShape.join(' ')
);
check(
  'and at the lines the buffer has, not the ones on disk',
  liveShape.includes('User.aplf:2:3') && liveShape.includes('User.aplf:3:3'),
  `${liveShape.join(' ')} — on disk the only use is line 1`
);

section('several references on one line');

const oneLine = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Triple.aplf': '∇R←Triple X\n R←(Mean X)+(Mean X)+(Mean X)\n∇\n'
});
const oneLineProject = await ProjectModel.index([oneLine]);
result = await referencesAt(
  oneLineProject,
  path.join(oneLine, 'Triple.aplf'),
  '∇R←Triple X\n R←(Me⎸an X)+(Mean X)+(Mean X)\n∇\n'
);
check(
  'all three occurrences on the line are reported at their own columns',
  shape(result, oneLine).join(' ') ===
    'Mean.aplf:0:3 Triple.aplf:1:4 Triple.aplf:1:13 Triple.aplf:1:22',
  shape(result, oneLine).join(' ')
);

// ------------------------------------------------------------- performance

section('a larger project');

const many = { 'Core/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' };
let expectedUses = 0;
for (let i = 0; i < 150; i++) {
  // A third of the files genuinely use it; the rest merely mention the spelling
  // somewhere it cannot count.
  if (i % 3 === 0) {
    many[`Core/User${i}.aplf`] = `∇R←User${i} X\n R←Mean X\n∇\n`;
    expectedUses++;
  } else if (i % 3 === 1) {
    many[`Core/Comment${i}.aplf`] = `∇R←Comment${i} X\n ⍝ Mean goes here\n R←X\n∇\n`;
  } else {
    many[`Elsewhere/Other${i}.aplf`] = `∇R←Other${i} X\n R←Mean X\n∇\n`;
  }
}
const bigTree = await fixture(many);
const bigProject = await ProjectModel.index([bigTree]);
const started = process.hrtime.bigint();
result = await referencesAt(
  bigProject,
  path.join(bigTree, 'Core', 'Mean.aplf'),
  '∇R←Me⎸an X\n R←X\n∇\n'
);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
check(
  `exactly the ${expectedUses} real uses plus the declaration (${elapsedMs.toFixed(0)} ms)`,
  result.locations.length === expectedUses + 1,
  `got ${result.locations.length}, expected ${expectedUses + 1}`
);
check(
  'the commented mentions contributed nothing',
  !result.locations.some(l => l.file.includes('Comment'))
);
check(
  'and the Elsewhere namespace, which has its own scope, contributed nothing',
  !result.locations.some(l => l.file.includes('Elsewhere')),
  'a bare Mean in #.Elsewhere does not resolve to #.Core.Mean'
);
check(
  `it completed without pathological behaviour (${elapsedMs.toFixed(0)} ms)`,
  elapsedMs < 30000,
  `took ${elapsedMs.toFixed(0)} ms`
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} reference checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} reference checks passed.`);
