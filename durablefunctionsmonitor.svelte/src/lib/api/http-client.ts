// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Browser backend client (contracts §5), a fetch port of
// durablefunctionsmonitor.react/src/services/BackendClient.ts.

import { host } from '$lib/host.svelte';
import { isJsonContentType, mapError, NetworkError, type BackendClient, type BackendClientHost } from './client';
import { apiHubSegment, clientHubSegment } from './hub-segment';

/** Anti-forgery cookie and header name, see the backend's XSRF token cookie. */
export const XSRF_TOKEN_HEADER = 'x-dfm-xsrf-token';

/** Session flag guarding the one-shot reload of the easy-auth cookie-expiry workaround. */
export const RELOAD_GUARD_KEY = 'dfm.reloadedOnNetworkError';

export type AuthHeadersProvider = () => Record<string, string> | Promise<Record<string, string>>;

export interface HttpBackendClientOptions {
  /** Page reload used by the cookie-expiry workaround. Injectable so tests do not navigate. */
  reload?: () => void;
}

/** Reads the anti-forgery token out of document.cookie, exactly as React's LoginState did. */
function xsrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined' || !document.cookie) {
    return {};
  }
  const match = new RegExp(`${XSRF_TOKEN_HEADER}=([^;]+)`).exec(decodeURIComponent(document.cookie));
  return match ? { [XSRF_TOKEN_HEADER]: match[1] } : {};
}

/** The api route prefix as a root-absolute path: the host global carries no leading slash. */
function apiBase(): string {
  const prefix = host.apiRoutePrefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `/${prefix}` : '';
}

function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

function saveBlobAs(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export class HttpBackendClient implements BackendClient {
  readonly isVsCode = false;
  readonly host: BackendClientHost;

  /**
   * Set by the login state after a successful cookie-based (no clientId) login. React installed
   * its axios "Network Error" interceptor at exactly that point, and only then; until the user is
   * logged in a failed request must not reload the page.
   */
  reloadOnNetworkError = false;

  readonly #getHub: () => string;
  readonly #getAuthHeaders: AuthHeadersProvider;
  readonly #reload: () => void;
  readonly #etags = new Map<string, string>();
  readonly #cache = new Map<string, unknown>();

  constructor(getHub: () => string, getAuthHeaders: AuthHeadersProvider, options: HttpBackendClientOptions = {}) {
    this.#getHub = getHub;
    this.#getAuthHeaders = getAuthHeaders;
    this.#reload = options.reload ?? (() => globalThis.location?.reload());

    this.host = {
      openInNewWindow: (instanceId: string) => {
        // Just to be extra sure
        const safeId = (instanceId ?? '').replace(/javascript:/gi, '');
        const routePrefix = host.routePrefix ? `/${host.routePrefix}` : '';
        const href = `${routePrefix}/${clientHubSegment(this.#getHub())}/instances/${encodeURIComponent(safeId)}`;
        window.open(href);
      },
      saveAs: async (svg: string, suggestedName: string) => {
        saveBlobAs(new Blob([svg], { type: 'image/svg+xml' }), suggestedName);
      },
      gotoFunctionCode: async (functionName: string) => {
        void functionName; // there is no editor to jump to outside VS Code
      },
      gotoBinding: async (functionName: string, bindingIndex: number) => {
        void functionName;
        void bindingIndex;
      },
      saveFunctionGraphAsJson: async () => {},
      persistState: (key: string, data: unknown) => {
        void key;
        void data; // the browser persists through localStorage, not through the host
      },
    };
  }

  /** apiRoutePrefix + hub segment + url; a `../` prefix addresses the hub-less calls. */
  buildUrl(method: string, url: string): string {
    if (url.startsWith('../')) {
      return `${apiBase()}/${url.slice(3)}`;
    }
    return `${apiBase()}/${apiHubSegment(this.#getHub(), method, url)}${url}`;
  }

  async get<T>(url: string, opts?: { conditional?: boolean }): Promise<T> {
    const target = this.buildUrl('GET', url);
    const conditional = opts?.conditional === true;
    const etag = this.#etags.get(target);
    const headers: Record<string, string> =
      conditional && etag !== undefined && this.#cache.has(target) ? { 'If-None-Match': etag } : {};

    const response = await this.#send('GET', target, undefined, headers);

    if (response.status === 304) {
      return this.#cache.get(target) as T;
    }

    const value = await this.#readBody<T>(response);

    if (conditional) {
      const newETag = response.headers.get('ETag');
      if (newETag) {
        this.#etags.set(target, newETag);
        this.#cache.set(target, value);
      } else {
        this.#etags.delete(target);
        this.#cache.delete(target);
      }
    }

    return value;
  }

  async post<T>(url: string, body?: unknown): Promise<T> {
    return this.#readBody<T>(await this.#send('POST', this.buildUrl('POST', url), body));
  }

  async put<T>(url: string, body?: unknown): Promise<T> {
    return this.#readBody<T>(await this.#send('PUT', this.buildUrl('PUT', url), body));
  }

  async download(url: string, fileName: string): Promise<void> {
    const response = await this.#send('POST', this.buildUrl('POST', url), undefined, { Accept: '*/*' });

    if (!response.ok) {
      throw mapError(response.status, await response.text(), response.headers.get('content-type'));
    }

    const mediaType = mediaTypeOf(response.headers.get('content-type'));
    const extension = mediaType === 'application/json' ? '.json' : mediaType === 'text/plain' ? '.txt' : '.dat';

    saveBlobAs(await response.blob(), `${fileName}${extension}`);
  }

  async #send(
    method: string,
    target: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...xsrfHeaders(),
      ...(await this.#getAuthHeaders()),
      ...extraHeaders,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      return await fetch(target, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      this.#onNetworkError();
      throw new NetworkError(err instanceof Error && err.message ? err.message : 'Network Error');
    }
  }

  /**
   * fetch throws a TypeError when the easy-auth cookie expired and the platform answers with a
   * cross-origin redirect (React could only detect this as "Network Error"). Reloading re-runs the
   * easy-auth login; the session flag makes sure it happens at most once.
   */
  #onNetworkError(): void {
    if (!this.reloadOnNetworkError) {
      return;
    }
    try {
      if (globalThis.sessionStorage?.getItem(RELOAD_GUARD_KEY)) {
        return;
      }
      globalThis.sessionStorage?.setItem(RELOAD_GUARD_KEY, '1');
    } catch {
      return; // no sessionStorage means no guard, and without a guard we must not reload
    }
    this.#reload();
  }

  async #readBody<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    const text = await response.text();

    if (!response.ok) {
      throw mapError(response.status, text, contentType);
    }

    if (!text) {
      return undefined as T;
    }

    // Custom tab markup and other text/plain endpoints resolve as a plain string.
    if (!isJsonContentType(contentType)) {
      return text as unknown as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
