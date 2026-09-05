// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The rows the bulk bar acts on (contracts §7). Shared by Instances and by the groups of the
// Failures screen, and deliberately independent of whatever list is on screen: the selection
// survives a peek, a filter change and a page of "load more", because the user made it on purpose.

import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export class Selection {
  /** The selected instance ids, in the order they were selected. */
  readonly ids = new SvelteSet<string>();

  /** Their orchestrator names, kept so a dialog can say what it is about to act on. */
  readonly names = new SvelteMap<string, string>();

  get count(): number {
    return this.ids.size;
  }

  get isEmpty(): boolean {
    return this.ids.size === 0;
  }

  /** The selection as an array, in selection order. */
  get list(): string[] {
    return [...this.ids];
  }

  has(instanceId: string): boolean {
    return this.ids.has(instanceId);
  }

  toggle(instanceId: string, name?: string): void {
    if (this.ids.delete(instanceId)) {
      this.names.delete(instanceId);
      return;
    }

    this.ids.add(instanceId);

    if (name !== undefined) {
      this.names.set(instanceId, name);
    }
  }

  /** Replaces the whole selection, which is what `selectAll=1` and a saved view do. */
  set(rows: readonly string[] | readonly { instanceId: string; name?: string }[]): void {
    this.clear();

    for (const row of rows) {
      if (typeof row === 'string') {
        this.ids.add(row);
      } else {
        this.ids.add(row.instanceId);

        if (row.name !== undefined) {
          this.names.set(row.instanceId, row.name);
        }
      }
    }
  }

  /**
   * The header checkbox: with every visible row already selected it clears them (and only them -
   * a row selected on an earlier page stays selected), otherwise it adds the ones that are missing.
   */
  toggleAll(visible: readonly string[] | readonly { instanceId: string; name?: string }[]): void {
    const rows = visible.map((row) => (typeof row === 'string' ? { instanceId: row, name: undefined } : row));

    if (rows.length > 0 && rows.every((row) => this.ids.has(row.instanceId))) {
      for (const row of rows) {
        this.ids.delete(row.instanceId);
        this.names.delete(row.instanceId);
      }

      return;
    }

    for (const row of rows) {
      this.ids.add(row.instanceId);

      if (row.name !== undefined) {
        this.names.set(row.instanceId, row.name);
      }
    }
  }

  /** True when every visible row is selected, which is what the header checkbox shows. */
  hasAll(visible: readonly string[] | readonly { instanceId: string }[]): boolean {
    if (visible.length === 0) {
      return false;
    }

    return visible.every((row) => this.ids.has(typeof row === 'string' ? row : row.instanceId));
  }

  /** The name a dialog shows beside an id, when the list it came from knew one. */
  nameOf(instanceId: string): string {
    return this.names.get(instanceId) ?? '';
  }

  clear(): void {
    this.ids.clear();
    this.names.clear();
  }
}
