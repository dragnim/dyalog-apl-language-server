import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const module = context.asAbsolutePath(path.join('out', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  const config = workspace.getConfiguration('dyalogApl');

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'apl' },
      { scheme: 'untitled', language: 'apl' }
    ],
    initializationOptions: {
      prefixKey: config.get<string>('prefixKey', '`'),
      diagnostics: config.get<boolean>('diagnostics', true),
      keyboardLocale: config.get<string>('keyboardLocale', 'en_US')
    },
    synchronize: {
      configurationSection: 'dyalogApl'
    }
  };

  client = new LanguageClient(
    'dyalogAplLanguageServer',
    'Dyalog APL Language Server',
    serverOptions,
    clientOptions
  );

  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
