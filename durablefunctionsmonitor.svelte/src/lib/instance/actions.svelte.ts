// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The nine confirm dialogs an instance action opens, and the one place that decides what each of
// them says (ScreenInstance.dc.html L356-L362 and ScreenEntities.dc.html L101-L102, verbatim).
//
// They are on the app rather than on a screen because the same dialogs are opened from four places:
// the workspace header, the peek panel over a list, the command palette and the Failures rows. The
// dialog is mounted once in the shell (`ActionDialogs.svelte`); `app.actions` is what opens it.

import type { FunctionMapResponse, RuntimeStatus } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import { runInstanceAction } from './one-off-actions';

export type ActionKind =
  'suspend' | 'resume' | 'raise' | 'custom' | 'restart' | 'rewind' | 'terminate' | 'purge' | 'signal';

/** What the dialog needs to know about the instance it is about; a list row knows all of it. */
export interface ActionTarget {
  id: string;
  /** The orchestrator name, or the entity name. */
  name: string;
  status: RuntimeStatus | string;
  isEntity?: boolean;
  /** Entities: the key half of `@name@key`, which is what the entity dialogs are titled by. */
  key?: string;
  /** The current customStatus, so the Set customStatus dialog opens on what is there now. */
  customStatus?: unknown;
  /** History rows, when the caller knows how many; the purge dialog says so when it does. */
  historyRows?: number | null;
  /** The children, once E8 has loaded them; only then does the purge dialog mention them. */
  childNames?: string[];
}

/** What the dialog collects. Each action reads the one or two fields it asked for. */
export interface ActionPayload {
  reason?: string;
  /** raise and signal. */
  name?: string;
  data?: unknown;
  /** custom: the parsed editor content, or null to clear it. */
  customStatus?: unknown;
  restartWithNewInstanceId?: boolean;
}

/** What a caller can fill in for the user - the replay recovery dialog opens `raise` this way. */
export interface ActionPrefill {
  name?: string;
  data?: unknown;
}

/**
 * The instance workspace, when the action is about the instance it has open: the actions there
 * reload the whole workspace, which a one-off action on a list row has nothing to do.
 */
export interface InstanceActionsApi {
  readonly instanceId: string;
  suspend(reason?: string): Promise<boolean>;
  resume(reason?: string): Promise<boolean>;
  rewind(reason?: string): Promise<boolean>;
  terminate(reason?: string): Promise<boolean>;
  purge(): Promise<boolean>;
  restart(restartWithNewInstanceId?: boolean): Promise<boolean>;
  raiseEvent(name: string, data: unknown, message?: string): Promise<boolean>;
  setCustomStatus(value: unknown): Promise<boolean>;
}

export interface ActionDef {
  title: string;
  body: string;
  band: boolean;
  confirm: string;
  variant: 'primary' | 'destructive' | 'danger';
  /** A reason field, written to the audit log. */
  reason?: boolean;
  /** Event name + event data, with the signalled names of the function map offered as a datalist. */
  event?: boolean;
  /** An entity signal: the same two fields under the entity's own labels. */
  signal?: boolean;
  /** The customStatus editor, prefilled with what the instance holds; empty clears it. */
  custom?: boolean;
  /** The "Start with a new instance id" checkbox. */
  restartOpts?: boolean;
}

/** The confirm button of each action. The success toast is built from it (the mockup's rule). */
export const ACTION_CONFIRM: Readonly<Record<ActionKind, string>> = {
  suspend: 'Suspend',
  resume: 'Resume',
  raise: 'Raise event',
  custom: 'Set customStatus',
  restart: 'Restart',
  rewind: 'Rewind',
  terminate: 'Terminate',
  purge: 'Purge instance',
  signal: 'Send signal',
};

/** What `Failed to …` says when an action does not go through. */
export const ACTION_VERBS: Readonly<Record<ActionKind, string>> = {
  suspend: 'suspend',
  resume: 'resume',
  raise: 'raise event',
  custom: 'set customStatus',
  restart: 'restart',
  rewind: 'rewind',
  terminate: 'terminate',
  purge: 'purge',
  signal: 'send signal',
};

/**
 * What the toast says when the action went through (ScreenInstance.dc.html L385-L387): suspend and
 * resume and purge report the state they left behind, everything else reports what was sent - a
 * request to a task hub is queued, not performed, and saying "Terminated" would be a lie.
 */
export function actionToast(kind: ActionKind, id: string, key?: string): string {
  switch (kind) {
    case 'suspend':
      return `Suspended ${id}`;
    case 'resume':
      return `Resumed ${id}`;
    case 'purge':
      return `Purged ${id}`;
    case 'signal':
      return `Signal sent to ${key || id}`;
    default:
      return `${ACTION_CONFIRM[kind]} sent for ${id}`;
  }
}

/**
 * The key half of an entity id, `@name@key` - what the entity dialogs are titled by. Undefined for
 * an orchestration id, and for an entity id the backend did not shape that way.
 */
export function entityKey(instanceId: string): string | undefined {
  const match = /^@[^@]+@(.+)$/.exec(instanceId);

  return match ? match[1] : undefined;
}

/** The names the orchestrators of this hub are signalled by, for the Event name datalist. */
export function eventNames(map: FunctionMapResponse | null): string[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, in a pure function
  const names = new Set<string>();

  for (const node of Object.values(map?.functions ?? {})) {
    for (const signal of node.isSignalledBy ?? []) {
      if (signal.signalName) {
        names.add(signal.signalName);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

/** What the purge dialog can say about what it is about to remove, once anything knows. */
function purgeBody(target: ActionTarget): string {
  if (target.isEntity) {
    return 'Removes the entity row and its history. The next signal recreates it with empty state.';
  }

  const rows = typeof target.historyRows === 'number' ? `its ${target.historyRows} history rows` : 'its history';
  const children = target.childNames ?? [];

  const body = `Removes the instance, ${rows} and its large-message blobs.`;

  if (children.length === 1) {
    return `${body} The sub-orchestration ${children[0]} is not purged.`;
  }

  if (children.length > 1) {
    return `${body} Its ${children.length} sub-orchestrations are not purged.`;
  }

  return body;
}

/** Word for word from the mockups: the wording is what tells the user what an action will do. */
export function actionDef(kind: ActionKind, target: ActionTarget): ActionDef {
  const id = target.id;
  const confirm = ACTION_CONFIRM[kind];

  switch (kind) {
    case 'suspend':
      return {
        title: `Suspend ${id}`,
        body: 'Pauses the instance. Timers and external events are held until you resume.',
        band: false,
        confirm,
        variant: 'primary',
        reason: true,
      };

    case 'resume':
      return {
        title: `Resume ${id}`,
        body: 'Resumes the instance. Held timers and events are delivered.',
        band: false,
        confirm,
        variant: 'primary',
        reason: true,
      };

    case 'raise':
      return {
        title: 'Raise event',
        body:
          'Sends an external event to this instance. The orchestrator must be waiting for an event ' +
          'with this exact name.',
        band: false,
        confirm,
        variant: 'primary',
        event: true,
      };

    case 'custom':
      return {
        title: 'Set customStatus',
        body:
          'Overwrites the customStatus field of this instance. The orchestrator can overwrite it ' +
          'again on its next replay.',
        band: false,
        confirm,
        variant: 'primary',
        custom: true,
      };

    case 'restart':
      return {
        title: `Restart ${id}`,
        body: 'Starts the orchestration again with the same input. The current instance keeps its history.',
        band: false,
        confirm,
        variant: 'primary',
        restartOpts: true,
      };

    case 'rewind':
      return {
        title: `Rewind ${id}`,
        body: 'Re-runs only the failed steps. Completed steps keep their results. Available for failed instances.',
        band: true,
        confirm,
        variant: 'primary',
        reason: true,
      };

    case 'terminate':
      return {
        title: `Terminate ${id}`,
        body:
          'Stops the instance where it is. Running activities finish but their results are ignored. ' +
          'This cannot be undone.',
        band: true,
        confirm,
        variant: 'destructive',
        reason: true,
      };

    case 'purge':
      return {
        title: `Purge ${target.isEntity ? (target.key ?? id) : id}`,
        body: purgeBody(target),
        band: true,
        confirm: target.isEntity ? 'Purge entity' : confirm,
        variant: 'destructive',
      };

    case 'signal':
      return {
        title: `Send signal to ${target.key || id}`,
        body: 'Raises an operation on the entity. The entity function decides what the signal name means.',
        band: false,
        confirm,
        variant: 'primary',
        signal: true,
      };
  }
}

/**
 * Which dialog is open, on what, and what happens when it is confirmed. One at a time: a confirm is
 * a modal, and two of them would be two modals over each other.
 */
export class Actions {
  kind = $state<ActionKind | null>(null);
  target = $state<ActionTarget | null>(null);

  /** What the opener filled in, for the raise dialog the replay recovery opens (E5-S4-T4). */
  prefill = $state<ActionPrefill | null>(null);

  /** While the action runs: the dialog's buttons are dead and its progress bar shows. */
  busy = $state(false);

  readonly #app: AppState;

  /**
   * The workspace on screen, while one is open. A plain field, deliberately: nothing renders from
   * it, and `$state` would hand back a proxy of the workspace rather than the workspace itself,
   * which is what the disposer compares against.
   */
  #instance: InstanceActionsApi | null = null;

  constructor(app: AppState) {
    this.#app = app;
  }

  get isOpen(): boolean {
    return this.kind !== null;
  }

  get def(): ActionDef | null {
    return this.kind && this.target ? actionDef(this.kind, this.target) : null;
  }

  open(kind: ActionKind, target: ActionTarget, options: { prefill?: ActionPrefill } = {}): void {
    this.kind = kind;
    this.target = target;
    this.prefill = options.prefill ?? null;
  }

  close(): void {
    this.kind = null;
    this.target = null;
    this.prefill = null;
  }

  /**
   * The instance workspace registers itself while it is mounted, and the returned disposer takes it
   * off again. An action about that instance goes through it, so the whole workspace reloads; an
   * action about any other instance is a one-off against the endpoints.
   */
  bind(instance: InstanceActionsApi): () => void {
    this.#instance = instance;

    return () => {
      if (this.#instance === instance) {
        this.#instance = null;
      }
    };
  }

  /** Runs the open action. The dialog closes on success and stays open, holding what was typed, on failure. */
  async run(payload: ActionPayload = {}): Promise<boolean> {
    const kind = this.kind;
    const target = this.target;

    if (!kind || !target || this.busy) {
      return false;
    }

    this.busy = true;

    try {
      const workspace = this.#instance?.instanceId === target.id ? this.#instance : null;

      const done = workspace
        ? await runOnWorkspace(workspace, kind, target, payload)
        : await runInstanceAction(this.#app, kind, target, payload);

      if (done) {
        this.close();

        // The workspace has already reloaded itself; a list has not
        if (!workspace) {
          this.#app.refresh();
        }
      }

      return done;
    } finally {
      this.busy = false;
    }
  }
}

/** The same nine actions, against the workspace that has the instance open. */
function runOnWorkspace(
  instance: InstanceActionsApi,
  kind: ActionKind,
  target: ActionTarget,
  payload: ActionPayload,
): Promise<boolean> {
  switch (kind) {
    case 'suspend':
      return instance.suspend(payload.reason);
    case 'resume':
      return instance.resume(payload.reason);
    case 'rewind':
      return instance.rewind(payload.reason);
    case 'terminate':
      return instance.terminate(payload.reason);
    case 'purge':
      return instance.purge();
    case 'restart':
      return instance.restart(payload.restartWithNewInstanceId ?? true);
    case 'raise':
      return instance.raiseEvent(payload.name ?? '', payload.data ?? null);
    case 'signal':
      // The same endpoint; only what it is called changes (contracts §6)
      return instance.raiseEvent(
        payload.name ?? '',
        payload.data ?? null,
        actionToast('signal', target.id, target.key),
      );
    case 'custom':
      return instance.setCustomStatus(payload.customStatus ?? null);
  }
}
