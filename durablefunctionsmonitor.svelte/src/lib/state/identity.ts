// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Who is signed in, as far as anyone can tell, and how that is put on screen.
//
// Three places know something about a person, and none of them is the whole truth:
//  - this browser's MSAL session (the ID token it was given, when the backend names an AAD app),
//  - the claims the backend validated for an Easy Auth login (`easyauth-config`'s `identity`),
//  - a row of the audit log (what the backend recorded about whoever made that call).
// All three become an `AccountIdentity`, so the account menu and the audit rows share one dialog.
//
// The browser's own account is for display. What the audit log records is read by the backend from the
// token it validated, never from anything the browser says about itself.

import type { AccountInfo } from '@azure/msal-browser';
import type { TokenInfo } from '$lib/api/auth';
import type { AuditRow, ServerIdentity } from '$lib/api/types';

export type IdentitySource = 'msal' | 'server' | 'audit';

export interface AccountIdentity {
  /** Where the details come from; the dialog says so, because the three are not equally authoritative. */
  source: IdentitySource;
  /** The sign-in name (the `preferred_username` claim): what an allow-list is written against. */
  userName: string;
  name?: string;
  email?: string;
  objectId?: string;
  tenantId?: string;
  roles: string[];
  /** How the backend authenticated the call: `easyauth`, `bearer`, `vscode` or `anonymous`. */
  authMethod?: string;

  /** MSAL's id for this account in this tenant: `<object id>.<tenant id>`. */
  homeAccountId?: string;
  /** The identity provider host, e.g. `login.microsoftonline.com`. */
  environment?: string;
  authority?: string;
  issuer?: string;
  /** The app the ID token was issued for: our own AAD app. */
  audience?: string;
  /** What the access token is good for. */
  scopes?: string[];
  idTokenExpiresAt?: string;
  accessTokenExpiresAt?: string;
  /** The claims of the ID token as MSAL parsed them. Never the token itself. */
  claims?: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function texts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && !!item);
  }

  return typeof value === 'string' && value ? [value] : [];
}

/** `exp` and friends are seconds since the epoch. */
function secondsToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

/**
 * What an MSAL account says about its owner. The ID token claims carry most of it; the account
 * object carries the rest. A field MSAL does not have stays undefined: the dialog shows only what is known.
 */
export function identityFromMsal(
  account: Partial<AccountInfo> & { username: string },
  authority?: string,
): AccountIdentity {
  const claims = (account.idTokenClaims ?? {}) as Record<string, unknown>;
  const hasClaims = Object.keys(claims).length > 0;

  return {
    source: 'msal',
    userName: account.username,
    name: text(account.name) ?? text(claims.name),
    email: text(claims.email),
    objectId: text(claims.oid) ?? text(account.localAccountId),
    tenantId: text(account.tenantId) ?? text(claims.tid),
    roles: texts(claims.roles),
    homeAccountId: text(account.homeAccountId),
    environment: text(account.environment),
    authority,
    issuer: text(claims.iss),
    audience: text(claims.aud),
    idTokenExpiresAt: secondsToIso(claims.exp),
    claims: hasClaims ? claims : undefined,
  };
}

/** The same identity, now that a token was acquired for it. */
export function withToken(identity: AccountIdentity, token: TokenInfo): AccountIdentity {
  return {
    ...identity,
    scopes: token.scopes.length ? token.scopes : identity.scopes,
    accessTokenExpiresAt: token.expiresOn ? token.expiresOn.toISOString() : identity.accessTokenExpiresAt,
  };
}

/**
 * The identity an Easy Auth login reports. An older backend sends only the user name, which is
 * still worth showing; no user name at all means nobody is signed in, and there is no identity.
 */
export function identityFromServer(
  identity: ServerIdentity | undefined,
  userName: string | undefined,
): AccountIdentity | null {
  const name = text(identity?.userName) ?? text(userName);

  if (!name) {
    return null;
  }

  return {
    source: 'server',
    userName: name,
    name: text(identity?.name),
    email: text(identity?.email),
    objectId: text(identity?.objectId),
    tenantId: text(identity?.tenantId),
    roles: texts(identity?.roles),
    authMethod: text(identity?.authMethod),
  };
}

/** What the audit log recorded about whoever made one call. */
export function identityFromAudit(row: AuditRow): AccountIdentity {
  return {
    source: 'audit',
    userName: row.user,
    name: text(row.name),
    email: text(row.email),
    objectId: text(row.objectId),
    tenantId: text(row.tenantId),
    roles: texts(row.roles),
    authMethod: text(row.authMethod),
  };
}

/** One line of the dialog. */
export interface IdentityRow {
  k: string;
  v: string;
  mono?: boolean;
}

const AUTH_METHODS: Record<string, string> = {
  easyauth: 'Easy Auth (App Service authentication)',
  bearer: 'Bearer token, validated by DfMon',
  vscode: 'The VS Code extension',
  anonymous: 'Authentication is off',
};

/** Where the details came from, in words. */
export function describeSource(source: IdentitySource): string {
  switch (source) {
    case 'msal':
      return 'This browser, signed in through Microsoft Entra ID (MSAL)';
    case 'server':
      return 'The claims the backend validated for this login';
    case 'audit':
      return 'The audit log: what the backend recorded when the call was made';
  }
}

function when(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }

  const time = new Date(iso);

  return Number.isNaN(time.getTime()) ? iso : `${time.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * Everything known about the person, one row each, and nothing for what is not known: a blank row
 * would look like an empty claim, and an empty claim is a different fact.
 */
export function identityRows(identity: AccountIdentity): IdentityRow[] {
  const rows: (IdentityRow | null)[] = [
    identity.name ? { k: 'Name', v: identity.name } : null,
    { k: 'User name', v: identity.userName, mono: true },
    identity.email && identity.email !== identity.userName ? { k: 'Email', v: identity.email, mono: true } : null,
    identity.objectId ? { k: 'Object ID', v: identity.objectId, mono: true } : null,
    identity.tenantId ? { k: 'Tenant ID', v: identity.tenantId, mono: true } : null,
    identity.roles.length ? { k: 'App roles', v: identity.roles.join(', ') } : null,
    identity.authMethod ? { k: 'Authenticated by', v: AUTH_METHODS[identity.authMethod] ?? identity.authMethod } : null,
    identity.authority ? { k: 'Authority', v: identity.authority, mono: true } : null,
    identity.environment ? { k: 'Identity provider', v: identity.environment, mono: true } : null,
    identity.issuer ? { k: 'Issuer', v: identity.issuer, mono: true } : null,
    identity.audience ? { k: 'Audience', v: identity.audience, mono: true } : null,
    identity.homeAccountId ? { k: 'Home account ID', v: identity.homeAccountId, mono: true } : null,
    identity.scopes?.length ? { k: 'Token scopes', v: identity.scopes.join(' '), mono: true } : null,
    identity.idTokenExpiresAt ? { k: 'ID token expires', v: when(identity.idTokenExpiresAt) as string } : null,
    identity.accessTokenExpiresAt
      ? { k: 'Access token expires', v: when(identity.accessTokenExpiresAt) as string }
      : null,
  ];

  return rows.filter((row): row is IdentityRow => row !== null);
}

/** What "Copy details" puts on the clipboard: the dialog's rows plus the claims, as JSON. */
export function identityDetails(identity: AccountIdentity): Record<string, unknown> {
  const { claims, ...rest } = identity;

  return claims ? { ...rest, claims } : rest;
}
