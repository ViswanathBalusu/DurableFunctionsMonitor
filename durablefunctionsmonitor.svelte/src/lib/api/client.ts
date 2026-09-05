// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The shared backend-client contract of contracts §5: the interface both clients implement
// and the typed errors every caller maps to a toast. Ported from
// durablefunctionsmonitor.react/src/services/IBackendClient.ts.

/** Host-specific side effects that are not HTTP calls (contracts §5). */
export interface BackendClientHost {
  /** Opens the instance details in a new browser tab / VS Code panel. */
  openInNewWindow(instanceId: string): void;
  /** Saves an SVG string as a file. */
  saveAs(svg: string, suggestedName: string): Promise<void>;
  /** VS Code only: jumps to the function's source code. */
  gotoFunctionCode(functionName: string): Promise<void>;
  /** VS Code only: jumps to a binding of the function. */
  gotoBinding(functionName: string, bindingIndex: number): Promise<void>;
  /** VS Code only: saves the function graph as JSON. */
  saveFunctionGraphAsJson(): Promise<void>;
  /** VS Code only: persists view state on the extension side. No-op in the browser. */
  persistState(key: string, data: unknown): void;
}

export interface BackendClient {
  readonly isVsCode: boolean;
  /** `conditional` sends `If-None-Match` and resolves the cached body on 304 (HTTP client only). */
  get<T>(url: string, opts?: { conditional?: boolean }): Promise<T>;
  post<T>(url: string, body?: unknown): Promise<T>;
  put<T>(url: string, body?: unknown): Promise<T>;
  /** POSTs and saves the response as a file (`.json` / `.txt` / `.dat` by content type). */
  download(url: string, fileName: string): Promise<void>;
  host: BackendClientHost;
}

/** Base class of every error both clients throw. `status` is 0 for network failures. */
export class BackendError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.body = body;
  }
}

export class BadRequestError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(400, message, body);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(401, message, body);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(403, message, body);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(404, message, body);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(409, message, body);
    this.name = 'ConflictError';
  }
}

export class PayloadTooLargeError extends BackendError {
  constructor(message: string, body?: unknown) {
    super(413, message, body);
    this.name = 'PayloadTooLargeError';
  }
}

/** 5xx. `body` keeps the parsed JSON of the recovery payloads of the input-event endpoints. */
export class ServerError extends BackendError {
  constructor(status: number, message: string, body?: unknown) {
    super(status, message, body);
    this.name = 'ServerError';
  }
}

/** The request never reached the backend (fetch threw, or the VS Code bridge is gone). */
export class NetworkError extends BackendError {
  constructor(message = 'Network Error', body?: unknown) {
    super(0, message, body);
    this.name = 'NetworkError';
  }
}

/** Builds the error class of contracts §5 for a status code. */
export function createBackendError(status: number, message: string, body?: unknown): BackendError {
  switch (status) {
    case 400:
      return new BadRequestError(message, body);
    case 401:
      return new UnauthorizedError(message, body);
    case 403:
      return new ForbiddenError(message, body);
    case 404:
      return new NotFoundError(message, body);
    case 409:
      return new ConflictError(message, body);
    case 413:
      return new PayloadTooLargeError(message, body);
    default:
      return status >= 500 ? new ServerError(status, message, body) : new BackendError(status, message, body);
  }
}

/** True for `application/json`, `application/problem+json`, `text/json`, … */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType === 'text/json' || mediaType.endsWith('+json');
}

/**
 * Turns a failed response into a typed error. JSON bodies are parsed and kept on `body`;
 * the message is the body text, or the body's own `error`/`message` field when it has one
 * (the recovery payloads of the input-event endpoints report the reason in `error`).
 */
export function mapError(status: number, bodyText: string, contentType?: string | null): BackendError {
  const text = (bodyText ?? '').trim();
  let body: unknown;
  let message = text;

  if (isJsonContentType(contentType) && text) {
    try {
      body = JSON.parse(text);
      const parsed = body as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.error === 'string' && parsed.error) {
          message = parsed.error;
        } else if (typeof parsed.message === 'string' && parsed.message) {
          message = parsed.message;
        }
      }
    } catch {
      body = undefined;
    }
  }

  return createBackendError(status, message || `Request failed with status code ${status}`, body);
}
