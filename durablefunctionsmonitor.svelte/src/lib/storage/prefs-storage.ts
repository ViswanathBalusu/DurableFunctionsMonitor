// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// PrefsStorage (contracts §8): user preferences (theme, mode, density, ...) are never written to
// the query string (unlike ViewStateStorage). Browser: plain `dfm.<field>` localStorage keys.
// VS Code: PersistState under the fixed key `prefs`.
import type { Host } from '../host.svelte';
import type { ITypedLocalStorage } from './typed-local-storage';
import { VsCodeTypedLocalStorage } from './vscode-typed-local-storage';

/**
 * The field names PrefsStorage persists (contracts §8). The `Prefs` rune class (E0-S4-T1) is the
 * eventual owner of these values; this type only pins the storage keys.
 */
export interface PrefsFields {
  theme: string;
  mode: string;
  density: string;
  showTimeAs: string;
  nav: string;
  thresholds: string;
  savedViews: string;
  'autoRefresh.instances': string;
  'autoRefresh.instance': string;
}

const PREFS_LOCAL_STORAGE_PREFIX = 'dfm';
const PREFS_VSCODE_KEY = 'prefs';

/** Plain `dfm.<field>` localStorage keys, no query string mirroring. */
class BrowserPrefsStorage implements ITypedLocalStorage<PrefsFields> {
  setItem(fieldName: Extract<keyof PrefsFields, string>, value: string): void {
    localStorage.setItem(`${PREFS_LOCAL_STORAGE_PREFIX}.${fieldName}`, value);
  }

  setItems(items: { fieldName: Extract<keyof PrefsFields, string>; value: string | null }[]): void {
    for (const item of items) {
      if (item.value === null) {
        localStorage.removeItem(`${PREFS_LOCAL_STORAGE_PREFIX}.${item.fieldName}`);
      } else {
        localStorage.setItem(`${PREFS_LOCAL_STORAGE_PREFIX}.${item.fieldName}`, item.value);
      }
    }
  }

  getItem(fieldName: Extract<keyof PrefsFields, string>): string | null {
    return localStorage.getItem(`${PREFS_LOCAL_STORAGE_PREFIX}.${fieldName}`);
  }

  removeItem(fieldName: Extract<keyof PrefsFields, string>): void {
    localStorage.removeItem(`${PREFS_LOCAL_STORAGE_PREFIX}.${fieldName}`);
  }
}

/** `ITypedLocalStorage<PrefsFields>`: browser localStorage or VS Code PersistState, by `host.kind`. */
export class PrefsStorage implements ITypedLocalStorage<PrefsFields> {
  private readonly inner: ITypedLocalStorage<PrefsFields>;

  constructor(host: Host) {
    this.inner =
      host.kind === 'vscode'
        ? new VsCodeTypedLocalStorage<PrefsFields>(PREFS_VSCODE_KEY, host)
        : new BrowserPrefsStorage();
  }

  setItem(fieldName: Extract<keyof PrefsFields, string>, value: string): void {
    this.inner.setItem(fieldName, value);
  }

  setItems(items: { fieldName: Extract<keyof PrefsFields, string>; value: string | null }[]): void {
    this.inner.setItems(items);
  }

  getItem(fieldName: Extract<keyof PrefsFields, string>): string | null {
    return this.inner.getItem(fieldName);
  }

  removeItem(fieldName: Extract<keyof PrefsFields, string>): void {
    this.inner.removeItem(fieldName);
  }
}
