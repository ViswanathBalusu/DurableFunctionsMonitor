// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The DTO fixtures (E3-S1-T2) are the mockups' own content, typed: the same instance ids, names,
// timestamps and payloads the screens in docs/ui-plans-artifacts draw. A test that renders a
// fixture is therefore looking at what the design was drawn against.

import type { About, Capabilities, Templates } from '$lib/api/types';

/** Everything a modern Azure Storage backend announces (B0-B5 all landed). */
export function capabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    stats: true,
    failures: true,
    spans: true,
    children: true,
    batch: true,
    storageHealth: true,
    audit: true,
    entities: true,
    updateInput: true,
    truncateHistory: true,
    purgeHistory: true,
    purgeEntities: true,
    cleanEntityStorage: true,
    deleteTaskHub: true,
    conditionalGet: true,
    episodeMarkers: true,
    ...overrides,
  };
}

/** What a provider with none of the optional endpoints says: every screen degrades from here. */
export function noCapabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  const off = Object.fromEntries(Object.keys(capabilities()).map((key) => [key, false])) as unknown as Capabilities;

  return { ...off, ...overrides };
}

export function templates(overrides: Partial<Templates> = {}): Templates {
  return {
    functionMapAvailable: true,
    functionCount: 14,
    liquidTabs: ['Order summary'],
    customMetaTag: false,
    ...overrides,
  };
}

export function about(overrides: Partial<About> = {}): About {
  return {
    accountName: 'dfmstorage001',
    hubName: 'DurableFunctionsHub',
    version: '6.9.0 (isolated)',
    permissions: ['DurableFunctionsMonitor.ReadWrite'],
    provider: 'AzureStorage',
    readOnly: false,
    dangerousOperations: false,
    capabilities: capabilities(),
    templates: templates(),
    ...overrides,
  };
}
