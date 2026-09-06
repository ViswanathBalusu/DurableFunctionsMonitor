// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The single router of the SPA (contracts §4). Every screen route sits under the hub segment,
// every link is built with `href()` (never by string concatenation), the browser runs in
// history mode with one `popstate` listener and the VS Code webview runs in memory mode,
// persisting the current route through `ViewStateStorage('route')`.

import { host } from './host.svelte';

/** Routes that only need the hub segment. */
const HUB_ROUTE_NAMES = [
  'overview',
  'instances',
  'failures',
  'entities',
  'functions',
  'storage',
  'activity',
  'settings',
] as const;

export type HubRouteName = (typeof HUB_ROUTE_NAMES)[number];

export type RouteName = 'login' | HubRouteName | 'instance';

export type RouteTarget =
  { name: 'login' } | { name: HubRouteName; hub: string } | { name: 'instance'; hub: string; instanceId: string };

export type Route = RouteTarget & { query: URLSearchParams };

/** What `parsePath` returns: a target plus, for the two legacy aliases, where to redirect. */
export type ParsedRoute = RouteTarget & { redirectTo?: string };

export type RouterMode = 'history' | 'memory';

export type QueryPatch = Record<string, string | number | boolean | null | undefined>;

export type QueryInit = QueryPatch | URLSearchParams | string;

/**
 * The slice of `ITypedLocalStorage<{ route: string; query: string }>` the router needs.
 * `ViewStateStorage('route')` from `src/lib/storage/view-state-storage.ts` (E0-S2-T2)
 * satisfies it structurally; declared here so the router does not depend on that module.
 */
export type RouteStateField = 'route' | 'query';

export interface RouteStateStorage {
  getItem(fieldName: RouteStateField): string | null;
  setItems(items: { fieldName: RouteStateField; value: string | null }[]): void;
}

export interface RouterOptions {
  /** Defaults to `memory` in VS Code, `history` in the browser. */
  mode?: RouterMode;
  /** Defaults to `host.routePrefix`. */
  routePrefix?: string;
  /** Memory mode only: the hub the webview is bound to. */
  hub?: string;
  /** Memory mode only: defaults to `host.orchestrationIdFromVsCode`. */
  instanceId?: string;
  /** Memory mode only: `ViewStateStorage('route')`. */
  storage?: RouteStateStorage | null;
}

export interface NavigateOptions {
  replace?: boolean;
  query?: QueryInit;
}

/** The sub-paths under a hub; `overview` is the hub root, not a sub-path. */
const SUB_PATH_ROUTES = new Set<string>(HUB_ROUTE_NAMES.filter((name) => name !== 'overview'));

/** Legacy forms kept alive by old bookmarks and by the VS Code extension (decision D8). */
const ALIAS_SUB_PATHS = ['durable-instances', 'orchestrations'];

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => !!segment);
}

/** Memory mode has no URL, so the hub comes from the host's injected config (contracts §3). */
function hubFromClientConfig(): string {
  const hubName = host.clientConfig.hubName;
  return typeof hubName === 'string' ? hubName : '';
}

function decodeSegments(segments: string[]): string {
  const raw = segments.join('/');
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape sequence is kept verbatim rather than blowing up the whole route.
    return raw;
  }
}

/** The path of a route, without the route prefix and without the query string. */
export function routePath(target: RouteTarget): string {
  switch (target.name) {
    case 'login':
      return '/';
    case 'overview':
      return `/${target.hub}`;
    case 'instance':
      return `/${target.hub}/instances/${encodeURIComponent(target.instanceId)}`;
    default:
      return `/${target.hub}/${target.name}`;
  }
}

/** `/instances` under hub `H` is `/H/instances`; `/` is the hub root. */
function hubRelative(hub: string, path: string): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  if (!hub) {
    return suffix || '/';
  }
  return `/${hub}${suffix}`;
}

function withPrefix(routePrefix: string, path: string): string {
  const prefix = splitPath(routePrefix).join('/');
  if (!prefix) {
    return path;
  }
  return path === '/' ? `/${prefix}/` : `/${prefix}${path}`;
}

/** Drops the `redirectTo` marker a parsed alias carries. */
export function toTarget(parsed: ParsedRoute | Route): RouteTarget {
  switch (parsed.name) {
    case 'login':
      return { name: 'login' };
    case 'instance':
      return { name: 'instance', hub: parsed.hub, instanceId: parsed.instanceId };
    default:
      return { name: parsed.name, hub: parsed.hub };
  }
}

/**
 * True when the router should take a link click rather than the browser: a plain left click. A
 * Ctrl/Cmd/Shift/middle click is the user asking for another tab or window, which is the browser's
 * job - and a click the router takes has to have its default prevented, or the page reloads under
 * the app it just navigated.
 */
export function isRouterClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export function toSearchParams(query?: QueryInit): URLSearchParams {
  if (!query) {
    return new URLSearchParams();
  }
  if (typeof query === 'string' || query instanceof URLSearchParams) {
    return new URLSearchParams(query);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
}

export function queryString(query?: URLSearchParams): string {
  const text = query?.toString() ?? '';
  return text ? `?${text}` : '';
}

/**
 * Maps a location pathname to a route (contracts §4). The route prefix is stripped once,
 * case-insensitively; an unknown sub-path under a hub renders Overview; the two legacy alias
 * forms resolve to the instance route and carry the path to redirect to.
 */
export function parsePath(pathname: string, routePrefix = ''): ParsedRoute {
  const segments = splitPath(pathname);
  const prefixSegments = splitPath(routePrefix);

  const startsWithPrefix =
    prefixSegments.length > 0 &&
    segments.length >= prefixSegments.length &&
    prefixSegments.every((segment, i) => segments[i].toLowerCase() === segment.toLowerCase());
  if (startsWithPrefix) {
    segments.splice(0, prefixSegments.length);
  }

  if (segments.length === 0) {
    return { name: 'login' };
  }

  const hub = segments[0];
  if (segments.length === 1) {
    return { name: 'overview', hub };
  }

  const subPath = segments[1];
  const rest = segments.slice(2);

  if (subPath === 'instances') {
    const instanceId = decodeSegments(rest);
    return instanceId ? { name: 'instance', hub, instanceId } : { name: 'instances', hub };
  }

  if (ALIAS_SUB_PATHS.includes(subPath)) {
    const instanceId = decodeSegments(rest);
    const target: RouteTarget = instanceId ? { name: 'instance', hub, instanceId } : { name: 'instances', hub };
    return { ...target, redirectTo: withPrefix(routePrefix, routePath(target)) };
  }

  return { name: SUB_PATH_ROUTES.has(subPath) ? (subPath as HubRouteName) : 'overview', hub };
}

export class Router {
  /** The route the app renders. Always carries the current query. */
  current: Route = $state({ name: 'login', query: new URLSearchParams() });

  readonly mode: RouterMode;
  readonly routePrefix: string;

  readonly #storage: RouteStateStorage | null;
  /** Memory mode only: what `back()` returns to. */
  readonly #stack: Route[] = [];
  readonly #onPopState = () => this.#syncFromLocation();

  constructor(options: RouterOptions = {}) {
    this.mode = options.mode ?? (host.kind === 'vscode' ? 'memory' : 'history');
    this.routePrefix = options.routePrefix ?? host.routePrefix;
    this.#storage = options.storage ?? null;

    if (this.mode === 'history') {
      this.#syncFromLocation();
      window.addEventListener('popstate', this.#onPopState);
      return;
    }

    const hub = options.hub ?? hubFromClientConfig();
    const instanceId = options.instanceId ?? host.orchestrationIdFromVsCode;
    if (instanceId) {
      this.current = { name: 'instance', hub, instanceId, query: new URLSearchParams() };
      return;
    }

    this.current = this.#restore(hub) ?? { name: 'overview', hub, query: new URLSearchParams() };
  }

  /** The hub segment of the current route, `''` on the login route. */
  get hub(): string {
    return 'hub' in this.current ? this.current.hub : '';
  }

  /** The path of the current route, prefix and query included. */
  get path(): string {
    return this.href(this.current, this.current.query);
  }

  /**
   * Builds a link. A string path is hub-relative (`/instances` → `/{prefix}/{hub}/instances`);
   * a route object carries its own hub.
   */
  href(pathOrRoute: string | RouteTarget, query?: QueryInit): string {
    const path = typeof pathOrRoute === 'string' ? hubRelative(this.hub, pathOrRoute) : routePath(pathOrRoute);
    return withPrefix(this.routePrefix, path) + queryString(toSearchParams(query));
  }

  navigate(target: RouteTarget, options: NavigateOptions = {}): void {
    const route = { ...toTarget(target), query: toSearchParams(options.query) } as Route;
    this.#go(route, options.replace ?? false);
  }

  /** Merges `patch` into the current query; `null` (or `undefined`) deletes a key. */
  setQuery(patch: QueryPatch, options: { replace?: boolean } = {}): void {
    const query = new URLSearchParams(this.current.query);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) {
        query.delete(key);
      } else {
        query.set(key, String(value));
      }
    }
    // Filters and the time range replace by default, so Back leaves the screen.
    this.#go({ ...toTarget(this.current), query } as Route, options.replace ?? true);
  }

  back(): void {
    if (this.mode === 'history') {
      window.history.back();
      return;
    }

    const previous = this.#stack.pop();
    if (previous) {
      this.current = previous;
      this.#persist();
    }
  }

  /** Detaches the `popstate` listener (history mode). */
  dispose(): void {
    if (this.mode === 'history') {
      window.removeEventListener('popstate', this.#onPopState);
    }
  }

  #go(route: Route, replace: boolean): void {
    if (this.mode === 'history') {
      const url = this.href(route, route.query);
      if (replace) {
        window.history.replaceState(null, '', url);
      } else {
        window.history.pushState(null, '', url);
      }
      this.current = route;
      return;
    }

    if (!replace) {
      this.#stack.push(this.current);
    }
    this.current = route;
    this.#persist();
  }

  #syncFromLocation(): void {
    const parsed = parsePath(window.location.pathname, this.routePrefix);
    const query = new URLSearchParams(window.location.search);
    if (parsed.redirectTo) {
      window.history.replaceState(null, '', parsed.redirectTo + queryString(query));
    }
    this.current = { ...toTarget(parsed), query } as Route;
  }

  #persist(): void {
    this.#storage?.setItems([
      { fieldName: 'route', value: this.href(this.current) },
      { fieldName: 'query', value: this.current.query.toString() || null },
    ]);
  }

  #restore(hub: string): Route | null {
    const path = this.#storage?.getItem('route');
    if (!path) {
      return null;
    }
    const parsed = parsePath(path, this.routePrefix);
    const query = new URLSearchParams(this.#storage?.getItem('query') ?? '');
    const restored = { ...toTarget(parsed), query } as Route;

    if (!hub) {
      return restored;
    }

    // This view is bound to one hub, so the hub of the path it persisted is never the interesting
    // part - and a path written before the host knew its hub has the wrong one, or none, which
    // parses to the login screen the webview cannot show. Keep the screen, take this hub.
    return restored.name === 'login' ? { name: 'overview', hub, query } : { ...restored, hub };
  }
}
