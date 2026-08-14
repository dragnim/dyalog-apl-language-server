/**
 * Drives the server over stdio exactly as a real editor would, and asserts on
 * what comes back. Run with: npm run smoke
 *
 * This used to print the replies and exit 0 regardless, so a wrong answer looked
 * exactly like a right one. Every check below now decides the exit code; the
 * readable output is a side effect, not the point.
 *
 * Requires `npm run build` first, since it launches the compiled server.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { version: EXPECTED_VERSION } = createRequire(import.meta.url)(
  path.join(root, 'package.json')
);

// ------------------------------------------------------------------ harness

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(` FAIL  ${name}`);
    if (detail !== undefined) console.log(`         ${detail}`);
  }
}

const section = text => console.log(`\n\x1b[1m${text}\x1b[0m`);

// ------------------------------------------------------------------- client

const SOURCE = [
  '⍝ average of a vector',
  'avg←{(+/⍵)÷≢⍵}',
  'shape←⍴⍵',
  '⎕IO←0',
  'broken←{(+/⍵)÷≢⍵',
  'x←`r',
  'y←``rho',
  'z←⎕N',
  'w←``shape',
  'v←``rotate',
  ':For i :I',
  ':E'
].join('\n');

/**
 * A document that must produce no diagnostics at all. The unbalanced brackets
 * inside the literal and the comment are the point: they are what proves the
 * shared scanner is masking them before the bracket check ever sees them.
 */
const CLEAN_SOURCE = [
  '⍝ nothing wrong here ( [ {',
  "msg←'don''t'",
  "unmatched←'( [ {'",
  'avg←{(+/⍵)÷≢⍵}',
  'nested←(1 2)(3 4)',
  'arr←(',
  '  1 2',
  ')'
].join('\n');

/** Exercised through a real textDocument/documentSymbol request. */
const SYMBOL_SOURCE = [
  '⍝ :Class NotAClass',
  ':Namespace Stats',
  '',
  '    ∇R←Mean X;n',
  '     n←≢X',
  '     R←(+/X)÷n',
  '    ∇',
  '',
  '    ∇R←(LO Over)Y',
  '     R←LO Y',
  '    ∇',
  '',
  '    Median←{',
  "        ⍝ a } that must not close this",
  '        s←⍵[⍋⍵]',
  '        s[⌈2÷⍨≢s]',
  '    }',
  '',
  '    threshold←0.5',
  '',
  ':EndNamespace'
].join('\n');

const server = spawn(process.execPath, [path.join(root, 'bin', 'dyalog-apl-language-server.js')], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let nextId = 1;
const pending = new Map();
const notifications = [];

function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

/** Resolves with the whole reply, so an error response can be inspected. */
function requestRaw(method, params) {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}

/** Resolves with just the result, which is undefined for an error reply. */
async function request(method, params) {
  return (await requestRaw(method, params)).result;
}

let buffer = Buffer.alloc(0);
server.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const length = Number(/Content-Length: (\d+)/i.exec(header)[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
    buffer = buffer.subarray(headerEnd + 4 + length);
    const message = JSON.parse(body);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method) {
      notifications.push(message);
    }
  }
});

const uri = 'file:///tmp/sample.aplf';
const cleanUri = 'file:///tmp/clean.aplf';
const symbolUri = 'file:///tmp/symbols.apln';
const at = (line, character, docUri = uri) => ({
  textDocument: { uri: docUri },
  position: { line, character }
});
const diagnosticsFor = u =>
  notifications
    .filter(n => n.method === 'textDocument/publishDiagnostics' && n.params.uri === u)
    .flatMap(n => n.params.diagnostics);

// --------------------------------------------------------------- initialise

section('initialize');

// A real ]Link-shaped tree, so workspace indexing is exercised through the
// actual initialize handshake rather than only in unit tests.
const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'apl-smoke-'));
await fsp.mkdir(path.join(workspace, 'Stats'), { recursive: true });
await fsp.writeFile(path.join(workspace, 'Stats', 'Mean.aplf'), '∇R←Mean X\n R←X\n∇\n', 'utf8');
await fsp.writeFile(path.join(workspace, 'Stats', 'Sum.aplf'), '{+/⍵}\n', 'utf8');
await fsp.writeFile(path.join(workspace, 'README.md'), '# not source\n', 'utf8');

const init = await request('initialize', {
  processId: process.pid,
  rootUri: null,
  workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: 'fixture' }],
  capabilities: {
    workspace: { workspaceFolders: true },
    textDocument: { definition: { linkSupport: true } }
  },
  initializationOptions: { prefixKey: '`', diagnostics: true, keyboardLocale: 'en_GB' }
});
send({ method: 'initialized', params: {} });

check(
  'server name is dyalog-apl-language-server',
  init.serverInfo?.name === 'dyalog-apl-language-server',
  `got ${JSON.stringify(init.serverInfo?.name)}`
);
check(
  `advertised version matches package.json (${EXPECTED_VERSION})`,
  init.serverInfo?.version === EXPECTED_VERSION,
  `got ${JSON.stringify(init.serverInfo?.version)}`
);
check(
  'completion capability is advertised',
  Boolean(init.capabilities?.completionProvider),
  `capabilities: ${Object.keys(init.capabilities ?? {}).join(', ')}`
);
check('hover capability is advertised', init.capabilities?.hoverProvider === true);
check(
  'document symbol capability is advertised',
  init.capabilities?.documentSymbolProvider === true,
  `capabilities: ${Object.keys(init.capabilities ?? {}).join(', ')}`
);
check(
  'prefix key is a completion trigger',
  init.capabilities?.completionProvider?.triggerCharacters?.includes('`') === true,
  `triggers: ${JSON.stringify(init.capabilities?.completionProvider?.triggerCharacters)}`
);

// -------------------------------------------------------------- diagnostics

send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId: 'apl', version: 1, text: SOURCE } }
});
send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri: cleanUri, languageId: 'apl', version: 1, text: CLEAN_SOURCE } }
});
send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri: symbolUri, languageId: 'apl', version: 1, text: SYMBOL_SOURCE } }
});

await new Promise(resolve => setTimeout(resolve, 400));

section('diagnostics');

const diagnostics = diagnosticsFor(uri);
const unclosed = diagnostics.find(d => /Unclosed \{/.test(d.message));
check(
  'the unclosed { on line 5 is reported',
  Boolean(unclosed),
  `got: ${diagnostics.map(d => d.message).join('; ') || '(none)'}`
);
check(
  'it points at line 5',
  unclosed?.range.start.line === 4,
  `got line ${unclosed ? unclosed.range.start.line + 1 : '?'}`
);
check(
  'it is reported as an error',
  unclosed?.severity === 1,
  `got severity ${unclosed?.severity}`
);
check('it is attributed to this server', unclosed?.source === 'dyalog-apl');

const cleanDiagnostics = diagnosticsFor(cleanUri);
check(
  'a valid document produces no diagnostics',
  cleanDiagnostics.length === 0,
  `got: ${cleanDiagnostics.map(d => `line ${d.range.start.line + 1}: ${d.message}`).join('; ')}`
);

// --------------------------------------------------------------------- hover

section('hover');

const hoverGlyph = await request('textDocument/hover', at(2, 6));
const glyphText = hoverGlyph?.contents?.value ?? '';
check('hover on ⍴ returns something', Boolean(hoverGlyph));
check('it names Rho', /Rho/.test(glyphText), glyphText.split('\n')[0]);
check('it gives the monadic meaning Shape', /Monadic:\s*Shape/.test(glyphText));
check('it gives the dyadic meaning Reshape', /Dyadic:\s*Reshape/.test(glyphText));

const hoverQuad = await request('textDocument/hover', at(3, 1));
const quadText = hoverQuad?.contents?.value ?? '';
check('hover on ⎕IO returns something', Boolean(hoverQuad));
check('it identifies ⎕IO', /⎕IO/.test(quadText), quadText);

// ---------------------------------------------------------- key completion

section('prefix key completion');

const byKey = await request('textDocument/completion', at(5, 4));
const rho = byKey.find(i => i.label === '⍴');
check('`r offers ⍴', rho?.filterText === '`r', `⍴ filterText was ${JSON.stringify(rho?.filterText)}`);
check('the edit inserts ⍴', rho?.textEdit?.newText === '⍴');

// The locale matters: ≢ is prefix-@ on a British keyboard, prefix-" on a US one.
const notMatch = byKey.find(i => i.label === '≢');
check(
  'en_GB maps ≢ to `@',
  notMatch?.filterText === '`@',
  `got ${JSON.stringify(notMatch?.filterText)}`
);
check(
  'en_GB does not report the US mapping `"',
  notMatch?.filterText !== '`"',
  `got ${JSON.stringify(notMatch?.filterText)}`
);

// --------------------------------------------------------- name completion

section('name search completion');

/** Ask for completion at the end of a line and find the item for a glyph. */
async function nameSearch(line, character, glyph) {
  const items = await request('textDocument/completion', at(line, character));
  return items.find(i => i.label === glyph);
}

const byName = await nameSearch(6, 7, '⍴');
check('``rho offers ⍴', Boolean(byName));
check(
  '``rho filter text matches what was typed',
  byName?.filterText === '``rho',
  `got ${JSON.stringify(byName?.filterText)}`
);

// The regression: these are secondary aliases. The server found the glyph but
// used to hand back filterText built from the first alias, so the editor
// filtered the item straight back out again.
const byShape = await nameSearch(8, 9, '⍴');
check('``shape offers ⍴', Boolean(byShape));
check(
  '``shape filter text matches what was typed',
  byShape?.filterText === '``shape',
  `got ${JSON.stringify(byShape?.filterText)}`
);

const byRotate = await nameSearch(9, 10, '⌽');
check('``rotate offers ⌽', Boolean(byRotate));
check(
  '``rotate filter text matches what was typed',
  byRotate?.filterText === '``rotate',
  `got ${JSON.stringify(byRotate?.filterText)}`
);

// ------------------------------------------------------ system completion

section('system name completion');

const bySystemName = await request('textDocument/completion', at(7, 4));
const systemLabels = bySystemName.map(i => i.label);
check(
  '⎕N offers ⎕NGET',
  systemLabels.includes('⎕NGET'),
  `offered: ${systemLabels.slice(0, 8).join(' ')}`
);
check('⎕N offers ⎕NC', systemLabels.includes('⎕NC'));
check(
  'every system completion carries a description',
  bySystemName.every(i => typeof i.detail === 'string' && i.detail.length > 0)
);

// ----------------------------------------------------- control completion

section('colon word completion');

const inFor = await request('textDocument/completion', at(10, 9));
const forLabels = inFor.map(i => i.label);
check(':For ... :I offers :In', forLabels.includes(':In'), `offered: ${forLabels.join(' ')}`);
check(':For ... :I offers :InEach', forLabels.includes(':InEach'));
check(
  ':For ... :I does not offer :If',
  !forLabels.includes(':If'),
  `offered: ${forLabels.join(' ')}`
);

const atStatement = await request('textDocument/completion', at(11, 2));
const statementLabels = atStatement.map(i => i.label);
check(':E at statement start offers :EndIf', statementLabels.includes(':EndIf'));
check(':E at statement start offers :End', statementLabels.includes(':End'));
check(
  ':E at statement start offers :EndDisposable',
  statementLabels.includes(':EndDisposable'),
  'the audited keyword set should include it'
);
check(
  ':In is not offered at statement start',
  !statementLabels.includes(':In'),
  'it is only legal inside a :For'
);
check(
  'every colon completion carries a description',
  atStatement.every(i => typeof i.detail === 'string' && i.detail.length > 0)
);

// ---------------------------------------------------------- document symbols

section('document symbols');

// LSP SymbolKind, from the specification.
const KIND = { Class: 5, Method: 6, Function: 12, Operator: 25, Namespace: 3, Interface: 11 };

const symbols = await request('textDocument/documentSymbol', {
  textDocument: { uri: symbolUri }
});

check(
  'one top-level symbol, the namespace',
  Array.isArray(symbols) && symbols.length === 1 && symbols[0].name === 'Stats',
  `got ${JSON.stringify((symbols ?? []).map(s => s.name))}`
);
check('it is reported as a namespace', symbols?.[0]?.kind === KIND.Namespace, `kind ${symbols?.[0]?.kind}`);
check(
  'the class named only in a comment is not a symbol',
  !JSON.stringify(symbols).includes('NotAClass')
);

const children = symbols?.[0]?.children ?? [];
check(
  'its three definitions are children, in source order',
  children.map(c => c.name).join(',') === 'Mean,Over,Median',
  `got ${children.map(c => c.name).join(',')}`
);
check('Mean is a function', children[0]?.kind === KIND.Function, `kind ${children[0]?.kind}`);
check(
  'Over is an operator, not a function',
  children[1]?.kind === KIND.Operator,
  `kind ${children[1]?.kind} — the (LO Over)Y header makes it a tradop`
);
check('Median is a function', children[2]?.kind === KIND.Function);
check(
  'the plain variable threshold is not a symbol',
  !JSON.stringify(symbols).includes('threshold')
);

// Ranges are what the editor navigates with, so they are checked against the
// actual source rather than merely being present.
const symbolLines = SYMBOL_SOURCE.split('\n');
const textOf = r =>
  r.start.line === r.end.line
    ? symbolLines[r.start.line].slice(r.start.character, r.end.character)
    : `${r.start.line}..${r.end.line}`;

check(
  'the namespace range spans :Namespace to :EndNamespace',
  symbols?.[0]?.range.start.line === 1 && symbols?.[0]?.range.end.line === 20,
  JSON.stringify(symbols?.[0]?.range)
);
check(
  'selecting Mean selects the name alone',
  textOf(children[0]?.selectionRange) === 'Mean',
  JSON.stringify(textOf(children[0]?.selectionRange))
);
check(
  'selecting Over selects the operator name alone',
  textOf(children[1]?.selectionRange) === 'Over',
  JSON.stringify(textOf(children[1]?.selectionRange))
);
check(
  'Mean spans its header through its closing ∇',
  children[0]?.range.start.line === 3 && children[0]?.range.end.line === 6,
  JSON.stringify(children[0]?.range)
);
check(
  'the dfn runs past the } inside its comment to the real closing brace',
  children[2]?.range.start.line === 12 && children[2]?.range.end.line === 16,
  JSON.stringify(children[2]?.range)
);

// The clean document holds one dfn among several ordinary assignments, and has
// unbalanced brackets inside a literal and a comment. Exactly one symbol should
// come back, which checks detection and masking at the same time.
const cleanSymbols = await request('textDocument/documentSymbol', {
  textDocument: { uri: cleanUri }
});
check(
  'only the dfn is a symbol; msg, unmatched, nested and arr are not',
  Array.isArray(cleanSymbols) &&
    cleanSymbols.length === 1 &&
    cleanSymbols[0].name === 'avg',
  `got ${JSON.stringify((cleanSymbols ?? []).map(s => s.name))}`
);

// ------------------------------------------------------------ project model

section('workspace project model');

// Indexing is deliberately started after initialize replies so a large tree
// cannot delay startup, so give it a moment to land.
await new Promise(resolve => setTimeout(resolve, 500));

const logs = notifications
  .filter(n => n.method === 'window/logMessage')
  .map(n => n.params.message);
const indexed = logs.find(m => m.startsWith('Indexed '));

check(
  'the workspace folder was indexed at startup',
  indexed !== undefined,
  `log messages: ${JSON.stringify(logs)}`
);
check(
  'it found the two source files and ignored README.md',
  /Indexed 2 object\(s\)/.test(indexed ?? ''),
  indexed
);
check(
  'across the root and the Stats namespace',
  /in 2 namespace\(s\)/.test(indexed ?? ''),
  indexed
);
check('with no problems', /0 problem\(s\)/.test(indexed ?? ''), indexed);
check(
  'workspace folder support is advertised',
  init.capabilities?.workspace?.workspaceFolders?.supported === true,
  JSON.stringify(init.capabilities?.workspace)
);

// Go to definition (#10), find references (#11) and rename (#12) consume the
// model. Workspace symbols (#13) does not exist yet and must not be claimed.
check(
  'workspaceSymbolProvider is not advertised',
  init.capabilities?.workspaceSymbolProvider === undefined,
  `got ${JSON.stringify(init.capabilities?.workspaceSymbolProvider)}`
);

// ---------------------------------------------------------- go to definition

section('go to definition');

check(
  'definitionProvider is advertised',
  init.capabilities?.definitionProvider === true,
  JSON.stringify(init.capabilities?.definitionProvider)
);

// A caller inside the same Link namespace as Mean and Sum.
const callerPath = path.join(workspace, 'Stats', 'Caller.aplf');
const callerUri = pathToFileURL(callerPath).href;
const meanUri = pathToFileURL(path.join(workspace, 'Stats', 'Mean.aplf')).href;
const sumUri = pathToFileURL(path.join(workspace, 'Stats', 'Sum.aplf')).href;

const CALLER = [
  '∇R←Caller X',
  ' R←#.Stats.Mean X',
  ' R←Mean R',
  ' R←Sum R',
  ' ⍝ Mean in a comment',
  " t←'#.Stats.Mean'",
  ' R←Missing R',
  ' ⎕IO←0',
  '∇'
].join('\n');

send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri: callerUri, languageId: 'apl', version: 1, text: CALLER } }
});

const definitionAt = (line, character) =>
  request('textDocument/definition', {
    textDocument: { uri: callerUri },
    position: { line, character }
  });

// This client asked for linkSupport, so it should get LocationLink[].
const rootQualified = await definitionAt(1, 14);
check(
  'a root-qualified name returns a LocationLink',
  Array.isArray(rootQualified) && rootQualified[0]?.targetUri !== undefined,
  JSON.stringify(rootQualified)
);
check(
  '#.Stats.Mean navigates to Mean.aplf',
  rootQualified?.[0]?.targetUri === meanUri,
  `${rootQualified?.[0]?.targetUri} vs ${meanUri}`
);
check(
  'and selects the name rather than the whole file',
  rootQualified?.[0]?.targetSelectionRange?.start?.character === 3 &&
    rootQualified?.[0]?.targetSelectionRange?.end?.character === 7,
  JSON.stringify(rootQualified?.[0]?.targetSelectionRange)
);

const bare = await definitionAt(2, 5);
check(
  'a bare sibling name navigates',
  bare?.[0]?.targetUri === meanUri,
  JSON.stringify(bare)
);

const bareDfn = await definitionAt(3, 5);
check(
  'a bare dfn file navigates to a sensible destination',
  bareDfn?.[0]?.targetUri === sumUri && bareDfn?.[0]?.targetSelectionRange?.start?.line === 0,
  JSON.stringify(bareDfn)
);

check(
  'a name in a comment returns nothing',
  (await definitionAt(4, 5)) === null,
  JSON.stringify(await definitionAt(4, 5))
);
check(
  'a name in a character literal returns nothing',
  (await definitionAt(5, 14)) === null,
  JSON.stringify(await definitionAt(5, 14))
);
check('an unknown name returns nothing', (await definitionAt(6, 6)) === null);
check('a system name returns nothing', (await definitionAt(7, 2)) === null);
check('a primitive returns nothing', (await definitionAt(1, 2)) === null);

// The live buffer differs from disk: navigation must follow the buffer.
send({
  method: 'textDocument/didOpen',
  params: {
    textDocument: {
      uri: meanUri,
      languageId: 'apl',
      version: 1,
      text: '⍝ inserted while unsaved\n∇R←Mean X\n R←X\n∇\n'
    }
  }
});
const afterEdit = await definitionAt(1, 14);
check(
  'navigation follows an unsaved edit in the target file',
  afterEdit?.[0]?.targetSelectionRange?.start?.line === 1,
  `${JSON.stringify(afterEdit?.[0]?.targetSelectionRange)} — on disk the header is line 0`
);

// ------------------------------------------------------------ find references

section('find references');

// The definition tests left Mean.aplf open with an unsaved line inserted above
// its header. Close it so these assertions describe the file as it is on disk.
send({ method: 'textDocument/didClose', params: { textDocument: { uri: meanUri } } });
await new Promise(resolve => setTimeout(resolve, 100));

check(
  'referencesProvider is advertised',
  init.capabilities?.referencesProvider === true,
  JSON.stringify(init.capabilities?.referencesProvider)
);

const referencesAt = (line, character, includeDeclaration = true) =>
  request('textDocument/references', {
    textDocument: { uri: callerUri },
    position: { line, character },
    context: { includeDeclaration }
  });

/** "basename:line:char", relative to the workspace, for readable assertions. */
const refShape = locations =>
  (locations ?? []).map(
    l => `${l.uri.split('/').pop()}:${l.range.start.line}:${l.range.start.character}`
  );

// The caller has two provable uses of Mean — the qualified one and the bare
// one — plus mentions in a comment and a string that must not count.
const refs = await referencesAt(1, 14);
check(
  'both real uses and the declaration are returned',
  refShape(refs).join(' ') === 'Caller.aplf:1:11 Caller.aplf:2:3 Mean.aplf:0:3',
  refShape(refs).join(' ')
);
check(
  'the mention in a comment is excluded',
  !refShape(refs).some(s => s.startsWith('Caller.aplf:4:')),
  refShape(refs).join(' ')
);
check(
  'the mention in a character literal is excluded',
  !refShape(refs).some(s => s.startsWith('Caller.aplf:5:')),
  refShape(refs).join(' ')
);
check(
  'each range covers exactly the name',
  (refs ?? []).every(l => l.range.end.character - l.range.start.character === 4),
  JSON.stringify((refs ?? []).map(l => l.range))
);

const withoutDecl = await referencesAt(1, 14, false);
check(
  'includeDeclaration:false drops the declaration only',
  refShape(withoutDecl).join(' ') === 'Caller.aplf:1:11 Caller.aplf:2:3',
  refShape(withoutDecl).join(' ')
);

// Starting from the bare use must give the same answer as the qualified one.
const fromBare = await referencesAt(2, 5);
check(
  'starting from a bare use gives the same set',
  refShape(fromBare).join(' ') === refShape(refs).join(' '),
  `${refShape(fromBare).join(' ')} vs ${refShape(refs).join(' ')}`
);

check(
  'a name in a comment yields no references',
  refShape(await referencesAt(4, 5)).length === 0,
  refShape(await referencesAt(4, 5)).join(' ')
);
check('a system name yields no references', refShape(await referencesAt(7, 2)).length === 0);

// ------------------------------------------------------------------- rename

section('rename');

check(
  'renameProvider is advertised with prepare support',
  init.capabilities?.renameProvider?.prepareProvider === true,
  JSON.stringify(init.capabilities?.renameProvider)
);

const prepareAt = (line, character) =>
  request('textDocument/prepareRename', {
    textDocument: { uri: callerUri },
    position: { line, character }
  });

const prepared = await prepareAt(1, 14);
check(
  'prepareRename returns the name range only',
  prepared?.range?.start?.character === 11 && prepared?.range?.end?.character === 15,
  JSON.stringify(prepared)
);
check('and the current name as placeholder', prepared?.placeholder === 'Mean', JSON.stringify(prepared));

const prepareRawAt = (line, character) =>
  requestRaw('textDocument/prepareRename', {
    textDocument: { uri: callerUri },
    position: { line, character }
  });

const commentPrepare = await prepareRawAt(4, 5);
check(
  'prepareRename refuses inside a comment, with a reason',
  commentPrepare.result == null && typeof commentPrepare.error?.message === 'string',
  JSON.stringify(commentPrepare)
);
const systemPrepare = await prepareRawAt(7, 2);
check(
  'prepareRename refuses a system name, saying so',
  systemPrepare.result == null && /System names/.test(systemPrepare.error?.message ?? ''),
  JSON.stringify(systemPrepare)
);

const renameAt = (line, character, newName) =>
  request('textDocument/rename', {
    textDocument: { uri: callerUri },
    position: { line, character },
    newName
  });

const edit = await renameAt(1, 14, 'Average');
check(
  'rename returns documentChanges',
  Array.isArray(edit?.documentChanges),
  JSON.stringify(edit)
);

/** "basename:line:char→text", flattened across documents. */
const editShape = workspaceEdit =>
  (workspaceEdit?.documentChanges ?? [])
    .filter(change => change.textDocument)
    .flatMap(change =>
      change.edits.map(
        e =>
          `${change.textDocument.uri.split('/').pop()}:${e.range.start.line}:` +
          `${e.range.start.character}-${e.range.end.character}→${e.newText}`
      )
    );

check(
  'both proven uses and the declaration are edited',
  editShape(edit).join(' ') ===
    'Caller.aplf:1:11-15→Average Caller.aplf:2:3-7→Average Mean.aplf:0:3-7→Average',
  editShape(edit).join(' ')
);
check(
  'only the final identifier of #.Stats.Mean is replaced',
  editShape(edit).every(s => /:\d+:\d+-\d+→Average$/.test(s)) &&
    editShape(edit).every(s => {
      const [, span] = /:(\d+-\d+)→/.exec(s);
      const [from, to] = span.split('-').map(Number);
      return to - from === 4;
    }),
  editShape(edit).join(' ')
);
check(
  'the comment and the character literal are untouched',
  !editShape(edit).some(s => s.startsWith('Caller.aplf:4:') || s.startsWith('Caller.aplf:5:')),
  editShape(edit).join(' ')
);

// This client did not advertise the rename resource operation.
check(
  'no file rename is offered to a client that cannot perform one',
  !(edit?.documentChanges ?? []).some(change => change.kind === 'rename'),
  JSON.stringify((edit?.documentChanges ?? []).filter(c => c.kind))
);

// Open documents get a version, which lets the client reject a stale edit.
check(
  'edits for the open document carry its version',
  (edit?.documentChanges ?? []).some(
    change => change.textDocument?.uri === callerUri && change.textDocument?.version !== undefined
  ),
  JSON.stringify((edit?.documentChanges ?? []).map(c => c.textDocument))
);

const badName = await requestRaw('textDocument/rename', {
  textDocument: { uri: callerUri },
  position: { line: 1, character: 14 },
  newName: '1Bad'
});
check(
  'an illegal new name is refused, explaining what a legal name is',
  badName.result == null && /legal Dyalog name/.test(badName.error?.message ?? ''),
  JSON.stringify(badName)
);

const inComment = await requestRaw('textDocument/rename', {
  textDocument: { uri: callerUri },
  position: { line: 4, character: 5 },
  newName: 'Average'
});
check(
  'renaming from inside a comment is refused',
  inComment.result == null && typeof inComment.error?.message === 'string',
  JSON.stringify(inComment)
);

// #13 is not implemented and must not be claimed.
check(
  'workspaceSymbolProvider is still not advertised',
  init.capabilities?.workspaceSymbolProvider === undefined,
  `got ${JSON.stringify(init.capabilities?.workspaceSymbolProvider)}`
);
// --------------------------------------------------------------- shutdown

await request('shutdown', null);
send({ method: 'exit' });
server.kill();
await fsp.rm(workspace, { recursive: true, force: true }).catch(() => {});

// ------------------------------------------------- a client with no workspace

section('a minimal client with no workspace');

/**
 * Neovim, Helix and a bare editor session may send no workspace folders and
 * declare no folder-event support. Registering the folder-change handler
 * unconditionally used to throw at load time and kill the server outright, so
 * this starts a second one the hard way and checks it still works.
 */
const minimal = spawn(
  process.execPath,
  [path.join(root, 'bin', 'dyalog-apl-language-server.js')],
  { stdio: ['pipe', 'pipe', 'pipe'] }
);

let minimalStderr = '';
minimal.stderr.on('data', chunk => {
  minimalStderr += chunk.toString('utf8');
});

let minimalBuffer = Buffer.alloc(0);
const minimalPending = new Map();
let minimalId = 1;

minimal.stdout.on('data', chunk => {
  minimalBuffer = Buffer.concat([minimalBuffer, chunk]);
  for (;;) {
    const headerEnd = minimalBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = minimalBuffer.subarray(0, headerEnd).toString('utf8');
    const length = Number(/Content-Length: (\d+)/i.exec(header)[1]);
    if (minimalBuffer.length < headerEnd + 4 + length) return;
    const body = minimalBuffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
    minimalBuffer = minimalBuffer.subarray(headerEnd + 4 + length);
    const message = JSON.parse(body);
    if (message.id !== undefined && minimalPending.has(message.id)) {
      minimalPending.get(message.id)(message.result);
      minimalPending.delete(message.id);
    }
  }
});

function minimalSend(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  minimal.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
function minimalRequest(method, params) {
  const id = minimalId++;
  return new Promise(resolve => {
    minimalPending.set(id, resolve);
    minimalSend({ id, method, params });
  });
}

const minimalInit = await Promise.race([
  minimalRequest('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: {}
  }),
  new Promise(resolve => setTimeout(() => resolve(undefined), 5000))
]);
minimalSend({ method: 'initialized', params: {} });

check(
  'it initializes rather than crashing',
  minimalInit?.serverInfo?.name === 'dyalog-apl-language-server',
  `stderr: ${minimalStderr.split('\n')[0] || '(none)'}`
);
check('it did not throw on startup', !/throw|Error:/.test(minimalStderr), minimalStderr.slice(0, 200));

minimalSend({
  method: 'textDocument/didOpen',
  params: {
    textDocument: { uri: 'file:///tmp/lone.aplf', languageId: 'apl', version: 1, text: 'Sq←{⍵*2}\n' }
  }
});

const loneSymbols = await Promise.race([
  minimalRequest('textDocument/documentSymbol', {
    textDocument: { uri: 'file:///tmp/lone.aplf' }
  }),
  new Promise(resolve => setTimeout(() => resolve(undefined), 5000))
]);
check(
  'single-file features still work with no project',
  Array.isArray(loneSymbols) && loneSymbols.length === 1 && loneSymbols[0].name === 'Sq',
  JSON.stringify(loneSymbols)
);

// This client did not ask for linkSupport, so it must get a plain Location.
const loneDefinition = await Promise.race([
  minimalRequest('textDocument/definition', {
    textDocument: { uri: 'file:///tmp/lone.aplf' },
    position: { line: 0, character: 0 }
  }),
  new Promise(resolve => setTimeout(() => resolve(undefined), 5000))
]);
check(
  'a same-file definition resolves with no workspace at all',
  loneDefinition?.uri === 'file:///tmp/lone.aplf' && loneDefinition?.range !== undefined,
  JSON.stringify(loneDefinition)
);
check(
  'and a client without linkSupport gets a plain Location',
  loneDefinition !== undefined && !Array.isArray(loneDefinition),
  JSON.stringify(loneDefinition)
);

minimalSend({ method: 'exit' });
minimal.kill();

console.log('');
if (failures.length) {
  console.log(`${failures.length} of ${passed + failures.length} checks failed:`);
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  process.exit(1);
}
console.log(`All ${passed} LSP checks passed.`);
