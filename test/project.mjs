/**
 * Tests for the static ]Link project model in src/analysis/project.ts.
 * Run with: npm run project
 *
 * Everything here builds a real temporary directory tree and indexes it, rather
 * than depending on the shape of this repository. Paths are assembled with
 * node:path throughout, and names are chosen so that nothing passes merely
 * because Windows and macOS filesystems are case-insensitive.
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

let ProjectModel, identifyFile, decodeCaseCode, parseLinkConfig, isAplName;
try {
  ({ ProjectModel, identifyFile, decodeCaseCode, parseLinkConfig, isAplName } = require(
    path.join(root, 'out', 'analysis', 'project.js')
  ));
} catch (error) {
  console.error('out/analysis/project.js is missing. Run `npm run build` first.');
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

// ------------------------------------------------------------------ fixtures

const temporaries = [];

/** Builds a tree from a {relativePath: contents} description. */
async function fixture(tree) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-project-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

async function cleanup() {
  for (const dir of temporaries) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const names = model => model.objects().map(o => o.qualifiedName).sort();
const kinds = model =>
  model
    .objects()
    .map(o => `${o.qualifiedName}:${o.kind}`)
    .sort();

// ----------------------------------------------------------- filename rules

section('filename to object name');

const identities = [
  ['Mean.aplf', 'Mean', 'function'],
  ['Twice.aplo', 'Twice', 'operator'],
  ['Utils.apln', 'Utils', 'namespace'],
  ['Widget.aplc', 'Widget', 'class'],
  ['IThing.apli', 'IThing', 'interface'],
  ['Table.apla', 'Table', 'array'],
  ['Legacy.dyalog', 'Legacy', 'code'],
  ['Generic.apl', 'Generic', 'code'],
  ['Page.mipage', 'Page', 'code']
];
for (const [file, name, kind] of identities) {
  const identity = identifyFile(file);
  check(
    `${file} → ${name} (${kind})`,
    identity?.name === name && identity?.kind === kind,
    `got ${JSON.stringify(identity)}`
  );
}

// docs/Usage/Arrays.md: a plain-text array records its format in a
// sub-extension, so the object name is not simply basename-minus-last-extension.
section('array sub-extensions');
for (const sub of ['CR', 'LF', 'CRLF', 'vec', 'mat']) {
  const identity = identifyFile(`Table.${sub}.apla`);
  check(
    `Table.${sub}.apla → Table`,
    identity?.name === 'Table' && identity?.kind === 'array',
    `got ${JSON.stringify(identity)}`
  );
}
check(
  'an unknown sub-extension is not stripped, so the name is rejected',
  identifyFile('Table.zzz.apla') === undefined,
  `got ${JSON.stringify(identifyFile('Table.zzz.apla'))}`
);

section('case codes (docs/API/Link.CaseCode.md)');
check(
  "the documented example decodes: HelloWorld-41 → HelloWorld",
  decodeCaseCode('HelloWorld-41').name === 'HelloWorld',
  decodeCaseCode('HelloWorld-41').name
);
check(
  'FOO-7 decodes to FOO',
  decodeCaseCode('FOO-7').name === 'FOO',
  decodeCaseCode('FOO-7').name
);
check(
  'a case-coded filename yields the decoded object name',
  identifyFile('HelloWorld-41.apln')?.name === 'HelloWorld',
  JSON.stringify(identifyFile('HelloWorld-41.apln'))
);
check('a name with no code is left alone', decodeCaseCode('Mean').name === 'Mean');

section('files that are not project source');
for (const file of ['README.md', 'package.json', 'notes.txt', '.linkconfig', '.gitignore', 'Makefile', 'noext']) {
  check(`${file} is ignored`, identifyFile(file) === undefined, JSON.stringify(identifyFile(file)));
}
check(
  'a filename that cannot be an APL name is rejected',
  identifyFile('my-file.aplf') === undefined,
  JSON.stringify(identifyFile('my-file.aplf'))
);
check('APL name rules accept ∆ and ⍙', isAplName('a∆b⍙c') === true);
check('APL name rules reject a leading digit', isAplName('1abc') === false);

// -------------------------------------------------------------- basic trees

section('basic mapping');

const basic = await fixture({
  'Foo/Bar.aplf': '∇R←Bar X\n R←X\n∇\n',
  'README.md': '# not source\n'
});
let model = await ProjectModel.index([basic]);
check('one object is found', model.objects().length === 1, names(model).join(' '));
check('Foo/Bar.aplf → #.Foo.Bar', names(model).join('') === '#.Foo.Bar', names(model).join(' '));
check('README.md contributed nothing', !JSON.stringify(model.objects()).includes('README'));
check(
  'the namespace #.Foo exists',
  model.namespaces().some(n => n.qualifiedName === '#.Foo'),
  model.namespaces().map(n => n.qualifiedName).join(' ')
);
check(
  'the file resolves back to its qualified name',
  model.qualifiedNameForFile(path.join(basic, 'Foo', 'Bar.aplf')) === '#.Foo.Bar'
);
check(
  'the location records the real path',
  model.objectForFile(path.join(basic, 'Foo', 'Bar.aplf'))?.location.file ===
    path.join(basic, 'Foo', 'Bar.aplf')
);

section('nested namespaces');

const nested = await fixture({
  'Foo/Bar/Baz.aplf': '∇R←Baz X\n R←X\n∇\n',
  'Foo/Top.aplf': '∇R←Top X\n R←X\n∇\n'
});
model = await ProjectModel.index([nested]);
check(
  'deep qualification is correct',
  names(model).join(' ') === '#.Foo.Bar.Baz #.Foo.Top',
  names(model).join(' ')
);
check(
  'the intermediate namespace exists',
  model.namespaces().some(n => n.qualifiedName === '#.Foo.Bar')
);
const fooChildren = model.childrenOf('#.Foo');
check(
  '#.Foo has one child namespace and one object',
  fooChildren.namespaces.length === 1 && fooChildren.objects.length === 1,
  `ns=${fooChildren.namespaces.map(n => n.name)} obj=${fooChildren.objects.map(o => o.name)}`
);
check('resolve finds a nested object', model.resolve('#.Foo.Bar.Baz')?.name === 'Baz');
check('resolve finds a namespace', model.resolve('#.Foo.Bar')?.qualifiedName === '#.Foo.Bar');
check('resolve returns nothing for an unknown name', model.resolve('#.Nope') === undefined);

section('every documented object type');

const allKinds = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Twice.aplo': '∇R←(LO Twice)Y\n R←LO LO Y\n∇\n',
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n',
  'Widget.aplc': ':Class Widget\n:EndClass\n',
  'IThing.apli': ':Interface IThing\n:EndInterface\n',
  'Table.apla': '⍬\n',
  'Text.mat.apla': 'line one\nline two\n',
  'Legacy.dyalog': ':Namespace Legacy\n:EndNamespace\n'
});
model = await ProjectModel.index([allKinds]);
check(
  'each file maps to the expected kind',
  kinds(model).join(' ') ===
    '#.IThing:interface #.Legacy:namespace #.Mean:function #.Table:array #.Text:array ' +
      '#.Twice:operator #.Utils:namespace #.Widget:class',
  kinds(model).join(' ')
);
check(
  'a .dyalog script is classified from its content, not its extension',
  model.objects().find(o => o.name === 'Legacy')?.kind === 'namespace'
);
check(
  'an array is not read for a declaration',
  model.objects().find(o => o.name === 'Table')?.declaredName === undefined
);
check(
  'a tradfn records where its header is',
  model.objects().find(o => o.name === 'Mean')?.location.range?.start.line === 0,
  JSON.stringify(model.objects().find(o => o.name === 'Mean')?.location.range)
);

// ------------------------------------------------------ declared vs filename

section('explicit declarations');

const declared = await fixture({
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n',
  'Widget.aplc': ':Class Widget\n:EndClass\n'
});
model = await ProjectModel.index([declared]);
check(
  'agreement produces the expected names',
  names(model).join(' ') === '#.Utils #.Widget',
  names(model).join(' ')
);
check(
  'the declaration is recorded',
  model.objects().every(o => o.declaredName === o.name)
);
check('no problems are reported', model.problems().length === 0, JSON.stringify(model.problems()));

// Link "will not insist that file names match item names when importing", and
// loads with 2 ⎕FIX, so the declared name is the one that comes into existence.
const mismatch = await fixture({
  'WrongName.apln': ':Namespace ActualName\n:EndNamespace\n'
});
model = await ProjectModel.index([mismatch]);
check(
  'on mismatch the declared name wins, as 2 ⎕FIX would',
  names(model).join('') === '#.ActualName',
  names(model).join(' ')
);
check(
  'the filename it disagreed with is retained',
  model.objects()[0]?.mismatchedFilename === 'WrongName',
  JSON.stringify(model.objects()[0])
);
check(
  'and the disagreement is recorded as a problem',
  model.problems().some(p => p.kind === 'name-mismatch'),
  JSON.stringify(model.problems())
);

section('a dfn file takes its name from the filename');

// Link stores a dfn as just the dfn, with no name in the source, so the file
// name is the only thing that can supply one.
const dfnFile = await fixture({ 'Square.aplf': '{⍵*2}\n' });
model = await ProjectModel.index([dfnFile]);
check(
  'Square.aplf containing a bare dfn → #.Square',
  names(model).join('') === '#.Square',
  names(model).join(' ')
);
check(
  'and it claims no declaration',
  model.objects()[0]?.declaredName === undefined
);

// ------------------------------------------------------------- ambiguity

section('ambiguous and invalid cases');

// TechDetails.md: "There must be exactly one file in the directory per named
// item"; Link reports more than one as an error.
const duplicate = await fixture({
  'Thing.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Thing.apln': ':Namespace Thing\n:EndNamespace\n'
});
model = await ProjectModel.index([duplicate]);
check(
  'a duplicated name is reported as a problem',
  model.problems().some(p => p.kind === 'duplicate-definition'),
  JSON.stringify(model.problems())
);
check(
  'and resolves to nothing rather than an arbitrary winner',
  model.resolve('#.Thing') === undefined
);
check(
  'nor does it appear as a child',
  model.childrenOf('#').objects.every(o => o.name !== 'Thing'),
  model.childrenOf('#').objects.map(o => o.name).join(' ')
);

const badDir = await fixture({
  'not-a-name/Inside.aplf': '∇R←Inside X\n R←X\n∇\n',
  'Good/Fine.aplf': '∇R←Fine X\n R←X\n∇\n'
});
model = await ProjectModel.index([badDir]);
check(
  'a directory that cannot be an APL name is not a namespace',
  names(model).join('') === '#.Good.Fine',
  names(model).join(' ')
);
check(
  'and its contents are not mapped anywhere else',
  !JSON.stringify(model.objects()).includes('Inside')
);
check(
  'the unusable directory is recorded',
  model.problems().some(p => p.kind === 'unusable-filename'),
  JSON.stringify(model.problems())
);

const malformed = await fixture({
  'Broken.apln': ':Namespace\n:EndNamespace\n',
  'Empty.aplf': ''
});
model = await ProjectModel.index([malformed]);
check(
  'a nameless :Namespace falls back to the filename rather than inventing one',
  model.objects().some(o => o.qualifiedName === '#.Broken'),
  names(model).join(' ')
);
check(
  'an empty function file still maps from its filename',
  model.objects().some(o => o.qualifiedName === '#.Empty')
);

section('ignored directories');

const ignored = await fixture({
  'Good.aplf': '∇R←Good X\n R←X\n∇\n',
  '.git/Hidden.aplf': '∇R←Hidden X\n R←X\n∇\n',
  'node_modules/Dep.aplf': '∇R←Dep X\n R←X\n∇\n',
  'out/Built.aplf': '∇R←Built X\n R←X\n∇\n',
  '.hidden/Secret.aplf': '∇R←Secret X\n R←X\n∇\n'
});
model = await ProjectModel.index([ignored]);
check(
  'only the real source is indexed',
  names(model).join('') === '#.Good',
  names(model).join(' ')
);

// ------------------------------------------------------------ .linkconfig

section('.linkconfig');

check(
  'flatten is read from JSON5',
  parseLinkConfig('{\n  LinkVersion: { ID: "4.0.11"},\n  Settings: {\n    flatten: 1,\n  },\n}').flatten === true
);
check('absent flatten defaults to off', parseLinkConfig('{}').flatten === false);
check(
  'caseCode is read',
  parseLinkConfig('{ Settings: { caseCode: true } }').caseCode === true
);

// flatten "will load all items into the root of the linked namespace, even if
// the source code is arranged into sub-directories".
const flattened = await fixture({
  '.linkconfig': '{\n  LinkVersion: { ID: "4.1.0"},\n  Settings: {\n    flatten: 1,\n  },\n}\n',
  'Foo/Bar.aplf': '∇R←Bar X\n R←X\n∇\n',
  'Foo/Deep/Baz.aplf': '∇R←Baz X\n R←X\n∇\n'
});
model = await ProjectModel.index([flattened]);
check(
  'with flatten set, subdirectories contribute no namespace',
  names(model).join(' ') === '#.Bar #.Baz',
  names(model).join(' ')
);
check(
  'and no child namespaces are created',
  model.namespaces().length === 1,
  model.namespaces().map(n => n.qualifiedName).join(' ')
);

// ------------------------------------------------------------ multiple roots

section('multiple workspace roots');

const rootA = await fixture({ 'Alpha/One.aplf': '∇R←One X\n R←X\n∇\n' });
const rootB = await fixture({ 'Beta/Two.aplf': '∇R←Two X\n R←X\n∇\n' });
model = await ProjectModel.index([rootA, rootB]);
check('both roots are indexed', model.rootCount === 2);
check(
  'each root keeps its own tree',
  names(model).join(' ') === '#.Alpha.One #.Beta.Two',
  names(model).join(' ')
);
check(
  'a name from one root does not appear under the other',
  model.resolve('#.Alpha.Two') === undefined && model.resolve('#.Beta.One') === undefined
);
check(
  'files resolve to the correct root',
  model.qualifiedNameForFile(path.join(rootA, 'Alpha', 'One.aplf')) === '#.Alpha.One' &&
    model.qualifiedNameForFile(path.join(rootB, 'Beta', 'Two.aplf')) === '#.Beta.Two'
);

section('no workspace at all');

const empty = await ProjectModel.index([]);
check('an empty model has no roots', empty.rootCount === 0 && empty.isEmpty === true);
check('and answers every query harmlessly', empty.objects().length === 0 &&
  empty.namespaces().length === 0 && empty.resolve('#.Anything') === undefined);
check(
  'a file change against an empty model is a no-op',
  (await empty.fileChanged(path.join(os.tmpdir(), 'nowhere.aplf'))) === false
);

// ----------------------------------------------------------------- changes

section('the model follows changes on disk');

const changing = await fixture({ 'Foo/First.aplf': '∇R←First X\n R←X\n∇\n' });
model = await ProjectModel.index([changing]);
check('starts with one object', names(model).join('') === '#.Foo.First');

// add
const added = path.join(changing, 'Foo', 'Second.aplf');
await fs.writeFile(added, '∇R←Second X\n R←X\n∇\n', 'utf8');
check('an added file is picked up', (await model.fileChanged(added)) === true);
check(
  'and appears in the model',
  names(model).join(' ') === '#.Foo.First #.Foo.Second',
  names(model).join(' ')
);

// change: the declaration changes which object the file defines
await fs.writeFile(added, '∇R←Renamed X\n R←X\n∇\n', 'utf8');
await model.fileChanged(added);
check(
  'a changed declaration changes the object identity',
  names(model).join(' ') === '#.Foo.First #.Foo.Renamed',
  names(model).join(' ')
);

// remove
await fs.rm(added);
await model.fileChanged(added);
check(
  'a removed file leaves the model',
  names(model).join('') === '#.Foo.First',
  names(model).join(' ')
);
check(
  'and no longer resolves by path',
  model.objectForFile(added) === undefined
);

// rename, which arrives as delete plus create
const before = path.join(changing, 'Foo', 'First.aplf');
const after = path.join(changing, 'Foo', 'Third.aplf');
await fs.rename(before, after);
await fs.writeFile(after, '{⍵}\n', 'utf8'); // a bare dfn, so the filename names it
await model.fileChanged(before);
await model.fileChanged(after);
check(
  'a rename is reflected',
  names(model).join('') === '#.Foo.Third',
  names(model).join(' ')
);

// a new file in a directory that was not previously a namespace
const newDir = path.join(changing, 'Fresh');
await fs.mkdir(newDir, { recursive: true });
const inNewDir = path.join(newDir, 'Late.aplf');
await fs.writeFile(inNewDir, '{⍵}\n', 'utf8');
await model.fileChanged(inNewDir);
check(
  'a file in a brand new directory creates its namespace',
  names(model).includes('#.Fresh.Late'),
  names(model).join(' ')
);

// ------------------------------------------------------------- performance

section('indexing a larger tree');

const many = {};
for (let d = 0; d < 12; d++) {
  for (let f = 0; f < 25; f++) {
    many[`Dir${d}/Fn${f}.aplf`] = `∇R←Fn${f} X\n R←X\n∇\n`;
  }
}
const big = await fixture(many);
const started = process.hrtime.bigint();
model = await ProjectModel.index([big]);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
check('300 files are all indexed', model.objects().length === 300, String(model.objects().length));
check('12 namespaces plus the root', model.namespaces().length === 13, String(model.namespaces().length));
check(
  `indexing stayed sane (${elapsedMs.toFixed(0)} ms)`,
  elapsedMs < 15000,
  `took ${elapsedMs.toFixed(0)} ms, which suggests pathological behaviour`
);

await cleanup();

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} project checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} project checks passed.`);
