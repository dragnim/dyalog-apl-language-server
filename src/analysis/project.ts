/**
 * A static model of a ]Link-style source tree.
 *
 * Everything here is derived from the filesystem and from the text of the files
 * themselves. Nothing asks an interpreter anything, and nothing ever will —
 * that is the permanent rule in docs/SCOPE.md, and it is what makes this work on
 * a machine with no Dyalog installed.
 *
 * LINK SEMANTICS, verified against Dyalog/link rather than assumed:
 *
 * - `StartupSession/Link/Utils.apln` defines the default extension-to-name-class
 *   table as (2 'apla') (3 'aplf') (4 'aplo') (9.1 'apln') (9.4 'aplc')
 *   (9.5 'apli'), so name class picks the extension and the extension therefore
 *   tells us the kind. Note that 3 covers both 3.1 tradfn and 3.2 dfn, and 4
 *   covers 4.1 and 4.2, so `.aplf` means "a function" without saying which sort.
 * - The same file lists CODE_EXTENSIONS as aplf, aplo, apln, aplc, apli, dyalog,
 *   apl and mipage. The last three carry no name class of their own: `.dyalog`
 *   is the legacy extension for anything, and Link's `Tail` appends it as a
 *   fallback for every class.
 * - Unscripted namespaces have no source of their own and are directories
 *   (name class ¯9.1, whose extension in `Tail` is literally '/').
 *   docs/Discussion/TechDetails.md.
 * - Arrays may carry a "sub-extension" recording a plain-text format:
 *   `.CR.apla`, `.LF.apla`, `.CRLF.apla`, `.vec.apla`, `.mat.apla`.
 *   docs/Usage/Arrays.md. So the object name for `Table.mat.apla` is `Table`,
 *   and naive extension stripping would produce `Table.mat`.
 * - `caseCode` appends a reverse-binary-in-octal case map to the basename, so
 *   `HelloWorld.apln` becomes `HelloWorld-41.apln`. docs/API/Link.CaseCode.md.
 *   An APL name cannot contain `-`, so such a suffix is unambiguous.
 * - `.linkconfig` is a JSON5 file in the linked directory whose `Settings` may
 *   change the mapping; `flatten` in particular loads everything into the root
 *   of the linked namespace regardless of subdirectories.
 *   docs/Usage/ConfigFiles.md and docs/API/Link.Create.md.
 * - "There must be exactly one file in the directory per named item"; more than
 *   one file defining the same object is an error Link reports on Create or
 *   Import. TechDetails.md. So a clash is recorded, and the name resolves to
 *   nothing rather than to an arbitrary winner.
 * - On import, Link "will not insist that file names match item names", and
 *   loads code with `2 ⎕FIX`, so the name the *source* declares is the one that
 *   actually comes into existence. docs/API/Link.Create.md, forceFilenames.
 *   The declared name therefore wins over the filename, and the disagreement is
 *   recorded for whatever later wants to report it.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { extractSymbols, type AplSymbol, type SourceRange } from './symbols';

// ------------------------------------------------------------------- model

export type ObjectKind =
  /** name class 2, `.apla` */
  | 'array'
  /** name class 3, tradfn or dfn, `.aplf` */
  | 'function'
  /** name class 4, tradop or dop, `.aplo` */
  | 'operator'
  /** name class 9.1, a scripted namespace, `.apln` */
  | 'namespace'
  /** name class 9.4, `.aplc` */
  | 'class'
  /** name class 9.5, `.apli` */
  | 'interface'
  /** `.apl`, `.dyalog`, `.mipage`: code whose class the extension does not state */
  | 'code';

export type ProjectProblem =
  /** Two or more files claim the same name in one namespace. Link rejects this. */
  | { kind: 'duplicate-definition'; name: string; paths: string[] }
  /** The script declares one name and the file is called another. */
  | { kind: 'name-mismatch'; path: string; declared: string; fromFilename: string }
  /** A filename that cannot be an APL name, so nothing can be mapped from it. */
  | { kind: 'unusable-filename'; path: string; reason: string };

export interface SourceLocation {
  /** Absolute path, in this platform's form. */
  file: string;
  /** Where the defining construct sits, when the source states it. */
  range?: SourceRange;
}

export interface ProjectObject {
  name: string;
  /** Display form, e.g. `#.Foo.Bar`. */
  qualifiedName: string;
  kind: ObjectKind;
  location: SourceLocation;
  /** Present when the source declared a name; that name wins. */
  declaredName?: string;
  /** Set when the filename disagrees with the declaration. */
  mismatchedFilename?: string;
}

export interface ProjectNamespace {
  name: string;
  /** Display form, `#` for a root. */
  qualifiedName: string;
  /** The directory backing this namespace. */
  directory: string;
  /** Objects by name. A name with more than one entry is a Link error. */
  objects: Map<string, ProjectObject[]>;
  /** Child namespaces, i.e. subdirectories. */
  namespaces: Map<string, ProjectNamespace>;
}

/** Settings from `.linkconfig` that change how the tree is interpreted. */
export interface LinkSettings {
  flatten: boolean;
  caseCode: boolean;
  /** Extra code extensions, without the dot. */
  codeExtensions: string[];
}

const DEFAULT_SETTINGS: LinkSettings = { flatten: false, caseCode: false, codeExtensions: [] };

// -------------------------------------------------------------- extensions

/** The extensions whose name class Link fixes by default. */
const KIND_BY_EXTENSION: Record<string, ObjectKind> = {
  apla: 'array',
  aplf: 'function',
  aplo: 'operator',
  apln: 'namespace',
  aplc: 'class',
  apli: 'interface'
};

/** Code extensions that do not imply a name class. */
const GENERIC_CODE_EXTENSIONS = ['dyalog', 'apl', 'mipage'];

/** Plain-text array formats, which sit before `.apla`. */
const ARRAY_SUB_EXTENSIONS = ['CR', 'LF', 'CRLF', 'vec', 'mat'];

const NAME_CHAR = /^[A-Za-z_∆⍙][A-Za-z0-9_∆⍙]*$/;

/** Directories never worth walking into. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  '.vscode',
  '.idea',
  '.vs'
]);

const MAX_DEPTH = 32;

export function isAplName(name: string): boolean {
  return NAME_CHAR.test(name);
}

/**
 * Undoes `caseCode`. The suffix is a reverse binary map of which characters are
 * uppercase, written in octal, so bit i of the value corresponds to character i.
 * `HelloWorld-41` decodes to 41₈ = 33₁₀ = bits 0 and 5, giving H and W.
 */
export function decodeCaseCode(stem: string): { name: string; hadCaseCode: boolean } {
  const match = /^(.*)-([0-7]+)$/.exec(stem);
  if (!match) return { name: stem, hadCaseCode: false };

  const [, base, octal] = match;
  const bits = Number.parseInt(octal, 8);
  if (!Number.isSafeInteger(bits)) return { name: stem, hadCaseCode: false };

  const characters = [...base].map((char, index) =>
    (bits >> index) & 1 ? char.toUpperCase() : char.toLowerCase()
  );
  return { name: characters.join(''), hadCaseCode: true };
}

export interface FileIdentity {
  /** Object name taken from the filename. */
  name: string;
  kind: ObjectKind;
  /** The extension that decided the kind, without a dot. */
  extension: string;
}

/**
 * Reads what a filename alone says. Returns undefined for anything Link would
 * not treat as source, and for names that could not be APL names.
 */
export function identifyFile(fileName: string, settings = DEFAULT_SETTINGS): FileIdentity | undefined {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0) return undefined; // no extension, or a dotfile

  const extension = fileName.slice(lastDot + 1);
  const known =
    KIND_BY_EXTENSION[extension] ??
    (GENERIC_CODE_EXTENSIONS.includes(extension) || settings.codeExtensions.includes(extension)
      ? 'code'
      : undefined);
  if (!known) return undefined;

  let stem = fileName.slice(0, lastDot);

  // An array may record its plain-text format in a sub-extension.
  if (known === 'array') {
    const subDot = stem.lastIndexOf('.');
    if (subDot > 0 && ARRAY_SUB_EXTENSIONS.includes(stem.slice(subDot + 1))) {
      stem = stem.slice(0, subDot);
    }
  }

  const decoded = decodeCaseCode(stem);
  const name = settings.caseCode || decoded.hadCaseCode ? decoded.name : stem;

  if (!isAplName(name)) return undefined;
  return { name, kind: known, extension };
}

// ------------------------------------------------------- declared identity

/** The name a script or tradfn states for itself, if it states one. */
export function declaredIdentity(
  source: string,
  kind: ObjectKind
): { name: string; kind: ObjectKind; range: SourceRange } | undefined {
  const top: AplSymbol[] = extractSymbols(source);
  if (top.length !== 1) return undefined; // Link forbids multiple names per file

  const symbol = top[0];
  const mapped: Record<AplSymbol['kind'], ObjectKind> = {
    namespace: 'namespace',
    class: 'class',
    interface: 'interface',
    tradfn: 'function',
    tradop: 'operator',
    dfn: 'function'
  };
  const declaredKind = mapped[symbol.kind];

  // A dfn assignment inside a .aplf is the file's own name repeated, not a
  // declaration Link would honour: the source of a dfn object is just the dfn.
  // Only take a declaration from a script or a ∇ definition.
  if (symbol.kind === 'dfn') return undefined;

  // The extension states a class for all but generic code files; trust the
  // source when the two disagree only in specificity.
  if (kind !== 'code' && declaredKind !== kind) {
    // e.g. a :Class inside a .apln. The source is what 2 ⎕FIX would create.
    return { name: symbol.name, kind: declaredKind, range: symbol.range };
  }

  return { name: symbol.name, kind: declaredKind, range: symbol.range };
}

// ------------------------------------------------------------------ config

/**
 * Reads the `Settings` that matter from a `.linkconfig`. The file is JSON5,
 * which JSON.parse cannot read, so this deliberately extracts only the few
 * scalar settings that change the mapping instead of pulling in a parser.
 * Anything it cannot read confidently is left at its default.
 */
export function parseLinkConfig(text: string): LinkSettings {
  const settings: LinkSettings = { ...DEFAULT_SETTINGS, codeExtensions: [] };

  const flag = (name: string): boolean | undefined => {
    const match = new RegExp(`\\b${name}\\s*:\\s*(1|0|true|false)\\b`, 'i').exec(text);
    if (!match) return undefined;
    return match[1] === '1' || match[1].toLowerCase() === 'true';
  };

  settings.flatten = flag('flatten') ?? false;
  settings.caseCode = flag('caseCode') ?? false;
  return settings;
}

async function readSettings(directory: string): Promise<LinkSettings> {
  try {
    const text = await fs.readFile(path.join(directory, '.linkconfig'), 'utf8');
    return parseLinkConfig(text);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// --------------------------------------------------------------- indexing

const joinName = (parent: string, child: string): string =>
  parent === '#' ? `#.${child}` : `${parent}.${child}`;

function emptyNamespace(name: string, qualifiedName: string, directory: string): ProjectNamespace {
  return { name, qualifiedName, directory, objects: new Map(), namespaces: new Map() };
}

export interface IndexOptions {
  /** Overrides the settings read from `.linkconfig`, for tests. */
  settings?: LinkSettings;
}

/**
 * One indexed source tree. A workspace may have several, and they stay separate:
 * a name in one root never resolves into another.
 */
export class ProjectRoot {
  readonly directory: string;
  settings: LinkSettings = { ...DEFAULT_SETTINGS };
  root: ProjectNamespace;
  problems: ProjectProblem[] = [];
  /** Every indexed file, so a path can be resolved back to its object. */
  private byFile = new Map<string, ProjectObject>();

  constructor(directory: string) {
    this.directory = directory;
    this.root = emptyNamespace('#', '#', directory);
  }

  async index(options: IndexOptions = {}): Promise<void> {
    this.settings = options.settings ?? (await readSettings(this.directory));
    this.root = emptyNamespace('#', '#', this.directory);
    this.problems = [];
    this.byFile.clear();
    await this.walk(this.directory, this.root, 0, new Set());
    this.detectDuplicates(this.root);
  }

  private async walk(
    directory: string,
    namespace: ProjectNamespace,
    depth: number,
    seen: Set<string>
  ): Promise<void> {
    if (depth > MAX_DEPTH) return;

    // Guard against symlink cycles by remembering resolved directories.
    let real = directory;
    try {
      real = await fs.realpath(directory);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;

        // A directory is an unscripted namespace, so it must be a valid APL
        // name. One that is not cannot be mapped, and is not descended into.
        if (!isAplName(entry.name)) {
          this.problems.push({
            kind: 'unusable-filename',
            path: full,
            reason: 'directory name is not a valid APL name'
          });
          continue;
        }

        // With flatten set, subdirectories contribute no namespace and their
        // contents land in the root of the link.
        if (this.settings.flatten) {
          await this.walk(full, this.root, depth + 1, seen);
          continue;
        }

        const child =
          namespace.namespaces.get(entry.name) ??
          emptyNamespace(entry.name, joinName(namespace.qualifiedName, entry.name), full);
        namespace.namespaces.set(entry.name, child);
        await this.walk(full, child, depth + 1, seen);
        continue;
      }

      if (!entry.isFile()) continue;
      await this.addFile(full, entry.name, namespace);
    }
  }

  private async addFile(
    full: string,
    fileName: string,
    namespace: ProjectNamespace
  ): Promise<void> {
    const identity = identifyFile(fileName, this.settings);
    if (!identity) return;

    let name = identity.name;
    let kind = identity.kind;
    let declaredName: string | undefined;
    let mismatchedFilename: string | undefined;
    let range: SourceRange | undefined;

    // Only read the file when its contents could name the object.
    if (kind !== 'array') {
      try {
        const source = await fs.readFile(full, 'utf8');
        const declared = declaredIdentity(source, kind);
        if (declared) {
          declaredName = declared.name;
          range = declared.range;
          kind = declared.kind;
          if (declared.name !== name) {
            mismatchedFilename = name;
            this.problems.push({
              kind: 'name-mismatch',
              path: full,
              declared: declared.name,
              fromFilename: name
            });
            // Link does not insist the two agree on import; 2 ⎕FIX creates the
            // name the source declares, so that is the one recorded.
            name = declared.name;
          }
        }
      } catch {
        // Unreadable: keep the filename-derived identity rather than nothing.
      }
    }

    const object: ProjectObject = {
      name,
      qualifiedName: joinName(namespace.qualifiedName, name),
      kind,
      location: { file: full, range },
      declaredName,
      mismatchedFilename
    };

    const existing = namespace.objects.get(name);
    if (existing) existing.push(object);
    else namespace.objects.set(name, [object]);
    this.byFile.set(full, object);
  }

  private detectDuplicates(namespace: ProjectNamespace): void {
    for (const [name, objects] of namespace.objects) {
      if (objects.length > 1) {
        this.problems.push({
          kind: 'duplicate-definition',
          name: objects[0].qualifiedName,
          paths: objects.map(o => o.location.file)
        });
      }
      void name;
    }
    for (const child of namespace.namespaces.values()) this.detectDuplicates(child);
  }

  /** The namespace backing a directory, creating nothing. */
  namespaceForDirectory(directory: string): ProjectNamespace | undefined {
    const relative = path.relative(this.directory, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    if (relative === '') return this.root;
    if (this.settings.flatten) return this.root;

    let current: ProjectNamespace | undefined = this.root;
    for (const part of relative.split(path.sep)) {
      current = current?.namespaces.get(part);
      if (!current) return undefined;
    }
    return current;
  }

  /** Whether a path is inside this root. */
  contains(file: string): boolean {
    const relative = path.relative(this.directory, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  objectForFile(file: string): ProjectObject | undefined {
    return this.byFile.get(file);
  }

  files(): string[] {
    return [...this.byFile.keys()];
  }

  /**
   * Re-reads one file. Handles creation, modification and deletion; a rename
   * arrives as a delete plus a create.
   */
  async updateFile(file: string): Promise<void> {
    const namespace = this.namespaceForDirectory(path.dirname(file));

    // Drop any previous entry for this path first.
    const previous = this.byFile.get(file);
    if (previous) {
      this.byFile.delete(file);
      const holder = this.namespaceForDirectory(path.dirname(file));
      const list = holder?.objects.get(previous.name);
      if (list && holder) {
        const remaining = list.filter(o => o.location.file !== file);
        if (remaining.length) holder.objects.set(previous.name, remaining);
        else holder.objects.delete(previous.name);
      }
    }
    this.problems = this.problems.filter(
      p => !('path' in p && p.path === file) && !('paths' in p && p.paths.includes(file))
    );

    let exists = true;
    try {
      const stat = await fs.stat(file);
      exists = stat.isFile();
    } catch {
      exists = false;
    }

    if (!exists) {
      this.detectDuplicatesFresh();
      return;
    }

    // A new file may sit in a directory that is not yet a namespace.
    if (!namespace) {
      await this.index({ settings: this.settings });
      return;
    }

    await this.addFile(file, path.basename(file), namespace);
    this.detectDuplicatesFresh();
  }

  private detectDuplicatesFresh(): void {
    this.problems = this.problems.filter(p => p.kind !== 'duplicate-definition');
    this.detectDuplicates(this.root);
  }
}

// ------------------------------------------------------------------ facade

/**
 * The whole workspace: zero or more independent roots.
 *
 * With no roots this is simply empty, and every query returns nothing. That is
 * the case when a client opens a single file with no folder, and it must stay
 * harmless — single-file features do not depend on any of this.
 */
export class ProjectModel {
  private roots: ProjectRoot[] = [];

  static async index(directories: string[], options: IndexOptions = {}): Promise<ProjectModel> {
    const model = new ProjectModel();
    for (const directory of directories) {
      const root = new ProjectRoot(directory);
      await root.index(options);
      model.roots.push(root);
    }
    return model;
  }

  get rootCount(): number {
    return this.roots.length;
  }

  get isEmpty(): boolean {
    return this.roots.length === 0;
  }

  rootDirectories(): string[] {
    return this.roots.map(r => r.directory);
  }

  problems(): ProjectProblem[] {
    return this.roots.flatMap(r => r.problems);
  }

  /** Every namespace in every root, roots included. */
  namespaces(): ProjectNamespace[] {
    const out: ProjectNamespace[] = [];
    const visit = (namespace: ProjectNamespace): void => {
      out.push(namespace);
      for (const child of namespace.namespaces.values()) visit(child);
    };
    for (const root of this.roots) visit(root.root);
    return out;
  }

  /** Every object in every root. */
  objects(): ProjectObject[] {
    return this.namespaces().flatMap(ns => [...ns.objects.values()].flat());
  }

  /** The object a file defines, or undefined if the file is not project source. */
  objectForFile(file: string): ProjectObject | undefined {
    for (const root of this.roots) {
      const found = root.objectForFile(file);
      if (found) return found;
    }
    return undefined;
  }

  /** The qualified name a file maps to. */
  qualifiedNameForFile(file: string): string | undefined {
    return this.objectForFile(file)?.qualifiedName;
  }

  /**
   * Resolves a qualified name such as `#.Foo.Bar`, searching each root
   * independently. Returns nothing when the name is ambiguous, which includes
   * the case Link itself rejects: two files defining one name.
   */
  resolve(qualifiedName: string): ProjectObject | ProjectNamespace | undefined {
    const matches: (ProjectObject | ProjectNamespace)[] = [];
    for (const namespace of this.namespaces()) {
      if (namespace.qualifiedName === qualifiedName) matches.push(namespace);
      for (const objects of namespace.objects.values()) {
        if (objects.length === 1 && objects[0].qualifiedName === qualifiedName) {
          matches.push(objects[0]);
        }
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** The direct children of a namespace, by qualified name. */
  childrenOf(qualifiedName: string): { objects: ProjectObject[]; namespaces: ProjectNamespace[] } {
    const namespaces: ProjectNamespace[] = [];
    const objects: ProjectObject[] = [];
    for (const namespace of this.namespaces()) {
      if (namespace.qualifiedName !== qualifiedName) continue;
      namespaces.push(...namespace.namespaces.values());
      objects.push(...[...namespace.objects.values()].filter(l => l.length === 1).map(l => l[0]));
    }
    return { objects, namespaces };
  }

  /** Applies a single file change, targeted rather than rescanning everything. */
  async fileChanged(file: string): Promise<boolean> {
    let touched = false;
    for (const root of this.roots) {
      if (!root.contains(file)) continue;
      await root.updateFile(file);
      touched = true;
    }
    return touched;
  }

  /** Full rescan, for when the folder set itself changes. */
  async reindex(options: IndexOptions = {}): Promise<void> {
    for (const root of this.roots) await root.index(options);
  }
}
