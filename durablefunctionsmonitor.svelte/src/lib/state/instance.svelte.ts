// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The instance workspace's state (contracts §7): the details, which tabs the instance has, the
// history paging next to it, and the eight actions the header offers. Everything a tab needs of the
// instance hangs off this one object, and every tab that loads something of its own registers a
// reload hook so `refreshAll()` - the Refresh button, an action, the auto-refresh tick - reloads the
// whole workspace at once rather than each tab reloading itself out of step with the rest.

import type { FunctionMapResponse, OrchestrationDetails, RuntimeStatus } from '$lib/api/types';
import { ACTION_VERBS, actionToast, type ActionKind } from '$lib/instance/actions.svelte';
import type { AppState } from './app.svelte';
import { InstanceHistoryState } from './instance-history.svelte';
import { InstanceSpansState } from './instance-spans.svelte';

/** A tab of the workspace. Custom Liquid tabs are `custom:<template name>` (contracts §4). */
export type WorkspaceTab = 'summary' | 'timeline' | 'history' | 'inputs' | 'sequence' | 'graph' | 'raw' | string;

export const CUSTOM_TAB_PREFIX = 'custom:';

/** The `?tab` value of a Liquid tab. */
export function customTab(templateName: string): string {
  return `${CUSTOM_TAB_PREFIX}${templateName}`;
}

/** The template name behind a custom tab, or null when the tab is one of the built-in ones. */
export function customTabName(tab: string): string | null {
  return tab.startsWith(CUSTOM_TAB_PREFIX) ? tab.slice(CUSTOM_TAB_PREFIX.length) : null;
}

/**
 * The statuses an instance never leaves. Their duration is fixed - `lastUpdatedTime - createdTime` -
 * while every other status is still running, and is measured against the clock instead.
 * ContinuedAsNew is not terminal: the instance carries on under the same id.
 */
export const TERMINAL_STATUSES: readonly RuntimeStatus[] = ['Completed', 'Failed', 'Terminated', 'Canceled'];

export function isTerminal(status: RuntimeStatus | null | undefined): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The function map of the hub, fetched at most once per hub.
 *
 * It is the same answer for every instance of a hub and it is not small, so the workspace, the Graph
 * tab and the Functions screen share one request rather than each making their own. A failure is not
 * cached: the next screen has to be able to try again.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a request cache; nothing renders from it
const functionMaps = new Map<string, Promise<FunctionMapResponse>>();

export function loadFunctionMap(app: AppState): Promise<FunctionMapResponse | null> {
  if (!app.host.functionGraphAvailable) {
    return Promise.resolve(null);
  }

  const hub = app.hub;
  let pending = functionMaps.get(hub);

  if (!pending) {
    pending = app.track(() => app.endpoints.functionMap());
    functionMaps.set(hub, pending);
    pending.catch(() => functionMaps.delete(hub));
  }

  // A map that cannot be read costs the Graph tab, nothing else - the workspace still opens
  return pending.catch(() => null);
}

/** Empties the per-hub cache. Tests use it; so does a hub switch that has to re-read the graph. */
export function clearFunctionMapCache(): void {
  functionMaps.clear();
}

export interface InstanceOptions {
  app: AppState;
  instanceId: string;
}

export class InstanceState {
  details = $state<OrchestrationDetails | null>(null);

  /** The hub's function map, when the host publishes one at all; null otherwise. */
  functionMap = $state<FunctionMapResponse | null>(null);

  loading = $state(false);

  /** The last details error, so the screen can say why it is empty. */
  error = $state<string | null>(null);

  /** True while one of the actions is in flight; the header's buttons disable from it. */
  busy = $state(false);

  readonly instanceId: string;
  readonly history: InstanceHistoryState;

  /** `/spans` and `/children` (E8): the Timeline tab, the Summary column and the header's counts. */
  readonly spans: InstanceSpansState;

  readonly #app: AppState;

  /** What `refreshAll()` reloads besides the details and the history: inputs, spans, children. */
  readonly #hooks: (() => Promise<void> | void)[] = [];

  #timer: ReturnType<typeof setInterval> | null = null;
  #requestId = 0;

  constructor(options: InstanceOptions) {
    this.#app = options.app;
    this.instanceId = options.instanceId;
    this.history = new InstanceHistoryState({ app: options.app, instanceId: options.instanceId });
    this.spans = new InstanceSpansState({ app: options.app, instanceId: options.instanceId });
  }

  get app(): AppState {
    return this.#app;
  }

  /** Entities have no input events, no sequence diagram and no duration of their own. */
  get isEntity(): boolean {
    return this.details?.entityType === 'DurableEntity';
  }

  /** What the instance is called on the function graph (React `getFunctionName`). */
  get functionName(): string {
    const details = this.details;

    if (!details) {
      return '';
    }

    return details.entityType === 'DurableEntity' ? (details.entityId?.name ?? details.name) : details.name;
  }

  get status(): RuntimeStatus | null {
    return this.details?.runtimeStatus ?? null;
  }

  /**
   * Whether the Graph tab is offered: the host has to publish a graph at all, and this instance's
   * function has to be on it. Entities are lowered in the map, so the match is case-insensitive
   * (React `shownFunctionNames`).
   */
  get hasGraph(): boolean {
    const name = this.functionName.toLowerCase();

    if (!this.#app.host.functionGraphAvailable || !name) {
      return false;
    }

    return Object.keys(this.functionMap?.functions ?? {}).some((key) => key.toLowerCase() === name);
  }

  /**
   * The tabs this instance has, in the order the strip lists them (E5-S3-T1). `summary` is not one
   * of them: it is the column on the right of every tab, and only turns into a tab of its own below
   * 1100 px - by CSS, not by this list - so it is always a legal `?tab` value and never a body.
   */
  get tabs(): WorkspaceTab[] {
    const tabs: WorkspaceTab[] = [];

    // Timeline is drawn from /spans, which an entity has none of
    if (this.#app.capabilities.spans && !this.isEntity) {
      tabs.push('timeline');
    }

    tabs.push('history');

    if (!this.isEntity) {
      tabs.push('inputs', 'sequence');
    }

    if (this.hasGraph) {
      tabs.push('graph');
    }

    tabs.push('raw');

    for (const templateName of this.details?.tabTemplateNames ?? []) {
      tabs.push(customTab(templateName));
    }

    return tabs;
  }

  /** Timeline when the backend has it, History otherwise: the two that need no other tab loaded. */
  get defaultTab(): WorkspaceTab {
    return this.tabs.includes('timeline') ? 'timeline' : 'history';
  }

  /** `summary`, or one of `tabs`. Anything else on the URL - a tab this instance has not got, or a stale link - falls back to the default. */
  isTabAvailable(tab: string): boolean {
    return tab === 'summary' || this.tabs.includes(tab);
  }

  /** The tab on show, from `?tab` (contracts §4), so it survives a reload and a shared link. */
  get tab(): WorkspaceTab {
    const asked = this.#app.router.current.query.get('tab') ?? '';

    return this.isTabAvailable(asked) ? asked : this.defaultTab;
  }

  setTab(tab: WorkspaceTab): void {
    this.#app.router.setQuery({ tab });
  }

  /**
   * How long the instance has been running, in ms: fixed once it is terminal, and counted against
   * `app.now` - which the screen ticks every second while it is mounted - while it is not.
   */
  get liveDuration(): number | null {
    const details = this.details;

    if (!details) {
      return null;
    }

    const created = Date.parse(details.createdTime);

    if (!Number.isFinite(created)) {
      return null;
    }

    const ended = isTerminal(details.runtimeStatus) ? Date.parse(details.lastUpdatedTime) : Number.NaN;
    const end = Number.isFinite(ended) ? ended : this.#app.now;

    return Math.max(0, end - created);
  }

  /**
   * Registers something else to reload with the workspace - the Inputs tab, spans, children - and
   * returns the disposer, so a tab that goes away stops being reloaded.
   */
  onReload(hook: () => Promise<void> | void): () => void {
    this.#hooks.push(hook);

    return () => {
      const index = this.#hooks.indexOf(hook);

      if (index >= 0) {
        this.#hooks.splice(index, 1);
      }
    };
  }

  /**
   * `GET orchestrations('{id}')` and, once per hub, the function map. Unlike React this does not
   * clear the history on the way: the history is its own state, reloaded by `refreshAll()`, and
   * emptying it here made the tab flash on every auto-refresh tick.
   */
  async loadDetails(): Promise<OrchestrationDetails | null> {
    const requestId = ++this.#requestId;

    this.loading = true;
    this.error = null;

    try {
      const [details, map] = await Promise.all([
        this.#app.track(() =>
          this.#app.endpoints.getOrchestration(this.instanceId, this.#app.capabilities.conditionalGet),
        ),
        loadFunctionMap(this.#app),
      ]);

      if (requestId !== this.#requestId) {
        return null;
      }

      this.details = details;

      if (map) {
        this.functionMap = map;
      }

      return details;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return null;
      }

      this.error = error instanceof Error ? error.message : String(error);

      // An auto-refresh that keeps failing is stopped, and the preference goes with it (React parity)
      this.stopAutoRefresh();
      this.#app.prefs.setAutoRefresh('instance', 0);
      this.#app.toast.fromError('Load failed', error, () => void this.loadDetails());

      return null;
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  /** Everything the workspace shows: the details, the first page of history, the spans, the hooks. */
  async refreshAll(): Promise<void> {
    await Promise.all([
      this.loadDetails(),
      this.history.load(true),
      this.spans.load(),
      ...this.#hooks.map((hook) => hook()),
    ]);
  }

  /** Starts (or restarts) the timer for the interval in the preferences; 0 turns it off. */
  startAutoRefresh(): void {
    this.stopAutoRefresh();

    const seconds = this.#app.autoRefreshSeconds('instance');

    if (seconds > 0) {
      this.#timer = setInterval(() => void this.tick(), seconds * 1000);
    }
  }

  stopAutoRefresh(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * One auto-refresh tick: the details, the first page of history and the spans, never over a
   * request already in flight. The spans are what makes a running timeline move, so a tick that
   * left them alone would tick a clock over a picture of the past.
   */
  async tick(): Promise<void> {
    if (this.loading || this.busy || this.history.loading || this.spans.loading) {
      return;
    }

    await Promise.all([this.loadDetails(), this.history.load(true), this.spans.load()]);
  }

  // ---------------------------------------------------------------- actions
  //
  // The confirm dialogs of E5-S1-T2 call these. Each says what it did (the mockup's wording,
  // ScreenInstance.dc.html L370-L387), reloads the workspace, and leaves the dialog to close itself.

  suspend(reason = ''): Promise<boolean> {
    return this.#act('suspend', () => this.#app.endpoints.postAction(this.instanceId, 'suspend', reason || undefined));
  }

  resume(reason = ''): Promise<boolean> {
    return this.#act('resume', () => this.#app.endpoints.postAction(this.instanceId, 'resume', reason || undefined));
  }

  rewind(reason = ''): Promise<boolean> {
    return this.#act('rewind', () => this.#app.endpoints.postAction(this.instanceId, 'rewind', reason || undefined));
  }

  terminate(reason = ''): Promise<boolean> {
    return this.#act('terminate', () =>
      this.#app.endpoints.postAction(this.instanceId, 'terminate', reason || undefined),
    );
  }

  /** The instance is gone afterwards, so nothing is reloaded - the list is what is left to show. */
  purge(): Promise<boolean> {
    return this.#act('purge', () => this.#app.endpoints.purge(this.instanceId), {
      reload: false,
      after: () => this.#app.router.navigate({ name: 'instances', hub: this.#app.hub }),
    });
  }

  restart(restartWithNewInstanceId = true): Promise<boolean> {
    return this.#act('restart', () => this.#app.endpoints.restart(this.instanceId, restartWithNewInstanceId));
  }

  /**
   * Also the entity signal: the endpoint is the same one (contracts §6), and only what the toast
   * calls it changes - which is why the caller may say what that is.
   */
  raiseEvent(name: string, data: unknown, message?: string): Promise<boolean> {
    return this.#act('raise', () => this.#app.endpoints.raiseEvent(this.instanceId, name, data), { message });
  }

  /** Null clears it: the backend takes an empty body as "no custom status" (contracts §6). */
  setCustomStatus(value: unknown | null): Promise<boolean> {
    return this.#act('custom', () => this.#app.endpoints.setCustomStatus(this.instanceId, value));
  }

  /**
   * One action: hold the buttons down, call, say what happened, reload. A failure says what failed
   * and why and changes nothing else - the dialog that called stays open so it can be tried again.
   */
  async #act(
    kind: ActionKind,
    run: () => Promise<unknown>,
    options: { reload?: boolean; after?: () => void; message?: string } = {},
  ): Promise<boolean> {
    if (this.busy) {
      return false;
    }

    this.busy = true;

    try {
      await this.#app.track(run);

      this.#app.toast.ok(options.message ?? actionToast(kind, this.instanceId));
      options.after?.();

      if (options.reload !== false) {
        await this.refreshAll();
      }

      return true;
    } catch (error) {
      this.#app.toast.fromError(`Failed to ${ACTION_VERBS[kind]}`, error);

      return false;
    } finally {
      this.busy = false;
    }
  }
}
