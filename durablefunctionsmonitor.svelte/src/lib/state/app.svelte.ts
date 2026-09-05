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
import { Peek } from './peek.svelte';
import { Prefs, type AutoRefreshSeconds } from './prefs.svelte';
import { Toasts } from './toast.svelte';

/** The context key every component uses: `getContext<AppState>(APP_CONTEXT_KEY)`. */
export const APP_CONTEXT_KEY = 'dfm';

/** Which of the two auto-refresh intervals a screen uses (contracts §8). */
export type AutoRefreshScreen = keyof AutoRefreshSeconds;

export interface AppStateOptions {
  host?: Host;
  client?: BackendClient;
  endpoints?: Endpoints;
  router?: Router;
  prefs?: Prefs;
}

/** What a screen needs of the Start new instance dialog to open it (E4-S7-T1). */
export interface StartNewInstanceDialogApi {
  readonly open: boolean;
  openWith(prefill?: { orchestrator?: string; instanceId?: string; input?: unknown }): void;
}

export interface AppDialogs {
  startNewInstance: StartNewInstanceDialogApi | null;
}

export class AppState {
  readonly host: Host;
  readonly client: BackendClient;
  readonly endpoints: Endpoints;
  readonly router: Router;
  readonly prefs: Prefs;

  /** The peeked row of whatever list is on screen (E2-S4); the panel lives in the shell. */
  readonly peek = new Peek();

  /** The one toast at a time (E2-S6); the host lives in the shell. */
  readonly toast = new Toasts();

  /** What `/about` answered, or null until it has. */
  about = $state<About | null>(null);

  /** The error of the last failed `/about`, so the shell can say why it is empty. */
  aboutError = $state<string | null>(null);

  /** Where the Authorization header comes from once the login state has one (E2-S7). */
  #authHeaders: () => Record<string, string> | Promise<Record<string, string>> = () => ({});

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
            // Empty until the login state wires itself in (E2-S7), which is what a local host with
            // DFM_NONCE expects anyway: no Authorization header at all.
            () => this.#authHeaders(),
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

  /** Wired by the browser's login state, so every request carries its bearer token. */
  setAuthHeaders(provider: () => Record<string, string> | Promise<Record<string, string>>): void {
    this.#authHeaders = provider;
  }

  /**
   * Dialogs any screen can open. The screen that renders one puts it here while it is mounted, so
   * the Overview's empty state and the workspace's recovery dialog can open the same Start new
   * instance dialog the Instances screen owns.
   */
  readonly dialogs = $state<AppDialogs>({ startNewInstance: null });

  /** The shared time range, read from the current route's query (contracts §4). */
  get timeRange(): TimeRange {
    return this.router.current ? parseTimeRange(this.router.current.query) : DEFAULT_TIME_RANGE;
  }

  /** Writes the range onto the current route, so every screen and every link follows it. */
  setTimeRange(range: TimeRange): void {
    this.router.setQuery(toQuery(range));
  }

  /** Seconds between automatic reloads of one screen; 0 = never (prefs, contracts §8). */
  autoRefreshSeconds(screen: AutoRefreshScreen): number {
    return this.prefs.autoRefresh[screen];
  }

  /** The list screens share one interval, the workspace has its own. */
  setAutoRefresh(screen: AutoRefreshScreen, seconds: number): void {
    this.prefs.setAutoRefresh(screen, seconds);
  }

  /**
   * Registers the reload of the screen on show and returns the disposer for it. A screen registers
   * from an effect, so the disposer runs when it unmounts; each handler also remembers the route it
   * was registered on, which is what makes `clearRefreshHandlers` independent of the order in which
   * the outgoing screen's cleanup and the incoming screen's registration happen to run.
   */
  onRefresh(handler: () => void): () => void {
    const entry = { handler, screen: this.screenKey };

    this.#refreshHandlers.push(entry);

    return () => this.#remove((candidate) => candidate === entry);
  }

  /** Reloads whatever is on screen: the screen's Refresh button, the palette, VS Code. */
  refresh(): void {
    // A copy: a handler may unregister itself (or another) while this runs
    for (const entry of [...this.#refreshHandlers]) {
      entry.handler();
    }
  }

  /**
   * Called by the outlet when a screen goes away, with the screen it is unmounting. Naming it - the
   * outlet knows it, having rendered it - is what makes this independent of when the cleanup runs
   * relative to the arriving screen's registration. Without an argument, every handler goes.
   */
  clearRefreshHandlers(screen?: string): void {
    this.#remove((entry) => screen === undefined || entry.screen === screen);
  }

  #remove(matches: (entry: { handler: () => void; screen: string }) => boolean): void {
    for (let index = this.#refreshHandlers.length - 1; index >= 0; index--) {
      if (matches(this.#refreshHandlers[index])) {
        this.#refreshHandlers.splice(index, 1);
      }
    }
  }

  /**
   * What `refresh()` calls: whatever the screen on show registered, and which screen that was.
   * A plain array: nothing renders from it, so it is deliberately not reactive state.
   */
  readonly #refreshHandlers: { handler: () => void; screen: string }[] = [];

  begin(): void {
    this.progress += 1;
  }

  end(): void {
    this.progress = Math.max(0, this.progress - 1);
  }

  /**
   * Runs one request with the progress counter held up for its duration - a promise or the function
   * that starts one - so the stripe under the top bar shows for as long as anything is in flight.
   * The counter comes back down on a rejection too; the caller still sees the rejection.
   */
  async track<T>(work: Promise<T> | (() => Promise<T>)): Promise<T> {
    this.begin();
    try {
      return await (typeof work === 'function' ? work() : work);
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

  /**
   * Which screen is on, ignoring the query: the workspace of two different instances counts as two
   * screens, and a filter change is the same screen (which is why it neither scrolls the outlet to
   * the top nor drops the screen's refresh handlers).
   */
  get screenKey(): string {
    const route = this.router.current;

    return 'instanceId' in route ? `instance:${route.instanceId}` : route.name;
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
