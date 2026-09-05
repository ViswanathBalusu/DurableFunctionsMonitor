// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Signing in, in the browser (contracts §7). A port of React's LoginState: ask the backend how it
// is protected, then either proceed as whoever the cookie says we are, or take the user through
// AAD; either way end up with a task hub - the one in the URL, the only one there is, or one the
// user picks from the list.

import { AadAuth } from '$lib/api/auth';
import { createEndpoints, type Endpoints } from '$lib/api/endpoints';
import { HttpBackendClient } from '$lib/api/http-client';
import type { About } from '$lib/api/types';
import type { Host } from '$lib/host.svelte';
import { parsePath, type Router } from '$lib/router.svelte';

/** One row of the hub picker. */
export interface HubOption {
  name: string;
  /** From that hub's `/about`; null when the call failed, which is not the same as "read only". */
  badge: 'ReadWrite' | 'Read only' | null;
  version: string | null;
}

/** How many hubs are probed for their badge. A storage account can hold far more than a list. */
export const MAX_HUBS_PROBED = 20;

export interface LoginOptions {
  endpoints: Endpoints;
  host: Host;
  router: Router;
  /** `/about` for one hub; by default a client bound to that hub, signed the same way. */
  aboutFor?: (hub: string) => Promise<About>;
  /** `window.location.replace`, which a test does not want to do. */
  replaceLocation?: (url: string) => void;
  /**
   * The HTTP client, so a cookie-based login can turn on its reload-on-network-error workaround.
   * React installed that axios interceptor at exactly this point and only here: before the user is
   * signed in, a failed call must not reload the page.
   */
  client?: { reloadOnNetworkError: boolean };
}

export class Login {
  /** Who the backend thinks we are; empty when nobody is signed in (anonymous or local). */
  userName = $state('');

  /** True once we know which hub to show, or the picker has the list it needs. */
  isLoggedIn = $state(false);

  /** Set when AAD is configured and this browser has no account: the screen offers Sign in. */
  needsSignIn = $state(false);

  /** The hubs to choose from; empty when the URL already names one, or only one exists. */
  hubs = $state<HubOption[]>([]);

  /** From the first `/about` that answered, for the version line under the title. */
  version = $state<string | null>(null);

  /** The account the badges were read for, so the screen can say who is signed in. */
  accountName = $state<string | null>(null);

  loading = $state(false);
  error = $state<string | null>(null);

  #aad: AadAuth | null = null;

  readonly #options: LoginOptions;

  constructor(options: LoginOptions) {
    this.#options = options;
  }

  /** No user name means nobody signed in: a local host, or a backend with no authentication. */
  get isAnonymous(): boolean {
    return !this.userName;
  }

  /** The task hub the URL names, or '' when it names none. */
  get hubFromLocation(): string {
    const parsed = parsePath(globalThis.location?.pathname ?? '', this.#options.host.routePrefix);

    return 'hub' in parsed ? parsed.hub : '';
  }

  /**
   * `window.location.pathname` minus DFM's own routing: everything up to the task hub segment,
   * with a trailing slash. React cut the path at its `/durable-instances/` anchor; the router's
   * parser knows where the hub is, which is the same cut without the guesswork.
   */
  get locationPathName(): string {
    const path = globalThis.location?.pathname ?? '/';
    const hub = this.hubFromLocation;

    if (!hub) {
      return path.endsWith('/') ? path : `${path}/`;
    }

    const segments = path.split('/');
    const index = segments.findIndex((segment) => segment.toLowerCase() === hub.toLowerCase());
    const base = segments.slice(0, index).join('/');

    return base.endsWith('/') ? base : `${base}/`;
  }

  /** The site's root: everything before the task hub name. AAD redirects come back here. */
  get rootUri(): string {
    const origin = globalThis.location?.origin ?? '';
    const path = this.locationPathName;

    return path === '/' ? origin : `${origin}${path.slice(0, -1)}`;
  }

  /**
   * The whole login flow. Never throws: a failure leaves `error` set and the screen says so.
   * Returns false when the browser is on its way to AAD, which means: stop, do not call anything.
   */
  async login(): Promise<boolean> {
    this.loading = true;
    this.error = null;

    try {
      const config = await this.#options.endpoints.easyAuthConfig();

      if (!config.clientId) {
        // Localhost, or a server-directed flow: whoever the cookie says we are
        this.userName = config.userName ?? '';

        if (this.#options.client) {
          this.#options.client.reloadOnNetworkError = true;
        }

        return await this.#afterSignIn();
      }

      this.#aad = await AadAuth.initialize({
        clientId: config.clientId,
        authority: config.authority,
        redirectUri: this.rootUri,
      });

      if (!this.#aad.account) {
        // Off to AAD. Nothing else may run: msal has to be able to redirect the page
        this.needsSignIn = true;
        await this.#aad.signIn();

        return false;
      }

      this.userName = this.#aad.account.username;

      return await this.#afterSignIn();
    } catch (error) {
      this.error = message(error, 'Failed to load auth config');
      return false;
    } finally {
      this.loading = false;
    }
  }

  /**
   * The Sign in button. `login()` already redirects a browser with no account; this is the way back
   * for the case where that redirect came back without one - and the button the mockup draws.
   */
  async signIn(): Promise<void> {
    await this.#aad?.signIn();
  }

  /** The headers every call carries: the anti-forgery one is the client's, the bearer is ours. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    return this.#aad ? await this.#aad.authorizationHeaders() : {};
  }

  /**
   * The hubs this identity may see. Exactly one is not a choice, so the app goes straight there
   * (React parity); more than one fills the picker, each row with the badge its `/about` reports.
   */
  async loadHubs(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const names = await this.#options.endpoints.taskHubNames();

      if (names.length === 1) {
        this.#options.router.navigate({ name: 'overview', hub: names[0] });
        this.isLoggedIn = true;
        return;
      }

      this.hubs = names.slice(0, MAX_HUBS_PROBED).map((name) => ({ name, badge: null, version: null }));
      this.isLoggedIn = true;

      await this.#loadBadges();
    } catch (error) {
      this.error = message(error, 'Failed to load the list of Task Hubs');
    } finally {
      this.loading = false;
    }
  }

  /** Sends the user back to where they came in: AAD when it is configured, Easy Auth otherwise. */
  async signOut(): Promise<void> {
    if (this.#aad) {
      await this.#aad.signOut();
      return;
    }

    const replace = this.#options.replaceLocation ?? ((url: string) => globalThis.location?.replace(url));

    replace('/.auth/login/aad?post_login_redirect_url=%2F');
  }

  /** The URL of one hub's Overview, for the picker's rows. */
  hubHref(hub: string): string {
    return this.#options.router.href({ name: 'overview', hub });
  }

  /** With a hub in the URL there is nothing to choose; without one, ask which. */
  async #afterSignIn(): Promise<boolean> {
    const hub = this.hubFromLocation;

    if (hub) {
      this.isLoggedIn = true;
      return true;
    }

    await this.loadHubs();

    return true;
  }

  /** In parallel, and never fatally: a hub whose /about fails simply shows no badge. */
  async #loadBadges(): Promise<void> {
    const aboutFor = this.#options.aboutFor ?? ((hub: string) => this.#aboutThrough(hub));

    const badges = await Promise.all(
      this.hubs.map(async (option) => {
        try {
          const about = await aboutFor(option.name);

          return {
            name: option.name,
            badge: (about.readOnly ? 'Read only' : 'ReadWrite') as HubOption['badge'],
            version: about.version || null,
            accountName: about.accountName || null,
          };
        } catch {
          return { name: option.name, badge: null, version: null, accountName: null };
        }
      }),
    );

    this.hubs = badges.map(({ name, badge, version }) => ({ name, badge, version }));
    this.version = badges.find((badge) => !!badge.version)?.version ?? null;
    this.accountName = badges.find((badge) => !!badge.accountName)?.accountName ?? null;
  }

  /** A client bound to one other hub, signed the same way as everything else. */
  #aboutThrough(hub: string): Promise<About> {
    const client = new HttpBackendClient(
      () => hub,
      () => this.getAuthHeaders(),
    );

    return createEndpoints(client).about();
  }
}

function message(error: unknown, prefix: string): string {
  const reason = error instanceof Error ? error.message : String(error ?? '');

  return reason ? `${prefix}. ${reason}` : prefix;
}
