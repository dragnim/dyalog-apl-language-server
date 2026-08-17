/**
 * Tests for the glyph metadata model and its rendering.
 * Run with: npm run glyphs
 *
 * The point of the model is that a glyph with no valence does not borrow one.
 * `⍝` used to carry `mon: 'Comment to end of line'`, which rendered as
 * "Monadic: Comment to end of line" — false APL, taught to whoever hovered it.
 * Most of what follows checks that no such label can come back.
 *
 * Completion kinds are asserted over a real LSP request in test/smoke.mjs.
 *
 * Requires `npm run build` first.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let GLYPHS, glyphFor, describe, shortDescribe;
try {
  ({ GLYPHS, glyphFor, describe, shortDescribe } = require(path.join(root, 'out', 'glyphs.js')));
} catch (error) {
  console.error('out/glyphs.js is missing. Run `npm run build` first.');
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

const CATEGORIES = ['function', 'operator', 'syntax', 'argument', 'constant', 'name-character'];
const hover = glyph => describe(glyph, '`', undefined);

// -------------------------------------------------------------- invariants

section('table invariants');

check(
  'every entry has a category from the known set',
  GLYPHS.every(g => CATEGORIES.includes(g.category)),
  JSON.stringify(GLYPHS.filter(g => !CATEGORIES.includes(g.category)).map(g => [g.g, g.category]))
);
check(
  'every entry has a glyph, a name and at least one alias',
  GLYPHS.every(g => g.g && g.glyphName && Array.isArray(g.names) && g.names.length > 0)
);
check(
  'no glyph character appears twice',
  new Set(GLYPHS.map(g => g.g)).size === GLYPHS.length,
  JSON.stringify(
    GLYPHS.map(g => g.g).filter((c, i, all) => all.indexOf(c) !== i)
  )
);

// The whole point: a category with no valence must not carry one.
const VALENCELESS = ['syntax', 'argument', 'constant', 'name-character'];
check(
  'syntax, argument, constant and name-character entries carry no mon/dya/op',
  GLYPHS.filter(g => VALENCELESS.includes(g.category)).every(g => !g.mon && !g.dya && !g.op),
  JSON.stringify(
    GLYPHS.filter(g => VALENCELESS.includes(g.category) && (g.mon || g.dya || g.op)).map(g => [
      g.g,
      g.category,
      g.mon,
      g.dya,
      g.op
    ])
  )
);
check(
  'and every one of them has a description instead',
  GLYPHS.filter(g => VALENCELESS.includes(g.category)).every(
    g => typeof g.description === 'string' && g.description.length > 0
  ),
  JSON.stringify(
    GLYPHS.filter(g => VALENCELESS.includes(g.category) && !g.description).map(g => g.g)
  )
);
check(
  'every function has a monadic or dyadic meaning',
  GLYPHS.filter(g => g.category === 'function').every(g => g.mon || g.dya),
  JSON.stringify(GLYPHS.filter(g => g.category === 'function' && !g.mon && !g.dya).map(g => g.g))
);
check(
  'every operator has an operator meaning',
  GLYPHS.filter(g => g.category === 'operator').every(g => g.op),
  JSON.stringify(GLYPHS.filter(g => g.category === 'operator' && !g.op).map(g => g.g))
);
check(
  'a function never carries an operator meaning',
  GLYPHS.filter(g => g.category === 'function').every(g => !g.op),
  JSON.stringify(GLYPHS.filter(g => g.category === 'function' && g.op).map(g => g.g))
);
check(
  'no entry uses description and a valence at once',
  GLYPHS.every(g => !(g.description && (g.mon || g.dya || g.op))),
  JSON.stringify(GLYPHS.filter(g => g.description && (g.mon || g.dya || g.op)).map(g => g.g))
);

// ------------------------------------------------------------ the fix itself

section('no glyph is given a valence it does not have');

check(
  'nothing in the table renders a Monadic label without a monadic meaning',
  GLYPHS.every(g => (hover(g).includes('Monadic:') ? Boolean(g.mon) : true)),
  JSON.stringify(GLYPHS.filter(g => hover(g).includes('Monadic:') && !g.mon).map(g => g.g))
);

// The exact cases named in issue #16.
const WERE_WRONG = [
  ['←', 'Left Arrow', 'Assignment'],
  ['⍝', 'Lamp', 'Comment to end of line'],
  ['⋄', 'Diamond', 'Statement separator'],
  ['¯', 'Macron', 'Negative number prefix'],
  ['∆', 'Delta', 'Valid in names']
];
for (const [char, name, description] of WERE_WRONG) {
  const glyph = glyphFor(char);
  check(
    `${char} no longer claims to be monadic`,
    !hover(glyph).includes('Monadic:'),
    hover(glyph).replace(/\n/g, ' | ')
  );
  check(
    `${char} still says "${description}"`,
    hover(glyph).includes(description) && shortDescribe(glyph) === `${name} — ${description}`,
    shortDescribe(glyph)
  );
}

// ---------------------------------------------------------------- rendering

section('primitive functions keep their valences');

const rho = glyphFor('⍴');
check('⍴ is a function', rho.category === 'function', rho.category);
check('with Shape and Reshape intact', rho.mon === 'Shape' && rho.dya === 'Reshape');
check(
  'hover lists both valences',
  hover(rho).includes('- Monadic: Shape') && hover(rho).includes('- Dyadic: Reshape'),
  hover(rho).replace(/\n/g, ' | ')
);
check('and the completion detail reads well', shortDescribe(rho) === 'Rho — Shape / Reshape');
check('⍴ carries no description field', rho.description === undefined);

section('primitive operators');

const each = glyphFor('¨');
check('¨ is an operator', each.category === 'operator', each.category);
check('with Each preserved', each.op === 'Each');
check(
  'hover labels it as an operator',
  hover(each).includes('- Operator: Each') && !hover(each).includes('Monadic:'),
  hover(each).replace(/\n/g, ' | ')
);
check('detail reads Diaeresis — Each', shortDescribe(each) === 'Diaeresis — Each');

section('mixed roles are kept, not flattened');

// / is Replicate as a function and Reduce as an operator. Both are true.
const slash = glyphFor('/');
check('/ is categorised as an operator', slash.category === 'operator', slash.category);
check('but keeps its function meaning', slash.mon === 'Replicate');
check('and its operator meaning', slash.op === 'Reduce');
check(
  'hover shows both, correctly labelled',
  hover(slash).includes('- Monadic: Replicate') && hover(slash).includes('- Operator: Reduce'),
  hover(slash).replace(/\n/g, ' | ')
);
check(
  'the whole slash family is modelled the same way',
  ['/', '⌿', '\\', '⍀'].every(c => {
    const g = glyphFor(c);
    return g.category === 'operator' && g.mon && g.op;
  }),
  JSON.stringify(['/', '⌿', '\\', '⍀'].map(c => [c, glyphFor(c).category, glyphFor(c).mon, glyphFor(c).op]))
);

section('syntax');

for (const [char, name] of [['←', 'Left Arrow'], ['⍝', 'Lamp'], ['⋄', 'Diamond'], ['¯', 'Macron']]) {
  const glyph = glyphFor(char);
  check(`${char} is syntax`, glyph.category === 'syntax', glyph.category);
  check(`${char} has a description and no valence`, Boolean(glyph.description) && !glyph.mon);
  check(`${char} keeps its official name ${name}`, glyph.glyphName === name);
}

section('arguments');

for (const char of ['⍺', '⍵', '⍶', '⍹']) {
  const glyph = glyphFor(char);
  check(`${char} is an argument symbol`, glyph.category === 'argument', glyph.category);
  check(`${char} describes its role without a valence`, Boolean(glyph.description) && !glyph.mon);
}
check(
  '⍵ reads as the right argument of a dfn',
  shortDescribe(glyphFor('⍵')) === 'Omega — Right argument of a dfn',
  shortDescribe(glyphFor('⍵'))
);
check(
  '⍹ reads as the right operand of a dop',
  glyphFor('⍹').description === 'Right operand of a dop',
  glyphFor('⍹').description
);

section('constants');

const zilde = glyphFor('⍬');
check('⍬ is a constant', zilde.category === 'constant', zilde.category);
check('described as the empty numeric vector', zilde.description === 'Empty numeric vector');
check(
  'and never labelled monadic',
  !hover(zilde).includes('Monadic:'),
  hover(zilde).replace(/\n/g, ' | ')
);

section('name characters, including PR #19');

for (const [char, name] of [['∆', 'Delta'], ['⍙', 'Delta Underbar'], ['_', 'Underscore']]) {
  const glyph = glyphFor(char);
  check(`${char} is a name character`, glyph.category === 'name-character', glyph.category);
  check(`${char} is named ${name}`, glyph.glyphName === name);
  check(`${char} says it is valid in names`, glyph.description === 'Valid in names');
  check(
    `${char} is not labelled monadic`,
    !hover(glyph).includes('Monadic:'),
    hover(glyph).replace(/\n/g, ' | ')
  );
}
check(
  '_ renders as Underscore — Valid in names',
  shortDescribe(glyphFor('_')) === 'Underscore — Valid in names',
  shortDescribe(glyphFor('_'))
);

section("the quote, from PR #19");

const quote = glyphFor("'");
check('is named Quote', quote.glyphName === 'Quote');
check('is syntax, since it delimits a literal', quote.category === 'syntax', quote.category);
check(
  'keeps the character-vector description MikeGatsby wrote',
  quote.description ===
    'Delimits a character vector (string); write two in a row for a literal apostrophe',
  quote.description
);
check(
  'and is not labelled monadic',
  !hover(quote).includes('Monadic:'),
  hover(quote).replace(/\n/g, ' | ')
);
check(
  'both of its aliases survive',
  quote.names.includes('quote') && quote.names.includes('apostrophe'),
  JSON.stringify(quote.names)
);
check('the underscore alias survives too', glyphFor('_').names.includes('underscore'));

section('the keyboard instruction still renders');

check(
  'a key is still offered, with the doubled backtick fence',
  describe(glyphFor('⍴'), '`', 'r').includes('Type it with `` `r ``'),
  describe(glyphFor('⍴'), '`', 'r').replace(/\n/g, ' | ')
);
check(
  'and syntax glyphs get the instruction too',
  describe(glyphFor('⍝'), '`', 'c').includes('Type it with'),
  describe(glyphFor('⍝'), '`', 'c').replace(/\n/g, ' | ')
);
check(
  'no key means no instruction',
  !describe(glyphFor('⍴'), '`', undefined).includes('Type it with')
);

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${checks} glyph metadata checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} glyph metadata checks passed.`);
