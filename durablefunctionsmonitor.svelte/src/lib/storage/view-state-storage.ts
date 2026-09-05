// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// ViewStateStorage (contracts §8): filters, tab, ordering and hidden columns per screen, so links
// are shareable and state survives reload. Browser: query string first, then localStorage
// `dfm.view.<screen>::<field>` (TypedLocalStorage). VS Code: PersistState under `view.<screen>`.
import type { Host } from '../host.svelte';
import type { ITypedLocalStorage } from './typed-local-storage';
import { createStorages } from './vscode-typed-local-storage';

/** `ITypedLocalStorage<T>` scoped to one screen's view state, picked by `host.kind`. */
export class ViewStateStorage<T> implements ITypedLocalStorage<T> {
  private readonly inner: ITypedLocalStorage<T>;

  constructor(screen: string, host: Host) {
    const prefix = host.kind === 'vscode' ? `view.${screen}` : `dfm.view.${screen}`;
    this.inner = createStorages<T>(host, prefix);
  }

  setItem(fieldName: Extract<keyof T, string>, value: string): void {
    this.inner.setItem(fieldName, value);
  }

  setItems(items: { fieldName: Extract<keyof T, string>; value: string | null }[]): void {
    this.inner.setItems(items);
  }

  getItem(fieldName: Extract<keyof T, string>): string | null {
    return this.inner.getItem(fieldName);
  }

  removeItem(fieldName: Extract<keyof T, string>): void {
    this.inner.removeItem(fieldName);
  }
}
