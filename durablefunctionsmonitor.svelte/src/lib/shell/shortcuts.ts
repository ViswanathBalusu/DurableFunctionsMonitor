// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The keyboard map of contracts §13, as one listener on the window (DFM App.dc.html L289-L302).
// Everything else - arrow keys in the palette, in a combobox, in a menu - belongs to the component
// that owns the focus, and is not here.

import type { AppState } from '$lib/state/app.svelte';
import type { HubRouteName } from '$lib/router.svelte';
import { visibleNavItems } from './nav-items';

/** How long after `g` the second key still counts as part of the chord. */
export const CHORD_MS = 900;

/** `g` then one of these. Settings is not in the chord map by capability: it always exists. */
const CHORDS: Record<string, HubRouteName> = {
  o: 'overview',
  i: 'instances',
  f: 'failures',
  e: 'entities',
  s: 'settings',
};

export interface ShortcutTargets {
  /** `/`: put the caret in the top bar's instance jump. */
  focusJump: () => void;
  /** Ctrl/⌘ K. */
  togglePalette: () => void;
  /** Whether the palette is up: while it is, the map is inert apart from Ctrl/⌘ K and Escape. */
  paletteOpen?: () => boolean;
  /** Escape, when the palette is the innermost thing open. */
  closePalette?: () => void;
  /** Defaults to `window`; a test passes its own element. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Installs the map and returns the disposer. Called by `Shell`, so the shortcuts exist exactly as
 * long as the shell does - the login screen has no shell, which is also why it has no shortcuts.
 */
export function installShortcuts(app: AppState, targets: ShortcutTargets): () => void {
  const on = targets.target ?? window;

  /** When the pending `g` expires. */
  let chordUntil = 0;

  function handler(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      chordUntil = 0;
      targets.togglePalette();
      return;
    }

    if (event.key === 'Escape') {
      chordUntil = 0;
      escape();
      return;
    }

    if (isTyping(event) || targets.paletteOpen?.() || app.router.current.name === 'login') {
      return;
    }

    if (event.key === '/') {
      event.preventDefault();
      targets.focusJump();
      return;
    }

    if (event.key === 'g') {
      chordUntil = Date.now() + CHORD_MS;
      return;
    }

    if (Date.now() < chordUntil) {
      chordUntil = 0;
      go(CHORDS[event.key]);
    }
  }

  /** Innermost first: the palette, then any dialog (bits-ui closes its own), then the peek. */
  function escape(): void {
    if (targets.paletteOpen?.()) {
      targets.closePalette?.();
      return;
    }

    if (globalThis.document?.querySelector('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')) {
      return;
    }

    app.peek.close();
  }

  function go(name: HubRouteName | undefined): void {
    if (!name || !app.hub) {
      return;
    }

    // A screen this backend cannot serve is not in the nav, so its chord does nothing either
    const reachable = name === 'settings' || visibleNavItems(app.capabilities, app.host).some((it) => it.id === name);

    if (reachable) {
      app.router.navigate({ name, hub: app.hub });
    }
  }

  on.addEventListener('keydown', handler as EventListener);

  return () => on.removeEventListener('keydown', handler as EventListener);
}

/** Every shortcut but Ctrl/⌘ K and Escape stays out of the way of whatever is being typed. */
function isTyping(event: KeyboardEvent): boolean {
  const element = event.target;

  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable;
}
