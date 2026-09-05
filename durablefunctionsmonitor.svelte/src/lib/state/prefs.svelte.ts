// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// User preferences and the theme runtime (contracts §8). Everything here is per user and per host,
// never part of a shareable link - that is ViewStateStorage's job.

import { setMode, systemPrefersMode } from 'mode-watcher';
import { host as defaultHost, type ClientConfig, type Host, type ThemeName } from '../host.svelte';
import { PrefsStorage, type PrefsFields } from '../storage/prefs-storage';
import type { ITypedLocalStorage } from '../storage/typed-local-storage';

/** The five papers of the design system. */
export const themeNames: ThemeName[] = ['poster', 'riso', 'memphis', 'blueprint', 'hazard'];

/** 'system' means "follow the OS" in the browser and "follow VS Code" inside the webview. */
export type ModePreference = 'light' | 'dark' | 'system';

export type ResolvedMode = 'light' | 'dark';

export type Density = 'compact' | 'comfortable';

export type ShowTimeAs = 'UTC' | 'Local';

export interface Thresholds {
  /** A Running instance untouched for this many minutes is 'stuck'. */
  stuckMinutes: number;
  /** A Pending instance older than this many minutes is 'long pending'. */
  pendingMinutes: number;
  /** A control queue deeper than this is called out on the Overview and the Storage screen. */
  queueDepth: number;
}

export interface SavedView {
  name: string;
  /** The full in-app URL, so a saved view restores filters, columns and time range at once. */
  url: string;
}

export interface AutoRefreshSeconds {
  /** The Instances screen. 0 = never. */
  instances: number;
  /** The instance workspace. 0 = never. */
  instance: number;
}

export const defaultThresholds: Thresholds = { stuckMinutes: 60, pendingMinutes: 10, queueDepth: 1000 };

const defaultAutoRefresh: AutoRefreshSeconds = { instances: 0, instance: 0 };

/**
 * Reads a JSON-encoded preference, falling back to the default when it was never written or when what
 * is in storage no longer parses (an older version of the app, or a hand-edited value).
 */
function readJson<T>(storage: ITypedLocalStorage<PrefsFields>, field: keyof PrefsFields, fallback: T): T {
  const raw = storage.getItem(field as Extract<keyof PrefsFields, string>);
  if (raw === null || raw === '') {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readOneOf<T extends string>(
  storage: ITypedLocalStorage<PrefsFields>,
  field: keyof PrefsFields,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = storage.getItem(field as Extract<keyof PrefsFields, string>);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function readNumber(storage: ITypedLocalStorage<PrefsFields>, field: keyof PrefsFields, fallback: number): number {
  const raw = storage.getItem(field as Extract<keyof PrefsFields, string>);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The user's preferences, loaded once at start-up and written back on every change.
 *
 * Precedence is contracts §8 throughout: a value the user chose wins, then whatever the host injected
 * through DfmClientConfig (the VS Code editor theme, the ingress's showTimeAs), then the documented
 * default. `apply()` is the only place that touches the document element.
 */
export class Prefs {
  /** Which paper. */
  theme = $state<ThemeName>('poster');

  /** What the user asked for; `resolvedMode` is what is actually rendered. */
  mode = $state<ModePreference>('system');

  density = $state<Density>('compact');

  showTimeAs = $state<ShowTimeAs>('UTC');

  /** The side nav starts collapsed inside VS Code, where horizontal space is scarce (contracts §3). */
  navCollapsed = $state(false);

  thresholds = $state<Thresholds>({ ...defaultThresholds });

  savedViews = $state<SavedView[]>([]);

  autoRefresh = $state<AutoRefreshSeconds>({ ...defaultAutoRefresh });

  readonly #storage: ITypedLocalStorage<PrefsFields>;
  readonly #host: Host;

  constructor(host: Host = defaultHost, storage?: ITypedLocalStorage<PrefsFields>) {
    this.#host = host;
    this.#storage = storage ?? new PrefsStorage(host);

    this.#load();
  }

  get clientConfig(): ClientConfig {
    return this.#host.clientConfig;
  }

  /**
   * The mode actually rendered: the user's choice, else the one the host injected (the VS Code editor
   * theme, or an ingress that pins one), else the operating system's preference. Inside VS Code
   * 'system' means "follow VS Code", which is exactly `clientConfig.theme`.
   */
  get resolvedMode(): ResolvedMode {
    if (this.mode !== 'system') {
      return this.mode;
    }

    const fromHost = this.clientConfig.theme;
    if (fromHost === 'light' || fromHost === 'dark') {
      return fromHost;
    }

    // VS Code without an injected theme cannot be asked; light is the safer guess there
    return this.#host.kind === 'vscode' ? 'light' : systemMode();
  }

  setTheme(theme: ThemeName): void {
    this.theme = theme;
    this.#storage.setItem('theme', theme);
    this.apply();
  }

  setMode(mode: ModePreference): void {
    this.mode = mode;
    this.#storage.setItem('mode', mode);
    this.apply();
  }

  setDensity(density: Density): void {
    this.density = density;
    this.#storage.setItem('density', density);
    this.apply();
  }

  setShowTimeAs(showTimeAs: ShowTimeAs): void {
    this.showTimeAs = showTimeAs;
    this.#storage.setItem('showTimeAs', showTimeAs);
  }

  setNavCollapsed(collapsed: boolean): void {
    this.navCollapsed = collapsed;
    this.#storage.setItem('nav', collapsed ? 'collapsed' : 'expanded');
  }

  setThresholds(thresholds: Thresholds): void {
    this.thresholds = thresholds;
    this.#storage.setItem('thresholds', JSON.stringify(thresholds));
  }

  setSavedViews(views: SavedView[]): void {
    this.savedViews = views;
    this.#storage.setItem('savedViews', JSON.stringify(views));
  }

  /** Seconds between automatic reloads of one screen; 0 turns it off. */
  setAutoRefresh(screen: keyof AutoRefreshSeconds, seconds: number): void {
    this.autoRefresh = { ...this.autoRefresh, [screen]: seconds };
    this.#storage.setItem(`autoRefresh.${screen}` as Extract<keyof PrefsFields, string>, String(seconds));
  }

  /**
   * Writes the three attributes the stylesheet reads. `data-theme` and `data-density` are ours;
   * the `dark` class is mode-watcher's, so `setMode` keeps its state in step with ours - but the class
   * is toggled here as well, because mode-watcher only applies it from its own component's effect and
   * the shell does not mount that until E2.
   */
  apply(): void {
    const root = globalThis.document?.documentElement;
    if (!root) {
      return;
    }

    const resolved = this.resolvedMode;

    root.dataset.theme = this.theme;
    root.dataset.density = this.density;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;

    setMode(this.mode);
  }

  #load(): void {
    const config = this.#host.clientConfig;

    this.theme = readOneOf<ThemeName>(
      this.#storage,
      'theme',
      themeNames,
      themeNames.includes(config.dfmTheme as ThemeName) ? (config.dfmTheme as ThemeName) : 'poster',
    );

    this.mode = readOneOf<ModePreference>(this.#storage, 'mode', ['light', 'dark', 'system'], 'system');

    this.density = readOneOf<Density>(this.#storage, 'density', ['compact', 'comfortable'], 'compact');

    this.showTimeAs = readOneOf<ShowTimeAs>(
      this.#storage,
      'showTimeAs',
      ['UTC', 'Local'],
      config.showTimeAs === 'Local' ? 'Local' : 'UTC',
    );

    // Only a stored value counts as a choice; the default follows the host (contracts §3)
    const nav = this.#storage.getItem('nav');
    this.navCollapsed = nav === null ? this.#host.kind === 'vscode' : nav === 'collapsed';

    this.thresholds = { ...defaultThresholds, ...readJson<Partial<Thresholds>>(this.#storage, 'thresholds', {}) };

    const savedViews = readJson<SavedView[]>(this.#storage, 'savedViews', []);
    this.savedViews = Array.isArray(savedViews) ? savedViews : [];

    this.autoRefresh = {
      instances: readNumber(this.#storage, 'autoRefresh.instances', defaultAutoRefresh.instances),
      instance: readNumber(this.#storage, 'autoRefresh.instance', defaultAutoRefresh.instance),
    };
  }
}

/**
 * The operating system's preference.
 *
 * Asked of `matchMedia` directly, which is the same source mode-watcher itself queries: its
 * `systemPrefersMode` only re-reads the query from inside an effect root, so a plain read of it here -
 * outside any component - can answer with whatever it saw when the module was first imported.
 * mode-watcher is still consulted where there is no matchMedia at all.
 */
function systemMode(): ResolvedMode {
  const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (query) {
    return query.matches ? 'dark' : 'light';
  }

  return systemPrefersMode.current === 'dark' ? 'dark' : 'light';
}
