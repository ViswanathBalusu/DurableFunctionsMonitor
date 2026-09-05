// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Port of durablefunctionsmonitor.react/src/states/ITypedLocalStorage.ts and TypedLocalStorage.ts
// (contracts §8). Every field write is mirrored into the query string so filters/tabs/ordering
// survive a reload and links stay shareable; the query string takes precedence on read.
import { QueryString } from './query-string';

/** Interface for persisting class field values in some storage. */
export interface ITypedLocalStorage<T> {
  setItem(fieldName: Extract<keyof T, string>, value: string): void;

  setItems(items: { fieldName: Extract<keyof T, string>; value: string | null }[]): void;

  getItem(fieldName: Extract<keyof T, string>): string | null;

  removeItem(fieldName: Extract<keyof T, string>): void;
}

/** Stores field values in localStorage under `${prefix}::${fieldName}`, mirrored to the query string. */
export class TypedLocalStorage<T> implements ITypedLocalStorage<T> {
  constructor(private readonly prefix: string) {}

  setItem(fieldName: Extract<keyof T, string>, value: string): void {
    localStorage.setItem(`${this.prefix}::${fieldName}`, value);

    // Also placing into the query string.
    const queryString = new QueryString();
    queryString.values[fieldName] = value;
    queryString.apply();
  }

  setItems(items: { fieldName: Extract<keyof T, string>; value: string | null }[]): void {
    // Also placing into the query string.
    const queryString = new QueryString();

    for (const item of items) {
      if (item.value === null) {
        localStorage.removeItem(`${this.prefix}::${item.fieldName}`);

        delete queryString.values[item.fieldName];
      } else {
        localStorage.setItem(`${this.prefix}::${item.fieldName}`, item.value);

        queryString.values[item.fieldName] = item.value;
      }
    }

    queryString.apply();
  }

  getItem(fieldName: Extract<keyof T, string>): string | null {
    // The query string should take precedence.
    const queryString = new QueryString();
    if (queryString.values[fieldName]) {
      return queryString.values[fieldName];
    }

    return localStorage.getItem(`${this.prefix}::${fieldName}`);
  }

  removeItem(fieldName: Extract<keyof T, string>): void {
    localStorage.removeItem(`${this.prefix}::${fieldName}`);

    // Also dropping it from the query string.
    const queryString = new QueryString();
    delete queryString.values[fieldName];
    queryString.apply();
  }
}
