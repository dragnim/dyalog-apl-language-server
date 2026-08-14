/**
 * Turning the project model's recorded problems into publishable diagnostics.
 *
 * This detects nothing. ProjectModel is the source of truth for what is wrong
 * with a source tree; this only decides which of its recorded problems are
 * user-facing errors, and where in a file to point at them.
 *
 * WHAT IS SURFACED, and what is not.
 *
 * `duplicate-definition` — reported, as an Error, on *every* file involved.
 *   Link is unambiguous that this is an error: "There must be exactly one file
 *   in the directory per named item ... this will be reported as an error on
 *   Link.Create or Link.Import" (Dyalog/link, docs/Discussion/TechDetails.md).
 *   The project model already resolves such a name to nothing rather than
 *   picking a winner, so without a diagnostic the user gets silence where Link
 *   gives an error. Both sides are reported because neither is more at fault
 *   than the other, and diagnosing only whichever file was indexed second would
 *   depend on traversal order.
 *
 * `name-mismatch` — deliberately NOT reported. Link "will not insist that file
 *   names match item names when importing items from a directory"
 *   (docs/API/Link.Create.md, forceFilenames), and loads with `2 ⎕FIX`, so a
 *   `:Namespace ActualName` inside `WrongName.apln` genuinely produces
 *   `#.ActualName`. Nothing is wrong, so nothing is reported. The problem is
 *   still recorded in the model, because a tool that wants to offer to tidy
 *   filenames would need it — but it is not an error, and reporting it would be
 *   the kind of intuitive-but-wrong diagnostic docs/SCOPE.md warns against.
 *
 * `unusable-filename` — deliberately NOT reported. It is recorded for a
 *   directory whose name could not be an APL name, which is how an ordinary
 *   `my-assets/` or `web-root/` alongside a Link tree looks. Such a directory is
 *   simply outside the tree rather than broken, and reporting every one of them
 *   would be noise. A diagnostic also needs a document to attach to, and a
 *   directory is not one.
 */

import * as path from 'node:path';

import type { SourceRange } from './symbols';
import { uniqueSymbolNamed } from './definitions';
import type { ProjectModel } from './project';

/** Stable, machine-readable identifiers. Clients and tests match on these. */
export type ProjectDiagnosticCode = 'link-duplicate-object';

export interface ProjectDiagnosticRelated {
  file: string;
  range: SourceRange;
  message: string;
}

export interface ProjectDiagnostic {
  file: string;
  code: ProjectDiagnosticCode;
  /** Only 'error' occurs today; the field exists so a later warning has a home. */
  severity: 'error' | 'warning';
  message: string;
  range: SourceRange;
  related: ProjectDiagnosticRelated[];
}

const ZERO: SourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

/** A path as the user would recognise it: relative to its root, forward slashes. */
function display(project: ProjectModel, file: string): string {
  const root = project.rootDirectoryFor(file);
  const relative = root === undefined ? file : path.relative(root, file);
  return relative.split(path.sep).join('/');
}

/**
 * Where to point in a file that declares `name`.
 *
 * Prefers the declaration's own name range. Where the file is open and its
 * declaration has moved in an unsaved buffer, the live text is consulted so the
 * squiggle lands on the declaration the user can actually see. Which files
 * *are* project objects still comes from the filesystem model — an unsaved edit
 * does not create or remove a Link object.
 */
function rangeFor(
  definition: { file: string; range?: SourceRange; selectionRange?: SourceRange },
  name: string,
  liveText?: (file: string) => string | undefined
): SourceRange {
  const live = liveText?.(definition.file);
  if (live !== undefined) {
    const symbol = uniqueSymbolNamed(live, name);
    if (symbol) return symbol.selectionRange;
  }
  return definition.selectionRange ?? definition.range ?? ZERO;
}

/** The simple name at the end of a qualified name. */
const simpleName = (qualifiedName: string): string =>
  qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1);

function compare(a: ProjectDiagnostic, b: ProjectDiagnostic): number {
  if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
  if (a.range.start.character !== b.range.start.character) {
    return a.range.start.character - b.range.start.character;
  }
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/**
 * Every project diagnostic, grouped by the file it belongs to.
 *
 * A file absent from the result has no project problems, which is what lets the
 * caller work out whose diagnostics need clearing.
 */
export function projectDiagnostics(
  project: ProjectModel,
  liveText?: (file: string) => string | undefined
): Map<string, ProjectDiagnostic[]> {
  const byFile = new Map<string, ProjectDiagnostic[]>();

  const add = (diagnostic: ProjectDiagnostic): void => {
    const list = byFile.get(diagnostic.file) ?? [];
    list.push(diagnostic);
    byFile.set(diagnostic.file, list);
  };

  for (const problem of project.problems()) {
    if (problem.kind !== 'duplicate-definition') continue;

    const name = simpleName(problem.name);

    for (const definition of problem.definitions) {
      const others = problem.definitions.filter(other => other.file !== definition.file);
      const otherNames = others.map(other => display(project, other.file)).sort();

      add({
        file: definition.file,
        code: 'link-duplicate-object',
        severity: 'error',
        message:
          `Duplicate Link object '${problem.name}'; also defined by ` +
          `${otherNames.join(', ')}. Link requires exactly one file per name.`,
        range: rangeFor(definition, name, liveText),
        related: others.map(other => ({
          file: other.file,
          range: rangeFor(other, name, liveText),
          message: `'${problem.name}' is also defined here.`
        }))
      });
    }
  }

  for (const list of byFile.values()) list.sort(compare);
  return byFile;
}
