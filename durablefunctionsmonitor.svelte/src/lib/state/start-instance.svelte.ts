// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Starting an orchestration. The dialog is opened from the Instances title row, from `?start=1`,
// from the command palette, from the Overview's empty state (E7) and from the recovery dialog of a
// purge that could not restart (E5) - so what it holds lives here, on the app, and every one of
// those opens the same dialog with whatever it wants prefilled.

import type { FunctionMapResponse } from '$lib/api/types';
import type { AppState } from './app.svelte';

export interface StartInstancePrefill {
  orchestrator?: string;
  instanceId?: string;
  /** Prefilled input, pretty-printed into the editor (contracts §9: two spaces, fully expanded). */
  input?: unknown;
}

export interface StartInstanceOptions {
  app: AppState;
}

export class StartInstance {
  open = $state(false);

  orchestrator = $state('');
  instanceId = $state('');
  inputText = $state('');
  busy = $state(false);

  /** The orchestrators of `/function-map`, when the host has a function graph at all. */
  orchestrators = $state<string[]>([]);

  readonly #app: AppState;

  #loaded = false;

  constructor(options: StartInstanceOptions) {
    this.#app = options.app;
  }

  /** Opens the dialog, empty or prefilled. */
  openWith(prefill: StartInstancePrefill = {}): void {
    this.orchestrator = prefill.orchestrator ?? '';
    this.instanceId = prefill.instanceId ?? '';
    this.inputText = prefill.input === undefined ? '' : JSON.stringify(prefill.input, null, 2);
    this.busy = false;
    this.open = true;

    void this.loadOrchestrators();
  }

  close(): void {
    this.open = false;
  }

  /**
   * The names to suggest, once. Only where the host published a function graph: without one the
   * backend has no function map to answer with, and the field is typed into instead of chosen from.
   */
  async loadOrchestrators(): Promise<void> {
    if (this.#loaded || !this.#app.host.functionGraphAvailable) {
      return;
    }

    this.#loaded = true;

    try {
      const map = await this.#app.track(() => this.#app.endpoints.functionMap());

      this.orchestrators = orchestratorNames(map);
    } catch {
      // A function map that cannot be read is not worth a toast: the field still takes a typed name
      this.orchestrators = [];
      this.#loaded = false;
    }
  }

  /**
   * `POST /orchestrations`. The id is left out when the field is empty, which is what asks the
   * backend for a generated one; the input is whatever the editor holds, or null.
   */
  async start(): Promise<string | null> {
    const name = this.orchestrator.trim();

    if (!name || this.busy) {
      return null;
    }

    this.busy = true;

    try {
      const { instanceId } = await this.#app.track(() =>
        this.#app.endpoints.startNewInstance({
          id: this.instanceId.trim() || undefined,
          name,
          data: parseInput(this.inputText),
        }),
      );

      this.open = false;
      this.#app.toast.ok(`Started ${instanceId} · ${name}`);

      // Whatever list is on screen is now one instance out of date
      this.#app.refresh();

      return instanceId;
    } catch (error) {
      // The dialog stays open, holding what was typed, so it can be corrected and sent again
      this.#app.toast.fromError('Failed to start new instance', error);

      return null;
    } finally {
      this.busy = false;
    }
  }
}

/** A function is an orchestrator when one of its bindings is an `orchestrationTrigger`. */
export function orchestratorNames(map: FunctionMapResponse): string[] {
  return Object.entries(map.functions ?? {})
    .filter(([, node]) => (node.bindings ?? []).some((binding) => binding.type === 'orchestrationTrigger'))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/** Whether the editor holds something that can be sent. Empty counts: it is sent as null. */
export function isJsonInput(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return true;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Empty input is `null`, not `""`: the backend takes JSON, and nothing is null. */
export function parseInput(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // The dialog does not allow this - Start is disabled while the JSON is invalid - so this is the
    // belt to that braces: the text goes as a string rather than the request being dropped
    return trimmed;
  }
}
