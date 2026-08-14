/**
 * Renaming a definition and every reference that provably means it.
 *
 * This does no searching of its own. The edit set *is* the occurrence set that
 * findReferences already proved, so rename cannot rename anything that find
 * references would not have found, and the two cannot disagree. Renaming
 * `#.Stats.Mean` therefore leaves `#.Finance.Mean` alone, and leaves a `Mean`
 * that is a function argument alone, for the same reasons and by the same code.
 *
 * prepareRename and rename share one safety path: `planRename` decides whether a
 * target can be renamed at all, and `computeRename` calls it before doing
 * anything else. An editor cannot therefore be offered a rename that the actual
 * rename would then refuse.
 *
 * WHAT A RENAME HAS TO CHANGE. For a Link project object the object's name comes
 * from its source declaration — Link "will not insist that file names match item
 * names" on import and fixes with `2 ⎕FIX` (Dyalog/link,
 * docs/API/Link.Create.md). So editing `∇R←Mean X` to `∇R←Average X` genuinely
 * renames the object, whatever the file is called. Renaming the file as well is
 * tidiness rather than correctness, and is offered as a resource operation only
 * when the client says it can perform one.
 *
 * The exception is an object whose name exists *only* as a filename — a bare dfn
 * in a `.aplf` with no name in its own text. There is nothing in the source to
 * edit, so there is no range for prepareRename to return and nothing for a text
 * edit to change. Those are refused rather than half-done; see the note on
 * `no-source-name` below.
 */

import * as path from 'node:path';

import { isLegalName, scanLine } from './scanner';
import { extractSymbols, splitLines, type SourceRange } from './symbols';
import { nameAt } from './names';
import { resolveDefinition } from './definitions';
import { findReferences, type TargetIdentity } from './references';
import { encodeCaseCode, identifyFile, type ProjectModel } from './project';

export type RefusalReason =
  /** The cursor is not on a name. */
  | 'no-name-at-cursor'
  /** A ⎕name, or something qualified by one. Not project source. */
  | 'system-name'
  /** A colon word such as `:If`. Part of the language, not a definition. */
  | 'control-word'
  /** Nothing could be resolved, or the target was ambiguous. */
  | 'unresolved'
  /** The object's name exists only in its filename, not in its source. */
  | 'no-source-name'
  /** The replacement is not a legal Dyalog name. */
  | 'invalid-new-name'
  /** The replacement is the name it already has. */
  | 'unchanged'
  /** Something of that name already exists where this one would go. */
  | 'collision';

export interface RenameRefusal {
  refused: RefusalReason;
  /** Human-readable reason, suitable for showing to the user. */
  detail: string;
}

export const isRefusal = (value: unknown): value is RenameRefusal =>
  typeof value === 'object' && value !== null && 'refused' in value;

export interface RenamePlan {
  /** The range the editor should let the user edit. */
  range: SourceRange;
  /** The name as it stands, for the editor's input box. */
  placeholder: string;
  target: TargetIdentity;
  /** The file declaring the target, or undefined for the current document. */
  declaringFile: string | undefined;
  /** Set when the target is a Link project object. */
  qualifiedName?: string;
}

export interface RenameTextEdit {
  /** undefined means the document the request came from. */
  file: string | undefined;
  range: SourceRange;
  newText: string;
}

export interface RenameFileOperation {
  oldFile: string;
  newFile: string;
}

export interface RenameResult {
  edits: RenameTextEdit[];
  /** Present only when a file rename is both needed and supported. */
  fileRename?: RenameFileOperation;
  plan: RenamePlan;
}

export interface RenameRequest {
  text: string;
  file?: string;
  position: { line: number; character: number };
  project: ProjectModel;
  liveText?: (file: string) => string | undefined;
}

export interface ComputeRenameRequest extends RenameRequest {
  newName: string;
  /** Whether the client advertised the rename resource operation. */
  clientSupportsFileRename?: boolean;
}

const refuse = (refused: RefusalReason, detail: string): RenameRefusal => ({ refused, detail });

const width = (range: SourceRange): number =>
  range.end.line === range.start.line ? range.end.character - range.start.character : -1;

/** The namespace part of a qualified name, or undefined at the root. */
function namespaceOf(qualifiedName: string): string | undefined {
  const segments = qualifiedName.split('.');
  if (segments.length <= 1) return undefined;
  segments.pop();
  return segments.length === 1 ? segments[0] : segments.join('.');
}

const qualify = (namespace: string, child: string): string =>
  namespace === '#' ? `#.${child}` : `${namespace}.${child}`;

/**
 * Whether a target can be renamed at all, and where its name sits.
 *
 * Called by both prepareRename and rename, so the two can never disagree about
 * eligibility.
 */
export function planRename(request: RenameRequest): RenamePlan | RenameRefusal {
  const lines = splitLines(request.text);
  const line = lines[request.position.line];
  if (line === undefined) return refuse('no-name-at-cursor', 'There is nothing at that position.');

  const reference = nameAt(line, request.position.character, request.position.line);
  if (!reference) return refuse('no-name-at-cursor', 'The cursor is not on a name.');
  if (reference.systemQualified) {
    return refuse('system-name', 'System names cannot be renamed.');
  }

  // A colon immediately before the name makes this a control word such as :If,
  // which is part of the language. A label is `name:`, with the colon after, so
  // this cannot be confused with one.
  const code = scanLine(line).code;
  if (reference.range.start.character > 0 && code[reference.range.start.character - 1] === ':') {
    return refuse('control-word', 'Control words cannot be renamed.');
  }

  const target = resolveDefinition({
    text: request.text,
    file: request.file,
    position: request.position,
    project: request.project,
    liveText: request.liveText
  });
  if (!target) {
    return refuse(
      'unresolved',
      'That name cannot be resolved to a single definition, so renaming it would not be safe.'
    );
  }

  const declaringFile = target.file ?? request.file;

  // A definition with no name in its own source — a bare dfn whose object name
  // comes from the filename — has a zero-width selection range, because there is
  // no name there to select. Renaming it would mean renaming the file and
  // nothing else, and there is no text range for the editor to work on.
  if (width(target.selectionRange) <= 0) {
    return refuse(
      'no-source-name',
      'This object is named by its filename rather than by its source, so it cannot be ' +
        'renamed through an edit. Rename the file instead.'
    );
  }

  const object = declaringFile ? request.project.objectForFile(declaringFile) : undefined;

  return {
    range: reference.range,
    placeholder: reference.name,
    target: {
      file: declaringFile,
      line: target.selectionRange.start.line,
      character: target.selectionRange.start.character
    },
    declaringFile,
    qualifiedName: object?.qualifiedName
  };
}

/** Every symbol name defined anywhere in a source text. */
function definedNames(source: string): Set<string> {
  const names = new Set<string>();
  const walk = (symbols: ReturnType<typeof extractSymbols>): void => {
    for (const symbol of symbols) {
      names.add(symbol.name);
      walk(symbol.children);
    }
  };
  walk(extractSymbols(source));
  return names;
}

/**
 * The filename a renamed object should have, honouring `caseCode`, or undefined
 * when the current filename does not correspond to the old name.
 *
 * A file whose name already disagrees with the object it defines is left alone:
 * Link permits that, and guessing at the user's intent for an existing mismatch
 * is not this feature's business.
 */
function renamedFile(
  file: string,
  oldName: string,
  newName: string,
  caseCode: boolean
): string | undefined {
  const directory = path.dirname(file);
  const base = path.basename(file);
  const identity = identifyFile(base, { flatten: false, caseCode, codeExtensions: [] });
  if (!identity || identity.name !== oldName) return undefined;

  // Everything after the object name: the extension, plus any array
  // sub-extension, preserved exactly.
  const stem = base.slice(0, base.length - identity.extension.length - 1);
  const suffix = base.slice(stem.length);
  const newStem = caseCode ? encodeCaseCode(newName) : newName;
  return path.join(directory, `${newStem}${suffix}`);
}

/**
 * The edits that rename the definition under the cursor, or a refusal.
 *
 * Every edit range comes from findReferences, so nothing is renamed that was not
 * proved to refer to this definition. Only the final identifier is replaced:
 * `#.Stats.Mean` becomes `#.Stats.Average` because the range covers `Mean` alone.
 */
export async function computeRename(
  request: ComputeRenameRequest
): Promise<RenameResult | RenameRefusal> {
  const plan = planRename(request);
  if (isRefusal(plan)) return plan;

  const newName = request.newName;

  if (newName !== newName.trim() || newName.length === 0) {
    return refuse('invalid-new-name', 'A name cannot be empty or contain leading or trailing spaces.');
  }
  if (!isLegalName(newName)) {
    return refuse(
      'invalid-new-name',
      `${JSON.stringify(newName)} is not a legal Dyalog name. A name starts with a ` +
        'non-numeric character and contains only letters, digits, _, ∆ and ⍙.'
    );
  }
  if (newName === plan.placeholder) {
    return refuse('unchanged', 'That is already its name.');
  }

  // ---- collisions the static model can actually prove

  // A sibling object of the same name in the same Link namespace.
  if (plan.qualifiedName && plan.declaringFile) {
    const namespace = namespaceOf(plan.qualifiedName);
    if (namespace) {
      const clash = request.project.resolveFrom(plan.declaringFile, qualify(namespace, newName));
      if (clash) {
        return refuse(
          'collision',
          `${qualify(namespace, newName)} already exists, so renaming would create two ` +
            'definitions of one name.'
        );
      }
    }
  }

  // A definition of that name already in the declaring file.
  const declaringText =
    plan.declaringFile === undefined
      ? request.text
      : (request.liveText?.(plan.declaringFile) ??
        (plan.declaringFile === request.file ? request.text : undefined));
  if (declaringText !== undefined && definedNames(declaringText).has(newName)) {
    return refuse(
      'collision',
      `${newName} is already defined in that file.`
    );
  }

  // ---- the edit set is exactly the proven reference set

  const { locations } = await findReferences({
    text: request.text,
    file: request.file,
    position: request.position,
    project: request.project,
    includeDeclaration: true,
    liveText: request.liveText
  });

  if (locations.length === 0) {
    return refuse('unresolved', 'No provable references were found, so there is nothing to rename.');
  }

  const edits: RenameTextEdit[] = locations.map(location => ({
    file: location.file,
    range: location.range,
    newText: newName
  }));

  // findReferences already sorts and each range covers one name, so edits cannot
  // overlap; this guards the invariant rather than assuming it.
  for (let i = 1; i < edits.length; i++) {
    const previous = edits[i - 1];
    const current = edits[i];
    if (
      previous.file === current.file &&
      previous.range.start.line === current.range.start.line &&
      previous.range.end.character > current.range.start.character
    ) {
      return refuse('unresolved', 'The edits would overlap, so the rename was abandoned.');
    }
  }

  let fileRename: RenameFileOperation | undefined;
  if (request.clientSupportsFileRename && plan.qualifiedName && plan.declaringFile) {
    const settings = request.project.linkSettingsFor(plan.declaringFile);
    const newFile = renamedFile(
      plan.declaringFile,
      plan.placeholder,
      newName,
      settings?.caseCode ?? false
    );
    if (newFile && newFile !== plan.declaringFile) {
      fileRename = { oldFile: plan.declaringFile, newFile };
    }
  }

  return { edits, fileRename, plan };
}
