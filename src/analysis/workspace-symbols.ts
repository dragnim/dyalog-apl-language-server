/**
 * Workspace-wide symbol search.
 *
 * This adds no recognition of its own. The catalogue is the two things that
 * already exist: ProjectModel says which files are project objects and what they
 * are called, and extractSymbols says what is defined inside each of those files.
 * Nothing here rediscovers the filesystem or re-parses APL by hand.
 *
 *   ProjectModel (identity)  +  extractSymbols (structure)
 *                          ↓
 *                  one flat, deduplicated catalogue
 *                          ↓
 *                    filter by query
 *
 * DEDUPLICATION. A definition is known twice over: `Stats/Mean.aplf` is the
 * project object `#.Stats.Mean`, and extracting symbols from that same file finds
 * the tradfn `Mean` its declaration sits in. They are one definition, so the
 * object wins — it carries the project identity — and the extracted symbol at the
 * same declaration position is dropped. Identity is (file, declaration position),
 * which is stable across both sources.
 *
 * A filename-derived object has no declaration position to compare, so nothing is
 * dropped for it; whatever the source defines is reported alongside the object.
 *
 * AMBIGUITY. Link requires exactly one file per named item, and the project model
 * records a clash rather than picking a winner. A name defined by two files
 * therefore contributes no workspace symbol at all: an editor jumping to an
 * arbitrary one of them would be worse than the name not appearing.
 *
 * UNSCRIPTED NAMESPACES are deliberately absent. A directory-backed namespace has
 * no source of its own — that is what makes it unscripted — so there is no file,
 * line or column to navigate to. LSP requires a Location, and pointing at a
 * directory, or at line 0 of some file inside it, would be a fabrication. The
 * namespaces still appear as the containerName of everything in them, which is
 * where they are actually useful.
 */

import * as fs from 'node:fs/promises';

import { extractSymbols, type AplSymbol, type SourceRange } from './symbols';
import { isAplSourceFile, type ProjectModel, type ProjectObject } from './project';

/** The kinds a workspace symbol can have, before the LSP mapping. */
export type WorkspaceSymbolKind =
  | 'function'
  | 'operator'
  | 'namespace'
  | 'class'
  | 'interface'
  | 'array'
  | 'code';

export interface WorkspaceSymbolEntry {
  /** The name as the source spells it. */
  name: string;
  /** The namespace or scripted object holding it, e.g. `#.Stats`. */
  containerName?: string;
  /** `containerName` and `name` joined, used for matching and ordering. */
  qualifiedName: string;
  kind: WorkspaceSymbolKind;
  file: string;
  /** The whole definition. */
  range: SourceRange;
  /** Just the name, for the editor to select on arrival. */
  selectionRange: SourceRange;
}

const ZERO: SourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

/** tradfn and dfn are both functions; tradop is an operator. */
const KIND_OF_SYMBOL: Record<AplSymbol['kind'], WorkspaceSymbolKind> = {
  tradfn: 'function',
  tradop: 'operator',
  dfn: 'function',
  namespace: 'namespace',
  class: 'class',
  interface: 'interface'
};

const qualify = (container: string, name: string): string =>
  container === '#' ? `#.${name}` : `${container}.${name}`;

/**
 * Case-insensitive substring match against both the simple name and the fully
 * qualified one, so `mean` finds `Mean` and `stats` finds everything in
 * `#.Stats`. An empty query matches everything.
 *
 * Deliberately not fuzzy. A predictable substring match is more useful in a
 * symbol picker than a ranking algorithm whose results shift as it is tuned.
 */
export function matchesQuery(entry: WorkspaceSymbolEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.qualifiedName.toLowerCase().includes(needle)
  );
}

/** Sorted by qualified name, then file, then position: stable and traversal-independent. */
function compare(a: WorkspaceSymbolEntry, b: WorkspaceSymbolEntry): number {
  if (a.qualifiedName !== b.qualifiedName) return a.qualifiedName < b.qualifiedName ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.range.start.line !== b.range.start.line) {
    return a.range.start.line - b.range.start.line;
  }
  return a.range.start.character - b.range.start.character;
}

/** The entry for a project object itself. */
function entryForObject(
  object: ProjectObject,
  containerName: string
): WorkspaceSymbolEntry {
  const kind: WorkspaceSymbolKind =
    object.kind === 'code' ? 'code' : (object.kind as WorkspaceSymbolKind);
  return {
    name: object.name,
    containerName,
    qualifiedName: object.qualifiedName,
    kind,
    file: object.location.file,
    // A filename-derived object declares no name in its source, so the start of
    // the file is the honest destination — the same policy go to definition uses.
    range: object.location.range ?? ZERO,
    selectionRange: object.location.selectionRange ?? object.location.range ?? ZERO
  };
}

/**
 * Walks the definitions inside one file, skipping the one that *is* the project
 * object, and giving each the enclosing scripted object as its container.
 */
function entriesInside(
  symbols: AplSymbol[],
  file: string,
  container: string,
  declaredAt: { line: number; character: number } | undefined,
  into: WorkspaceSymbolEntry[]
): void {
  for (const symbol of symbols) {
    const isTheObjectItself =
      declaredAt !== undefined &&
      symbol.selectionRange.start.line === declaredAt.line &&
      symbol.selectionRange.start.character === declaredAt.character;

    // The object's own declaration is already catalogued from ProjectModel, and
    // that entry is the one carrying project identity.
    const qualifiedName = isTheObjectItself ? container : qualify(container, symbol.name);

    if (!isTheObjectItself) {
      into.push({
        name: symbol.name,
        containerName: container,
        qualifiedName,
        kind: KIND_OF_SYMBOL[symbol.kind],
        file,
        range: symbol.range,
        selectionRange: symbol.selectionRange
      });
    }

    // Children of a scripted object are qualified by it either way.
    if (symbol.children.length > 0) {
      entriesInside(symbol.children, file, qualifiedName, undefined, into);
    }
  }
}

export interface WorkspaceSymbolRequest {
  project: ProjectModel;
  query: string;
  /** Live text of any open document, preferred over what is on disk. */
  liveText?: (file: string) => string | undefined;
}

/**
 * Every statically known workspace symbol matching the query.
 *
 * With no workspace root the project model is empty and this returns nothing:
 * single-file navigation is what textDocument/documentSymbol is for, and turning
 * workspace search into a hidden index of open buffers would report symbols from
 * files the user never told us were a project.
 */
export async function findWorkspaceSymbols(
  request: WorkspaceSymbolRequest
): Promise<WorkspaceSymbolEntry[]> {
  const entries: WorkspaceSymbolEntry[] = [];

  for (const namespace of request.project.namespaces()) {
    for (const objects of namespace.objects.values()) {
      // Link permits exactly one file per name; a clash resolves to nothing.
      if (objects.length !== 1) continue;
      const object = objects[0];

      entries.push(entryForObject(object, namespace.qualifiedName));

      // Array data and MiServer markup are not ordinary APL source, so their
      // contents are not parsed for definitions — the object itself is still
      // searchable. Same policy as find references.
      if (!isAplSourceFile(object.location.file, object.kind)) continue;

      const text =
        request.liveText?.(object.location.file) ??
        (await fs.readFile(object.location.file, 'utf8').catch(() => undefined));
      if (text === undefined) continue;

      entriesInside(
        extractSymbols(text),
        object.location.file,
        object.qualifiedName,
        object.location.selectionRange?.start,
        entries
      );
    }
  }

  return entries.filter(entry => matchesQuery(entry, request.query)).sort(compare);
}
