/**
 * Tests for workspace/symbol search.
 * Run with: npm run workspace
 *
 * The decisive ones are deduplication — one definition known through both the
 * project model and source extraction must appear once — and container identity,
 * which is what keeps two `Mean`s in different namespaces apart.
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

let ProjectModel, findWorkspaceSymbols, matchesQuery;
try {
  ({ ProjectModel } = require(path.join(root, 'out', 'analysis', 'project.js')));
  ({ findWorkspaceSymbols, matchesQuery } = require(
    path.join(root, 'out', 'analysis', 'workspace-symbols.js')
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-workspace-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

const search = (project, query = '', options = {}) =>
  findWorkspaceSymbols({ project, query, ...options });

/** "qualifiedName:kind" for compact assertions. */
const shape = entries => entries.map(e => `${e.qualifiedName}:${e.kind}`);
/** "qualifiedName@file:line:char" for location assertions. */
const located = (entries, base) =>
  entries.map(
    e =>
      `${e.qualifiedName}@${path.relative(base, e.file).split(path.sep).join('/')}` +
      `:${e.selectionRange.start.line}:${e.selectionRange.start.character}`
  );

// ------------------------------------------------------------ Link objects

section('Link-backed project objects');

const basic = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Twice.aplo': '∇R←(LO Twice)Y\n R←LO LO Y\n∇\n',
  'Widget.aplc': ':Class Widget\n:EndClass\n',
  'IThing.apli': ':Interface IThing\n:EndInterface\n',
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n',
  'Table.apla': '⍬\n',
  'README.md': '# not source\n'
});
let project = await ProjectModel.index([basic]);
let results = await search(project);

check(
  'every object type is searchable, with a truthful kind',
  shape(results).join(' ') ===
    '#.IThing:interface #.Stats.Mean:function #.Stats.Twice:operator #.Table:array ' +
      '#.Utils:namespace #.Widget:class',
  shape(results).join(' ')
);
check('README.md contributes nothing', !JSON.stringify(results).includes('README'));
check(
  'a top-level object is contained by its namespace',
  results.find(e => e.name === 'Mean')?.containerName === '#.Stats',
  JSON.stringify(results.find(e => e.name === 'Mean'))
);
check(
  'a root object is contained by #',
  results.find(e => e.name === 'Widget')?.containerName === '#'
);
check(
  'navigation lands on the declaration name, not line 0',
  located(results, basic).includes('#.Stats.Mean@Stats/Mean.aplf:0:3'),
  located(results, basic).join(' ')
);
check(
  'an operator points at the operator name inside its parentheses',
  located(results, basic).includes('#.Stats.Twice@Stats/Twice.aplo:0:7'),
  located(results, basic).join(' ')
);

section('deduplication');

check(
  'Mean.aplf yields exactly one symbol, not one per source of truth',
  results.filter(e => e.name === 'Mean').length === 1,
  JSON.stringify(results.filter(e => e.name === 'Mean'))
);
check(
  'and the same for every scripted object',
  ['Widget', 'IThing', 'Utils', 'Twice'].every(
    name => results.filter(e => e.name === name).length === 1
  ),
  shape(results).join(' ')
);

section('filename-derived objects');

const bareDfn = await fixture({ 'Sum.aplf': '{+/⍵}\n' });
results = await search(await ProjectModel.index([bareDfn]));
check(
  'a bare dfn is still searchable through its file identity',
  shape(results).join(' ') === '#.Sum:function',
  shape(results).join(' ')
);
check(
  'and points at the start of the file, since it declares no name',
  results[0].selectionRange.start.line === 0 && results[0].selectionRange.start.character === 0,
  JSON.stringify(results[0].selectionRange)
);

// ------------------------------------------------------ nested definitions

section('definitions inside scripted objects');

const nested = await fixture({
  'Widget.aplc': [
    ':Class Widget',
    '',
    '    Render←{⍵}',
    '',
    '    ∇Resize X',
    '     X',
    '    ∇',
    '',
    '    ∇R←(LO Apply)Y',
    '     R←LO Y',
    '    ∇',
    '',
    ':EndClass'
  ].join('\n')
});
const nestedProject = await ProjectModel.index([nested]);
results = await search(nestedProject);
check(
  'the class and all three members are searchable',
  shape(results).join(' ') ===
    '#.Widget:class #.Widget.Apply:operator #.Widget.Render:function #.Widget.Resize:function',
  shape(results).join(' ')
);
check(
  'members are contained by the class',
  results.filter(e => e.name !== 'Widget').every(e => e.containerName === '#.Widget'),
  JSON.stringify(results.map(e => [e.name, e.containerName]))
);
check(
  'the class itself appears once, not twice',
  results.filter(e => e.name === 'Widget').length === 1
);

const deep = await fixture({
  'Outer.apln': [
    ':Namespace Outer',
    '    :Namespace Inner',
    '        Helper←{⍵}',
    '    :EndNamespace',
    ':EndNamespace'
  ].join('\n')
});
results = await search(await ProjectModel.index([deep]));
check(
  'nesting qualifies arbitrarily deep',
  shape(results).join(' ') ===
    '#.Outer:namespace #.Outer.Inner:namespace #.Outer.Inner.Helper:function',
  shape(results).join(' ')
);
check(
  'and the deepest member names its immediate container',
  results.find(e => e.name === 'Helper')?.containerName === '#.Outer.Inner',
  JSON.stringify(results.find(e => e.name === 'Helper'))
);

section('generic source files');

const generic = await fixture({
  'Legacy.dyalog': [
    ':Namespace Legacy',
    '    First←{⍵}',
    '    ∇Second X',
    '     X',
    '    ∇',
    ':EndNamespace'
  ].join('\n')
});
results = await search(await ProjectModel.index([generic]));
check(
  'a .dyalog script and its definitions are all searchable',
  shape(results).join(' ') ===
    '#.Legacy:namespace #.Legacy.First:function #.Legacy.Second:function',
  shape(results).join(' ')
);

// ------------------------------------------------------ same name elsewhere

section('the same simple name in two namespaces');

const twoMeans = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Finance/Mean.aplf': '∇R←Mean X\n R←X\n∇\n'
});
results = await search(await ProjectModel.index([twoMeans]), 'mean');
check('both appear', results.length === 2, shape(results).join(' '));
check(
  'and are distinguished by containerName',
  results.map(e => e.containerName).sort().join(' ') === '#.Finance #.Stats',
  JSON.stringify(results.map(e => [e.name, e.containerName]))
);
check(
  'both keep the simple name the source spells',
  results.every(e => e.name === 'Mean')
);
check(
  'and point at different files',
  new Set(results.map(e => e.file)).size === 2
);

// ----------------------------------------------------------------- queries

section('query matching');

const queries = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/GeometricMean.aplf': '∇R←GeometricMean X\n R←X\n∇\n',
  'Other/Total.aplf': '∇R←Total X\n R←X\n∇\n'
});
const queryProject = await ProjectModel.index([queries]);

check(
  'an empty query returns everything, sorted',
  shape(await search(queryProject, '')).join(' ') ===
    '#.Other.Total:function #.Stats.GeometricMean:function #.Stats.Mean:function',
  shape(await search(queryProject, '')).join(' ')
);
check(
  'a substring matches by simple name',
  shape(await search(queryProject, 'mean')).join(' ') ===
    '#.Stats.GeometricMean:function #.Stats.Mean:function',
  shape(await search(queryProject, 'mean')).join(' ')
);
check(
  'matching is case-insensitive',
  shape(await search(queryProject, 'MEAN')).join(' ') ===
    shape(await search(queryProject, 'mean')).join(' ')
);
check(
  'but the returned spelling is the source spelling',
  (await search(queryProject, 'MEAN')).every(e => /Mean$/.test(e.name))
);
check(
  'a container name matches everything in it',
  shape(await search(queryProject, 'stats')).join(' ') ===
    '#.Stats.GeometricMean:function #.Stats.Mean:function',
  shape(await search(queryProject, 'stats')).join(' ')
);
check(
  'a query matching nothing returns nothing',
  (await search(queryProject, 'xyz-no-match')).length === 0
);
check(
  'whitespace-only queries behave like empty ones',
  (await search(queryProject, '   ')).length === 3
);
check(
  'matchesQuery is exposed and agrees',
  matchesQuery({ name: 'Mean', qualifiedName: '#.Stats.Mean' }, 'STAT') === true &&
    matchesQuery({ name: 'Mean', qualifiedName: '#.Stats.Mean' }, 'zzz') === false
);

section('ordering is deterministic, not filesystem order');

const unsorted = await fixture({
  'Zeta/Alpha.aplf': '∇R←Alpha X\n R←X\n∇\n',
  'Alpha/Zeta.aplf': '∇R←Zeta X\n R←X\n∇\n',
  'Alpha/Alpha.aplf': '∇R←Alpha X\n R←X\n∇\n',
  'Middle/Beta.aplf': '∇R←Beta X\n R←X\n∇\n'
});
const unsortedProject = await ProjectModel.index([unsorted]);
const firstRun = shape(await search(unsortedProject));
check(
  'sorted by qualified name',
  firstRun.join(' ') ===
    '#.Alpha.Alpha:function #.Alpha.Zeta:function #.Middle.Beta:function #.Zeta.Alpha:function',
  firstRun.join(' ')
);
check(
  'and repeating the search gives the same order',
  shape(await search(unsortedProject)).join(' ') === firstRun.join(' ')
);

// ------------------------------------------------- what must not appear

section('comments, strings and ordinary assignments');

const noise = await fixture({
  'Real.apln': [
    ':Namespace Real',
    '    ⍝ Fake←{⍵}',
    "    text←':Class AlsoFake'",
    '    x←1',
    '    nums←1 2 3',
    '    Genuine←{⍵}',
    ':EndNamespace'
  ].join('\n')
});
results = await search(await ProjectModel.index([noise]));
check(
  'only the namespace and the real dfn appear',
  shape(results).join(' ') === '#.Real:namespace #.Real.Genuine:function',
  shape(results).join(' ')
);
for (const ghost of ['Fake', 'AlsoFake', 'x', 'nums', 'text']) {
  check(`${ghost} is not a workspace symbol`, !results.some(e => e.name === ghost));
}

section('array data is not parsed as source');

const withArray = await fixture({
  'Notes.mat.apla': 'Mean Mean\n∇R←Ghost X\nGhostDfn←{⍵}\n',
  'Real.aplf': '∇R←Real X\n R←X\n∇\n'
});
results = await search(await ProjectModel.index([withArray]));
check(
  'the array object is searchable but its contents are not',
  shape(results).join(' ') === '#.Notes:array #.Real:function',
  shape(results).join(' ')
);
check(
  'nothing was invented from the array text',
  !results.some(e => ['Ghost', 'GhostDfn', 'Mean'].includes(e.name)),
  shape(results).join(' ')
);

section('MiServer pages are indexed but not parsed');

// .mipage is markup with APL embedded, not ordinary APL source. Link lists it as
// a code extension, so the object is real and searchable; tokenising its markup
// as APL would invent definitions out of prose.
const withPage = await fixture({
  'Home.mipage': '<html>\n∇R←Ghost X\nGhostDfn←{⍵}\n</html>\n',
  'Real.aplf': '∇R←Real X\n R←X\n∇\n'
});
results = await search(await ProjectModel.index([withPage]));
check(
  'the page object itself is searchable',
  results.some(e => e.qualifiedName === '#.Home'),
  shape(results).join(' ')
);
check(
  'but nothing is extracted from its markup',
  !results.some(e => ['Ghost', 'GhostDfn'].includes(e.name)),
  shape(results).join(' ')
);
check(
  'so exactly the page and the real function appear',
  shape(results).join(' ') === '#.Home:code #.Real:function',
  shape(results).join(' ')
);

section('unscripted namespaces are omitted, deliberately');

const directories = await fixture({ 'Stats/Deep/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' });
results = await search(await ProjectModel.index([directories]));
check(
  'a directory-backed namespace produces no symbol of its own',
  shape(results).join(' ') === '#.Stats.Deep.Mean:function',
  `${shape(results).join(' ')} — a directory has no source position to navigate to`
);
check(
  'but it still qualifies what is inside it',
  results[0].containerName === '#.Stats.Deep',
  results[0].containerName
);

section('ambiguous project objects produce nothing');

const ambiguous = await fixture({
  'Thing.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Thing.apln': ':Namespace Thing\n:EndNamespace\n',
  'Fine.aplf': '∇R←Fine X\n R←X\n∇\n'
});
results = await search(await ProjectModel.index([ambiguous]));
check(
  'a name defined by two files is not offered at all',
  shape(results).join(' ') === '#.Fine:function',
  `${shape(results).join(' ')} — Link treats two files for one name as an error`
);

// ------------------------------------------------------------ environment

section('multiple workspace roots');

const rootA = await fixture({ 'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' });
const rootB = await fixture({ 'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' });
const twoRoots = await ProjectModel.index([rootA, rootB]);
results = await search(twoRoots, 'mean');
check(
  'the same qualified name in two roots gives two results',
  results.length === 2,
  JSON.stringify(results.map(e => e.file))
);
check(
  'they are not merged into one',
  new Set(results.map(e => e.file)).size === 2
);
check(
  'and each points into its own root',
  results.some(e => e.file.startsWith(rootA)) && results.some(e => e.file.startsWith(rootB))
);

section('no workspace');

const empty = await ProjectModel.index([]);
check('an empty project returns no symbols', (await search(empty)).length === 0);
check('and does not throw on a query', (await search(empty, 'anything')).length === 0);

// ------------------------------------------------------------ live buffers

section('live buffers');

const live = await fixture({
  'Helpers.apln': ':Namespace Helpers\n    OldHelper←{⍵}\n:EndNamespace\n'
});
const liveProject = await ProjectModel.index([live]);
const helpersFile = path.join(live, 'Helpers.apln');

results = await search(liveProject);
check(
  'on disk the member is OldHelper',
  shape(results).join(' ') === '#.Helpers:namespace #.Helpers.OldHelper:function',
  shape(results).join(' ')
);

// A declaration moved down by an unsaved edit.
const moved = ':Namespace Helpers\n\n    ⍝ inserted, unsaved\n    OldHelper←{⍵}\n:EndNamespace\n';
results = await search(liveProject, '', {
  liveText: file => (file === helpersFile ? moved : undefined)
});
check(
  'a moved declaration is found at its buffer position',
  results.find(e => e.name === 'OldHelper')?.selectionRange.start.line === 3,
  `${JSON.stringify(results.find(e => e.name === 'OldHelper')?.selectionRange)} — on disk it is line 1`
);

// A member renamed but not saved.
const renamed = ':Namespace Helpers\n    NewHelper←{⍵}\n:EndNamespace\n';
results = await search(liveProject, '', {
  liveText: file => (file === helpersFile ? renamed : undefined)
});
check(
  'a member renamed in the buffer is found under its new name',
  shape(results).join(' ') === '#.Helpers:namespace #.Helpers.NewHelper:function',
  shape(results).join(' ')
);
check(
  'and the old name is no longer returned',
  !results.some(e => e.name === 'OldHelper'),
  shape(results).join(' ')
);
check(
  'while the project object identity still comes from the filesystem',
  results.some(e => e.qualifiedName === '#.Helpers'),
  'an unsaved edit does not invent or remove a Link object'
);

// ------------------------------------------------------------ performance

section('a larger workspace');

const many = {};
let expectedMeanMatches = 0;
for (let n = 0; n < 240; n++) {
  const namespace = `Ns${n % 8}`;
  if (n % 4 === 0) {
    many[`${namespace}/Mean${n}.aplf`] = `∇R←Mean${n} X\n R←X\n∇\n`;
    expectedMeanMatches++;
  } else if (n % 4 === 1) {
    many[`${namespace}/Op${n}.aplo`] = `∇R←(LO Op${n})Y\n R←LO Y\n∇\n`;
  } else if (n % 4 === 2) {
    many[`${namespace}/Cls${n}.aplc`] = `:Class Cls${n}\n    Inner${n}←{⍵}\n:EndClass\n`;
  } else {
    many[`${namespace}/Fn${n}.aplf`] = `∇R←Fn${n} X\n R←X\n∇\n`;
  }
}
const big = await fixture(many);
const bigProject = await ProjectModel.index([big]);
const started = process.hrtime.bigint();
const all = await search(bigProject);
const meanOnly = await search(bigProject, 'mean');
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

// 240 objects plus one Inner per class file.
check(
  `all 240 objects and 60 class members are catalogued (${elapsedMs.toFixed(0)} ms)`,
  all.length === 300,
  `got ${all.length}`
);
check(
  `the query returns exactly the ${expectedMeanMatches} matching functions`,
  meanOnly.length === expectedMeanMatches,
  `got ${meanOnly.length}`
);
check(
  'and it completed without pathological behaviour',
  elapsedMs < 30000,
  `took ${elapsedMs.toFixed(0)} ms`
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} workspace symbol checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} workspace symbol checks passed.`);
