// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Port of durablefunctionsmonitor.react/src/states/VsCodeTypedLocalStorage.ts (contracts §8).
// Unlike the browser, VS Code has no query string or localStorage of its own: state is seeded
// once from `host.stateFromVsCode[prefix]` and persisted back through the `PersistState` message.
import type { Host } from '../host.svelte';
import type { ITypedLocalStorage } from './typed-local-storage';
import { TypedLocalStorage } from './typed-local-storage';

interface VsCodeApiLike {
  postMessage(message: unknown): void;
}

function isVsCodeApiLike(value: unknown): value is VsCodeApiLike {
  return !!value && typeof (value as VsCodeApiLike).postMessage === 'function';
}

/** Stores field values in the VS Code webview state, seeded from and persisted via `host`. */
export class VsCodeTypedLocalStorage<T> implements ITypedLocalStorage<T> {
  private readonly state: Record<string, string>;

  constructor(
    private readonly prefix: string,
    private readonly host: Host,
  ) {
    const seeded = host.stateFromVsCode[prefix];
    this.state = seeded && typeof seeded === 'object' ? { ...(seeded as Record<string, string>) } : {};
  }

  setItem(fieldName: Extract<keyof T, string>, value: string): void {
    this.state[fieldName] = value;
    this.save();
  }

  setItems(items: { fieldName: Extract<keyof T, string>; value: string | null }[]): void {
    for (const item of items) {
      if (item.value === null) {
        delete this.state[item.fieldName];
      } else {
        this.state[item.fieldName] = item.value;
      }
    }

    this.save();
  }

  getItem(fieldName: Extract<keyof T, string>): string | null {
    return this.state[fieldName] ?? null;
  }

  removeItem(fieldName: Extract<keyof T, string>): void {
    delete this.state[fieldName];
    this.save();
  }

  private save(): void {
    if (isVsCodeApiLike(this.host.vsCodeApi)) {
      this.host.vsCodeApi.postMessage({ method: 'PersistState', key: this.prefix, data: this.state });
    }
  }
}

/**
 * Picks the `ITypedLocalStorage<T>` implementation for `prefix` by `host.kind`: `TypedLocalStorage`
 * (localStorage + query string) in the browser, `VsCodeTypedLocalStorage` (PersistState) in VS Code.
 */
export function createStorages<T>(host: Host, prefix: string): ITypedLocalStorage<T> {
  return host.kind === 'vscode' ? new VsCodeTypedLocalStorage<T>(prefix, host) : new TypedLocalStorage<T>(prefix);
}
