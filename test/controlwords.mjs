/**
 * Proves the colon-word list and the TextMate grammar cannot silently drift.
 * Run with: npm run controlwords
 *
 * They had already drifted: the grammar knew :Interface and :Signature while
 * completion did not, and neither knew :Disposable, :EndDisposable, :End,
 * :Attribute, :Using or :Require. Both consumers now come from
 * src/control-words.ts, and this test fails if the generator has not been re-run.
 *
 * Requires `npm run build` first, since it reads the compiled data.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import onigurumaModule from 'vscode-oniguruma';
import textmateModule from 'vscode-textmate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let CONTROL_WORDS, controlWordsFor, controlWordMatch;
try {
  ({ CONTROL_WORDS, controlWordsFor, controlWordMatch } = require(
    path.join(root, 'out', 'control-words.js')
  ));
} catch {
  console.error('out/control-words.js is missing. Run `npm run build` first.');
  process.exit(1);
}

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok && detail !== undefined) console.log(`        ${detail}`);
}

// ------------------------------------------------- the list itself is sane

const words = CONTROL_WORDS.map(w => w.word);

check('every word starts with a colon', words.every(w => w.startsWith(':')));
check(
  'there are no duplicates',
  new Set(words.map(w => w.toLowerCase())).size === words.length,
  'Dyalog colon words are case-insensitive, so duplicates would be a real clash'
);
check(
  'only :In and :InEach are for-clause words',
  controlWordsFor('for-clause')
    .map(w => w.word)
    .sort()
    .join(' ') === ':In :InEach',
  controlWordsFor('for-clause').map(w => w.word).join(' ')
);

// Keywords the audit against Dyalog's documentation added. If someone trims the
// list back, this says so rather than letting highlighting quietly regress.
const AUDITED = [
  ':Disposable', ':EndDisposable', ':End', ':Interface', ':EndInterface',
  ':Include', ':Signature', ':Attribute', ':Using', ':Require'
];
for (const word of AUDITED) {
  check(`${word} is present`, words.includes(word));
}

// ------------------------------------------------ the grammar is in step

const grammarFile = path.join(root, 'syntaxes', 'apl.tmLanguage.json');
const grammarJson = JSON.parse(await fs.readFile(grammarFile, 'utf8'));
const actual = grammarJson.repository['control-word'].match;

check(
  'the grammar rule matches what the generator would write',
  actual === controlWordMatch(),
  'run `npm run gen:grammar` and commit the result'
);

// ------------------------------------- and every word actually highlights

const wasm = await fs.readFile(
  path.join(root, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')
);
await onigurumaModule.loadWASM(wasm);

const registry = new textmateModule.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: patterns => new onigurumaModule.OnigScanner(patterns),
    createOnigString: text => new onigurumaModule.OnigString(text)
  }),
  loadGrammar: async () =>
    textmateModule.parseRawGrammar(await fs.readFile(grammarFile, 'utf8'), 'apl.tmLanguage.json')
});

const grammar = await registry.loadGrammar('source.apl.dyalog');
if (!grammar) {
  console.error('The grammar failed to load.');
  process.exit(1);
}

function scopesOf(line, needle) {
  const result = grammar.tokenizeLine(line, textmateModule.INITIAL);
  const start = line.indexOf(needle);
  const token = result.tokens.find(t => t.startIndex <= start && t.endIndex > start);
  return token ? token.scopes : [];
}

let highlightFailures = 0;
for (const { word } of CONTROL_WORDS) {
  const line = word === ':In' || word === ':InEach' ? `:For i ${word} v` : `${word} x`;
  if (!scopesOf(line, word).includes('keyword.control.apl')) {
    highlightFailures++;
    console.log(` FAIL  ${word} does not highlight as keyword.control.apl`);
  }
}
check(
  `all ${CONTROL_WORDS.length} colon words highlight as keywords`,
  highlightFailures === 0,
  `${highlightFailures} did not`
);

// :End must not swallow the longer words, and names must not be keywords.
check(':EndDisposable is not tokenised as :End', scopesOf(':EndDisposable', ':EndDisposable').includes('keyword.control.apl'));
check(
  'a name beginning with a keyword is not a keyword',
  !scopesOf('Iffy←1', 'Iffy').includes('keyword.control.apl')
);
check(
  'colon words are case-insensitive',
  scopesOf(':enddisposable x', ':enddisposable').includes('keyword.control.apl')
);

console.log('');
if (failures) {
  console.log(`${failures} of ${checks} colon-word checks failed.`);
  process.exit(1);
}
console.log(`All ${checks} colon-word checks passed (${CONTROL_WORDS.length} keywords).`);
