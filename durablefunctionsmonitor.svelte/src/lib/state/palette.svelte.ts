// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The command palette's items and query (contracts §7). Every row is computed from live state -
// the capabilities, the route, the preferences, the id suggestions - so the palette can never offer
// a screen this backend does not have or a "current" mark that is out of date.

import { TIME_RANGE_LABELS, TIME_RANGE_PRESETS, isPreset } from '$lib/filters/time-range';
import { NAV_ITEMS, SETTINGS_ITEM } from '$lib/shell/nav-items';
import { THEMES } from '$lib/themes';
import type { AppState } from './app.svelte';
import { MIN_PREFIX, Suggestions } from './suggestions.svelte';

export interface PaletteItem {
  /** Stable within one rendering; the row's value in the list. */
  id: string;
  label: string;
  /** The right-hand `.kbd`: a chord (`g i`) or the word `current`. */
  kbd?: string;
  run: () => void;
}

export interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

/** The chords the keyboard map answers (contracts §13), shown beside the screens they go to. */
const CHORDS: Record<string, string> = {
  overview: 'g o',
  instances: 'g i',
  failures: 'g f',
  entities: 'g e',
  settings: 'g s',
};

export interface PaletteOptions {
  /** Opens the top bar's hub menu; the shell knows where that menu is. */
  onSwitchHub?: () => void;
  /**
   * Suspends or resumes the instance the workspace is on. E5 passes the confirm dialogs here; until
   * it does, the palette does not offer the rows - the same rule the peek panel follows.
   */
  onInstanceAction?: (action: 'suspend' | 'resume') => void;
  /** Whether the instance the workspace is on is suspended, which decides which of the pair shows. */
  instanceSuspended?: () => boolean;
  /** Whether an instance id is known to have failed (E9's failures state); nothing else knows. */
  isFailed?: (instanceId: string) => boolean;
  /** Shared with the top bar's jump field in tests; its own otherwise. */
  suggestions?: Suggestions;
}

export class Palette {
  open = $state(false);
  query = $state('');

  readonly #app: AppState;
  readonly #options: PaletteOptions;
  readonly #suggestions: Suggestions;

  constructor(app: AppState, options: PaletteOptions = {}) {
    this.#app = app;
    this.#options = options;
    this.#suggestions = options.suggestions ?? new Suggestions(app.endpoints);
  }

  /** The groups to draw: built from state, then filtered by the query, empty ones dropped. */
  get groups(): PaletteGroup[] {
    const query = this.query.trim().toLowerCase();

    return this.#build()
      .map((group) => ({
        name: group.name,
        items: group.items.filter((item) => !query || item.label.toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length > 0);
  }

  /** Every row on screen, in order. */
  get items(): PaletteItem[] {
    return this.groups.flatMap((group) => group.items);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  toggle(): void {
    if (this.open) {
      this.close();
    } else {
      this.show();
    }
  }

  /** Always opens on an empty query: the palette is a fresh start, not a place you left off. */
  show(): void {
    this.query = '';
    this.#suggestions.clear();
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  /** Every keystroke: the filter is local, the instance ids come from the backend. */
  setQuery(query: string): void {
    this.query = query;
    this.#suggestions.query(query.trim());
  }

  /** Running a row always closes the palette (DFM App.dc.html L318-L338). */
  run(item: PaletteItem): void {
    this.close();
    item.run();
  }

  #build(): PaletteGroup[] {
    return [
      { name: 'Go to', items: [...this.#screens(), ...this.#instances()] },
      { name: 'Actions', items: this.#actions() },
      { name: 'Preferences', items: this.#preferences() },
    ];
  }

  #screens(): PaletteItem[] {
    const app = this.#app;

    return [...NAV_ITEMS.filter((item) => item.visible(app.capabilities, app.host)), SETTINGS_ITEM].map((item) => ({
      id: `go:${item.id}`,
      label: item.label,
      kbd: CHORDS[item.id],
      run: () => app.router.navigate({ name: item.id, hub: app.hub }),
    }));
  }

  /** Up to six ids from `/id-suggestions`, once the query is long enough for it to mean anything. */
  #instances(): PaletteItem[] {
    if (this.query.trim().length < MIN_PREFIX) {
      return [];
    }

    const app = this.#app;

    return this.#suggestions.items.map((instanceId) => {
      // A failed instance opens on its Inputs tab: what was it given is the first question asked
      const failed = this.#options.isFailed?.(instanceId) ?? false;

      return {
        id: `instance:${instanceId}`,
        label: `Instance ${instanceId}${failed ? ' (failed)' : ''}`,
        run: () =>
          app.router.navigate(
            { name: 'instance', hub: app.hub, instanceId },
            failed ? { query: { tab: 'inputs' } } : {},
          ),
      };
    });
  }

  #actions(): PaletteItem[] {
    const app = this.#app;
    const route = app.router.current;

    const items: PaletteItem[] = [
      {
        id: 'action:start',
        label: 'Start new instance',
        run: () => app.router.navigate({ name: 'instances', hub: app.hub }, { query: { start: 1 } }),
      },
      { id: 'action:refresh', label: 'Refresh', run: () => app.refresh() },
    ];

    // Only on the workspace, and only once E5 has somewhere for it to go
    if (route.name === 'instance' && this.#options.onInstanceAction) {
      const suspended = this.#options.instanceSuspended?.() ?? false;

      items.push({
        id: 'action:suspend',
        label: suspended ? 'Resume current instance' : 'Suspend current instance',
        run: () => this.#options.onInstanceAction?.(suspended ? 'resume' : 'suspend'),
      });
    }

    items.push(
      {
        id: 'action:purge',
        label: 'Purge instance history…',
        run: () => app.router.navigate({ name: 'settings', hub: app.hub }),
      },
      { id: 'action:hub', label: 'Switch task hub', run: () => this.#options.onSwitchHub?.() },
    );

    return items;
  }

  #preferences(): PaletteItem[] {
    const prefs = this.#app.prefs;
    const dark = prefs.resolvedMode === 'dark';
    const range = this.#app.timeRange;

    return [
      {
        id: 'pref:mode',
        label: dark ? 'Switch to light mode' : 'Switch to dark mode',
        run: () => prefs.setMode(dark ? 'light' : 'dark'),
      },

      ...THEMES.map((theme) => ({
        id: `pref:theme:${theme.key}`,
        label: `Theme: ${theme.label}`,
        kbd: theme.key === prefs.theme ? 'current' : undefined,
        run: () => prefs.setTheme(theme.key),
      })),

      {
        id: 'pref:density',
        label: prefs.density === 'comfortable' ? 'Density: compact rows (36 px)' : 'Density: comfortable rows (44 px)',
        run: () => prefs.setDensity(prefs.density === 'comfortable' ? 'compact' : 'comfortable'),
      },

      ...TIME_RANGE_PRESETS.map((preset) => ({
        id: `pref:range:${preset}`,
        label: `Time range: ${TIME_RANGE_LABELS[preset]}`,
        kbd: isPreset(range) && range.preset === preset ? 'current' : undefined,
        run: () => this.#app.setTimeRange({ preset }),
      })),

      {
        id: 'pref:time',
        label: prefs.showTimeAs === 'UTC' ? 'Show time as local' : 'Show time as UTC',
        run: () => prefs.setShowTimeAs(prefs.showTimeAs === 'UTC' ? 'Local' : 'UTC'),
      },
    ];
  }
}
