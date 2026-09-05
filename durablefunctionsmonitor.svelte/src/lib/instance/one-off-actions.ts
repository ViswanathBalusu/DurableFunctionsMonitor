// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// An instance action on a row of a list: the peek panel, the command palette, a Failures row. There
// is no workspace to reload afterwards - `app.refresh()` reloads whatever list is on screen - so
// this is the endpoint call, the toast, and nothing else.

import type { AppState } from '$lib/state/app.svelte';
import { ACTION_VERBS, actionToast, type ActionKind, type ActionPayload, type ActionTarget } from './actions.svelte';

export async function runInstanceAction(
  app: AppState,
  kind: ActionKind,
  target: ActionTarget,
  payload: ActionPayload = {},
): Promise<boolean> {
  try {
    await app.track(() => call(app, kind, target, payload));

    app.toast.ok(actionToast(kind, target.id, target.key));

    return true;
  } catch (error) {
    app.toast.fromError(`Failed to ${ACTION_VERBS[kind]}`, error);

    return false;
  }
}

function call(app: AppState, kind: ActionKind, target: ActionTarget, payload: ActionPayload): Promise<unknown> {
  const id = target.id;
  const reason = payload.reason || undefined;

  switch (kind) {
    case 'suspend':
    case 'resume':
    case 'rewind':
    case 'terminate':
      // The five plain actions take the reason as their whole body (contracts §6)
      return app.endpoints.postAction(id, kind, reason);

    case 'purge':
      return app.endpoints.purge(id);

    case 'restart':
      return app.endpoints.restart(id, payload.restartWithNewInstanceId ?? true);

    case 'raise':
    case 'signal':
      // An entity signal is a raised event; only what the dialog calls it changes
      return app.endpoints.raiseEvent(id, payload.name ?? '', payload.data ?? null);

    case 'custom':
      // Null clears it: the backend takes an empty body as "no custom status"
      return app.endpoints.setCustomStatus(id, payload.customStatus ?? null);
  }
}
