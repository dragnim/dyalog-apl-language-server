/**
 * Drives the server over stdio exactly as a real editor would, so the thing can
 * be verified without opening VS Code. Run with: npm run smoke
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SOURCE = [
  '⍝ average of a vector',
  'avg←{(+/⍵)÷≢⍵}',
  'shape←⍴⍵',
  '⎕IO←0',
  'broken←{(+/⍵)÷≢⍵',
  'x←`r',
  'y←``rho',
  'z←⎕N'
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

function request(method, params) {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
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
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    } else if (message.method) {
      notifications.push(message);
    }
  }
});

const uri = 'file:///tmp/sample.aplf';
const at = (line, character) => ({ textDocument: { uri }, position: { line, character } });
const label = text => `\n\x1b[1m${text}\x1b[0m`;

const init = await request('initialize', {
  processId: process.pid,
  rootUri: null,
  capabilities: {},
  initializationOptions: { prefixKey: '`', diagnostics: true, keyboardLocale: 'en_GB' }
});
send({ method: 'initialized', params: {} });

console.log(label('Server identified itself as'));
console.log(` ${init.serverInfo.name} ${init.serverInfo.version}`);
console.log(` capabilities: ${Object.keys(init.capabilities).join(', ')}`);

send({
  method: 'textDocument/didOpen',
  params: { textDocument: { uri, languageId: 'apl', version: 1, text: SOURCE } }
});

await new Promise(resolve => setTimeout(resolve, 300));

console.log(label('Diagnostics it reported'));
const diagnostics = notifications
  .filter(n => n.method === 'textDocument/publishDiagnostics')
  .flatMap(n => n.params.diagnostics);
if (diagnostics.length === 0) console.log(' (none)');
for (const d of diagnostics) {
  console.log(` line ${d.range.start.line + 1} col ${d.range.start.character + 1}: ${d.message}`);
}

console.log(label('Hover on ⍴ (line 3)'));
const hoverGlyph = await request('textDocument/hover', at(2, 6));
console.log(
  hoverGlyph
    ? hoverGlyph.contents.value.split('\n').map(l => ` ${l}`).join('\n')
    : ' (nothing)'
);

console.log(label('Hover on ⎕IO (line 4)'));
const hoverQuad = await request('textDocument/hover', at(3, 1));
console.log(hoverQuad ? ` ${hoverQuad.contents.value}` : ' (nothing)');

console.log(label('Completion after `r (line 6)'));
const byKey = await request('textDocument/completion', at(5, 4));
const matching = (items, prefix) => items.filter(i => i.filterText === prefix);
for (const item of matching(byKey, '`r')) {
  console.log(` ${item.label}  ${item.detail}   (replaces "${item.filterText}")`);
}
console.log(` ${byKey.length} glyphs offered in total, filtered by the editor as you type`);

console.log(label('Locale check: ≢ on a British keyboard (should be `@, not `")'));
const notMatch = byKey.find(i => i.label === '≢');
console.log(notMatch ? ` ≢ is typed with ${notMatch.filterText}` : ' (not offered)');

console.log(label('Completion after ``rho (line 7)'));
const byName = await request('textDocument/completion', at(6, 7));
for (const item of byName.slice(0, 3)) {
  console.log(` ${item.label}  ${item.detail}`);
}

console.log(label('Completion after ⎕N (line 8)'));
const bySystemName = await request('textDocument/completion', at(7, 4));
for (const item of bySystemName.filter(i => i.label.startsWith('⎕N')).slice(0, 5)) {
  console.log(` ${item.label}  ${item.detail}`);
}

console.log('');
await request('shutdown', null);
send({ method: 'exit' });
server.kill();
