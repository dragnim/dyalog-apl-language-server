/**
 * Checks the syntax grammar actually works. This matters more than it sounds:
 * if a single regex in the grammar is invalid, VS Code silently loads nothing
 * and you get no highlighting and no error message. Run with: npm run grammar
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// Both packages are CommonJS, so the real exports hang off the default import.
import onigurumaModule from 'vscode-oniguruma';
import textmateModule from 'vscode-textmate';

const oniguruma = onigurumaModule;
const textmate = textmateModule;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const wasm = await fs.readFile(
  path.join(root, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm')
);
await oniguruma.loadWASM(wasm);

const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
    createOnigString: text => new oniguruma.OnigString(text)
  }),
  loadGrammar: async () =>
    textmate.parseRawGrammar(
      await fs.readFile(path.join(root, 'syntaxes', 'apl.tmLanguage.json'), 'utf8'),
      'apl.tmLanguage.json'
    )
});

const grammar = await registry.loadGrammar('source.apl.dyalog');
if (!grammar) {
  console.error('The grammar failed to load.');
  process.exit(1);
}

/** [line to tokenise, substring to look for, scope it must carry] */
const CASES = [
  ['⍝ a comment', '⍝ a comment', 'comment.line.lamp.apl'],
  ["msg←'don''t'", "'don''t'", 'string.quoted.single.apl'],
  ["msg←'⍝ not a comment'", '⍝', 'string.quoted.single.apl'],
  ['x←¯3.5e2', '¯3.5e2', 'constant.numeric.apl'],
  ['x2←1', 'x2', '!constant.numeric.apl'],
  ['empty←⍬', '⍬', 'constant.language.zilde.apl'],
  ['⎕IO←0', '⎕IO', 'support.function.system.apl'],
  [':If x>0', ':If', 'keyword.control.apl'],
  [':EndFor', ':EndFor', 'keyword.control.apl'],
  ['Iffy←1', 'Iffy', '!keyword.control.apl'],
  ['start:x←1', 'start', 'entity.name.label.apl'],
  ['mean←{(+/⍵)÷≢⍵}', '⍵', 'variable.language.apl'],
  ['mean←{(+/⍵)÷≢⍵}', '←', 'keyword.operator.assignment.apl'],
  ['mean←{(+/⍵)÷≢⍵}', '÷', 'keyword.operator.apl'],
  ['mean←{(+/⍵)÷≢⍵}', '/', 'entity.name.type.apl'],
  ['sums←+/¨v', '¨', 'entity.name.type.apl'],
  ['r←3 4⍴⍳12', '⍴', 'keyword.operator.apl'],
  ['→0', '→', 'keyword.control.flow.apl'],
  ['x←a∊b', '∊', 'keyword.operator.apl'],
  ['x←(1 2)@2⊢v', '@', 'entity.name.type.apl'],
  ['n←≢v', '≢', 'keyword.operator.apl'],
  ['x←2⊥1 0 1', '⊥', 'keyword.operator.apl'],
  ['x←⌶42', '⌶', 'entity.name.type.apl'],
  ['a←1 ⋄ b←2', '⋄', 'punctuation.separator.statement.apl']
];

let failures = 0;
let ruleState = textmate.INITIAL;

for (const [line, needle, wanted] of CASES) {
  const result = grammar.tokenizeLine(line, ruleState);
  const start = line.indexOf(needle);
  const token = result.tokens.find(t => t.startIndex <= start && t.endIndex > start);
  const scopes = token ? token.scopes : [];

  const negated = wanted.startsWith('!');
  const scope = negated ? wanted.slice(1) : wanted;
  const has = scopes.includes(scope);
  const ok = negated ? !has : has;

  if (!ok) failures++;
  const mark = ok ? '  ok  ' : ' FAIL ';
  const expectation = negated ? `must not be ${scope}` : scope;
  console.log(`${mark} ${line.padEnd(24)} ${needle.padEnd(18)} ${expectation}`);
  if (!ok) console.log(`        actually: ${scopes.join(' ')}`);
}

console.log('');
if (failures) {
  console.log(`${failures} of ${CASES.length} checks failed.`);
  process.exit(1);
}
console.log(`All ${CASES.length} checks passed.`);
