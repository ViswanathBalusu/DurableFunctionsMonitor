// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Endpoints } from '$lib/api/endpoints';

/** Below this many characters the backend has nothing useful to prefix-match on. */
export const MIN_PREFIX = 2;

/** How long the field waits after a keystroke before asking (React's reloadSuggestions). */
export const DEBOUNCE_MS = 150;

/** How many suggestions the drop-down shows. */
export const MAX_SUGGESTIONS = 6;

/**
 * Instance-id suggestions for the top bar's jump field.
 *
 * Debounced, and every response carries the id of the request that asked for it: typing quickly
 * produces overlapping calls, and the last answer to arrive is not necessarily the one for what is
 * in the field now.
 */
export class Suggestions {
  items = $state<string[]>([]);

  loading = $state(false);

  #requestId = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  readonly #endpoints: Endpoints;
  readonly #debounceMs: number;

  constructor(endpoints: Endpoints, debounceMs = DEBOUNCE_MS) {
    this.#endpoints = endpoints;
    this.#debounceMs = debounceMs;
  }

  /** Call on every keystroke; the class decides whether and when to ask. */
  query(prefix: string): void {
    this.#cancel();

    if (prefix.length < MIN_PREFIX) {
      this.items = [];
      this.loading = false;
      return;
    }

    this.#timer = setTimeout(() => void this.#load(prefix), this.#debounceMs);
  }

  /** Drops what is on screen and any pending call (the field was cleared, or an id was chosen). */
  clear(): void {
    this.#cancel();
    this.items = [];
    this.loading = false;
  }

  async #load(prefix: string): Promise<void> {
    const requestId = ++this.#requestId;
    this.loading = true;

    try {
      const ids = await this.#endpoints.idSuggestions(prefix);

      if (requestId !== this.#requestId) {
        // A newer keystroke already asked; this answer is about a prefix nobody is typing any more
        return;
      }

      this.items = ids.slice(0, MAX_SUGGESTIONS);
    } catch {
      // A failed suggestion lookup is not worth a toast: the user can still type the id in full
      if (requestId === this.#requestId) {
        this.items = [];
      }
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  #cancel(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
