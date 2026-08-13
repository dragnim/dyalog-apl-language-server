import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  MarkupKind,
  Position,
  Range,
  TextDocumentChangeEvent
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { createRequire } from 'node:module';

import {
  GLYPHS,
  SYSTEM_NAMES,
  glyphFor,
  systemNameFor,
  describe,
  shortDescribe
} from './glyphs';

import { controlWordsFor, type ControlWordContext } from './control-words';

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

connection.onInitialize((params: InitializeParams): InitializeResult => {
  settings = DEFAULTS;
  applySettings((params.initializationOptions as Partial<Settings> | undefined) ?? {});

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [settings.prefixKey, '⎕', ':']
      },
      hoverProvider: true
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

const NAME_CHAR = /[A-Za-z0-9_∆⍙]/;

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
  const lines = doc.getText().split(/\r\n|\r|\n/);

  lines.forEach((line, lineNumber) => {
    let inString = false;
    let stringStart = 0;

    for (let col = 0; col < line.length; col++) {
      const char = line[col];

      if (inString) {
        if (char === "'") {
          if (line[col + 1] === "'") col++;
          else inString = false;
        }
        continue;
      }

      if (char === '⍝') break;

      if (char === "'") {
        inString = true;
        stringStart = col;
        continue;
      }

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

    if (inString) {
      diagnostics.push(
        diagnostic(lineNumber, stringStart, line.length - stringStart, 'Unclosed character literal')
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
