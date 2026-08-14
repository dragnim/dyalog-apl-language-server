/**
 * Working out what a name at a cursor refers to, statically.
 *
 * The governing rule is docs/SCOPE.md: prefer no definition to the wrong one.
 * Every branch below either has evidence for exactly one target or gives up.
 *
 * SCOPE RULES, from Dyalog's programming reference guide,
 * introduction/namespaces/namespace-syntax.md:
 *
 * - `#` is the root namespace and `##` is the parent of the current one, so a
 *   path beginning with either is anchored and needs no guessing.
 * - A relative path such as `Foo.Bar` is resolved in the current namespace.
 * - An unqualified name is resolved in the current space, and *only* then in
 *   the exported names of the namespaces listed in `⎕PATH`. Dyalog does not
 *   search enclosing namespaces. `⎕PATH` is workspace state that no static
 *   reading of a source tree can know, so this stops at the current space:
 *   a bare name resolves to a definition in the same file, or to an object in
 *   the same Link namespace — that is, a sibling file in the same directory —
 *   and to nothing else.
 *
 * That last point is why a bare `Bar` does not resolve merely because some
 * `Bar` exists somewhere in the workspace.
 *
 * The `.` in a dotted path is only a namespace reference when the thing to its
 * left is a namespace; otherwise it is inner product. The interpreter settles
 * that by looking at the name class at runtime. Here it is settled by requiring
 * the project model to show that every qualifier really is a namespace, and
 * abandoning the resolution when it cannot.
 */

import * as path from 'node:path';

import { extractSymbols, splitLines, type AplSymbol, type SourceRange } from './symbols';
import { nameAt, isLocallyBound, type NameReference } from './names';
import type { ProjectModel, ProjectObject } from './project';

export interface DefinitionTarget {
  /** The defining file, or undefined when it is the document asked about. */
  file: string | undefined;
  /** The whole definition. */
  range: SourceRange;
  /** The defined name within it, for the editor to select on arrival. */
  selectionRange: SourceRange;
}

export interface DefinitionRequest {
  /** Live text of the document the cursor is in. */
  text: string;
  /** Its path on disk, absent for an untitled or non-file document. */
  file?: string;
  position: { line: number; character: number };
  project: ProjectModel;
  /** Live text of any other open document, when the editor holds one. */
  liveText?: (file: string) => string | undefined;
}

const ZERO: SourceRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

/** Joins a namespace and a child, keeping `#.Foo` rather than `#..Foo`. */
function qualify(namespace: string, child: string): string {
  return namespace === '#' ? `#.${child}` : `${namespace}.${child}`;
}

/** The containing namespace of a qualified name, or undefined at the root. */
function parentOf(qualifiedName: string): string | undefined {
  if (qualifiedName === '#') return undefined;
  const segments = qualifiedName.split('.');
  segments.pop();
  return segments.length <= 1 ? '#' : segments.join('.');
}

/** Every symbol in a document, flattened. */
function allSymbols(symbols: AplSymbol[]): AplSymbol[] {
  return symbols.flatMap(symbol => [symbol, ...allSymbols(symbol.children)]);
}

/**
 * The one definition of `name` in this source, or undefined when there is none
 * or more than one. Two definitions of a name in one file is exactly the sort of
 * ambiguity that must not resolve.
 */
export function uniqueSymbolNamed(source: string, name: string): AplSymbol | undefined {
  const matches = allSymbols(extractSymbols(source)).filter(symbol => symbol.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Turns a project object into a target, preferring the live text of the target
 * file when the editor has it open.
 *
 * The project model is filesystem-backed on purpose — the source tree is the
 * authority — so an edited but unsaved *identity* still reads as it does on
 * disk. Where the file is open, though, its ranges are recomputed from the live
 * text, so navigation lands in the right place in a buffer that has moved.
 */
function targetFor(object: ProjectObject, liveText?: (file: string) => string | undefined): DefinitionTarget {
  const live = liveText?.(object.location.file);
  if (live !== undefined) {
    const symbol = uniqueSymbolNamed(live, object.name);
    if (symbol) {
      return { file: object.location.file, range: symbol.range, selectionRange: symbol.selectionRange };
    }
  }

  // A bare dfn in a .aplf takes its name from the filename and declares nothing
  // in its own source, so there is no name to select; the start of the file is
  // the honest destination.
  return {
    file: object.location.file,
    range: object.location.range ?? ZERO,
    selectionRange: object.location.selectionRange ?? object.location.range ?? ZERO
  };
}

/** Builds the namespace a reference is anchored to, or undefined. */
function baseNamespace(reference: NameReference, request: DefinitionRequest): string | undefined {
  if (reference.rootQualified) return '#';
  if (!request.file) return undefined;

  const current = request.project.namespaceNameForFile(request.file);
  if (current === undefined) return undefined;

  let namespace = current;
  for (let level = 0; level < reference.parentLevels; level++) {
    const parent = parentOf(namespace);
    if (parent === undefined) return undefined; // above the root: nothing there
    namespace = parent;
  }
  return namespace;
}

/** The definition a cursor points at, or undefined when nothing is certain. */
export function resolveDefinition(request: DefinitionRequest): DefinitionTarget | undefined {
  const lines = splitLines(request.text);
  const line = lines[request.position.line];
  if (line === undefined) return undefined;

  const reference = nameAt(line, request.position.character, request.position.line);
  if (!reference || reference.systemQualified) return undefined;

  const anchored = reference.rootQualified || reference.parentLevels > 0;

  // ---- a bare name
  if (reference.qualifiers.length === 0 && !anchored) {
    // A definition in this very file wins, and is read from the live text so an
    // unsaved edit navigates correctly.
    const local = uniqueSymbolNamed(request.text, reference.name);
    if (local) {
      return { file: request.file, range: local.range, selectionRange: local.selectionRange };
    }

    // Assigned, localised or an argument here: a local, not a project object.
    if (isLocallyBound(reference.name, lines)) return undefined;

    if (!request.file) return undefined;
    const namespace = request.project.namespaceNameForFile(request.file);
    if (namespace === undefined) return undefined;

    // The current space only. See the note on ⎕PATH at the top of this file.
    const found = request.project.resolveFrom(request.file, qualify(namespace, reference.name));
    if (found && 'location' in found) return targetFor(found, request.liveText);
    return undefined;
  }

  // ---- a qualified path
  const base = baseNamespace(reference, request);
  if (base === undefined || !request.file) return undefined;

  // Every qualifier must be a real namespace before the dots may be read as
  // namespace references at all.
  let namespace = base;
  for (const qualifier of reference.qualifiers) {
    const candidate = qualify(namespace, qualifier);
    const resolved = request.project.resolveFrom(request.file, candidate);
    if (!resolved || 'location' in resolved) return undefined; // absent, or an object not a namespace
    namespace = candidate;
  }

  const found = request.project.resolveFrom(request.file, qualify(namespace, reference.name));
  if (found && 'location' in found) return targetFor(found, request.liveText);

  // A directory-backed namespace has no source file to navigate to.
  return undefined;
}

/** Exposed so the server can turn a path into the URI the client gave us. */
export function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}
