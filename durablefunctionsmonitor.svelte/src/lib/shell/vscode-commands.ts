// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The extension's menu commands (E2-S6-T3). VS Code sends them through the same bridge the HTTP
// calls go over, keyed by name instead of by request id; each one lands the user on the screen that
// owns the thing they asked for, with the dialog named in the query so that screen can open it.

import type { VsCodeCustomMessageHandlers } from '$lib/api/vscode-client';
import type { AppState } from '$lib/state/app.svelte';

/** The bridge, narrowed to what this needs: only the VS Code client has custom handlers. */
interface CustomCommandClient {
  setCustomHandlers?: (handlers: VsCodeCustomMessageHandlers) => void;
}

/**
 * Registers the handlers and tells the extension we are ready for them (`IAmReady`, which the
 * client posts once). Called by the shell once it is mounted: before that there is no screen to
 * navigate to. Outside VS Code the client has no custom handlers and this does nothing.
 */
export function installVsCodeCommands(app: AppState): void {
  const client = app.client as unknown as CustomCommandClient;

  if (app.host.kind !== 'vscode' || typeof client.setCustomHandlers !== 'function') {
    return;
  }

  const settings = (dialog: string) => () =>
    app.router.navigate({ name: 'settings', hub: app.hub }, { query: { dialog } });

  const instances = (query: Record<string, string>) => () =>
    app.router.navigate({ name: 'instances', hub: app.hub }, { query });

  client.setCustomHandlers({
    // E6 opens these two from the query; the command's own payload is the extension's business
    purgeHistory: settings('purge'),
    cleanEntityStorage: settings('clean'),

    // E4 reads `start` and opens its dialog, and `selectAll` selects every row it has loaded so the
    // bulk bar is there - which is what "batch operations" means from a menu with no selection
    startNewInstance: instances({ start: '1' }),
    batchOps: instances({ selectAll: '1' }),
  });
}
