// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Endpoints } from '$lib/api/endpoints';
import type { Host } from '$lib/host.svelte';

/**
 * The task hubs of the storage account, for the hub switcher.
 *
 * Loaded once per session: the list changes when someone creates a task hub, which is not something
 * a monitoring session has to watch for, and the call lists tables in the storage account. Inside VS
 * Code there is nothing to load - the webview is attached to exactly one hub.
 */
export class Hubs {
  names = $state<string[]>([]);

  /** Why the list is empty, when it is empty because the call failed. */
  error = $state<string | null>(null);

  loading = $state(false);

  #loaded = false;

  readonly #endpoints: Endpoints;
  readonly #host: Host;

  constructor(endpoints: Endpoints, host: Host) {
    this.#endpoints = endpoints;
    this.#host = host;
  }

  /** True when there is a choice to offer: more than the hub already open, in the browser. */
  get switchable(): boolean {
    return this.#host.kind === 'browser';
  }

  async load(currentHub: string): Promise<string[]> {
    if (!this.switchable) {
      // The webview's single hub; nothing to ask the backend
      this.names = currentHub ? [currentHub] : [];
      this.#loaded = true;
      return this.names;
    }

    if (this.#loaded) {
      return this.names;
    }

    this.loading = true;

    try {
      const names = await this.#endpoints.taskHubNames();

      this.names = [...names].sort((a, b) => a.localeCompare(b));
      this.error = null;
      this.#loaded = true;
    } catch (error) {
      // A backend that does not allow listing hubs (DFM_HUB_NAME pinned) is normal, not broken:
      // the switcher then offers only the hub that is open.
      this.error = error instanceof Error ? error.message : String(error);
      this.names = currentHub ? [currentHub] : [];
    } finally {
      this.loading = false;
    }

    return this.names;
  }

  /** Forgets what was loaded, so the next `load` asks again (after connecting to another account). */
  reset(): void {
    this.#loaded = false;
    this.names = [];
    this.error = null;
  }
}
