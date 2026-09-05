// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The one object every screen reads through `getContext('dfm')` (contracts §7): the host, the backend,
// the router, the preferences, and the few pieces of state that are genuinely global - what /about said,
// the shared time range, and how much work is in flight.

import { NoCapabilities, createEndpoints, type Endpoints } from '../api/endpoints';
import { HttpBackendClient } from '../api/http-client';
import type { About, Capabilities } from '../api/types';
import { VsCodeBackendClient } from '../api/vscode-client';
import type { BackendClient } from '../api/client';
import { DEFAULT_TIME_RANGE, parseTimeRange, toQuery, type TimeRange } from '../filters/time-range';
import { host as defaultHost, type Host } from '../host.svelte';
import { Router } from '../router.svelte';
import { ViewStateStorage } from '../storage/view-state-storage';
import { Prefs } from './prefs.svelte';

/** The context key every component uses: `getContext<AppState>(APP_CONTEXT_KEY)`. */
export const APP_CONTEXT_KEY = 'dfm';

export interface AppStateOptions {
  host?: Host;
  client?: BackendClient;
  endpoints?: Endpoints;
  router?: Router;
  prefs?: Prefs;
}

export class AppState {
  readonly host: Host;
  readonly client: BackendClient;
  readonly endpoints: Endpoints;
  readonly router: Router;
  readonly prefs: Prefs;

  /** What `/about` answered, or null until it has. */
  about = $state<About | null>(null);

  /** The error of the last failed `/about`, so the shell can say why it is empty. */
  aboutError = $state<string | null>(null);

  /** How many requests are in flight; the top-bar progress bar shows while this is above zero. */
  progress = $state(0);

  constructor(options: AppStateOptions = {}) {
    this.host = options.host ?? defaultHost;
    this.prefs = options.prefs ?? new Prefs(this.host);

    this.router =
      options.router ??
      new Router({
        storage: this.host.kind === 'vscode' ? new ViewStateStorage('route', this.host) : null,
      });

    this.client =
      options.client ??
      (this.host.kind === 'vscode'
        ? new VsCodeBackendClient(this.host.vsCodeApi as ConstructorParameters<typeof VsCodeBackendClient>[0])
        : new HttpBackendClient(
            () => this.hub,
            // MSAL fills this in from E2; until then every call goes out unauthenticated, which is
            // what a local host with DFM_NONCE expects.
            () => ({}),
          ));

    this.endpoints = options.endpoints ?? createEndpoints(this.client);
  }

  /** The hub of the current route, `''` on the login route. */
  get hub(): string {
    return this.router.hub;
  }

  /**
   * What the backend says it can do. Every capability is false until `/about` has answered, so a screen
   * that gates on one degrades on its own while the app is still loading (decision D9).
   */
  get capabilities(): Capabilities {
    return this.about?.capabilities ?? NoCapabilities;
  }

  get readOnly(): boolean {
    // Unknown is treated as read-only: better to hide an action that exists than to offer one that 403s
    return this.about?.readOnly ?? true;
  }

  get dangerous(): boolean {
    return this.about?.dangerousOperations ?? false;
  }

  /** Who the backend thinks is calling; empty when authentication is off. */
  get userName(): string {
    return typeof this.host.clientConfig.userName === 'string' ? this.host.clientConfig.userName : '';
  }

  get busy(): boolean {
    return this.progress > 0;
  }

  /** The shared time range, read from the current route's query (contracts §4). */
  get timeRange(): TimeRange {
    return this.router.current ? parseTimeRange(this.router.current.query) : DEFAULT_TIME_RANGE;
  }

  /** Writes the range onto the current route, so every screen and every link follows it. */
  setTimeRange(range: TimeRange): void {
    this.router.setQuery(toQuery(range));
  }

  /** Seconds between automatic reloads of one screen; 0 = never (prefs, contracts §8). */
  autoRefreshSeconds(screen: 'instances' | 'instance'): number {
    return this.prefs.autoRefresh[screen];
  }

  begin(): void {
    this.progress += 1;
  }

  end(): void {
    this.progress = Math.max(0, this.progress - 1);
  }

  /** Runs one request with the progress counter held up for its duration. */
  async track<T>(work: () => Promise<T>): Promise<T> {
    this.begin();
    try {
      return await work();
    } finally {
      this.end();
    }
  }

  /**
   * Loads `/about` for the current hub. Never throws: a failure leaves `about` as it was and puts the
   * message on `aboutError`, because every screen has to keep working (degraded) without it.
   */
  async loadAbout(): Promise<About | null> {
    if (!this.hub) {
      return null;
    }

    try {
      const about = await this.track(() => this.endpoints.about());

      this.about = about;
      this.aboutError = null;
      this.applyDocumentTitle();

      return about;
    } catch (error) {
      this.aboutError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  /** React parity: `Durable Functions Monitor (account/hub[, ReadOnly]) vX.Y.Z`. */
  applyDocumentTitle(): void {
    const about = this.about;
    if (!about || !globalThis.document) {
      return;
    }

    const readOnly = about.readOnly ? ', ReadOnly' : '';
    document.title = `Durable Functions Monitor (${about.accountName}/${about.hubName}${readOnly}) v${about.version}`;
  }
}
