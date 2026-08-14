/**
 * Tests for the project-problem to diagnostic projection.
 * Run with: npm run projectdiag
 *
 * Most of these check that a problem is *not* turned into a diagnostic. The
 * project model records three kinds of problem and only one of them is an error
 * under Link's rules; reporting the other two would be exactly the sort of
 * intuitive-but-wrong diagnostic docs/SCOPE.md warns about.
 *
 * The real LSP behaviour — merging with lexical diagnostics, and clearing when a
 * conflict is resolved — is covered in test/smoke.mjs.
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

let ProjectModel, projectDiagnostics;
try {
  ({ ProjectModel } = require(path.join(root, 'out', 'analysis', 'project.js')));
  ({ projectDiagnostics } = require(path.join(root, 'out', 'analysis', 'project-diagnostics.js')));
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-projdiag-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

/** "relative/path:line:char:code" for compact assertions. */
const shape = (byFile, base) =>
  [...byFile.entries()]
    .flatMap(([file, entries]) =>
      entries.map(
        e =>
          `${path.relative(base, file).split(path.sep).join('/')}` +
          `:${e.range.start.line}:${e.range.start.character}:${e.code}`
      )
    )
    .sort();

// ------------------------------------------------------------- duplicates

section('duplicate Link objects');

const duplicate = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Mean.apln': ':Namespace Mean\n:EndNamespace\n',
  'Stats/Fine.aplf': '∇R←Fine X\n R←X\n∇\n'
});
let project = await ProjectModel.index([duplicate]);
let byFile = projectDiagnostics(project);

check(
  'the model recorded the conflict',
  project.problems().some(p => p.kind === 'duplicate-definition'),
  JSON.stringify(project.problems())
);
check(
  'both conflicting files are diagnosed, and the healthy one is not',
  shape(byFile, duplicate).join(' ') ===
    'Stats/Mean.aplf:0:3:link-duplicate-object Stats/Mean.apln:0:11:link-duplicate-object',
  shape(byFile, duplicate).join(' ')
);
check('the healthy file has no entry at all', !byFile.has(path.join(duplicate, 'Stats', 'Fine.aplf')));

const onAplf = byFile.get(path.join(duplicate, 'Stats', 'Mean.aplf'))[0];
check('severity is error', onAplf.severity === 'error', onAplf.severity);
check('the code is stable', onAplf.code === 'link-duplicate-object', onAplf.code);
check(
  'the message names the qualified object',
  onAplf.message.includes("'#.Stats.Mean'"),
  onAplf.message
);
check(
  'and names the other file relative to the root, with forward slashes',
  onAplf.message.includes('Stats/Mean.apln') &&
    // Not the absolute path: the temp root must not leak into a user-facing message.
    !onAplf.message.includes(duplicate.split(path.sep).join('/')),
  onAplf.message
);
check(
  'and says what the rule is',
  /exactly one file per name/.test(onAplf.message),
  onAplf.message
);
check(
  'it points at the declaration name, not line 0 character 0',
  onAplf.range.start.line === 0 && onAplf.range.start.character === 3,
  JSON.stringify(onAplf.range)
);

section('related information points at the other definition');

check('there is one related entry', onAplf.related.length === 1, JSON.stringify(onAplf.related));
check(
  'it names the other file',
  onAplf.related[0].file === path.join(duplicate, 'Stats', 'Mean.apln'),
  onAplf.related[0].file
);
check(
  'at that file’s own declaration name',
  onAplf.related[0].range.start.character === 11,
  JSON.stringify(onAplf.related[0].range)
);
check(
  'with a message saying so',
  /also defined here/i.test(onAplf.related[0].message),
  onAplf.related[0].message
);

section('three files claiming one name');

const triple = await fixture({
  'A.aplf': '∇R←Thing X\n R←X\n∇\n',
  'B.aplf': '∇R←Thing X\n R←X\n∇\n',
  'C.aplf': '∇R←Thing X\n R←X\n∇\n'
});
byFile = projectDiagnostics(await ProjectModel.index([triple]));
check('all three are diagnosed', shape(byFile, triple).length === 3, shape(byFile, triple).join(' '));
check(
  'and each names the other two',
  [...byFile.values()].every(entries => entries[0].related.length === 2),
  JSON.stringify([...byFile.values()].map(e => e[0].related.length))
);

section('a filename-derived object with no declaration');

// A bare dfn declares no name in its source, so there is nothing to point at
// but the start of the file — which is honest rather than lazy.
const bare = await fixture({
  'Sum.aplf': '{+/⍵}\n',
  'Sum.apln': ':Namespace Sum\n:EndNamespace\n'
});
byFile = projectDiagnostics(await ProjectModel.index([bare]));
check(
  'the bare dfn is reported at the start of its file',
  shape(byFile, bare).includes('Sum.aplf:0:0:link-duplicate-object'),
  shape(byFile, bare).join(' ')
);
check(
  'while the script is reported at its declaration',
  shape(byFile, bare).includes('Sum.apln:0:11:link-duplicate-object'),
  shape(byFile, bare).join(' ')
);

// ----------------------------------------------------- what is NOT reported

section('a filename/declaration mismatch is not a problem to report');

// Link "will not insist that file names match item names when importing", so
// WrongName.apln declaring ActualName genuinely produces #.ActualName.
const mismatch = await fixture({ 'WrongName.apln': ':Namespace ActualName\n:EndNamespace\n' });
project = await ProjectModel.index([mismatch]);
check(
  'the model still records the mismatch',
  project.problems().some(p => p.kind === 'name-mismatch'),
  JSON.stringify(project.problems())
);
check(
  'but no diagnostic is produced',
  projectDiagnostics(project).size === 0,
  shape(projectDiagnostics(project), mismatch).join(' ')
);

section('an ordinary non-APL directory name is not a problem to report');

const assets = await fixture({
  'my-assets/logo.txt': 'not source\n',
  'web-root/index.html': '<html></html>\n',
  'Good.aplf': '∇R←Good X\n R←X\n∇\n'
});
project = await ProjectModel.index([assets]);
check(
  'the model records them as unusable for mapping',
  project.problems().filter(p => p.kind === 'unusable-filename').length === 2,
  JSON.stringify(project.problems())
);
check(
  'but nothing is diagnosed: they are outside the tree, not broken',
  projectDiagnostics(project).size === 0,
  shape(projectDiagnostics(project), assets).join(' ')
);

section('valid case-coded filenames are not diagnosed');

const cased = await fixture({
  '.linkconfig': '{\n  Settings: {\n    caseCode: 1,\n  },\n}\n',
  'HelloWorld-41.apln': ':Namespace HelloWorld\n:EndNamespace\n',
  'FOO-7.aplf': '∇R←FOO X\n R←X\n∇\n'
});
check(
  'a documented case code is legal, not a duplicate or an error',
  projectDiagnostics(await ProjectModel.index([cased])).size === 0,
  shape(projectDiagnostics(await ProjectModel.index([cased])), cased).join(' ')
);

section('a clean project produces nothing');

const clean = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Sum.aplf': '{+/⍵}\n',
  'README.md': '# notes\n',
  'Table.mat.apla': 'some text\n'
});
check(
  'no diagnostics for a healthy tree',
  projectDiagnostics(await ProjectModel.index([clean])).size === 0,
  shape(projectDiagnostics(await ProjectModel.index([clean])), clean).join(' ')
);

// -------------------------------------------------------------- Link rules

section('flatten uses the effective identity, not the directory layout');

// Without flatten these are #.A.Mean and #.B.Mean, which do not collide. With
// flatten both become #.Mean, which does.
const flatTree = {
  '.linkconfig': '{\n  Settings: {\n    flatten: 1,\n  },\n}\n',
  'A/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'B/Mean.aplf': '∇R←Mean X\n R←X\n∇\n'
};
const flattened = await fixture(flatTree);
byFile = projectDiagnostics(await ProjectModel.index([flattened]));
check(
  'with flatten, the two files collide and both are diagnosed',
  shape(byFile, flattened).join(' ') ===
    'A/Mean.aplf:0:3:link-duplicate-object B/Mean.aplf:0:3:link-duplicate-object',
  shape(byFile, flattened).join(' ')
);
check(
  'and the message uses the flattened identity',
  [...byFile.values()][0][0].message.includes("'#.Mean'"),
  [...byFile.values()][0][0].message
);

const notFlattened = await fixture({
  'A/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'B/Mean.aplf': '∇R←Mean X\n R←X\n∇\n'
});
check(
  'without flatten the same layout is perfectly legal',
  projectDiagnostics(await ProjectModel.index([notFlattened])).size === 0,
  shape(projectDiagnostics(await ProjectModel.index([notFlattened])), notFlattened).join(' ')
);

section('workspace roots are independent');

const rootA = await fixture({ 'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' });
const rootB = await fixture({ 'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n' });
check(
  'the same qualified name in two roots is not a duplicate',
  projectDiagnostics(await ProjectModel.index([rootA, rootB])).size === 0,
  'each root is its own project'
);

const rootWithConflict = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Mean.apln': ':Namespace Mean\n:EndNamespace\n'
});
byFile = projectDiagnostics(await ProjectModel.index([rootA, rootWithConflict]));
check(
  'a conflict in one root is reported and the healthy root is untouched',
  [...byFile.keys()].every(file => file.startsWith(rootWithConflict)),
  [...byFile.keys()].join(' ')
);

section('no workspace');

check(
  'an empty model produces no diagnostics and does not throw',
  projectDiagnostics(await ProjectModel.index([])).size === 0
);

// ------------------------------------------------------------ live buffers

section('live text improves the range without changing identity');

const live = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Mean.apln': ':Namespace Mean\n:EndNamespace\n'
});
const liveProject = await ProjectModel.index([live]);
const aplfPath = path.join(live, 'Mean.aplf');

byFile = projectDiagnostics(liveProject);
check(
  'on disk the declaration is line 0',
  byFile.get(aplfPath)[0].range.start.line === 0,
  JSON.stringify(byFile.get(aplfPath)[0].range)
);

const moved = '⍝ inserted, unsaved\n⍝ and another\n∇R←Mean X\n R←X\n∇\n';
byFile = projectDiagnostics(liveProject, file => (file === aplfPath ? moved : undefined));
check(
  'an unsaved edit that moves the declaration moves the diagnostic',
  byFile.get(aplfPath)[0].range.start.line === 2,
  `${JSON.stringify(byFile.get(aplfPath)[0].range)} — on disk it is line 0`
);
check(
  'the conflict itself is unchanged: identity is still filesystem-backed',
  byFile.size === 2 && byFile.get(aplfPath)[0].code === 'link-duplicate-object',
  shape(byFile, live).join(' ')
);
check(
  'and related information follows the buffer too',
  byFile.get(path.join(live, 'Mean.apln'))[0].related[0].range.start.line === 2,
  JSON.stringify(byFile.get(path.join(live, 'Mean.apln'))[0].related[0].range)
);

section('ordering is deterministic');

const many = await fixture({
  'Zeta.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Alpha.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Middle.aplf': '∇R←Thing X\n R←X\n∇\n'
});
const manyProject = await ProjectModel.index([many]);
const first = shape(projectDiagnostics(manyProject), many);
check(
  'repeating the projection gives the same result',
  shape(projectDiagnostics(manyProject), many).join(' ') === first.join(' '),
  first.join(' ')
);
check(
  'and each message lists the others in a stable order',
  [...projectDiagnostics(manyProject).values()].every(
    entries => entries[0].message === entries[0].message
  ) &&
    [...projectDiagnostics(manyProject).values()]
      .map(e => e[0].message)
      .join('|') ===
      [...projectDiagnostics(manyProject).values()].map(e => e[0].message).join('|')
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} project diagnostic checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} project diagnostic checks passed.`);
