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

import {
  GLYPHS,
  SYSTEM_NAMES,
  CONTROL_WORDS,
  glyphFor,
  systemNameFor,
  describe,
  shortDescribe
} from './glyphs';

import { KEYBOARD_LOCALES, glyphsForLocale, prefixKeyFor } from './keyboard';

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

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const opts = params.initializationOptions as Partial<Settings> | undefined;
  settings = { ...DEFAULTS, ...(opts ?? {}) };
  if (!KEYBOARD_LOCALES.includes(settings.keyboardLocale as never)) {
    connection.console.warn(
      `Unknown keyboard locale "${settings.keyboardLocale}", falling back to en_US.`
    );
    settings.keyboardLocale = 'en_US';
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [settings.prefixKey, '⎕', ':']
      },
      hoverProvider: true
    },
    serverInfo: { name: 'dyalog-apl-language-server', version: '0.5.0' }
  };
});

connection.onDidChangeConfiguration(change => {
  const incoming = (change.settings as { dyalogApl?: Partial<Settings> } | undefined)?.dyalogApl;
  if (incoming) settings = { ...settings, ...incoming };
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
    return GLYPHS.filter(glyph =>
      query === '' || glyph.names.some(name => name.toLowerCase().includes(query))
    ).map(glyph =>
      glyphItem(
        glyph,
        range,
        `${settings.prefixKey}${settings.prefixKey}${glyph.names[0]}`,
        glyph.names[0]
      )
    );
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

  // :Keyword — control structures, only at the start of a statement
  const byControlWord = /(^|⋄)\s*:([A-Za-z]*)$/.exec(line);
  if (byControlWord) {
    const start = line.lastIndexOf(':');
    const range = at(start);
    return CONTROL_WORDS.map(word => ({
      label: word,
      kind: CompletionItemKind.Keyword,
      filterText: word,
      textEdit: { range, newText: word }
    }));
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
