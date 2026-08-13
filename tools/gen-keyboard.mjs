/**
 * Generates src/keyboard.ts — the prefix keyboard tables — from RIDE's layout
 * data, using RIDE's own algorithm. Run with: npm run gen:keyboard
 *
 * How this works, and why it is trustworthy:
 *
 * RIDE stores four strings per keyboard locale in src/kbds.js, each indexed by
 * scancode: 0 unshifted, 1 shifted, 2 APL, 3 APL shifted. Its src/km.js builds
 * the backtick map by walking the unshifted and shifted strings and pairing each
 * character against the APL character at the same scancode. This script does the
 * same walk, so the output is what RIDE itself would produce rather than anyone's
 * recollection of the keyboard.
 *
 * The layouts genuinely differ between locales — on a British keyboard ≢ is
 * prefix-@ while on a US keyboard it is prefix-" — so all locales are emitted
 * and the user picks one in settings.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pinned deliberately. Fetching `master` meant that running this script on two
 * different days could produce different output from the same project commit,
 * which breaks the "source tree is the authority" principle in docs/SCOPE.md.
 * Moving to a newer RIDE revision is an intentional change: bump the SHA and
 * commit the regenerated src/keyboard.ts together.
 *
 * 66702dd is the most recent commit to touch src/kbds.js (2024-12-19).
 */
const RIDE_REPO = 'https://github.com/Dyalog/ride';
const RIDE_COMMIT = '66702ddcfb692352d532e395ba3e7ca030f89200';
const RIDE_PATH = 'src/kbds.js';
const SOURCE = `https://raw.githubusercontent.com/Dyalog/ride/${RIDE_COMMIT}/${RIDE_PATH}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`Could not fetch ${SOURCE}: ${response.status}`);
  process.exit(1);
}
const js = await response.text();

// Each locale is a name followed by exactly four JSON string literals.
const layouts = {};
for (const match of js.matchAll(/(\w+):\[\s*((?:"(?:[^"\\]|\\.)*",?\s*){4})\]/g)) {
  const strings = [...match[2].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(s => JSON.parse(s[0]));
  if (strings.length === 4) layouts[match[1]] = strings;
}

if (!layouts.en_US) {
  console.error('The en_US layout was not found. RIDE may have restructured kbds.js.');
  process.exit(1);
}

/** RIDE's algorithm from src/km.js: first scancode to claim a character wins. */
function prefixMap(strings) {
  const map = {};
  for (const shifted of [0, 1]) {
    const plain = strings[shifted];
    const apl = strings[2 + shifted];
    for (let i = 0; i < plain.length; i++) {
      const from = plain[i];
      const to = apl[i];
      if (from !== ' ' && to && to !== ' ' && !(from in map)) map[from] = to;
    }
  }
  return map;
}

// Invert to glyph -> key, which is the direction the editor needs. Where a glyph
// is reachable by more than one key, the first wins, matching RIDE's search.
const byLocale = {};
for (const [locale, strings] of Object.entries(layouts).sort()) {
  const glyphToKey = {};
  for (const [key, glyph] of Object.entries(prefixMap(strings))) {
    if (!(glyph in glyphToKey)) glyphToKey[glyph] = key;
  }
  byLocale[locale] = glyphToKey;
}

const locales = Object.keys(byLocale);
const q = s => JSON.stringify(s);

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run gen:keyboard
//
// Derived from RIDE's src/kbds.js by the algorithm in RIDE's src/km.js. See
// tools/gen-keyboard.mjs for the details and the reasoning.
//
// Upstream:  ${RIDE_REPO}
// Commit:    ${RIDE_COMMIT}
// Path:      ${RIDE_PATH}
// Licence:   MIT, Copyright (c) 2016-2023 Dyalog Ltd. See THIRD_PARTY_NOTICES.md.
//
// The commit is pinned, so regenerating from the same project commit always
// produces this file. Updating RIDE means bumping RIDE_COMMIT in the generator
// and committing the regenerated output alongside it.

/** Keyboard locales RIDE knows about. */
export const KEYBOARD_LOCALES = [
${locales.map(l => `  ${q(l)}`).join(',\n')}
] as const;

export type KeyboardLocale = (typeof KEYBOARD_LOCALES)[number];

/** For each locale, the character to type after the prefix key for each glyph. */
export const PREFIX_KEYS: Record<string, Record<string, string>> = {
${locales
  .map(
    l =>
      `  ${q(l)}: {\n` +
      Object.entries(byLocale[l])
        .map(([g, k]) => `    ${q(g)}: ${q(k)}`)
        .join(',\n') +
      '\n  }'
  )
  .join(',\n')}
};

export function prefixKeyFor(glyph: string, locale: string): string | undefined {
  return (PREFIX_KEYS[locale] ?? PREFIX_KEYS.en_US)[glyph];
}

export function glyphsForLocale(locale: string): Record<string, string> {
  return PREFIX_KEYS[locale] ?? PREFIX_KEYS.en_US;
}
`;

await fs.writeFile(path.join(root, 'src', 'keyboard.ts'), out, 'utf8');

console.log(`Wrote src/keyboard.ts`);
console.log(`  ${locales.length} locales: ${locales.join(', ')}`);
console.log(`  en_US covers ${Object.keys(byLocale.en_US).length} glyphs`);
const gb = byLocale.en_GB ?? {};
const differ = Object.keys({ ...byLocale.en_US, ...gb }).filter(
  g => byLocale.en_US[g] !== gb[g]
);
console.log(`  en_GB differs from en_US on ${differ.length} glyphs: ${differ.join(' ')}`);
