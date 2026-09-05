// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The one toast the app shows at a time (DFM App.dc.html L303-L308). A success says what happened
// and goes away; a failure stays until it is dismissed, because the user has to be able to read
// what went wrong - and, where the caller can, retry it.

/** How long a success stays up. */
export const OK_TIMEOUT_MS = 5000;

export interface ToastMessage {
  /** Rises with every toast, so the host can key on it and restart its own animation. */
  id: number;
  kind: 'ok' | 'error';
  message: string;
  /** Errors only, and only when the caller knows how to try again. */
  retry?: () => void;
}

export class Toasts {
  current = $state<ToastMessage | null>(null);

  #nextId = 1;
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** A success: five seconds, then gone. */
  ok(message: string): ToastMessage {
    return this.#show({ kind: 'ok', message }, OK_TIMEOUT_MS);
  }

  /** A failure: it stays until the user dismisses it. */
  error(message: string, options: { retry?: () => void } = {}): ToastMessage {
    return this.#show({ kind: 'error', message, retry: options.retry }, 0);
  }

  /** `Could not terminate order-1. 404 Not Found` - the prefix says what, the error says why. */
  fromError(prefix: string, error: unknown, retry?: () => void): ToastMessage {
    const reason = error instanceof Error ? error.message : String(error ?? '');

    return this.error(reason ? `${prefix}. ${reason}` : prefix, { retry });
  }

  dismiss(): void {
    this.#clear();
    this.current = null;
  }

  /** The newest replaces whatever is up: two toasts at once is one toast the user does not read. */
  #show(toast: Omit<ToastMessage, 'id'>, timeout: number): ToastMessage {
    this.#clear();

    const next = { ...toast, id: this.#nextId++ };
    this.current = next;

    if (timeout > 0) {
      this.#timer = setTimeout(() => {
        // Only if it is still the toast this timer was started for
        if (this.current?.id === next.id) {
          this.current = null;
        }
      }, timeout);
    }

    return next;
  }

  #clear(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
