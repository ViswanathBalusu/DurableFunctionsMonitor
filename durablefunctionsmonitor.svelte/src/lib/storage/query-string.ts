// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Port of durablefunctionsmonitor.react/src/states/QueryString.ts.
// Helper class for dealing with the browser's query string; TypedLocalStorage mirrors every
// value it stores into the query string through this class (contracts §8).
export class QueryString {
  private readonly _values: Record<string, string> = {};

  constructor() {
    const pairs = window.location.search.substring(1).split('&');
    for (const pairString of pairs) {
      const pair = pairString.split('=');
      if (pair.length > 1) {
        this._values[pair[0]] = decodeURIComponent(pair[1]);
      }
    }
  }

  get values(): Record<string, string> {
    return this._values;
  }

  setValue(key: string, val: string): void {
    if (val) {
      this._values[key] = val;
    } else {
      delete this._values[key];
    }
  }

  apply(pushState = false): void {
    let queryString = '';
    for (const key in this._values) {
      if (queryString) {
        queryString += '&';
      }
      queryString += `${key}=${encodeURIComponent(this._values[key])}`;
    }

    // Rebuild the full path explicitly (not just the query string): resolving an *empty*
    // relative url against the current location keeps the base's existing query per the URL
    // spec, which would make clearing the last value a no-op.
    const url = !queryString ? window.location.pathname : `${window.location.pathname}?${queryString}`;

    if (pushState) {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
  }
}
