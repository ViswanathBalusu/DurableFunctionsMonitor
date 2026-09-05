// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The peeked row (contracts §7). A peek is an overlay over whatever list the user is reading, so it
// holds a copy of the row rather than a pointer into a list: the list keeps its scroll position, its
// paging and its selection, and closing the peek puts the focus back on the row that opened it.

import type { EntityType } from '$lib/api/types';

export interface PeekItem {
  id: string;
  /** The orchestration or entity name, as the list shows it. */
  name: string;
  kind: EntityType;
  /** The runtime status verbatim from the backend; the panel colours the tile from it. */
  status: string;
  /** ISO, UTC - the panel formats it against the user's `showTimeAs`. */
  created: string;
  updated: string;
  /** Milliseconds, or null when the backend did not give one. */
  duration: number | null;
  customStatus?: unknown;
  /** Entities only: the parsed state, shown pretty-printed and fully expanded. */
  state?: unknown;
  /** `31 rows · 18.2 KB`, once E8's history state knows; the panel shows an em dash until then. */
  history?: string;
}

export class Peek {
  /** The row being peeked, or null when the panel is closed. */
  item = $state<PeekItem | null>(null);

  /** Where the focus goes when the panel closes: the row that opened it. */
  #openedFrom: HTMLElement | null = null;

  get isOpen(): boolean {
    return this.item !== null;
  }

  /**
   * Opens the panel on a row. Peeking twice without closing (the user clicks the next row while the
   * panel is up) keeps the first opener as the focus target, which is the row still under the mouse.
   */
  open(item: PeekItem): void {
    this.#openedFrom ??= activeElement();
    this.item = item;
  }

  close(): void {
    if (!this.item) {
      return;
    }

    this.item = null;

    const target = this.#openedFrom;
    this.#openedFrom = null;

    // After the overlay has gone: bits-ui moves the focus itself while the panel is unmounting
    queueMicrotask(() => {
      if (target?.isConnected) {
        target.focus();
      }
    });
  }
}

function activeElement(): HTMLElement | null {
  const active = globalThis.document?.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}
