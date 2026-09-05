// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { About, EasyAuthConfig } from '$lib/api/types';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import { host as browserHost } from '$lib/host.svelte';
import type { Host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { Login, MAX_HUBS_PROBED, type LoginOptions } from './login.svelte';

/**
 * The MSAL module, mocked: these tests are about what the login state does with an account, not
 * about @azure/msal-browser itself. `msal` below is what the fake app was asked to do.
 */
const msal = {
  created: [] as unknown[],
  accounts: [] as { username: string }[],
  redirectResult: null as { account: { username: string } } | null,
  handleRedirectRejects: false,
  silentToken: 'access-token' as string | null,
  silentRejects: false,
  calls: [] as string[],
};

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    constructor(config: unknown) {
      msal.created.push(config);
    }
    async initialize() {
      msal.calls.push('initialize');
    }
    async handleRedirectPromise() {
      msal.calls.push('handleRedirectPromise');

      if (msal.handleRedirectRejects) {
        throw new Error('state mismatch');
      }

      return msal.redirectResult;
    }
    getAllAccounts() {
      return msal.accounts;
    }
    setActiveAccount() {
      msal.calls.push('setActiveAccount');
    }
    async loginRedirect() {
      msal.calls.push('loginRedirect');
    }
    async logoutRedirect() {
      msal.calls.push('logoutRedirect');
    }
    async acquireTokenSilent() {
      msal.calls.push('acquireTokenSilent');

      if (msal.silentRejects) {
        throw new Error('interaction required');
      }

      return { accessToken: msal.silentToken, idToken: 'id-token' };
    }
    async acquireTokenRedirect() {
      msal.calls.push('acquireTokenRedirect');
    }
  },
}));

function endpointsWith(overrides: Partial<Endpoints> = {}): Endpoints {
  return {
    easyAuthConfig: async (): Promise<EasyAuthConfig> => ({}),
    taskHubNames: async () => ['DurableFunctionsHub'],
    ...overrides,
  } as Endpoints;
}

function about(overrides: Partial<About> = {}): About {
  return normalizeAbout({
    accountName: 'mystorageaccount',
    version: '6.9.0 (isolated)',
    permissions: ['DurableFunctionsMonitor.ReadWrite'],
    ...overrides,
  });
}

function loginWith(options: Partial<LoginOptions> & { path?: string } = {}) {
  const { path = '/', host = browserHost, ...rest } = options;

  window.history.replaceState({}, '', path);

  return new Login({
    endpoints: endpointsWith(),
    host,
    router: new Router({ mode: 'history', routePrefix: host.routePrefix }),
    ...rest,
  });
}

beforeEach(() => {
  msal.created = [];
  msal.accounts = [];
  msal.redirectResult = null;
  msal.handleRedirectRejects = false;
  msal.silentToken = 'access-token';
  msal.silentRejects = false;
  msal.calls = [];
});

describe('Login without a clientId', () => {
  it('is anonymous when the backend names nobody', async () => {
    const login = loginWith({ path: '/DurableFunctionsHub' });

    await login.login();

    expect(login.isAnonymous).toBe(true);
    expect(login.userName).toBe('');
    expect(login.isLoggedIn).toBe(true);
    expect(msal.created).toHaveLength(0);
  });

  it('takes the user name a server-directed login reports', async () => {
    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => ({ userName: 'chandra@contoso.com' }) }),
    });

    await login.login();

    expect(login.userName).toBe('chandra@contoso.com');
    expect(login.isAnonymous).toBe(false);
  });

  it('turns on the cookie-expiry reload of the client, but only once signed in', async () => {
    const client = { reloadOnNetworkError: false };
    const login = loginWith({ path: '/DurableFunctionsHub', client });

    expect(client.reloadOnNetworkError).toBe(false);

    await login.login();

    expect(client.reloadOnNetworkError).toBe(true);
  });

  it('says so when the config cannot be loaded', async () => {
    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({
        easyAuthConfig: async () => {
          throw new Error('503 Service Unavailable');
        },
      }),
    });

    expect(await login.login()).toBe(false);
    expect(login.error).toBe('Failed to load auth config. 503 Service Unavailable');
    expect(login.isLoggedIn).toBe(false);
  });

  it('signs out through Easy Auth', async () => {
    const replaceLocation = vi.fn();
    const login = loginWith({ path: '/DurableFunctionsHub', replaceLocation });

    await login.login();
    await login.signOut();

    expect(replaceLocation).toHaveBeenCalledWith('/.auth/login/aad?post_login_redirect_url=%2F');
  });

  it('has no authorization header to add', async () => {
    const login = loginWith({ path: '/DurableFunctionsHub' });

    await login.login();

    expect(await login.getAuthHeaders()).toEqual({});
  });
});

describe('Login with MSAL', () => {
  const config = { clientId: 'client-id', authority: 'https://login.microsoftonline.com/tenant' };

  it('sends a browser with no account to AAD, and asks nothing else', async () => {
    const taskHubNames = vi.fn();
    const login = loginWith({
      path: '/',
      endpoints: endpointsWith({ easyAuthConfig: async () => config, taskHubNames }),
    });

    expect(await login.login()).toBe(false);

    expect(msal.calls).toContain('loginRedirect');
    expect(login.needsSignIn).toBe(true);
    expect(taskHubNames).not.toHaveBeenCalled();
  });

  it('configures msal with the root uri, so AAD comes back outside any hub', async () => {
    const login = loginWith({ path: '/DurableFunctionsHub/instances/order-1' });

    await new Login({
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
      host: browserHost,
      router: new Router({ mode: 'history', routePrefix: '' }),
    }).login();

    expect(msal.created[0]).toEqual({
      auth: { clientId: 'client-id', authority: config.authority, redirectUri: window.location.origin },
    });

    expect(login.rootUri).toBe(window.location.origin);
  });

  it('takes the account name of the redirect it just handled', async () => {
    msal.redirectResult = { account: { username: 'chandra@contoso.com' } };

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    expect(await login.login()).toBe(true);

    expect(login.userName).toBe('chandra@contoso.com');
    expect(login.isAnonymous).toBe(false);
    expect(msal.calls).toContain('setActiveAccount');
  });

  it('falls back to the account msal already had', async () => {
    msal.accounts = [{ username: 'someone@contoso.com' }];

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    await login.login();

    expect(login.userName).toBe('someone@contoso.com');
  });

  it('survives a redirect it cannot handle', async () => {
    msal.handleRedirectRejects = true;
    msal.accounts = [{ username: 'someone@contoso.com' }];

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    await login.login();

    expect(login.userName).toBe('someone@contoso.com');
    expect(login.error).toBeNull();
  });

  it('carries a bearer token on every call', async () => {
    msal.accounts = [{ username: 'someone@contoso.com' }];

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    await login.login();

    expect(await login.getAuthHeaders()).toEqual({ Authorization: 'Bearer access-token' });
  });

  it('uses the id token when msal returns no access token', async () => {
    msal.accounts = [{ username: 'someone@contoso.com' }];
    msal.silentToken = null;

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    await login.login();

    expect(await login.getAuthHeaders()).toEqual({ Authorization: 'Bearer id-token' });
  });

  it('goes back to AAD when a token cannot be had silently', async () => {
    msal.accounts = [{ username: 'someone@contoso.com' }];
    msal.silentRejects = true;

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
    });

    await login.login();

    expect(await login.getAuthHeaders()).toEqual({});
    expect(msal.calls).toContain('acquireTokenRedirect');
  });

  it('signs out through msal, not through Easy Auth', async () => {
    msal.accounts = [{ username: 'someone@contoso.com' }];
    const replaceLocation = vi.fn();

    const login = loginWith({
      path: '/DurableFunctionsHub',
      endpoints: endpointsWith({ easyAuthConfig: async () => config }),
      replaceLocation,
    });

    await login.login();
    await login.signOut();

    expect(msal.calls).toContain('logoutRedirect');
    expect(replaceLocation).not.toHaveBeenCalled();
  });
});

describe('Login and the task hubs', () => {
  it('goes straight to the only hub there is, and shows no picker', async () => {
    const login = loginWith({ path: '/', endpoints: endpointsWith({ taskHubNames: async () => ['OnlyHub'] }) });

    await login.login();

    expect(window.location.pathname).toBe('/OnlyHub');
    expect(login.hubs).toEqual([]);
    expect(login.isLoggedIn).toBe(true);
  });

  it('asks which hub when there is a choice, and badges each one', async () => {
    const login = loginWith({
      path: '/',
      endpoints: endpointsWith({ taskHubNames: async () => ['First', 'Second'] }),
      aboutFor: async (hub: string) =>
        hub === 'First' ? about() : about({ readOnly: true, permissions: [], version: '6.9.0 (isolated)' }),
    });

    await login.login();

    expect(login.hubs).toEqual([
      { name: 'First', badge: 'ReadWrite', version: '6.9.0 (isolated)' },
      { name: 'Second', badge: 'Read only', version: '6.9.0 (isolated)' },
    ]);

    expect(login.version).toBe('6.9.0 (isolated)');
    expect(login.accountName).toBe('mystorageaccount');
    expect(window.location.pathname).toBe('/');
  });

  it('shows no badge for a hub whose /about failed', async () => {
    const login = loginWith({
      path: '/',
      endpoints: endpointsWith({ taskHubNames: async () => ['First', 'Second'] }),
      aboutFor: async (hub: string) => {
        if (hub === 'Second') {
          throw new Error('401 Unauthorized');
        }
        return about();
      },
    });

    await login.login();

    expect(login.hubs[1]).toEqual({ name: 'Second', badge: null, version: null });
    expect(login.error).toBeNull();
  });

  it('probes at most twenty hubs', async () => {
    const names = Array.from({ length: 25 }, (_, index) => `Hub${index}`);
    const aboutFor = vi.fn(async () => about());

    const login = loginWith({ path: '/', endpoints: endpointsWith({ taskHubNames: async () => names }), aboutFor });

    await login.login();

    expect(login.hubs).toHaveLength(MAX_HUBS_PROBED);
    expect(aboutFor).toHaveBeenCalledTimes(MAX_HUBS_PROBED);
  });

  it('says so when the hub list cannot be loaded', async () => {
    const login = loginWith({
      path: '/',
      endpoints: endpointsWith({
        taskHubNames: async () => {
          throw new Error('403 Forbidden');
        },
      }),
    });

    await login.login();

    expect(login.error).toBe('Failed to load the list of Task Hubs. 403 Forbidden');
    expect(login.hubs).toEqual([]);
  });

  it('does not ask for the list when the URL already names a hub', async () => {
    const taskHubNames = vi.fn(async () => ['First', 'Second']);
    const login = loginWith({ path: '/DurableFunctionsHub/instances', endpoints: endpointsWith({ taskHubNames }) });

    await login.login();

    expect(taskHubNames).not.toHaveBeenCalled();
    expect(login.isLoggedIn).toBe(true);
  });

  it('links each row to that hub Overview', async () => {
    const login = loginWith({ path: '/' });

    expect(login.hubHref('Second')).toBe('/Second');
  });
});

describe('Login and the URL it was opened on', () => {
  it('cuts the path at the task hub, wherever the app is hosted', () => {
    const login = loginWith({ path: '/DurableFunctionsHub/instances/order-1' });

    expect(login.hubFromLocation).toBe('DurableFunctionsHub');
    expect(login.locationPathName).toBe('/');
    expect(login.rootUri).toBe(window.location.origin);
  });

  it('keeps a route prefix in front of the hub', () => {
    const host = { ...browserHost, routePrefix: 'monitor' } as Host;
    const login = loginWith({ path: '/monitor/DurableFunctionsHub/instances', host });

    expect(login.hubFromLocation).toBe('DurableFunctionsHub');
    expect(login.locationPathName).toBe('/monitor/');
    expect(login.rootUri).toBe(`${window.location.origin}/monitor`);
  });

  it('has no hub to cut at on the login route', () => {
    const login = loginWith({ path: '/' });

    expect(login.hubFromLocation).toBe('');
    expect(login.locationPathName).toBe('/');
    expect(login.rootUri).toBe(window.location.origin);
  });
});
