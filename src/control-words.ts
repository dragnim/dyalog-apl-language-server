/**
 * The authoritative list of Dyalog colon words.
 *
 * This file is the single source. The TextMate grammar's `control-word` rule is
 * generated from it by `tools/gen-grammar.mjs` (`npm run gen:grammar`), and
 * `test/controlwords.mjs` fails if the two drift apart. Do not add a keyword to
 * the grammar by hand.
 *
 * PROVENANCE. Audited against Dyalog's own documentation, in
 * Dyalog/documentation @ programming-reference-guide/docs:
 *
 * - `.../control-structures/control-structures-summary.md` enumerates the
 *   block, qualifier, terminator and flow-control words, and states that every
 *   `:EndXxx` may be abbreviated to `:End`.
 * - `.../control-structures/{access,attribute,class,implements,interface,
 *   namespace,section,signature,using}.md` give the declaration statements.
 * - `.../object-oriented-programming/` gives `:Field`, `:Property`,
 *   `:EndProperty` (property-section.md) and `:Require`
 *   (including-script-files.md).
 *
 * Cross-checked against RIDE's `src/syntax_info.js`, whose `startBlock` and
 * `endBlock` lists agree with the block words below. RIDE does not list the
 * non-block declaration words, so those come from the documentation alone.
 *
 * CONTEXT. The summary page is explicit about placement:
 *
 *   "Control words ... may occur only at the beginning of a line or expression
 *    in a diamond-separated statement. The only exceptions are :In and :InEach
 *    which must appear on the same line within a :For expression."
 *
 * That is why every word here carries a context, and why the server does not
 * offer `:In` outside a `:For`.
 *
 * Control words are case-insensitive in Dyalog. The casing below is the
 * documented spelling, which is what completion inserts.
 */

/** Where a colon word may legally appear. */
export type ControlWordContext =
  /** At the start of a line, or after a ⋄ within one. */
  | 'statement'
  /** Only within a :For statement, on the same line. */
  | 'for-clause';

export interface ControlWord {
  /** The word as written, including its colon. */
  word: string;
  context: ControlWordContext;
  /** One line for the completion list. */
  detail: string;
}

export const CONTROL_WORDS: ControlWord[] = [
  // Conditional
  { word: ':If', context: 'statement', detail: 'Conditional block' },
  { word: ':ElseIf', context: 'statement', detail: 'Further condition' },
  { word: ':AndIf', context: 'statement', detail: 'Conjoin with the previous condition' },
  { word: ':OrIf', context: 'statement', detail: 'Disjoin with the previous condition' },
  { word: ':Else', context: 'statement', detail: 'Otherwise' },
  { word: ':EndIf', context: 'statement', detail: 'End of :If' },

  // Loops
  { word: ':While', context: 'statement', detail: 'Loop while a condition holds' },
  { word: ':EndWhile', context: 'statement', detail: 'End of :While' },
  { word: ':Repeat', context: 'statement', detail: 'Loop until a condition holds' },
  { word: ':Until', context: 'statement', detail: 'Terminating condition of :Repeat' },
  { word: ':EndRepeat', context: 'statement', detail: 'End of :Repeat' },
  { word: ':For', context: 'statement', detail: 'Loop over the items of an array' },
  { word: ':EndFor', context: 'statement', detail: 'End of :For' },
  { word: ':In', context: 'for-clause', detail: 'Items to loop over, within :For' },
  { word: ':InEach', context: 'for-clause', detail: 'Parallel item lists, within :For' },

  // Selection
  { word: ':Select', context: 'statement', detail: 'Select on a value' },
  { word: ':Case', context: 'statement', detail: 'Match a single value' },
  { word: ':CaseList', context: 'statement', detail: 'Match any of several values' },
  { word: ':EndSelect', context: 'statement', detail: 'End of :Select' },

  // Error handling and scoping blocks
  { word: ':Trap', context: 'statement', detail: 'Trap errors within the block' },
  { word: ':EndTrap', context: 'statement', detail: 'End of :Trap' },
  { word: ':With', context: 'statement', detail: 'Evaluate within a namespace' },
  { word: ':EndWith', context: 'statement', detail: 'End of :With' },
  { word: ':Hold', context: 'statement', detail: 'Acquire tokens for exclusive access' },
  { word: ':EndHold', context: 'statement', detail: 'End of :Hold' },
  { word: ':Disposable', context: 'statement', detail: 'Dispose of objects on exit' },
  { word: ':EndDisposable', context: 'statement', detail: 'End of :Disposable' },

  // Generic terminator
  { word: ':End', context: 'statement', detail: 'End of any control structure' },

  // Flow control
  { word: ':Return', context: 'statement', detail: 'Return from the function' },
  { word: ':Leave', context: 'statement', detail: 'Leave the innermost loop' },
  { word: ':Continue', context: 'statement', detail: 'Start the next iteration' },
  { word: ':GoTo', context: 'statement', detail: 'Branch to a line' },

  // Scripted objects
  { word: ':Namespace', context: 'statement', detail: 'Namespace script' },
  { word: ':EndNamespace', context: 'statement', detail: 'End of :Namespace' },
  { word: ':Class', context: 'statement', detail: 'Class script' },
  { word: ':EndClass', context: 'statement', detail: 'End of :Class' },
  { word: ':Interface', context: 'statement', detail: 'Interface script' },
  { word: ':EndInterface', context: 'statement', detail: 'End of :Interface' },
  { word: ':Section', context: 'statement', detail: 'Named section, for folding' },
  { word: ':EndSection', context: 'statement', detail: 'End of :Section' },
  { word: ':Property', context: 'statement', detail: 'Property definition' },
  { word: ':EndProperty', context: 'statement', detail: 'End of :Property' },

  // Declarations
  { word: ':Access', context: 'statement', detail: 'Accessibility of a member' },
  { word: ':Attribute', context: 'statement', detail: '.NET attribute' },
  { word: ':Field', context: 'statement', detail: 'Field definition' },
  { word: ':Implements', context: 'statement', detail: 'Declare what a member implements' },
  { word: ':Include', context: 'statement', detail: 'Include the members of a namespace' },
  { word: ':Require', context: 'statement', detail: 'Load a script file' },
  { word: ':Signature', context: 'statement', detail: 'Signature of an exposed method' },
  { word: ':Using', context: 'statement', detail: '.NET search path' }
];

/** The words legal in a given position. */
export function controlWordsFor(context: ControlWordContext): ControlWord[] {
  return CONTROL_WORDS.filter(w => w.context === context);
}

/**
 * The alternation used by the TextMate grammar, longest first so that `:EndIf`
 * wins over `:End`. Exported so the generator and the drift test agree by
 * construction rather than by two people writing the same regex twice.
 */
export function grammarAlternation(): string {
  return CONTROL_WORDS.map(w => w.word.slice(1))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .join('|');
}

/**
 * The complete `match` expression for the grammar's control-word rule. Lives
 * here, next to the data, so that the generator and the drift test cannot each
 * hold their own idea of what the rule should look like.
 */
export function controlWordMatch(): string {
  return `(?i):(?:${grammarAlternation()})(?![A-Za-z])`;
}
