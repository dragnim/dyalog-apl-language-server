/**
 * Rewrites the `control-word` rule in syntaxes/apl.tmLanguage.json from the
 * authoritative list in src/control-words.ts. Run with: npm run gen:grammar
 *
 * The keyword list used to exist twice — once for completion and once in the
 * grammar — and the two had already drifted apart: the grammar knew :Interface
 * and :Signature, completion did not, and neither knew :Disposable, :End,
 * :Attribute, :Using or :Require. Generating one from the other removes the
 * opportunity. test/controlwords.mjs fails if this has not been re-run.
 *
 * Only the one rule is touched; the rest of the grammar is left byte-for-byte
 * alone apart from JSON re-indentation.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let controlWordMatch, grammarAlternation;
try {
  ({ controlWordMatch, grammarAlternation } = require(
    path.join(root, 'out', 'control-words.js')
  ));
} catch {
  console.error('out/control-words.js is missing. Run `npm run build` first.');
  process.exit(1);
}

const file = path.join(root, 'syntaxes', 'apl.tmLanguage.json');
const grammar = JSON.parse(await fs.readFile(file, 'utf8'));

const wanted = controlWordMatch();
const current = grammar.repository['control-word'].match;

if (current === wanted) {
  console.log('syntaxes/apl.tmLanguage.json is already up to date.');
  process.exit(0);
}

grammar.repository['control-word'].match = wanted;
await fs.writeFile(file, `${JSON.stringify(grammar, null, 2)}\n`, 'utf8');

console.log('Wrote syntaxes/apl.tmLanguage.json');
console.log(`  control-word rule now covers ${grammarAlternation().split('|').length} keywords`);
