/**
 * Finding every provable reference to a definition.
 *
 * The whole point is that this is not a workspace-wide search for a spelling.
 * A textual occurrence of `Mean` is a reference only when resolving it *in its
 * own file and namespace* lands on the same definition the cursor started from.
 * `#.Stats.Mean` and `#.Finance.Mean` are different objects, and a bare `Mean`
 * in each of their namespaces refers to a different one of them, so spelling
 * alone proves nothing.
 *
 * The shape is therefore:
 *
 *   cursor → resolveDefinition → canonical identity
 *          → cheap lexical scan for the name across the root
 *          → resolveDefinition again at each occurrence, in its own context
 *          → keep only those whose identity matches
 *
 * Every rule about what may resolve — bare names reaching only the current
 * space, `##.` and `#.` anchoring, locally bound names being excluded, comments
 * and literals being masked — is inherited from definitions.ts rather than
 * restated here. That is deliberate: references cannot drift from go to
 * definition, because they are the same decision asked repeatedly.
 *
 * Rename (#12) can consume `findReferences` unchanged: it yields the canonical
 * target plus the exact occurrence ranges, which is precisely the input a
 * workspace edit needs. Nothing here performs an edit.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { scanLines, NAME_CHARS } from './scanner';
import type { SourceRange } from './symbols';
import { nameAt } from './names';
import { resolveDefinition, type DefinitionTarget } from './definitions';
import { isAplSourceFile, type ProjectModel } from './project';

export interface ReferenceLocation {
  /** Absolute path, or undefined for an untitled document. */
  file: string | undefined;
  range: SourceRange;
  /** True when this occurrence is the definition's own declared name. */
  isDeclaration: boolean;
}

/**
 * What a reference must point at to count. A definition is identified by where
 * its name sits, which is stable across the two resolutions being compared.
 */
export interface TargetIdentity {
  /** undefined means the document the request came from, which has no path. */
  file: string | undefined;
  line: number;
  character: number;
}

export interface ReferenceRequest {
  /** Live text of the document the cursor is in. */
  text: string;
  file?: string;
  position: { line: number; character: number };
  project: ProjectModel;
  includeDeclaration: boolean;
  /** Live text of any open document, preferred over what is on disk. */
  liveText?: (file: string) => string | undefined;
}

/** Where a resolved definition actually lives, for comparison. */
function identityOf(target: DefinitionTarget, currentFile: string | undefined): TargetIdentity {
  return {
    file: target.file ?? currentFile,
    line: target.selectionRange.start.line,
    character: target.selectionRange.start.character
  };
}

function sameIdentity(a: TargetIdentity, b: TargetIdentity): boolean {
  if (a.line !== b.line || a.character !== b.character) return false;
  if (a.file === undefined || b.file === undefined) return a.file === b.file;
  return path.resolve(a.file) === path.resolve(b.file);
}

/** Whole-name occurrences of `name` in already-masked code. */
function occurrencesIn(code: string, name: string): number[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![${NAME_CHARS}])${escaped}(?![${NAME_CHARS}])`, 'gu');
  const columns: number[] = [];
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    columns.push(match.index);
  }
  return columns;
}

/** The text to analyse for a file: the editor's copy if it has one. */
async function textFor(
  file: string,
  liveText?: (file: string) => string | undefined
): Promise<string | undefined> {
  const live = liveText?.(file);
  if (live !== undefined) return live;
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

export interface ReferenceResult {
  /** The definition everything was proved against, or undefined if unresolved. */
  target?: TargetIdentity;
  locations: ReferenceLocation[];
}

/**
 * Every occurrence that provably refers to the definition under the cursor.
 *
 * Returns nothing at all when the cursor itself cannot be resolved: with no
 * definite target there is nothing to prove a reference against, and guessing
 * from the spelling is exactly what this must not do.
 */
export async function findReferences(request: ReferenceRequest): Promise<ReferenceResult> {
  const lines = request.text.split(/\r\n|\r|\n/);
  const cursorLine = lines[request.position.line];
  if (cursorLine === undefined) return { locations: [] };

  const reference = nameAt(cursorLine, request.position.character, request.position.line);
  if (!reference || reference.systemQualified) return { locations: [] };

  const target = resolveDefinition({
    text: request.text,
    file: request.file,
    position: request.position,
    project: request.project,
    liveText: request.liveText
  });
  if (!target) return { locations: [] };

  const identity = identityOf(target, request.file);
  const name = reference.name;

  // The current document is always searched, even with no project at all.
  const documents: { file: string | undefined; text: string }[] = [
    { file: request.file, text: request.text }
  ];

  // Then every searchable source file in the same root. Roots are separate
  // projects, so a match in another one is not a reference to this definition.
  if (request.file) {
    const root = request.project.rootDirectoryFor(request.file);
    if (root !== undefined) {
      for (const object of request.project.objects()) {
        const file = object.location.file;
        if (request.project.rootDirectoryFor(file) !== root) continue;
        if (!isAplSourceFile(file, object.kind)) continue;
        if (path.resolve(file) === path.resolve(request.file)) continue; // already have it live
        const text = await textFor(file, request.liveText);
        if (text !== undefined) documents.push({ file, text });
      }
    }
  }

  const found: ReferenceLocation[] = [];

  for (const document of documents) {
    const scanned = scanLines(document.text);
    for (let line = 0; line < scanned.length; line++) {
      for (const character of occurrencesIn(scanned[line].code, name)) {
        // The decisive step: resolve this occurrence in its own context.
        const resolved = resolveDefinition({
          text: document.text,
          file: document.file,
          position: { line, character },
          project: request.project,
          liveText: request.liveText
        });
        if (!resolved) continue;
        if (!sameIdentity(identityOf(resolved, document.file), identity)) continue;

        const isDeclaration = sameIdentity({ file: document.file, line, character }, identity);
        if (isDeclaration && !request.includeDeclaration) continue;

        found.push({
          file: document.file,
          range: {
            start: { line, character },
            end: { line, character: character + name.length }
          },
          isDeclaration
        });
      }
    }
  }

  // Deterministic order, so editors and tests agree: path, then line, then column.
  found.sort((a, b) => {
    const left = a.file ?? '';
    const right = b.file ?? '';
    if (left !== right) return left < right ? -1 : 1;
    if (a.range.start.line !== b.range.start.line) {
      return a.range.start.line - b.range.start.line;
    }
    return a.range.start.character - b.range.start.character;
  });

  return { target: identity, locations: found };
}
