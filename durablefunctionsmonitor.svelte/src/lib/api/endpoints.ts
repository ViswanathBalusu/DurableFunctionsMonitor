// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// One function per row of the endpoint table in docs/plans/svelte-rewrite/00-shared-contracts.md §6.
// Everything above this layer speaks these functions and the DTOs of ./types, never raw URLs; everything
// below (host or VS Code transport, hub segment, errors) is the BackendClient's job.

import type { BackendClient } from './client';
import type {
  About,
  AuditQuery,
  AuditResponse,
  BatchRequest,
  BatchResponse,
  Capabilities,
  ChildrenResponse,
  CleanEntityStorageRequest,
  CleanEntityStorageResponse,
  ConnectionInfo,
  EasyAuthConfig,
  EntitiesQuery,
  EntitiesResponse,
  FailuresQuery,
  FailuresResponse,
  FunctionMapResponse,
  HistoryQuery,
  HistoryResponse,
  InputEventsResponse,
  OrchestrationDetails,
  OrchestrationStatus,
  OrchestrationsQuery,
  PurgeHistoryRequest,
  PurgeHistoryResponse,
  ReplayRequest,
  ReplayResult,
  RestartInPlaceRequest,
  RestartInPlaceResult,
  SpansResponse,
  StartNewInstanceRequest,
  StartNewInstanceResponse,
  StatsRequest,
  StatsResponse,
  StorageQuery,
  StorageResponse,
  UpdateInputAndRewindRequest,
  UpdateInputAndRewindResult,
} from './types';

/**
 * An instance id inside an OData-style `orchestrations('{id}')` segment.
 *
 * `encodeURIComponent` leaves the single quote alone (it is an unreserved mark in RFC 2396), and an
 * unescaped quote would close the segment early, so it is percent-encoded on top. Ported from the React
 * client, whose routes the backend still matches.
 */
export function encodeInstanceId(instanceId: string): string {
  return encodeURIComponent(instanceId ?? '').replace(/'/g, '%27');
}

function instancePath(instanceId: string, suffix = ''): string {
  return `/orchestrations('${encodeInstanceId(instanceId)}')${suffix}`;
}

/**
 * Turns the raw `/about` body into a complete About. A backend older than B0 does not send `provider`,
 * `capabilities` or `templates` at all; rather than sprinkling `?.` over every screen, the missing halves
 * are filled here exactly as contracts §6 prescribes: provider 'unknown', readOnly derived from the
 * permissions, every capability false, empty templates.
 */
export function normalizeAbout(raw: Partial<About> | null | undefined): About {
  const permissions = raw?.permissions ?? [];

  return {
    accountName: raw?.accountName ?? '',
    hubName: raw?.hubName ?? '',
    version: raw?.version ?? '',
    permissions,

    provider: raw?.provider ?? 'unknown',

    // An old backend says nothing about the mode; the permission list is what it did say
    readOnly: raw?.readOnly ?? !permissions.includes(ReadWritePermission),
    dangerousOperations: raw?.dangerousOperations ?? permissions.includes(DangerousOperationsPermission),

    capabilities: { ...NoCapabilities, ...(raw?.capabilities ?? {}) },
    templates: {
      functionMapAvailable: raw?.templates?.functionMapAvailable ?? false,
      functionCount: raw?.templates?.functionCount ?? null,
      liquidTabs: raw?.templates?.liquidTabs ?? [],
      customMetaTag: raw?.templates?.customMetaTag ?? false,
    },
  };
}

export const ReadWritePermission = 'DurableFunctionsMonitor.ReadWrite';
export const DangerousOperationsPermission = 'DurableFunctionsMonitor.DangerousOperations';

/** Every capability off: what a backend that does not announce them can be assumed to support. */
export const NoCapabilities: Capabilities = {
  stats: false,
  failures: false,
  spans: false,
  children: false,
  batch: false,
  storageHealth: false,
  audit: false,
  entities: false,
  updateInput: false,
  truncateHistory: false,
  purgeHistory: false,
  purgeEntities: false,
  cleanEntityStorage: false,
  deleteTaskHub: false,
  conditionalGet: false,
  episodeMarkers: false,
};

export type Endpoints = ReturnType<typeof createEndpoints>;

export function createEndpoints(client: BackendClient) {
  return {
    // ---------------------------------------------------------------- hub level

    /** `/about`, already normalized - screens never see a half-filled About. */
    about: async (): Promise<About> => normalizeAbout(await client.get<Partial<About>>('/about')),

    /**
     * The Instances table. Parameter order is fixed (contracts §6): $top, $skip, $filter, $orderby,
     * hidden-columns. The filter arrives already built by src/lib/filters/odata.ts, with its values
     * encoded inside the quotes, so it is inserted verbatim.
     */
    listOrchestrations: (query: OrchestrationsQuery): Promise<OrchestrationStatus[]> => {
      let url = `/orchestrations?$top=${query.top}&$skip=${query.skip}`;

      if (query.filter) {
        url += `&$filter=${query.filter}`;
      }
      if (query.orderBy) {
        url += `&$orderby=${query.orderBy}`;
      }
      if (query.hiddenColumns?.length) {
        url += `&hidden-columns=${query.hiddenColumns.join('|')}`;
      }

      return client.get<OrchestrationStatus[]>(url);
    },

    startNewInstance: (req: StartNewInstanceRequest): Promise<StartNewInstanceResponse> =>
      client.post<StartNewInstanceResponse>('/orchestrations', req),

    /** `conditional` sends If-None-Match and reuses the cached body on 304 (capability conditionalGet). */
    getOrchestration: (instanceId: string, conditional = false): Promise<OrchestrationDetails> =>
      client.get<OrchestrationDetails>(instancePath(instanceId), { conditional }),

    getHistory: (instanceId: string, query: HistoryQuery): Promise<HistoryResponse> => {
      let url = `${instancePath(instanceId, '/history')}?$top=${query.top}&$skip=${query.skip}`;

      if (query.filter) {
        url += `&$filter=${query.filter}`;
      }

      return client.get<HistoryResponse>(url);
    },

    // ---------------------------------------------------------------- instance actions

    /** suspend | resume | rewind | terminate. The body is the reason, or empty. */
    postAction: (instanceId: string, action: string, body?: unknown): Promise<void> =>
      client.post<void>(instancePath(instanceId, `/${action}`), body),

    raiseEvent: (instanceId: string, name: string, data: unknown): Promise<void> =>
      client.post<void>(instancePath(instanceId, '/raise-event'), { name, data }),

    /** An empty body clears the custom status, which is why null is passed through rather than dropped. */
    setCustomStatus: (instanceId: string, value: unknown | null): Promise<void> =>
      client.post<void>(instancePath(instanceId, '/set-custom-status'), value),

    restart: (instanceId: string, restartWithNewInstanceId: boolean): Promise<void> =>
      client.post<void>(instancePath(instanceId, '/restart'), { restartWithNewInstanceId }),

    purge: (instanceId: string): Promise<void> => client.post<void>(instancePath(instanceId, '/purge')),

    /** Saves one big field as a file. `field` is input | output | custom-status. */
    downloadField: (instanceId: string, field: string, fileName?: string): Promise<void> =>
      client.download(instancePath(instanceId, `/${field}`), fileName ?? `${instanceId}-${field}`),

    /** A Liquid custom tab, rendered by the backend. Returns markup, not JSON. */
    customTabMarkup: (instanceId: string, template: string): Promise<string> =>
      client.post<string>(instancePath(instanceId, `/custom-tab-markup('${encodeURIComponent(template)}')`)),

    // ---------------------------------------------------------------- input events (restart/rewind/replay)

    inputEvents: (instanceId: string): Promise<InputEventsResponse> =>
      client.get<InputEventsResponse>(instancePath(instanceId, '/input-events')),

    updateInputAndRewind: (instanceId: string, req: UpdateInputAndRewindRequest): Promise<UpdateInputAndRewindResult> =>
      client.post<UpdateInputAndRewindResult>(instancePath(instanceId, '/update-input-and-rewind'), req),

    replay: (instanceId: string, req: ReplayRequest): Promise<ReplayResult> =>
      client.post<ReplayResult>(instancePath(instanceId, '/replay'), req),

    restartInPlace: (instanceId: string, req: RestartInPlaceRequest): Promise<RestartInPlaceResult> =>
      client.post<RestartInPlaceResult>(instancePath(instanceId, '/restart-in-place'), req),

    // ---------------------------------------------------------------- hub administration

    idSuggestions: (prefix: string): Promise<string[]> =>
      client.get<string[]>(`/id-suggestions(prefix='${encodeURIComponent(prefix)}')`),

    functionMap: (): Promise<FunctionMapResponse> => client.get<FunctionMapResponse>('/function-map'),

    purgeHistory: (req: PurgeHistoryRequest): Promise<PurgeHistoryResponse> =>
      client.post<PurgeHistoryResponse>('/purge-history', req),

    cleanEntityStorage: (req: CleanEntityStorageRequest): Promise<CleanEntityStorageResponse> =>
      client.post<CleanEntityStorageResponse>('/clean-entity-storage', req),

    deleteTaskHub: (): Promise<void> => client.post<void>('/delete-task-hub'),

    manageConnection: (): Promise<ConnectionInfo> => client.get<ConnectionInfo>('/manage-connection'),

    // The two hub-less calls: '../' addresses them past the hub segment (contracts §5)
    easyAuthConfig: (): Promise<EasyAuthConfig> => client.get<EasyAuthConfig>('../easyauth-config'),

    taskHubNames: (): Promise<string[]> => client.get<string[]>('../task-hub-names'),

    // ---------------------------------------------------------------- aggregation endpoints (B1-B5)

    stats: (req: StatsRequest): Promise<StatsResponse> => {
      let url = `/stats?from=${encodeURIComponent(req.from)}&to=${encodeURIComponent(req.to)}`;

      if (req.bins !== undefined) {
        url += `&bins=${req.bins}`;
      }
      if (req.stuckAfterMinutes !== undefined) {
        url += `&stuckAfterMinutes=${req.stuckAfterMinutes}`;
      }
      if (req.pendingAfterMinutes !== undefined) {
        url += `&pendingAfterMinutes=${req.pendingAfterMinutes}`;
      }

      return client.get<StatsResponse>(url);
    },

    children: (instanceId: string): Promise<ChildrenResponse> =>
      client.get<ChildrenResponse>(instancePath(instanceId, '/children')),

    spans: (instanceId: string, conditional = false): Promise<SpansResponse> =>
      client.get<SpansResponse>(instancePath(instanceId, '/spans'), { conditional }),

    failures: (query: FailuresQuery): Promise<FailuresResponse> =>
      client.get<FailuresResponse>(
        `/failures?from=${encodeURIComponent(query.from)}&to=${encodeURIComponent(query.to)}`,
      ),

    batch: (req: BatchRequest): Promise<BatchResponse> => client.post<BatchResponse>('/orchestrations/batch', req),

    storage: (query: StorageQuery = {}): Promise<StorageResponse> => {
      const params: string[] = [];

      if (query.counts) {
        params.push('counts=true');
      }
      if (query.instanceId) {
        params.push(`instanceId=${encodeURIComponent(query.instanceId)}`);
      }

      return client.get<StorageResponse>(params.length ? `/storage?${params.join('&')}` : '/storage');
    },

    entities: (query: EntitiesQuery = {}): Promise<EntitiesResponse> => {
      const params: string[] = [];

      if (query.name) {
        params.push(`name=${encodeURIComponent(query.name)}`);
      }
      if (query.keyPrefix) {
        params.push(`keyPrefix=${encodeURIComponent(query.keyPrefix)}`);
      }
      if (query.updatedFrom) {
        params.push(`updatedFrom=${encodeURIComponent(query.updatedFrom)}`);
      }
      if (query.updatedTo) {
        params.push(`updatedTo=${encodeURIComponent(query.updatedTo)}`);
      }
      if (query.top !== undefined) {
        params.push(`$top=${query.top}`);
      }
      if (query.skip !== undefined) {
        params.push(`$skip=${query.skip}`);
      }

      return client.get<EntitiesResponse>(params.length ? `/entities?${params.join('&')}` : '/entities');
    },

    audit: (query: AuditQuery = {}): Promise<AuditResponse> => {
      const params: string[] = [];

      if (query.from) {
        params.push(`from=${encodeURIComponent(query.from)}`);
      }
      if (query.to) {
        params.push(`to=${encodeURIComponent(query.to)}`);
      }
      if (query.operation) {
        params.push(`operation=${encodeURIComponent(query.operation)}`);
      }
      if (query.top !== undefined) {
        params.push(`$top=${query.top}`);
      }
      if (query.skip !== undefined) {
        params.push(`$skip=${query.skip}`);
      }

      return client.get<AuditResponse>(params.length ? `/audit?${params.join('&')}` : '/audit');
    },
  };
}
