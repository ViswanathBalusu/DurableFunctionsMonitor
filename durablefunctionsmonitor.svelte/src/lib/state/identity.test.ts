// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { auditRow } from '../../../tests/unit/fixtures/audit';
import {
  describeSource,
  identityDetails,
  identityFromAudit,
  identityFromMsal,
  identityFromServer,
  identityRows,
  withToken,
  type AccountIdentity,
} from './identity';

const claims = {
  aud: 'client-id',
  iss: 'https://login.microsoftonline.com/66666666-7777-8888-9999-000000000000/v2.0',
  exp: 1_788_000_000,
  name: 'Alice Smith',
  oid: '11111111-2222-3333-4444-555555555555',
  preferred_username: 'alice@contoso.com',
  roles: ['Operator', 'Reader'],
  tid: '66666666-7777-8888-9999-000000000000',
};

const account = {
  homeAccountId: '11111111-2222-3333-4444-555555555555.66666666-7777-8888-9999-000000000000',
  environment: 'login.microsoftonline.com',
  tenantId: '66666666-7777-8888-9999-000000000000',
  username: 'alice@contoso.com',
  localAccountId: '11111111-2222-3333-4444-555555555555',
  name: 'Alice Smith',
  idTokenClaims: claims,
};

describe('identityFromMsal', () => {
  it('reads what the account and its ID token say', () => {
    const identity = identityFromMsal(account, 'https://login.microsoftonline.com/tenant');

    expect(identity).toMatchObject({
      source: 'msal',
      userName: 'alice@contoso.com',
      name: 'Alice Smith',
      objectId: '11111111-2222-3333-4444-555555555555',
      tenantId: '66666666-7777-8888-9999-000000000000',
      roles: ['Operator', 'Reader'],
      homeAccountId: account.homeAccountId,
      environment: 'login.microsoftonline.com',
      authority: 'https://login.microsoftonline.com/tenant',
      issuer: claims.iss,
      audience: 'client-id',
      idTokenExpiresAt: new Date(1_788_000_000 * 1000).toISOString(),
    });

    expect(identity.claims).toEqual(claims);
  });

  it('does not make up what MSAL does not have', () => {
    const identity = identityFromMsal({ username: 'someone@contoso.com' });

    expect(identity.name).toBeUndefined();
    expect(identity.objectId).toBeUndefined();
    expect(identity.tenantId).toBeUndefined();
    expect(identity.roles).toEqual([]);
    expect(identity.claims).toBeUndefined();
    expect(identity.idTokenExpiresAt).toBeUndefined();
  });

  it('takes a single role claim for a list of one', () => {
    expect(identityFromMsal({ username: 'a@b.com', idTokenClaims: { roles: 'Operator' } as never }).roles).toEqual([
      'Operator',
    ]);
  });
});

describe('withToken', () => {
  it('adds what the token is good for, and until when', () => {
    const identity = withToken(identityFromMsal(account), {
      scopes: ['client-id/.default'],
      expiresOn: new Date('2026-10-28T12:00:00Z'),
    });

    expect(identity.scopes).toEqual(['client-id/.default']);
    expect(identity.accessTokenExpiresAt).toBe('2026-10-28T12:00:00.000Z');
  });

  it('keeps what it knew when a token says nothing', () => {
    const first = withToken(identityFromMsal(account), { scopes: ['a'], expiresOn: new Date('2026-10-28T12:00:00Z') });
    const second = withToken(first, { scopes: [], expiresOn: null });

    expect(second.scopes).toEqual(['a']);
    expect(second.accessTokenExpiresAt).toBe('2026-10-28T12:00:00.000Z');
  });
});

describe('identityFromServer', () => {
  it('reads the claims the backend validated', () => {
    const identity = identityFromServer(
      {
        userName: 'alice@contoso.com',
        name: 'Alice Smith',
        objectId: 'oid-1',
        tenantId: 'tid-1',
        roles: ['Operator'],
        authMethod: 'easyauth',
      },
      'alice@contoso.com',
    );

    expect(identity).toEqual({
      source: 'server',
      userName: 'alice@contoso.com',
      name: 'Alice Smith',
      email: undefined,
      objectId: 'oid-1',
      tenantId: 'tid-1',
      roles: ['Operator'],
      authMethod: 'easyauth',
    });
  });

  it('is still somebody when an older backend sends only the user name', () => {
    expect(identityFromServer(undefined, 'alice@contoso.com')).toMatchObject({
      userName: 'alice@contoso.com',
      roles: [],
    });
  });

  it('is nobody when there is no user name at all', () => {
    expect(identityFromServer(undefined, undefined)).toBeNull();
    expect(identityFromServer({ name: 'No user name' }, '')).toBeNull();
  });

  it('turns the nulls of a JSON answer into absent fields', () => {
    const identity = identityFromServer({ userName: 'a@b.com', name: null, roles: null, authMethod: null }, undefined);

    expect(identity?.name).toBeUndefined();
    expect(identity?.roles).toEqual([]);
    expect(identity?.authMethod).toBeUndefined();
  });
});

describe('identityFromAudit', () => {
  it('reads what the audit log recorded about the caller', () => {
    const identity = identityFromAudit(
      auditRow({
        name: 'Alice Smith',
        objectId: 'oid-1',
        tenantId: 'tid-1',
        roles: ['Operator'],
        authMethod: 'bearer',
      }),
    );

    expect(identity).toMatchObject({
      source: 'audit',
      userName: 'chandra@contoso.com',
      name: 'Alice Smith',
      objectId: 'oid-1',
      tenantId: 'tid-1',
      roles: ['Operator'],
      authMethod: 'bearer',
    });
  });

  it('copes with a row from before identities were recorded', () => {
    expect(identityFromAudit(auditRow())).toMatchObject({ userName: 'chandra@contoso.com', roles: [] });
  });
});

describe('identityRows', () => {
  it('lists everything known, labelled, and nothing else', () => {
    const rows = identityRows(
      withToken(identityFromMsal(account, 'https://login.microsoftonline.com/tenant'), {
        scopes: ['client-id/.default'],
        expiresOn: new Date('2026-10-28T12:00:00Z'),
      }),
    );

    expect(rows.map((row) => row.k)).toEqual([
      'Name',
      'User name',
      'Object ID',
      'Tenant ID',
      'App roles',
      'Authority',
      'Identity provider',
      'Issuer',
      'Audience',
      'Home account ID',
      'Token scopes',
      'ID token expires',
      'Access token expires',
    ]);

    expect(rows.find((row) => row.k === 'App roles')?.v).toBe('Operator, Reader');
    expect(rows.find((row) => row.k === 'Access token expires')?.v).toBe('2026-10-28 12:00:00 UTC');
  });

  it('shows nothing for what is not known', () => {
    expect(identityRows(identityFromAudit(auditRow()))).toEqual([
      { k: 'User name', v: 'chandra@contoso.com', mono: true },
    ]);
  });

  it('does not repeat an email that is the user name', () => {
    const rows = identityRows({ source: 'server', userName: 'a@b.com', email: 'a@b.com', roles: [] });

    expect(rows.map((row) => row.k)).toEqual(['User name']);
  });

  it('says in words how the backend authenticated the call', () => {
    const row = (authMethod: string) =>
      identityRows({ source: 'audit', userName: 'u', roles: [], authMethod }).find((r) => r.k === 'Authenticated by');

    expect(row('easyauth')?.v).toMatch(/Easy Auth/);
    expect(row('bearer')?.v).toMatch(/Bearer token/);
    expect(row('something-new')?.v).toBe('something-new');
  });
});

describe('identityDetails', () => {
  it('is the identity with its claims, ready to copy', () => {
    const identity = identityFromMsal(account);

    expect(identityDetails(identity)).toMatchObject({ userName: 'alice@contoso.com', claims });
  });

  it('has no claims key when there are none', () => {
    expect('claims' in identityDetails(identityFromServer(undefined, 'a@b.com') as AccountIdentity)).toBe(false);
  });
});

describe('describeSource', () => {
  it('names each of the three places', () => {
    expect(describeSource('msal')).toMatch(/MSAL/);
    expect(describeSource('server')).toMatch(/backend validated/);
    expect(describeSource('audit')).toMatch(/audit log/);
  });
});
