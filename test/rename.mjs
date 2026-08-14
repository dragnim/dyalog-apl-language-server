/**
 * Tests for prepareRename and rename.
 * Run with: npm run rename
 *
 * The important ones are the refusals. A rename that edits the wrong occurrence
 * silently corrupts a project, so most of what follows checks that the server
 * declines rather than guesses.
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

let ProjectModel, encodeCaseCode, decodeCaseCode, planRename, computeRename, isRefusal;
try {
  ({ ProjectModel, encodeCaseCode, decodeCaseCode } = require(
    path.join(root, 'out', 'analysis', 'project.js')
  ));
  ({ planRename, computeRename, isRefusal } = require(
    path.join(root, 'out', 'analysis', 'rename.js')
  ));
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-rename-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

function cursorOf(source) {
  const lines = source.split('\n');
  const line = lines.findIndex(l => l.includes('⎸'));
  if (line === -1) throw new Error('the fixture has no ⎸ cursor marker');
  return { line, character: lines[line].indexOf('⎸'), text: source.replace('⎸', '') };
}

async function prepare(project, file, source, options = {}) {
  const { line, character, text } = cursorOf(source);
  return planRename({ text, file, position: { line, character }, project, ...options });
}

async function rename(project, file, source, newName, options = {}) {
  const { line, character, text } = cursorOf(source);
  return computeRename({
    text,
    file,
    position: { line, character },
    project,
    newName,
    ...options
  });
}

/** Compact "relative:line:char→new" form. */
const shape = (result, base) =>
  result.edits.map(e =>
    `${e.file === undefined ? '<cur>' : path.relative(base, e.file).split(path.sep).join('/')}` +
    `:${e.range.start.line}:${e.range.start.character}-${e.range.end.character}→${e.newText}`
  );

// -------------------------------------------------------------- case codes

section('case code round trip (docs/API/Link.CaseCode.md)');

check(
  'HelloWorld encodes to HelloWorld-41, as documented',
  encodeCaseCode('HelloWorld') === 'HelloWorld-41',
  encodeCaseCode('HelloWorld')
);
check('FOO encodes to FOO-7, as documented', encodeCaseCode('FOO') === 'FOO-7', encodeCaseCode('FOO'));
for (const name of ['HelloWorld', 'FOO', 'mean', 'Average', 'aBcDeF']) {
  check(
    `${name} survives encode then decode`,
    decodeCaseCode(encodeCaseCode(name)).name === name,
    `got ${decodeCaseCode(encodeCaseCode(name)).name}`
  );
}

// ------------------------------------------------------------ prepareRename

section('prepareRename accepts a real definition');

const stats = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/CallerA.aplf': '∇R←CallerA X\n R←#.Stats.Mean X\n R←Mean R\n∇\n',
  'Stats/CallerB.aplf': '∇R←CallerB X\n R←#.Stats.Mean X\n∇\n',
  'Stats/Sum.aplf': '{+/⍵}\n',
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n'
});
let project = await ProjectModel.index([stats]);
const meanFile = path.join(stats, 'Stats', 'Mean.aplf');
const callerA = path.join(stats, 'Stats', 'CallerA.aplf');

let plan = await prepare(project, callerA, '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n');
check('a project reference is renameable', !isRefusal(plan), JSON.stringify(plan));
check(
  'the range covers only the final identifier',
  plan.range.start.character === 11 && plan.range.end.character === 15,
  JSON.stringify(plan.range)
);
check('the placeholder is the current name', plan.placeholder === 'Mean', plan.placeholder);
check('it reports the qualified object', plan.qualifiedName === '#.Stats.Mean', plan.qualifiedName);

plan = await prepare(project, meanFile, '∇R←Me⎸an X\n R←X\n∇\n');
check('so is the definition itself', !isRefusal(plan) && plan.placeholder === 'Mean');

section('prepareRename refuses what it cannot rename safely');

const refusals = [
  ['a comment', '∇R←CallerA X\n ⍝ Me⎸an is slow\n∇\n', 'no-name-at-cursor'],
  ['a character literal', "∇R←CallerA X\n t←'Me⎸an'\n∇\n", 'no-name-at-cursor'],
  // The marker sits immediately before ⍴, so the cursor is on the primitive.
  ['a primitive', '∇R←CallerA X\n R←⎸⍴X\n∇\n', 'no-name-at-cursor'],
  ['a system name', '∇R←CallerA X\n ⎕I⎸O←0\n∇\n', 'system-name'],
  ['a control word', '∇R←CallerA X\n :I⎸f 1\n :EndIf\n∇\n', 'control-word'],
  ['an unknown name', '∇R←CallerA X\n R←Nowhe⎸re X\n∇\n', 'unresolved'],
  ['a tradfn argument', '∇R←CallerA Me⎸an\n R←Mean\n∇\n', 'unresolved'],
  ['a ;-localised name', '∇R←CallerA X;Mean\n R←Me⎸an\n∇\n', 'unresolved']
];
for (const [label, source, expected] of refusals) {
  const outcome = await prepare(project, callerA, source);
  check(
    `${label} is refused (${expected})`,
    isRefusal(outcome) && outcome.refused === expected,
    JSON.stringify(outcome)
  );
}

// A bare dfn whose object name exists only as a filename.
const sumFile = path.join(stats, 'Stats', 'Sum.aplf');
let outcome = await prepare(project, callerA, '∇R←CallerA X\n R←Su⎸m X\n∇\n');
check(
  'a filename-derived object is refused, not half-renamed',
  isRefusal(outcome) && outcome.refused === 'no-source-name',
  JSON.stringify(outcome)
);
check(
  'and the refusal explains why',
  isRefusal(outcome) && /filename/.test(outcome.detail),
  isRefusal(outcome) ? outcome.detail : ''
);

// --------------------------------------------------------------- rename

section('renaming a project object');

let result = await rename(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n',
  'Average'
);
check('the rename is allowed', !isRefusal(result), JSON.stringify(result));
check(
  'every proven occurrence is edited and nothing else',
  shape(result, stats).join(' ') ===
    'Stats/CallerA.aplf:1:11-15→Average Stats/CallerA.aplf:2:3-7→Average ' +
      'Stats/CallerB.aplf:1:11-15→Average Stats/Mean.aplf:0:3-7→Average',
  shape(result, stats).join(' ')
);
check(
  'the qualified path keeps its qualifiers',
  result.edits.every(e => e.range.end.character - e.range.start.character === 4),
  'each edit replaces Mean only, never #.Stats.Mean'
);
check(
  'no file rename is offered when the client cannot perform one',
  result.fileRename === undefined
);

result = await rename(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n',
  'Average',
  { clientSupportsFileRename: true }
);
check(
  'a supporting client is offered the file rename too',
  result.fileRename?.oldFile === meanFile &&
    result.fileRename?.newFile === path.join(stats, 'Stats', 'Average.aplf'),
  JSON.stringify(result.fileRename)
);

section('renaming from the definition gives the same edits');

const fromDefinition = await rename(project, meanFile, '∇R←Me⎸an X\n R←X\n∇\n', 'Average');
check(
  'the same edit set either way',
  shape(fromDefinition, stats).join(' ') === shape(result, stats).join(' '),
  `${shape(fromDefinition, stats).join(' ')}\n         vs ${shape(result, stats).join(' ')}`
);

section('scripted objects');

result = await rename(project, callerA, '∇R←CallerA X\n R←#.Uti⎸ls\n∇\n', 'Helpers');
check(
  'a :Namespace declaration is renamed',
  !isRefusal(result) &&
    shape(result, stats).join(' ') ===
      'Stats/CallerA.aplf:1:5-10→Helpers Utils.apln:0:11-16→Helpers',
  isRefusal(result) ? JSON.stringify(result) : shape(result, stats).join(' ')
);

// ------------------------------------------------------- namespace isolation

section('same spelling in another namespace is untouched');

const twoMeans = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Caller.aplf': '∇R←Caller X\n R←Mean X\n∇\n',
  'Finance/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Finance/Caller.aplf': '∇R←Caller X\n R←Mean X\n∇\n'
});
const twoProject = await ProjectModel.index([twoMeans]);
result = await rename(
  twoProject,
  path.join(twoMeans, 'Stats', 'Caller.aplf'),
  '∇R←Caller X\n R←Me⎸an X\n∇\n',
  'Average'
);
check(
  'only the Stats definition and its use are edited',
  shape(result, twoMeans).join(' ') ===
    'Stats/Caller.aplf:1:3-7→Average Stats/Mean.aplf:0:3-7→Average',
  shape(result, twoMeans).join(' ')
);
check(
  'nothing in Finance is edited, though the spelling is identical',
  !shape(result, twoMeans).some(s => s.startsWith('Finance/')),
  shape(result, twoMeans).join(' ')
);

// --------------------------------------------------------- local shadowing

section('locals are not renamed');

const shadowed = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'UsesArgument.aplf': '∇R←UsesArgument Mean\n R←Mean+1\n∇\n',
  'UsesLocal.aplf': '∇R←UsesLocal X;Mean\n Mean←1\n R←Mean\n∇\n',
  'RealUser.aplf': '∇R←RealUser X\n R←Mean X\n∇\n'
});
const shadowProject = await ProjectModel.index([shadowed]);
result = await rename(
  shadowProject,
  path.join(shadowed, 'RealUser.aplf'),
  '∇R←RealUser X\n R←Me⎸an X\n∇\n',
  'Average'
);
const shadowShape = shape(result, shadowed);
check(
  'the real use and the declaration are edited',
  shadowShape.includes('RealUser.aplf:1:3-7→Average') &&
    shadowShape.includes('Mean.aplf:0:3-7→Average'),
  shadowShape.join(' ')
);
check(
  'the tradfn argument named Mean is left alone',
  !shadowShape.some(s => s.startsWith('UsesArgument.aplf')),
  shadowShape.join(' ')
);
check(
  'the ;-localised Mean is left alone',
  !shadowShape.some(s => s.startsWith('UsesLocal.aplf')),
  shadowShape.join(' ')
);

// ------------------------------------------------------ comments and strings

section('comments and character literals are never edited');

const noisy = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Noisy.aplf': [
    '∇R←Noisy X',
    ' ⍝ Mean is slow',
    " msg←'Mean'",
    ' R←Mean X',
    '∇'
  ].join('\n')
});
const noisyProject = await ProjectModel.index([noisy]);
result = await rename(
  noisyProject,
  path.join(noisy, 'Noisy.aplf'),
  ['∇R←Noisy X', ' ⍝ Mean is slow', " msg←'Mean'", ' R←Me⎸an X', '∇'].join('\n'),
  'Average'
);
check(
  'only the real reference and the declaration change',
  shape(result, noisy).join(' ') === 'Mean.aplf:0:3-7→Average Noisy.aplf:3:3-7→Average',
  shape(result, noisy).join(' ')
);

// ----------------------------------------------------------- same file

section('same-file rename');

const sameFileSource = [
  'Helper←{⍵+1}',
  '∇R←Main X',
  ' R←Help⎸er X',
  ' R←Helper R',
  ' ⍝ Helper again',
  '∇'
].join('\n');
result = await rename(noisyProject, path.join(noisy, 'Noisy.aplf'), sameFileSource, 'Assist');
check(
  'the definition and both uses are edited, the comment is not',
  shape(result, noisy).join(' ') ===
    'Noisy.aplf:0:0-6→Assist Noisy.aplf:2:3-9→Assist Noisy.aplf:3:3-9→Assist',
  shape(result, noisy).join(' ')
);

section('several references on one line');

const oneLine = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Triple.aplf': '∇R←Triple X\n R←(Mean X)+(Mean X)+(Mean X)\n∇\n'
});
const oneLineProject = await ProjectModel.index([oneLine]);
result = await rename(
  oneLineProject,
  path.join(oneLine, 'Triple.aplf'),
  '∇R←Triple X\n R←(Me⎸an X)+(Mean X)+(Mean X)\n∇\n',
  'Avg'
);
check(
  'all three are edited at their own columns',
  shape(result, oneLine).join(' ') ===
    'Mean.aplf:0:3-7→Avg Triple.aplf:1:4-8→Avg Triple.aplf:1:13-17→Avg Triple.aplf:1:22-26→Avg',
  shape(result, oneLine).join(' ')
);
const tripleEdits = result.edits.filter(e => e.file?.endsWith('Triple.aplf'));
check(
  'and the edits on that line do not overlap',
  tripleEdits.every(
    (edit, index) =>
      index === 0 || tripleEdits[index - 1].range.end.character <= edit.range.start.character
  ),
  JSON.stringify(tripleEdits.map(e => e.range))
);

// ------------------------------------------------------------ new names

section('invalid replacement names are rejected');

for (const [bad, label] of [
  ['', 'empty'],
  [' ', 'a space'],
  ['Foo Bar', 'an embedded space'],
  [' Foo', 'a leading space'],
  ['Foo ', 'a trailing space'],
  ['1Foo', 'a leading digit'],
  ['Foo.Bar', 'a qualified name'],
  ['⎕IO', 'a system name'],
  ['+', 'a primitive'],
  ['Foo!', 'punctuation'],
  ['#', 'the root marker']
]) {
  const attempt = await rename(
    project,
    callerA,
    '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n',
    bad
  );
  check(
    `${JSON.stringify(bad)} (${label}) is rejected`,
    isRefusal(attempt) && attempt.refused === 'invalid-new-name',
    JSON.stringify(attempt)
  );
}

section('legal Dyalog names are accepted');

for (const good of ['Average', 'avg_2', 'A∆B', 'x⍙y', 'Café']) {
  const attempt = await rename(
    project,
    callerA,
    '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n',
    good
  );
  check(`${JSON.stringify(good)} is accepted`, !isRefusal(attempt), JSON.stringify(attempt));
}

const unchanged = await rename(
  project,
  callerA,
  '∇R←CallerA X\n R←#.Stats.Me⎸an X\n R←Mean R\n∇\n',
  'Mean'
);
check(
  'renaming to the same name is refused as unchanged',
  isRefusal(unchanged) && unchanged.refused === 'unchanged',
  JSON.stringify(unchanged)
);

// ------------------------------------------------------------ collisions

section('provable collisions are refused');

const colliding = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Average.aplf': '∇R←Average X\n R←X\n∇\n',
  'Stats/Caller.aplf': '∇R←Caller X\n R←Mean X\n∇\n'
});
const collideProject = await ProjectModel.index([colliding]);
outcome = await rename(
  collideProject,
  path.join(colliding, 'Stats', 'Caller.aplf'),
  '∇R←Caller X\n R←Me⎸an X\n∇\n',
  'Average'
);
check(
  'renaming onto an existing sibling object is refused',
  isRefusal(outcome) && outcome.refused === 'collision',
  JSON.stringify(outcome)
);
check(
  'and says what it would have clashed with',
  isRefusal(outcome) && /#\.Stats\.Average/.test(outcome.detail),
  isRefusal(outcome) ? outcome.detail : ''
);

outcome = await rename(
  collideProject,
  path.join(colliding, 'Stats', 'Caller.aplf'),
  '∇R←Caller X\n R←Me⎸an X\n∇\n',
  'Median'
);
check('a free name in the same namespace is allowed', !isRefusal(outcome), JSON.stringify(outcome));

// A second definition of the new name in the same file.
outcome = await rename(
  noisyProject,
  path.join(noisy, 'Noisy.aplf'),
  ['Helper←{⍵}', 'Assist←{⍵}', 'x←Help⎸er 1'].join('\n'),
  'Assist'
);
check(
  'a same-file definition collision is refused',
  isRefusal(outcome) && outcome.refused === 'collision',
  JSON.stringify(outcome)
);

// ------------------------------------------------------------ environment

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
result = await rename(
  twoRoots,
  path.join(rootOne, 'User.aplf'),
  '∇R←User X\n R←Me⎸an X\n∇\n',
  'Average'
);
check(
  'no edit lands in the other root',
  result.edits.every(e => e.file.startsWith(rootOne)),
  result.edits.map(e => e.file).join(' ')
);
check('and both occurrences in this root are edited', result.edits.length === 2);

section('no workspace');

const noProject = await ProjectModel.index([]);
const lone = path.join(os.tmpdir(), 'apl-rename-lone.aplf');
result = await rename(
  noProject,
  lone,
  ['Sq←{⍵*2}', 'a←S⎸q 4', 'b←Sq 5'].join('\n'),
  'Square'
);
check(
  'a same-file rename still works with no project',
  !isRefusal(result) && result.edits.length === 3,
  JSON.stringify(isRefusal(result) ? result : shape(result, os.tmpdir()))
);
check(
  'and offers no file rename, since there is no project object',
  !isRefusal(result) && result.fileRename === undefined
);
outcome = await rename(noProject, lone, 'R←#.Foo.B⎸ar 1\n', 'Baz');
check(
  'a project reference with no project is refused',
  isRefusal(outcome) && outcome.refused === 'unresolved',
  JSON.stringify(outcome)
);

section('live buffers');

const liveTree = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'User.aplf': '∇R←User X\n R←Mean X\n∇\n'
});
const liveProject = await ProjectModel.index([liveTree]);
const liveUser = path.join(liveTree, 'User.aplf');
const editedUser = '∇R←User X\n ⍝ inserted, unsaved\n R←Mean X\n R←Mean R\n∇\n';
result = await rename(
  liveProject,
  path.join(liveTree, 'Mean.aplf'),
  '∇R←Me⎸an X\n R←X\n∇\n',
  'Average',
  { liveText: file => (file === liveUser ? editedUser : undefined) }
);
const liveShape = shape(result, liveTree);
check(
  'the unsaved extra reference is edited too',
  liveShape.filter(s => s.startsWith('User.aplf')).length === 2,
  liveShape.join(' ')
);
check(
  'at the buffer positions, not the stale disk ones',
  liveShape.includes('User.aplf:2:3-7→Average') && liveShape.includes('User.aplf:3:3-7→Average'),
  `${liveShape.join(' ')} — on disk the only use is line 1`
);

section('caseCode filenames');

const cased = await fixture({
  '.linkconfig': '{\n  Settings: {\n    caseCode: 1,\n  },\n}\n',
  'HelloWorld-41.apln': ':Namespace HelloWorld\n:EndNamespace\n',
  'User.aplf': '∇R←User X\n R←HelloWorld\n∇\n'
});
const casedProject = await ProjectModel.index([cased]);
result = await rename(
  casedProject,
  path.join(cased, 'User.aplf'),
  '∇R←User X\n R←HelloWor⎸ld\n∇\n',
  'GoodBye',
  { clientSupportsFileRename: true }
);
check(
  'the new filename carries a correct case code',
  result.fileRename?.newFile === path.join(cased, `${encodeCaseCode('GoodBye')}.apln`),
  `${result.fileRename?.newFile} (expected ${encodeCaseCode('GoodBye')}.apln)`
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} rename checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} rename checks passed.`);
