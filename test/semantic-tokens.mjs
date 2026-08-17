/**
 * Tests for semantic token classification.
 * Run with: npm run semantic
 *
 * The decisive tests are shadowing and ambiguity: a name bound by the enclosing
 * definition must be that binding rather than a same-named project object, and a
 * name the server cannot resolve must produce no token at all.
 *
 * The LSP encoding itself is decoded and checked in test/smoke.mjs.
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

let ProjectModel, semanticOccurrences, encodeModifiers, TOKEN_TYPES, TOKEN_MODIFIERS;
try {
  ({ ProjectModel } = require(path.join(root, 'out', 'analysis', 'project.js')));
  ({ semanticOccurrences, encodeModifiers, TOKEN_TYPES, TOKEN_MODIFIERS } = require(
    path.join(root, 'out', 'analysis', 'semantic-tokens.js')
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'apl-semantic-'));
  temporaries.push(base);
  for (const [relative, contents] of Object.entries(tree)) {
    const full = path.join(base, ...relative.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, 'utf8');
  }
  return base;
}

const emptyProject = await ProjectModel.index([]);

/** `"word":type+modifiers` per token, in order, for compact assertions. */
function shape(text, options = {}) {
  const occurrences = semanticOccurrences({ text, project: emptyProject, ...options });
  const lines = text.split('\n');
  return occurrences.map(o => {
    const word = lines[o.line].slice(o.startCharacter, o.startCharacter + o.length);
    const mods = o.modifiers.length ? `+${o.modifiers.join(',')}` : '';
    return `${word}:${o.type}${mods}`;
  });
}

/** With positions, when the exact place matters. */
function placed(text, options = {}) {
  const occurrences = semanticOccurrences({ text, project: emptyProject, ...options });
  const lines = text.split('\n');
  return occurrences.map(
    o =>
      `${o.line}:${o.startCharacter}:${lines[o.line].slice(
        o.startCharacter,
        o.startCharacter + o.length
      )}:${o.type}`
  );
}

// ------------------------------------------------------------------- legend

section('the legend is fixed and protocol-facing');

check(
  'token types are in a stable, explicit order',
  TOKEN_TYPES.join(',') === 'namespace,class,interface,function,operator,variable,parameter',
  TOKEN_TYPES.join(',')
);
check(
  'token modifiers likewise',
  TOKEN_MODIFIERS.join(',') === 'declaration,definition',
  TOKEN_MODIFIERS.join(',')
);
check('every type is a standard LSP type', TOKEN_TYPES.every(t => typeof t === 'string'));
check('declaration encodes as bit 0', encodeModifiers(['declaration']) === 1);
check('definition encodes as bit 1', encodeModifiers(['definition']) === 2);
check('both together encode as 3', encodeModifiers(['declaration', 'definition']) === 3);
check('none encodes as 0', encodeModifiers([]) === 0);

// -------------------------------------------------------- traditional forms

section('traditional function');

const tradfn = ['∇R←Foo X;Temp', ' Temp←X', ' R←Temp', '∇'].join('\n');
check(
  'header and body are classified by role',
  shape(tradfn).join(' ') ===
    'R:variable+declaration Foo:function+declaration,definition X:parameter+declaration ' +
      'Temp:variable+declaration Temp:variable X:parameter R:variable Temp:variable',
  shape(tradfn).join(' ')
);
check(
  'the definition name is both declared and defined',
  shape(tradfn)[1] === 'Foo:function+declaration,definition'
);
check(
  'binding sites are declarations, body uses are not',
  shape(tradfn).filter(s => s === 'Temp:variable').length === 2 &&
    shape(tradfn).filter(s => s === 'Temp:variable+declaration').length === 1,
  shape(tradfn).join(' ')
);
check(
  'the argument is a parameter, not a variable',
  shape(tradfn).includes('X:parameter+declaration') && shape(tradfn).includes('X:parameter')
);

check(
  'a namelist result binds each of its names',
  shape(['∇(A B)←Foo X', ' A←X ⋄ B←X', '∇'].join('\n')).join(' ') ===
    'A:variable+declaration B:variable+declaration Foo:function+declaration,definition ' +
      'X:parameter+declaration A:variable X:parameter B:variable X:parameter',
  shape(['∇(A B)←Foo X', ' A←X ⋄ B←X', '∇'].join('\n')).join(' ')
);
check(
  'an ambivalent left argument is a parameter',
  shape(['∇R←{L} Foo X', ' R←X', '∇'].join('\n')).includes('L:parameter+declaration'),
  shape(['∇R←{L} Foo X', ' R←X', '∇'].join('\n')).join(' ')
);
check(
  'a Locals Line binds too',
  shape(['∇R←Foo X;A', '  ;Temp', ' Temp←X ⋄ R←Temp', '∇'].join('\n')).includes(
    'Temp:variable+declaration'
  ),
  shape(['∇R←Foo X;A', '  ;Temp', ' Temp←X ⋄ R←Temp', '∇'].join('\n')).join(' ')
);

section('traditional operator');

const tradop = ['∇R←(LO Twice)Y', ' R←LO LO Y', '∇'].join('\n');
check(
  'the operator is an operator and its operand a parameter',
  shape(tradop).join(' ') ===
    'R:variable+declaration LO:parameter+declaration ' +
      'Twice:operator+declaration,definition Y:parameter+declaration ' +
      'R:variable LO:parameter LO:parameter Y:parameter',
  shape(tradop).join(' ')
);
check(
  'the operator is not called a function',
  !shape(tradop).some(s => s.startsWith('Twice:function')),
  shape(tradop).join(' ')
);
check(
  'a dyadic operator binds both operands',
  shape(['∇R←X(A Dyadic B)Y', ' R←Y', '∇'].join('\n')).join(' ') ===
    'R:variable+declaration X:parameter+declaration A:parameter+declaration ' +
      'Dyadic:operator+declaration,definition B:parameter+declaration ' +
      'Y:parameter+declaration R:variable Y:parameter',
  shape(['∇R←X(A Dyadic B)Y', ' R←Y', '∇'].join('\n')).join(' ')
);

section('named dfn');

check(
  'a named dfn is a function definition',
  shape('Mean←{+/⍵÷≢⍵}').join(' ') === 'Mean:function+declaration,definition',
  shape('Mean←{+/⍵÷≢⍵}').join(' ')
);
check(
  'and ⍵ is left to the grammar',
  !shape('Mean←{+/⍵÷≢⍵}').some(s => s.startsWith('⍵')),
  shape('Mean←{+/⍵÷≢⍵}').join(' ')
);

section('scripted objects');

check(
  'namespace, class and interface declarations',
  shape(
    [':Namespace Stats', ':EndNamespace', ':Class Widget', ':EndClass', ':Interface IThing', ':EndInterface'].join('\n')
  ).join(' ') ===
    'Stats:namespace+declaration,definition Widget:class+declaration,definition ' +
      'IThing:interface+declaration,definition',
  shape(
    [':Namespace Stats', ':EndNamespace', ':Class Widget', ':EndClass', ':Interface IThing', ':EndInterface'].join('\n')
  ).join(' ')
);
check(
  'members inside a class are classified',
  shape([':Class Widget', '    Render←{⍵}', '    ∇Resize X', '     X', '    ∇', ':EndClass'].join('\n')).join(' ') ===
    'Widget:class+declaration,definition Render:function+declaration,definition ' +
      'Resize:function+declaration,definition X:parameter+declaration X:parameter',
  shape([':Class Widget', '    Render←{⍵}', '    ∇Resize X', '     X', '    ∇', ':EndClass'].join('\n')).join(' ')
);
check(
  'the colon word itself gets no semantic token',
  !shape([':Namespace Stats', ':EndNamespace'].join('\n')).some(s => /Namespace:/.test(s.split(':')[0])),
  shape([':Namespace Stats', ':EndNamespace'].join('\n')).join(' ')
);

// ------------------------------------------------------ project references

section('qualified project references');

const projectTree = await fixture({
  'Stats/Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Stats/Twice.aplo': '∇R←(LO Twice)Y\n R←LO Y\n∇\n',
  'Stats/Caller.aplf': '∇R←Caller X\n R←X\n∇\n',
  'Widget.aplc': ':Class Widget\n:EndClass\n',
  'Utils.apln': ':Namespace Utils\n:EndNamespace\n'
});
const project = await ProjectModel.index([projectTree]);
const callerFile = path.join(projectTree, 'Stats', 'Caller.aplf');
const withProject = { project, file: callerFile };

const qualifiedShape = source => {
  const occurrences = semanticOccurrences({ text: source, ...withProject });
  const lines = source.split('\n');
  return occurrences.map(o => {
    const word = lines[o.line].slice(o.startCharacter, o.startCharacter + o.length);
    const mods = o.modifiers.length ? `+${o.modifiers.join(',')}` : '';
    return `${word}:${o.type}${mods}`;
  });
};

check(
  '#.Stats.Mean gives Stats a namespace token and Mean a function token',
  qualifiedShape('∇R←Caller X\n R←#.Stats.Mean X\n∇').join(' ') ===
    'R:variable+declaration Caller:function+declaration,definition X:parameter+declaration ' +
      'R:variable Stats:namespace Mean:function X:parameter',
  qualifiedShape('∇R←Caller X\n R←#.Stats.Mean X\n∇').join(' ')
);
check(
  'a project operator reference is an operator',
  qualifiedShape('∇R←Caller X\n R←#.Stats.Twice X\n∇').includes('Twice:operator'),
  qualifiedShape('∇R←Caller X\n R←#.Stats.Twice X\n∇').join(' ')
);
check(
  'a project class reference is a class',
  qualifiedShape('∇R←Caller X\n R←#.Widget\n∇').includes('Widget:class'),
  qualifiedShape('∇R←Caller X\n R←#.Widget\n∇').join(' ')
);
check(
  'a scripted namespace reference is a namespace',
  qualifiedShape('∇R←Caller X\n R←#.Utils\n∇').includes('Utils:namespace'),
  qualifiedShape('∇R←Caller X\n R←#.Utils\n∇').join(' ')
);
check(
  'a bare sibling reference resolves in the current namespace',
  qualifiedShape('∇R←Caller X\n R←Mean X\n∇').includes('Mean:function'),
  qualifiedShape('∇R←Caller X\n R←Mean X\n∇').join(' ')
);
check(
  'the qualified path is several tokens, not one',
  qualifiedShape('∇R←Caller X\n R←#.Stats.Mean X\n∇').filter(s =>
    s.startsWith('Stats:') || s.startsWith('Mean:')
  ).length === 2
);

section('relative qualified references');

const nestedTree = await fixture({
  'A/B/Target.aplf': '∇R←Target X\n R←X\n∇\n',
  'A/Caller.aplf': '∇R←Caller X\n R←X\n∇\n'
});
const nestedProject = await ProjectModel.index([nestedTree]);
const nestedShape = semanticOccurrences({
  text: '∇R←Caller X\n R←B.Target X\n∇',
  file: path.join(nestedTree, 'A', 'Caller.aplf'),
  project: nestedProject
});
const nestedWords = nestedShape.map(o => {
  const lines = ['∇R←Caller X', ' R←B.Target X', '∇'];
  return `${lines[o.line].slice(o.startCharacter, o.startCharacter + o.length)}:${o.type}`;
});
check(
  'B is a namespace and Target a function',
  nestedWords.includes('B:namespace') && nestedWords.includes('Target:function'),
  nestedWords.join(' ')
);

// ---------------------------------------------------------------- shadowing

section('local bindings beat project identity');

const shadowTree = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Caller.aplf': '∇R←Caller X\n R←X\n∇\n'
});
const shadowProject = await ProjectModel.index([shadowTree]);
const shadowFile = path.join(shadowTree, 'Caller.aplf');

const shadowArgument = semanticOccurrences({
  text: '∇R←Caller Mean\n R←Mean+1\n∇',
  file: shadowFile,
  project: shadowProject
});
const shadowWords = shadowArgument.map(o => {
  const lines = ['∇R←Caller Mean', ' R←Mean+1', '∇'];
  return `${lines[o.line].slice(o.startCharacter, o.startCharacter + o.length)}:${o.type}`;
});
check(
  'an argument named Mean is a parameter, not the project function',
  shadowWords.join(' ') === 'R:variable Caller:function Mean:parameter R:variable Mean:parameter',
  shadowWords.join(' ')
);
check(
  'nothing calls it a function',
  !shadowWords.some(s => s === 'Mean:function'),
  shadowWords.join(' ')
);

const shadowLocal = semanticOccurrences({
  text: '∇R←Caller X;Mean\n Mean←1\n R←Mean\n∇',
  file: shadowFile,
  project: shadowProject
});
const localWords = shadowLocal.map(o => {
  const lines = ['∇R←Caller X;Mean', ' Mean←1', ' R←Mean', '∇'];
  return `${lines[o.line].slice(o.startCharacter, o.startCharacter + o.length)}:${o.type}`;
});
check(
  'a ;-localised Mean is a variable throughout',
  localWords.filter(s => s === 'Mean:variable').length === 3,
  localWords.join(' ')
);
check('and never a function', !localWords.some(s => s === 'Mean:function'), localWords.join(' '));

// A genuine reference in a function that does not bind the name still resolves.
const genuine = semanticOccurrences({
  text: '∇R←Caller X\n R←Mean X\n∇',
  file: shadowFile,
  project: shadowProject
});
check(
  'the same spelling unshadowed is the project function',
  genuine.some(o => o.type === 'function' && o.line === 1),
  JSON.stringify(genuine)
);

section('ambiguous and unresolved names get no token');

check(
  'foo bar baz produces nothing',
  shape('foo bar baz').length === 0,
  shape('foo bar baz').join(' ')
);
check(
  'an unknown name inside a function produces nothing for it',
  !shape(['∇R←Foo X', ' R←Unknown X', '∇'].join('\n')).some(s => s.startsWith('Unknown')),
  shape(['∇R←Foo X', ' R←Unknown X', '∇'].join('\n')).join(' ')
);

const ambiguous = await fixture({
  'Thing.aplf': '∇R←Thing X\n R←X\n∇\n',
  'Thing.apln': ':Namespace Thing\n:EndNamespace\n',
  'Caller.aplf': '∇R←Caller X\n R←X\n∇\n'
});
const ambiguousProject = await ProjectModel.index([ambiguous]);
const ambiguousTokens = semanticOccurrences({
  text: '∇R←Caller X\n R←Thing X\n∇',
  file: path.join(ambiguous, 'Caller.aplf'),
  project: ambiguousProject
});
check(
  'a name two files define is left uncoloured',
  !ambiguousTokens.some(o => o.line === 1 && o.startCharacter === 3),
  JSON.stringify(ambiguousTokens)
);

section('comments, literals, primitives and system names');

const noisy = ['∇R←Foo X', ' ⍝ Temp Foo Mean', " t←'Temp Foo'", ' ⎕IO←0', ' R←X', '∇'].join('\n');
check(
  'nothing from the comment or the literal',
  !placed(noisy).some(p => p.startsWith('1:') || p.startsWith('2:')),
  placed(noisy).join(' ')
);
check(
  'nothing for ⎕IO',
  !shape(noisy).some(s => s.startsWith('IO')),
  shape(noisy).join(' ')
);
check(
  'nothing for a primitive',
  !shape(['∇R←Foo X', ' R←⍴X', '∇'].join('\n')).some(s => s.startsWith('⍴')),
  shape(['∇R←Foo X', ' R←⍴X', '∇'].join('\n')).join(' ')
);
check(
  'nothing for a colon word',
  !shape(['∇R←Foo X', ' :If X', ' :EndIf', ' R←X', '∇'].join('\n')).some(
    s => s.startsWith('If') || s.startsWith('EndIf')
  ),
  shape(['∇R←Foo X', ' :If X', ' :EndIf', ' R←X', '∇'].join('\n')).join(' ')
);

// -------------------------------------------------------------- environment

section('no workspace');

check(
  'document-local bindings still classify with no project',
  shape(['∇R←Foo X;Temp', ' Temp←X', '∇'].join('\n')).join(' ') ===
    'R:variable+declaration Foo:function+declaration,definition X:parameter+declaration ' +
      'Temp:variable+declaration Temp:variable X:parameter',
  shape(['∇R←Foo X;Temp', ' Temp←X', '∇'].join('\n')).join(' ')
);
check(
  'and a project reference simply produces nothing',
  !shape(['∇R←Foo X', ' R←#.Stats.Mean X', '∇'].join('\n')).some(s => s.startsWith('Stats')),
  shape(['∇R←Foo X', ' R←#.Stats.Mean X', '∇'].join('\n')).join(' ')
);
check(
  'an untitled document does not throw',
  shape('Sq←{⍵*2}').join(' ') === 'Sq:function+declaration,definition'
);

section('workspace roots stay separate');

const rootOne = await fixture({ 'Mean.aplf': '∇R←Mean X\n R←X\n∇\n', 'One.aplf': '{⍵}\n' });
const rootTwo = await fixture({ 'Other.aplf': '∇R←Other X\n R←X\n∇\n', 'Two.aplf': '{⍵}\n' });
const twoRoots = await ProjectModel.index([rootOne, rootTwo]);
const crossRoot = semanticOccurrences({
  text: '∇R←One X\n R←Other X\n∇',
  file: path.join(rootOne, 'One.aplf'),
  project: twoRoots
});
check(
  'a name from the other root is not resolved',
  !crossRoot.some(o => o.line === 1 && o.startCharacter === 3),
  JSON.stringify(crossRoot)
);
const sameRoot = semanticOccurrences({
  text: '∇R←One X\n R←Mean X\n∇',
  file: path.join(rootOne, 'One.aplf'),
  project: twoRoots
});
check(
  'while one in its own root is',
  sameRoot.some(o => o.line === 1 && o.startCharacter === 3 && o.type === 'function'),
  JSON.stringify(sameRoot)
);

section('live buffers');

const liveTree = await fixture({
  'Mean.aplf': '∇R←Mean X\n R←X\n∇\n',
  'Caller.aplf': '∇R←Caller X\n R←Mean X\n∇\n'
});
const liveProject = await ProjectModel.index([liveTree]);
const liveCaller = path.join(liveTree, 'Caller.aplf');

// The buffer has the reference two lines further down than disk does.
const movedBuffer = '∇R←Caller X\n ⍝ inserted\n ⍝ and another\n R←Mean X\n∇';
const liveTokens = semanticOccurrences({
  text: movedBuffer,
  file: liveCaller,
  project: liveProject
});
check(
  'tokens follow the live buffer, not the file on disk',
  liveTokens.some(o => o.line === 3 && o.type === 'function'),
  JSON.stringify(liveTokens.map(o => [o.line, o.startCharacter, o.type]))
);
check(
  'and nothing is emitted for the inserted comment lines',
  !liveTokens.some(o => o.line === 1 || o.line === 2),
  JSON.stringify(liveTokens.map(o => o.line))
);

// A local added only in the buffer shadows the project object immediately.
const shadowedBuffer = '∇R←Caller X;Mean\n Mean←1\n R←Mean\n∇';
const shadowedLive = semanticOccurrences({
  text: shadowedBuffer,
  file: liveCaller,
  project: liveProject
});
check(
  'an unsaved localisation shadows the project function at once',
  shadowedLive.every(o => o.type !== 'function' || o.line === 0),
  JSON.stringify(shadowedLive.map(o => [o.line, o.type]))
);

section('legal non-ASCII names');

check(
  'Café classifies like any other name',
  shape(['∇R←Café X;Cañón', ' Cañón←X', ' R←Cañón', '∇'].join('\n')).join(' ') ===
    'R:variable+declaration Café:function+declaration,definition X:parameter+declaration ' +
      'Cañón:variable+declaration Cañón:variable X:parameter R:variable Cañón:variable',
  shape(['∇R←Café X;Cañón', ' Cañón←X', ' R←Cañón', '∇'].join('\n')).join(' ')
);
check(
  '∆ and ⍙ names too',
  shape(['∇R←A∆B X;C⍙D', ' C⍙D←X', '∇'].join('\n')).includes('A∆B:function+declaration,definition'),
  shape(['∇R←A∆B X;C⍙D', ' C⍙D←X', '∇'].join('\n')).join(' ')
);

// ------------------------------------------------------- ordering and overlap

section('ordering and non-overlap');

const busy = [
  ':Namespace Outer',
  '    ∇R←Foo X;Temp',
  '     Temp←X',
  '     R←Temp',
  '    ∇',
  '    Bar←{⍵}',
  ':EndNamespace'
].join('\n');
const busyTokens = semanticOccurrences({ text: busy, project: emptyProject });

check(
  'tokens are sorted by line then character',
  busyTokens.every((token, index) => {
    if (index === 0) return true;
    const previous = busyTokens[index - 1];
    return (
      token.line > previous.line ||
      (token.line === previous.line && token.startCharacter > previous.startCharacter)
    );
  }),
  JSON.stringify(busyTokens.map(o => [o.line, o.startCharacter]))
);
check(
  'no two tokens overlap',
  busyTokens.every((token, index) => {
    if (index === 0) return true;
    const previous = busyTokens[index - 1];
    if (previous.line !== token.line) return true;
    return previous.startCharacter + previous.length <= token.startCharacter;
  }),
  JSON.stringify(busyTokens.map(o => [o.line, o.startCharacter, o.length]))
);
check(
  'every token has a type in the legend',
  busyTokens.every(o => TOKEN_TYPES.includes(o.type)),
  JSON.stringify(busyTokens.map(o => o.type))
);
check(
  'every modifier is in the legend',
  busyTokens.every(o => o.modifiers.every(m => TOKEN_MODIFIERS.includes(m)))
);
check(
  'the whole document classifies as expected',
  shape(busy).join(' ') ===
    'Outer:namespace+declaration,definition R:variable+declaration ' +
      'Foo:function+declaration,definition X:parameter+declaration Temp:variable+declaration ' +
      'Temp:variable X:parameter R:variable Temp:variable ' +
      'Bar:function+declaration,definition',
  shape(busy).join(' ')
);

for (const dir of temporaries) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} semantic token checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} semantic token checks passed.`);
