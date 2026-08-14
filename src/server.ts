import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  DefinitionParams,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  ErrorCodes,
  Location,
  LocationLink,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  MarkupKind,
  Position,
  PrepareRenameParams,
  Range,
  ReferenceParams,
  RenameParams,
  ResponseError,
  SymbolKind,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
  TextDocumentChangeEvent
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  GLYPHS,
  SYSTEM_NAMES,
  glyphFor,
  systemNameFor,
  describe,
  shortDescribe
} from './glyphs';

import { controlWordsFor, type ControlWordContext } from './control-words';

import { extractSymbols, type AplSymbol, type AplSymbolKind } from './analysis/symbols';
import { scanLines, NAME_CHARS } from './analysis/scanner';
import { ProjectModel } from './analysis/project';
import { resolveDefinition } from './analysis/definitions';
import { findReferences } from './analysis/references';
import { planRename, computeRename, isRefusal } from './analysis/rename';

import { KEYBOARD_LOCALES, glyphsForLocale, prefixKeyFor } from './keyboard';

/**
 * The one place the version is read. package.json is the single source; see
 * the note in README's Development section. Resolved at runtime rather than
 * inlined so that out/ and the packaged extension both find their own manifest.
 */
const { version: VERSION } = createRequire(__filename)('../package.json') as {
  version: string;
};

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

interface Settings {
  /** Character that starts a glyph completion. Doubled, it starts a name search. */
  prefixKey: string;
  /** Whether to report unbalanced brackets and unclosed strings. */
  diagnostics: boolean;
  /** Which keyboard layout the prefix keys follow. Layouts genuinely differ. */
  keyboardLocale: string;
}

const DEFAULTS: Settings = { prefixKey: '`', diagnostics: true, keyboardLocale: 'en_US' };
let settings: Settings = DEFAULTS;

/**
 * A prefix key has to be a single character that cannot appear in a name, or
 * the completion triggers would fire while typing ordinary identifiers. An
 * arbitrary string is rejected rather than half-honoured.
 */
export function validPrefixKey(key: unknown): key is string {
  return typeof key === 'string' && [...key].length === 1 && !/[A-Za-z0-9\s]/u.test(key);
}

function applySettings(incoming: Partial<Settings>): void {
  const merged = { ...settings, ...incoming };

  if (!validPrefixKey(merged.prefixKey)) {
    connection.console.warn(
      `Invalid prefix key ${JSON.stringify(merged.prefixKey)}: it must be a single ` +
        `character that is not a letter, digit or space. Falling back to ${JSON.stringify(
          DEFAULTS.prefixKey
        )}.`
    );
    merged.prefixKey = DEFAULTS.prefixKey;
  }

  if (!KEYBOARD_LOCALES.includes(merged.keyboardLocale as never)) {
    connection.console.warn(
      `Unknown keyboard locale "${merged.keyboardLocale}", falling back to en_US.`
    );
    merged.keyboardLocale = DEFAULTS.keyboardLocale;
  }

  settings = merged;
}

// -------------------------------------------------------------- project model

/**
 * The static ]Link project model. Always present, and empty when there is no
 * workspace: a client that opens a lone file with no folder must still get
 * completion, hover, symbols and diagnostics, none of which consult this.
 *
 * Go to definition (#10), find references (#11) and rename (#12) all consume it.
 * Workspace symbols (#13) will; no capability for that is advertised.
 */
let project = new ProjectModel();

/** Whether the client said it can send workspace/didChangeWorkspaceFolders. */
let clientSupportsFolderEvents = false;

/** Whether the client accepts LocationLink rather than plain Location. */
let clientSupportsDefinitionLinks = false;

/**
 * Whether the client said it can perform a file rename as part of a workspace
 * edit. Emitting one to a client that cannot would produce an edit it silently
 * drops or rejects, so it is only offered when advertised.
 */
let clientSupportsFileRename = false;

/** file:// URIs to filesystem paths, ignoring anything not on disk. */
function toFsPath(uri: string): string | undefined {
  if (!uri.startsWith('file:')) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/**
 * The folders the client gave us, newest LSP field first. `rootUri` and
 * `rootPath` are both deprecated but still all some clients send, and a client
 * may legitimately send none of the three.
 */
function workspaceDirectories(params: InitializeParams): string[] {
  if (params.workspaceFolders?.length) {
    return params.workspaceFolders
      .map(folder => toFsPath(folder.uri))
      .filter((p): p is string => p !== undefined);
  }
  if (params.rootUri) {
    const single = toFsPath(params.rootUri);
    if (single) return [single];
  }
  if (params.rootPath) return [params.rootPath];
  return [];
}

async function indexWorkspace(directories: string[]): Promise<void> {
  if (directories.length === 0) {
    project = new ProjectModel();
    connection.console.info('No workspace folder; project model is empty.');
    return;
  }
  try {
    project = await ProjectModel.index(directories);
    const objects = project.objects().length;
    const namespaces = project.namespaces().length;
    const problems = project.problems().length;
    connection.console.info(
      `Indexed ${objects} object(s) in ${namespaces} namespace(s) across ` +
        `${directories.length} root(s); ${problems} problem(s).`
    );
  } catch (error) {
    // Indexing must never take the server down: everything else still works.
    project = new ProjectModel();
    connection.console.warn(
      `Could not index the workspace: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  settings = DEFAULTS;
  applySettings((params.initializationOptions as Partial<Settings> | undefined) ?? {});

  clientSupportsFolderEvents = params.capabilities.workspace?.workspaceFolders === true;
  clientSupportsDefinitionLinks =
    params.capabilities.textDocument?.definition?.linkSupport === true;
  clientSupportsFileRename =
    params.capabilities.workspace?.workspaceEdit?.resourceOperations?.includes('rename') === true;

  // Indexing happens after the reply, so a large tree cannot delay startup.
  const directories = workspaceDirectories(params);
  void indexWorkspace(directories);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [settings.prefixKey, '⎕', ':']
      },
      hoverProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      workspace: {
        workspaceFolders: { supported: true, changeNotifications: true }
      }
    },
    serverInfo: { name: 'dyalog-apl-language-server', version: VERSION }
  };
});

connection.onDidChangeConfiguration(change => {
  const incoming = (change.settings as { dyalogApl?: Partial<Settings> } | undefined)?.dyalogApl;
  if (incoming) {
    const before = settings.prefixKey;
    applySettings(incoming);
    if (settings.prefixKey !== before) {
      // triggerCharacters were fixed at initialize. The VS Code client restarts
      // the server when this setting changes; anything else needs a reload.
      connection.console.info(
        'The prefix key changed. Restart the language server for the completion ' +
          'trigger to follow it.'
      );
    }
  }
  for (const doc of documents.all()) publishDiagnostics(doc);
});

// ---------------------------------------------------------------- completion

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function glyphItem(
  glyph: (typeof GLYPHS)[number],
  range: Range,
  filterText: string,
  sortText: string
): CompletionItem {
  return {
    label: glyph.g,
    kind: CompletionItemKind.Operator,
    detail: shortDescribe(glyph),
    documentation: {
      kind: MarkupKind.Markdown,
      value: describe(glyph, settings.prefixKey, prefixKeyFor(glyph.g, settings.keyboardLocale))
    },
    filterText,
    sortText,
    textEdit: { range, newText: glyph.g }
  };
}

function controlWordItems(context: ControlWordContext, range: Range): CompletionItem[] {
  return controlWordsFor(context).map(word => ({
    label: word.word,
    kind: CompletionItemKind.Keyword,
    detail: word.detail,
    filterText: word.word,
    textEdit: { range, newText: word.word }
  }));
}

connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const line = doc.getText({
    start: Position.create(params.position.line, 0),
    end: params.position
  });

  const pk = escapeRegExp(settings.prefixKey);
  const at = (startChar: number): Range =>
    Range.create(
      Position.create(params.position.line, startChar),
      Position.create(params.position.line, params.position.character)
    );

  // ``name — search glyphs by name, e.g. ``rho
  const byName = new RegExp(`${pk}${pk}([A-Za-z ]*)$`).exec(line);
  if (byName) {
    const query = byName[1].toLowerCase().trim();
    const range = at(byName.index);
    const items: CompletionItem[] = [];
    for (const glyph of GLYPHS) {
      // The alias that matched is the one the filter text has to be built from.
      // Using names[0] regardless meant the server found ⍴ for ``shape and then
      // handed the editor "``rho" to filter on, so the item vanished as the user
      // kept typing.
      const matched =
        query === ''
          ? glyph.names[0]
          : glyph.names.find(name => name.toLowerCase().includes(query));
      if (matched === undefined) continue;
      items.push(
        glyphItem(
          glyph,
          range,
          `${settings.prefixKey}${settings.prefixKey}${matched}`,
          glyph.names[0]
        )
      );
    }
    return items;
  }

  // `k — the traditional prefix layout, e.g. `r for ⍴
  const byKey = new RegExp(`${pk}([^${pk}\\s]?)$`).exec(line);
  if (byKey) {
    const range = at(byKey.index);
    const table = glyphsForLocale(settings.keyboardLocale);
    return Object.entries(table)
      .map(([char, key]) => {
        const glyph = glyphFor(char) ?? { g: char, glyphName: char, names: [char] };
        return glyphItem(glyph, range, `${settings.prefixKey}${key}`, key);
      });
  }

  // ⎕NAME — system names
  const bySystemName = /⎕([A-Za-z]*)$/.exec(line);
  if (bySystemName) {
    const range = at(bySystemName.index);
    return SYSTEM_NAMES.map(entry => ({
      label: entry.name,
      kind: CompletionItemKind.Function,
      detail: entry.desc,
      filterText: entry.name,
      textEdit: { range, newText: entry.name }
    }));
  }

  // :In and :InEach are the only colon words that may appear mid-statement, and
  // only inside a :For. Checked first: it is the more specific position.
  const inForClause = /(^|⋄)\s*:For\b[^⋄]*:([A-Za-z]*)$/i.exec(line);
  if (inForClause) {
    return controlWordItems('for-clause', at(line.lastIndexOf(':')));
  }

  // Every other colon word may only start a line or follow a ⋄.
  const byControlWord = /(^|⋄)\s*:([A-Za-z]*)$/.exec(line);
  if (byControlWord) {
    return controlWordItems('statement', at(line.lastIndexOf(':')));
  }

  return [];
});

// --------------------------------------------------------------------- hover

const NAME_CHAR = new RegExp(`[${NAME_CHARS}]`, 'u');

connection.onHover((params: HoverParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);

  for (const candidate of [offset, offset - 1]) {
    if (candidate < 0 || candidate >= text.length) continue;
    const hover = hoverAt(text, candidate, doc);
    if (hover) return hover;
  }
  return null;
});

function hoverAt(text: string, offset: number, doc: TextDocument): Hover | null {
  const char = text[offset];
  if (char === undefined || char === '\n' || char === '\r') return null;

  // Walk back to the start of a ⎕name, if we are inside one.
  if (NAME_CHAR.test(char) || char === '⎕') {
    let start = offset;
    while (start > 0 && NAME_CHAR.test(text[start - 1])) start--;
    if (text[start - 1] === '⎕') start--;
    if (text[start] === '⎕') {
      let end = start + 1;
      while (end < text.length && NAME_CHAR.test(text[end])) end++;
      const token = text.slice(start, end);
      const entry = systemNameFor(token);
      const range = Range.create(doc.positionAt(start), doc.positionAt(end));
      if (entry) {
        return {
          range,
          contents: {
            kind: MarkupKind.Markdown,
            value: `**${entry.name}** — ${entry.desc}`
          }
        };
      }
      if (token === '⎕') {
        const quad = glyphFor('⎕')!;
        return {
          range,
          contents: { kind: MarkupKind.Markdown, value: describe(quad, settings.prefixKey) }
        };
      }
      return null;
    }
    return null;
  }

  const glyph = glyphFor(char);
  if (!glyph) return null;

  return {
    range: Range.create(doc.positionAt(offset), doc.positionAt(offset + 1)),
    contents: {
      kind: MarkupKind.Markdown,
      value: describe(glyph, settings.prefixKey, prefixKeyFor(char, settings.keyboardLocale))
    }
  };
}

/**
 * Source files changing on disk. A create, delete or change is applied to just
 * that path; a rename reaches us as a delete plus a create, so it needs no case
 * of its own. Only a change to the folder set triggers a full rescan.
 */
connection.onDidChangeWatchedFiles(async change => {
  const paths = change.changes
    .map(event => toFsPath(event.uri))
    .filter((p): p is string => p !== undefined);
  for (const file of paths) await project.fileChanged(file);
});

/**
 * Registered only once the client has said it supports folder change events.
 * Touching this getter beforehand, or at all against a client that does not
 * support them, throws — which at module scope would take the whole server down
 * for every simple client.
 */
connection.onInitialized(() => {
  if (!clientSupportsFolderEvents) return;
  connection.workspace.onDidChangeWorkspaceFolders(() => {
    void connection.workspace.getWorkspaceFolders().then(folders => {
      const directories = (folders ?? [])
        .map(folder => toFsPath(folder.uri))
        .filter((p): p is string => p !== undefined);
      return indexWorkspace(directories);
    });
  });
});

/**
 * A saved buffer can change what a file declares, and therefore which object it
 * defines. Reindexing that one file is cheap; doing it on every keystroke would
 * not be, so this deliberately waits for the save.
 */
documents.onDidSave(event => {
  const file = toFsPath(event.document.uri);
  if (file) void project.fileChanged(file);
});

// ----------------------------------------------------------- document symbols

/**
 * LSP has no APL-shaped kinds, so these are the closest standard ones. A tradop
 * maps to SymbolKind.Operator, which exists precisely for higher-order things
 * and is what keeps operators visually distinct from functions in an outline.
 */
const SYMBOL_KINDS: Record<AplSymbolKind, SymbolKind> = {
  tradfn: SymbolKind.Function,
  tradop: SymbolKind.Operator,
  dfn: SymbolKind.Function,
  namespace: SymbolKind.Namespace,
  class: SymbolKind.Class,
  interface: SymbolKind.Interface
};

function toDocumentSymbol(symbol: AplSymbol): DocumentSymbol {
  return {
    name: symbol.name,
    kind: SYMBOL_KINDS[symbol.kind],
    detail: symbol.detail,
    range: Range.create(
      Position.create(symbol.range.start.line, symbol.range.start.character),
      Position.create(symbol.range.end.line, symbol.range.end.character)
    ),
    selectionRange: Range.create(
      Position.create(symbol.selectionRange.start.line, symbol.selectionRange.start.character),
      Position.create(symbol.selectionRange.end.line, symbol.selectionRange.end.character)
    ),
    children: symbol.children.map(toDocumentSymbol)
  };
}

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return extractSymbols(doc.getText()).map(toDocumentSymbol);
});

// -------------------------------------------------------------- definitions

const toRange = (range: { start: Position; end: Position }): Range =>
  Range.create(
    Position.create(range.start.line, range.start.character),
    Position.create(range.end.line, range.end.character)
  );

/**
 * Go to definition. All the judgement lives in analysis/definitions.ts; this
 * only turns paths into URIs and picks the reply shape the client asked for.
 */
connection.onDefinition((params: DefinitionParams): Location | LocationLink[] | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const target = resolveDefinition({
    text: doc.getText(),
    file: toFsPath(params.textDocument.uri),
    position: params.position,
    project,
    // Another open buffer may have moved since it was last saved.
    liveText: liveTextOf
  });
  if (!target) return null;

  const uri = target.file === undefined ? params.textDocument.uri : pathToFileURL(target.file).href;

  if (clientSupportsDefinitionLinks) {
    return [
      {
        targetUri: uri,
        targetRange: toRange(target.range),
        targetSelectionRange: toRange(target.selectionRange)
      }
    ];
  }
  return { uri, range: toRange(target.selectionRange) };
});

/** The live text of any open buffer, so unsaved edits are what gets analysed. */
function liveTextOf(file: string): string | undefined {
  for (const open of documents.all()) {
    const openPath = toFsPath(open.uri);
    if (openPath && openPath === file) return open.getText();
  }
  return undefined;
}

/**
 * Find references. Every judgement lives in analysis/references.ts, which
 * proves each occurrence by resolving it rather than matching its spelling.
 */
connection.onReferences(async (params: ReferenceParams): Promise<Location[] | null> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const { locations } = await findReferences({
    text: doc.getText(),
    file: toFsPath(params.textDocument.uri),
    position: params.position,
    project,
    includeDeclaration: params.context?.includeDeclaration ?? true,
    liveText: liveTextOf
  });

  return locations.map(location => ({
    uri: location.file === undefined ? params.textDocument.uri : pathToFileURL(location.file).href,
    range: toRange(location.range)
  }));
});

// -------------------------------------------------------------------- rename

/**
 * prepareRename. Returns the range the editor should let the user edit, or an
 * error carrying the reason it refused, which clients surface to the user.
 * Eligibility comes from the same planRename the rename itself calls.
 */
connection.onPrepareRename((params: PrepareRenameParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const plan = planRename({
    text: doc.getText(),
    file: toFsPath(params.textDocument.uri),
    position: params.position,
    project,
    liveText: liveTextOf
  });

  if (isRefusal(plan)) {
    return new ResponseError(ErrorCodes.InvalidRequest, plan.detail);
  }
  return { range: toRange(plan.range), placeholder: plan.placeholder };
});

/**
 * rename. The edit set is the proven reference set from #11, so only the final
 * identifier of a qualified path is replaced and nothing that merely shares the
 * spelling is touched.
 *
 * documentChanges is used rather than changes, because a file rename has to be a
 * resource operation and the two must arrive in one edit to be applied together.
 */
connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | ResponseError> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return new ResponseError(ErrorCodes.InvalidRequest, 'That document is not open.');

  const result = await computeRename({
    text: doc.getText(),
    file: toFsPath(params.textDocument.uri),
    position: params.position,
    project,
    newName: params.newName,
    clientSupportsFileRename,
    liveText: liveTextOf
  });

  if (isRefusal(result)) {
    return new ResponseError(ErrorCodes.InvalidRequest, result.detail);
  }

  // Group the edits by document, preserving the order they were proved in.
  const byUri = new Map<string, TextEdit[]>();
  for (const edit of result.edits) {
    const uri =
      edit.file === undefined ? params.textDocument.uri : pathToFileURL(edit.file).href;
    const list = byUri.get(uri) ?? [];
    list.push({ range: toRange(edit.range), newText: edit.newText });
    byUri.set(uri, list);
  }

  const documentChanges: (TextDocumentEdit | { kind: 'rename'; oldUri: string; newUri: string })[] =
    [];
  for (const [uri, edits] of [...byUri.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const open = documents.get(uri);
    documentChanges.push({
      textDocument: { uri, version: open ? open.version : null },
      edits
    });
  }

  // The file rename comes last, so the text edits apply to the old path.
  if (result.fileRename) {
    documentChanges.push({
      kind: 'rename',
      oldUri: pathToFileURL(result.fileRename.oldFile).href,
      newUri: pathToFileURL(result.fileRename.newFile).href
    });
  }

  return { documentChanges };
});

// --------------------------------------------------------------- diagnostics

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/**
 * Deliberately shallow: brackets and quotes only. It cannot know whether a name
 * is a function or an array, so it says nothing about that. Everything it
 * reports is something the interpreter would also reject.
 *
 * Brackets are balanced across the whole document, because array notation lets
 * a parenthesised expression span lines. Strings are per-line, because in APL
 * they cannot span lines.
 */
function analyse(doc: TextDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stack: { char: string; line: number; col: number }[] = [];

  // The scanner has already blanked out comments and character literals while
  // preserving every column, so brackets inside them simply are not here.
  scanLines(doc.getText()).forEach((line, lineNumber) => {
    for (let col = 0; col < line.code.length; col++) {
      const char = line.code[col];

      if (OPENERS[char]) {
        stack.push({ char, line: lineNumber, col });
        continue;
      }

      if (CLOSERS.has(char)) {
        const open = stack.pop();
        if (!open) {
          diagnostics.push(diagnostic(lineNumber, col, 1, `Unmatched ${char}`));
        } else if (OPENERS[open.char] !== char) {
          diagnostics.push(
            diagnostic(
              lineNumber,
              col,
              1,
              `Mismatched ${char}: expected ${OPENERS[open.char]} to close the ${open.char} on line ${
                open.line + 1
              }`
            )
          );
        }
      }
    }

    if (line.unterminatedStringAt !== -1) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          line.unterminatedStringAt,
          line.text.length - line.unterminatedStringAt,
          'Unclosed character literal'
        )
      );
    }
  });

  for (const open of stack) {
    diagnostics.push(diagnostic(open.line, open.col, 1, `Unclosed ${open.char}`));
  }

  return diagnostics;
}

function diagnostic(line: number, col: number, length: number, message: string): Diagnostic {
  return {
    severity: DiagnosticSeverity.Error,
    range: Range.create(Position.create(line, col), Position.create(line, col + length)),
    message,
    source: 'dyalog-apl'
  };
}

function publishDiagnostics(doc: TextDocument): void {
  const diagnostics = settings.diagnostics ? analyse(doc) : [];
  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

documents.onDidChangeContent((event: TextDocumentChangeEvent<TextDocument>) => {
  publishDiagnostics(event.document);
});

documents.listen(connection);
connection.listen();
