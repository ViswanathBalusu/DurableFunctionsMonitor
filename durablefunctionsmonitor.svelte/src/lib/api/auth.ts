// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The AAD half of signing in, a port of React's LoginState MSAL code onto @azure/msal-browser 5.
// Everything here is about one thing: turning "the backend told us its clientId" into an
// Authorization header, or into a redirect when a header cannot be had silently.

import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

export interface AadConfig {
  clientId: string;
  authority?: string;
  /** Everything before the task hub segment, so AAD comes back to the app and not into a hub. */
  redirectUri: string;
}

export class AadAuth {
  /** The signed-in account, or null when AAD has never seen this browser. */
  account: AccountInfo | null = null;

  readonly #app: PublicClientApplication;
  readonly #clientId: string;

  private constructor(app: PublicClientApplication, clientId: string) {
    this.#app = app;
    this.#clientId = clientId;
  }

  /**
   * Builds the MSAL app, initializes it (v5 requires that before anything else) and finishes a
   * redirect if this load is one. A failure to handle the redirect is logged and not thrown: it
   * leaves us with no account, which is the same situation as never having signed in.
   */
  static async initialize(config: AadConfig): Promise<AadAuth> {
    const app = new PublicClientApplication({
      auth: { clientId: config.clientId, authority: config.authority, redirectUri: config.redirectUri },
    });

    await app.initialize();

    const auth = new AadAuth(app, config.clientId);

    try {
      const result = await app.handleRedirectPromise();
      auth.account = result?.account ?? app.getAllAccounts()[0] ?? null;
    } catch (error) {
      console.log(`DFM: failed to handle the login redirect (${error})`);
      auth.account = app.getAllAccounts()[0] ?? null;
    }

    if (auth.account) {
      app.setActiveAccount(auth.account);
    }

    return auth;
  }

  /** Sends the user to AAD. The redirect flow, not a popup: popups are blocked too often. */
  async signIn(): Promise<void> {
    await this.#app.loginRedirect({ scopes: [this.#clientId] });
  }

  async signOut(): Promise<void> {
    await this.#app.logoutRedirect();
  }

  /**
   * A bearer token for our own AAD app. When the silent path fails - a rare event, refresh tokens
   * being long-lived - the user goes back to AAD, which reloads the page anyway, so there is no
   * header to return and no error worth showing.
   */
  async authorizationHeaders(): Promise<Record<string, string>> {
    const request = { scopes: [this.#clientId], account: this.account ?? undefined };

    try {
      const result = await this.#app.acquireTokenSilent(request);

      // msal can return a null access token; the id token is the same token in that case
      const token = result.accessToken || result.idToken;

      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (error) {
      console.log(`DFM: acquireTokenSilent() failed (${error}), so calling acquireTokenRedirect()`);

      void this.#app.acquireTokenRedirect(request);

      return {};
    }
  }
}
