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

  // The prefix key is part of the completion trigger characters, and those are
  // fixed when the server announces its capabilities at initialize. Merely
  // pushing the new configuration would leave the trigger pointing at the old
  // key, so the server is restarted instead. The other settings are read live
  // and need no restart.
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(async event => {
      if (!event.affectsConfiguration('dyalogApl.prefixKey')) return;
      const current = workspace.getConfiguration('dyalogApl');
      if (client) {
        client.clientOptions.initializationOptions = {
          prefixKey: current.get<string>('prefixKey', '`'),
          diagnostics: current.get<boolean>('diagnostics', true),
          keyboardLocale: current.get<string>('keyboardLocale', 'en_US')
        };
        await client.restart();
      }
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
