// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// VS Code backend client (contracts §5), a port of
// durablefunctionsmonitor.react/src/services/VsCodeBackendClient.ts. Every request is forwarded to
// the extension through postMessage; the extension prepends the hub segment itself.

import { createBackendError, type BackendClient, type BackendClientHost, type BackendError } from './client';

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

/** Commands the extension sends to us (menu commands), keyed by `id` instead of a request id. */
export type VsCodeCustomMessageHandlers = {
  purgeHistory: (data: unknown) => void;
  cleanEntityStorage: (data: unknown) => void;
  startNewInstance: (data: unknown) => void;
  batchOps: (data: unknown) => void;
};

export const VS_CODE_CUSTOM_COMMANDS: readonly (keyof VsCodeCustomMessageHandlers)[] = [
  'purgeHistory',
  'cleanEntityStorage',
  'startNewInstance',
  'batchOps',
];

/** The error shape the extension puts on a failed response. */
export interface VsCodeBridgeError {
  message?: string;
  response?: { data?: unknown };
}

interface VsCodeMessage {
  id?: string;
  data?: unknown;
  err?: VsCodeBridgeError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * The extension has no status codes, only an error message ("Request failed with status code 404"),
 * so the status is guessed from that message and defaults to 500. `response.data` is kept as `body`.
 */
export function bridgeError(err: VsCodeBridgeError | undefined): BackendError {
  const message = err?.message ? err.message : 'Request failed';
  const match = /status code (\d{3})/i.exec(message);
  const status = match ? Number(match[1]) : 500;
  return createBackendError(status, message, err?.response?.data);
}

export class VsCodeBackendClient implements BackendClient {
  readonly isVsCode = true;
  readonly host: BackendClientHost;

  readonly #vsCodeApi: VsCodeApi;
  readonly #requests = new Map<string, PendingRequest>();
  #handlers: VsCodeCustomMessageHandlers | null = null;
  #iAmReadySent = false;

  constructor(vsCodeApi: VsCodeApi, messageSource: EventTarget = window) {
    this.#vsCodeApi = vsCodeApi;

    // Handling responses from VsCode
    messageSource.addEventListener('message', (event) => this.#onMessage((event as MessageEvent).data));

    this.host = {
      openInNewWindow: (instanceId: string) => {
        void this.#call('OpenInNewWindow', instanceId).catch(() => {});
      },
      saveAs: (svg: string, suggestedName: string) => this.#call<void>('SaveAs', suggestedName, svg),
      gotoFunctionCode: (functionName: string) => this.#call<void>('GotoFunctionCode', functionName),
      gotoBinding: (functionName: string, bindingIndex: number) =>
        this.#call<void>('GotoBinding', functionName, bindingIndex),
      saveFunctionGraphAsJson: () => this.#call<void>('SaveFunctionGraphAsJson', ''),
      persistState: (key: string, data: unknown) => {
        this.#vsCodeApi.postMessage({ method: 'PersistState', key, data });
      },
    };
  }

  get<T>(url: string, opts?: { conditional?: boolean }): Promise<T> {
    void opts; // conditional GET is HTTP-only; the bridge has no ETag cache
    return this.#call<T>('GET', url);
  }

  post<T>(url: string, body?: unknown): Promise<T> {
    return this.#call<T>('POST', url, body);
  }

  put<T>(url: string, body?: unknown): Promise<T> {
    return this.#call<T>('PUT', url, body);
  }

  download(url: string, fileName: string): Promise<void> {
    return this.#call<void>('Download', url, fileName);
  }

  /**
   * Registers the handlers for the extension's menu commands and tells the extension we are ready
   * to process them. Cannot happen in the constructor, because the client and the dialog states
   * depend on each other; `IAmReady` is posted only once, however often this is called.
   */
  setCustomHandlers(handlers: VsCodeCustomMessageHandlers): void {
    this.#handlers = handlers;

    if (this.#iAmReadySent) {
      return;
    }
    this.#iAmReadySent = true;
    this.#vsCodeApi.postMessage({ method: 'IAmReady' });
  }

  #call<T>(method: string, url: string, data?: unknown): Promise<T> {
    const requestId = Math.random().toString();

    // Registering before posting, so a response can never arrive before we can handle it
    const promise = new Promise<T>((resolve, reject) => {
      this.#requests.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
    });

    this.#vsCodeApi.postMessage({ id: requestId, method, url, data });

    return promise;
  }

  #onMessage(message: VsCodeMessage | null | undefined): void {
    if (!message || typeof message.id !== 'string') {
      return;
    }

    // handling menu commands
    const handler = this.#handlerFor(message.id);
    if (handler) {
      try {
        handler(message.data);
      } catch (err) {
        console.log('Failed to handle response from VsCode: ' + err);
      }
      return;
    }

    // handling HTTP responses
    const request = this.#requests.get(message.id);
    if (!request) {
      return;
    }
    this.#requests.delete(message.id);

    if (message.err) {
      request.reject(bridgeError(message.err));
    } else {
      request.resolve(message.data);
    }
  }

  #handlerFor(id: string): ((data: unknown) => void) | undefined {
    if (!this.#handlers) {
      return undefined;
    }
    return VS_CODE_CUSTOM_COMMANDS.includes(id as keyof VsCodeCustomMessageHandlers)
      ? this.#handlers[id as keyof VsCodeCustomMessageHandlers]
      : undefined;
  }
}
