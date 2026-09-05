// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Inputs tab (docs/plans/input-events-restart-rewind-replay.md §4, design §9): the inputs this
// instance received, what may be done with each of them, and why not when it may not.
//
// Eligibility is the backend's answer, never this app's guess: a button is disabled with the reason
// the backend gave, verbatim, and no button is ever hidden because of eligibility. The one thing
// decided here is the size limit, because the editor is where the text grows past it.

import type {
  InputEvent,
  InputEventOperation,
  InputEventsResponse,
  ReplayRequest,
  ReplayResult,
  RestartInPlaceRequest,
  RestartInPlaceResult,
  UpdateInputAndRewindRequest,
  UpdateInputAndRewindResult,
} from '$lib/api/types';
import { MAX_INLINE_BYTES, utf16Bytes } from '$lib/format/bytes';
import { formatJson } from '$lib/format/json';
import type { AppState } from './app.svelte';
import { parseInput } from './start-instance.svelte';

/** The order the operations are offered in, whichever of them an event carries (design §9). */
export const OPERATION_ORDER: readonly InputEventOperation[] = [
  'restart-in-place',
  'update-input-and-rewind',
  'replay',
];

/** The two that are Dangerous rather than Write; they wear the striped button (contracts §11). */
export const DANGEROUS_OPERATIONS: readonly InputEventOperation[] = ['restart-in-place', 'replay'];

/** What each operation does, in the words the mockup puts under its button (L184-L185). */
export const OPERATION_DESCRIPTIONS: Readonly<Record<InputEventOperation, string>> = {
  'restart-in-place': 'Purges this instance and starts it again with the input shown.',
  'update-input-and-rewind': 'Replaces this input and re-runs only the failed steps.',
  replay: 'Deletes history after this event and runs everything after it again.',
};

/** Said in place of the description when the editor holds more than the backend stores inline. */
export const OVER_SIZE_REASON = 'Input is larger than 60 KB';

export const READ_ONLY_REASON = 'Read-only mode';

export interface OperationButton {
  op: InputEventOperation;
  label: string;
  variant: 'danger' | 'default';
  disabled: boolean;
  /** Why it is disabled, or what it does - one line under the button, either way. */
  why: string;
  /** The replay of a running instance has to terminate it first (E5-S4-T3). */
  requiresTerminate: boolean;
}

/** One input event and the editor over it. */
export class InputCard {
  /** What the editor holds. */
  text = $state('');

  readonly event: InputEvent;

  /** What the backend sent, pretty-printed - which is what "reset" goes back to. */
  readonly stored: string;

  /**
   * Asked every time rather than captured: `/about` may not have answered when this tab loaded, and
   * until it has, `app.readOnly` is true - a card built from that would stay dead for ever.
   */
  readonly #readOnly: () => boolean;

  constructor(event: InputEvent, options: { readOnly: () => boolean }) {
    this.event = event;
    this.stored = formatJson(event.input);
    this.text = this.stored;
    this.#readOnly = options.readOnly;
  }

  get sequenceNumber(): number | null {
    return this.event.sequenceNumber;
  }

  get edited(): boolean {
    return this.text !== this.stored;
  }

  get bytes(): number {
    return utf16Bytes(this.text);
  }

  /** Past what the backend stores inline: nothing may be sent until it is shorter. */
  get over(): boolean {
    return this.bytes > MAX_INLINE_BYTES;
  }

  /** Whether the editor takes typing at all: something has to be possible with this event. */
  get editable(): boolean {
    return !this.#readOnly() && OPERATION_ORDER.some((op) => this.event.operations?.[op]?.allowed);
  }

  reset(): void {
    this.text = this.stored;
  }

  /** The buttons this card offers, in the fixed order, one per operation the event carries. */
  get buttons(): OperationButton[] {
    return OPERATION_ORDER.filter((op) => this.event.operations?.[op]).map((op) => this.#button(op));
  }

  #button(op: InputEventOperation): OperationButton {
    const eligibility = this.event.operations[op];
    const allowed = !!eligibility?.allowed;
    const readOnly = this.#readOnly();

    return {
      op,
      label: op === 'replay' ? `Replay from #${this.sequenceNumber ?? '?'}` : LABELS[op],
      variant: DANGEROUS_OPERATIONS.includes(op) ? 'danger' : 'default',
      disabled: readOnly || this.over || !allowed,
      why: readOnly
        ? READ_ONLY_REASON
        : !allowed
          ? // The backend's own words: it knows why, and paraphrasing it would be guessing
            (eligibility?.reason ?? OPERATION_DESCRIPTIONS[op])
          : this.over
            ? OVER_SIZE_REASON
            : OPERATION_DESCRIPTIONS[op],
      requiresTerminate: !!eligibility?.requiresTerminate,
    };
  }
}

const LABELS: Readonly<Record<InputEventOperation, string>> = {
  'restart-in-place': 'Restart in place',
  'update-input-and-rewind': 'Update input and rewind',
  replay: 'Replay',
};

export type InputOpResult = RestartInPlaceResult | UpdateInputAndRewindResult | ReplayResult;

/** What one run came back as; E5-S4-T4 turns it into a toast or a recovery dialog. */
export type InputOpOutcome =
  | { ok: true; op: InputEventOperation; card: InputCard; result: InputOpResult }
  | { ok: false; op: InputEventOperation; card: InputCard; error: unknown };

export interface RunOptions {
  reason?: string;
  terminateIfRunning?: boolean;
}

export interface InputsOptions {
  app: AppState;
  instanceId: string;
}

export class Inputs {
  cards = $state<InputCard[]>([]);

  /** The whole answer, for the header chips and the notes above the cards. */
  response = $state<InputEventsResponse | null>(null);

  loading = $state(false);
  error = $state<string | null>(null);

  /** True once anything has been loaded, so `refreshAll` knows whether this tab is in play. */
  loaded = $state(false);

  /** While one operation is running: every button on the tab is dead. */
  busy = $state(false);

  readonly instanceId: string;

  readonly #app: AppState;

  #requestId = 0;

  constructor(options: InputsOptions) {
    this.#app = options.app;
    this.instanceId = options.instanceId;
  }

  /** The first warning any operation carries; the tab renders it once, above the cards. */
  get warning(): string | null {
    for (const card of this.cards) {
      for (const op of OPERATION_ORDER) {
        const warning = card.event.operations?.[op]?.warning;

        if (warning) {
          return warning;
        }
      }
    }

    return null;
  }

  /**
   * A provider that does not number its history rows cannot be given a concurrency token, so none
   * of the three operations can be offered at all - the backend says so per operation, and this is
   * what lets the tab say it once instead of three times per card.
   */
  get noSequenceNumbers(): boolean {
    return this.cards.length > 0 && this.cards.every((card) => card.sequenceNumber === null);
  }

  get isEmpty(): boolean {
    return this.loaded && this.cards.length === 0;
  }

  /** `GET input-events`. Every run reloads it: the sequence numbers are the concurrency token. */
  async load(): Promise<void> {
    const requestId = ++this.#requestId;

    this.loading = true;
    this.error = null;

    try {
      const response = await this.#app.track(() => this.#app.endpoints.inputEvents(this.instanceId));

      if (requestId !== this.#requestId) {
        return;
      }

      this.response = response;
      this.cards = (response.events ?? []).map((event) => new InputCard(event, { readOnly: () => this.#app.readOnly }));
      this.loaded = true;
    } catch (error) {
      if (requestId !== this.#requestId) {
        return;
      }

      this.error = error instanceof Error ? error.message : String(error);
      this.#app.toast.fromError('Failed to load the inputs', error, () => void this.load());
    } finally {
      if (requestId === this.#requestId) {
        this.loading = false;
      }
    }
  }

  /** Reloads only if the tab has been opened; `refreshAll` calls this for every workspace reload. */
  async reloadIfLoaded(): Promise<void> {
    if (this.loaded) {
      await this.load();
    }
  }

  reset(card: InputCard): void {
    card.reset();
  }

  /**
   * Runs one operation against one card and says what came back. The list is reloaded either way -
   * a run that worked changed the history, and a run that was refused did so because the history is
   * not what this tab was showing.
   */
  async run(op: InputEventOperation, card: InputCard, options: RunOptions = {}): Promise<InputOpOutcome> {
    this.busy = true;

    try {
      const result = await this.#app.track(() => this.#call(op, card, options));

      return { ok: true, op, card, result };
    } catch (error) {
      return { ok: false, op, card, error };
    } finally {
      this.busy = false;
    }
  }

  #call(op: InputEventOperation, card: InputCard, options: RunOptions): Promise<InputOpResult> {
    const endpoints = this.#app.endpoints;

    // The sequence number goes back exactly as it arrived: it is the concurrency token, and a
    // number this app computed rather than received would defeat the point of having one
    const sequenceNumber = card.sequenceNumber ?? 0;

    switch (op) {
      case 'restart-in-place': {
        // Only an edited input is sent; without one the backend restarts with what it already has
        const request: RestartInPlaceRequest = card.edited ? { input: parseInput(card.text) } : {};

        return endpoints.restartInPlace(this.instanceId, request);
      }

      case 'update-input-and-rewind': {
        // This one replaces the input, so it always carries one - the edit, or what is stored
        const request: UpdateInputAndRewindRequest = {
          sequenceNumber,
          input: card.edited ? parseInput(card.text) : card.event.input,
        };

        if (options.reason) {
          request.reason = options.reason;
        }

        return endpoints.updateInputAndRewind(this.instanceId, request);
      }

      case 'replay': {
        const request: ReplayRequest = { sequenceNumber };

        if (card.edited) {
          request.input = parseInput(card.text);
        }

        if (options.terminateIfRunning) {
          request.terminateIfRunning = true;
        }

        return endpoints.replay(this.instanceId, request);
      }
    }
  }
}
