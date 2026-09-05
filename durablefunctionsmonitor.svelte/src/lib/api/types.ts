// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Every DTO the backend speaks, transcribed from docs/plans/svelte-rewrite/00-shared-contracts.md §6.
// That table is authoritative: the C# DTOs of the B epics serialise to exactly these shapes (camelCase,
// enums as strings, dates as ISO 8601 UTC). Nothing here is inferred from a response at runtime.

export type RuntimeStatus =
  'Completed' | 'Running' | 'Failed' | 'Pending' | 'Terminated' | 'Canceled' | 'ContinuedAsNew' | 'Suspended';

export type EntityType = 'Orchestration' | 'DurableEntity';

/** What `/about.capabilities` announces. Every screen gates on these, never on the provider name (D9). */
export interface Capabilities {
  stats: boolean;
  failures: boolean;
  spans: boolean;
  children: boolean;
  batch: boolean;
  storageHealth: boolean;
  audit: boolean;
  entities: boolean;
  updateInput: boolean;
  truncateHistory: boolean;
  purgeHistory: boolean;
  purgeEntities: boolean;
  cleanEntityStorage: boolean;
  deleteTaskHub: boolean;
  conditionalGet: boolean;
  episodeMarkers: boolean;
}

export interface Templates {
  functionMapAvailable: boolean;
  functionCount: number | null;
  liquidTabs: string[];
  customMetaTag: boolean;
}

export interface About {
  accountName: string;
  hubName: string;
  version: string;
  /** 'DurableFunctionsMonitor.ReadWrite', 'DurableFunctionsMonitor.DangerousOperations' */
  permissions: string[];
  provider: 'AzureStorage' | 'MsSql' | 'Netherite' | string;
  readOnly: boolean;
  dangerousOperations: boolean;
  capabilities: Capabilities;
  templates: Templates;
}

export interface OrchestrationStatus {
  instanceId: string;
  name: string;
  runtimeStatus: RuntimeStatus;
  entityType: EntityType;
  entityId?: { name: string; key: string };
  createdTime: string;
  lastUpdatedTime: string;
  /** ms, lastUpdatedTime - createdTime */
  duration: number;
  input?: unknown;
  output?: unknown;
  customStatus?: unknown;
  lastEvent?: string;
  /**
   * Only populated when the query filtered on it (contracts §6), and null rather than absent on the
   * details endpoint - hence the three-state type.
   */
  parentInstanceId?: string | null;
}

export interface OrchestrationDetails extends OrchestrationStatus {
  parentInstanceId: string | null;
  tabTemplateNames: string[];
  tags?: Record<string, string>;
}

/** History rows keep the backend's PascalCase field names; nothing renames them on the way through. */
export interface HistoryEvent {
  SequenceNumber: number | null;
  Timestamp: string;
  EventType: string;
  EventId: number | null;
  Name: string | null;
  ScheduledTime: string | null;
  DurationInMs: number | null;
  SubOrchestrationId: string | null;
  Input: unknown;
  Result: unknown;
  Details: unknown;
  TimerId?: number | null;
  FireAt?: string | null;
}

export interface HistoryResponse {
  history: HistoryEvent[];
}

// Input events (docs/plans/input-events-restart-rewind-replay.md §4)

export type InputEventOperation = 'restart-in-place' | 'update-input-and-rewind' | 'replay';

export interface OperationEligibility {
  allowed: boolean;
  reason?: string;
  requiresTerminate?: boolean;
  warning?: string;
}

export interface InputEvent {
  sequenceNumber: number | null;
  eventType: 'ExecutionStarted' | 'EventRaised';
  name: string;
  timestamp: string;
  input: unknown;
  isLast: boolean;
  operations: Record<InputEventOperation, OperationEligibility>;
}

export interface InputEventsResponse {
  instanceId: string;
  runtimeStatus: RuntimeStatus;
  parentInstanceId: string | null;
  dangerousOperationsEnabled: boolean;
  storageSupports: { updateInput: boolean; truncateHistory: boolean };
  events: InputEvent[];
}

export interface RestartInPlaceRequest {
  input?: unknown;
}

export interface UpdateInputAndRewindRequest {
  sequenceNumber: number;
  input: unknown;
  reason?: string;
}

export interface ReplayRequest {
  sequenceNumber: number;
  input?: unknown;
  terminateIfRunning?: boolean;
}

export interface RestartInPlaceResult {
  instanceId: string;
  purged: true;
  input: unknown;
}

export interface UpdateInputAndRewindResult {
  sequenceNumber: number;
  inputUpdated: true;
  rewound: true;
}

export interface ReplayResult {
  sequenceNumber: number;
  eventName: string;
  deletedRows: number;
  raised: true;
}

/** 500 body of `restart-in-place`: what the caller has to do by hand to recover. */
export interface RestartInPlaceRecovery {
  error: string;
  orchestratorName: string;
  instanceId: string;
  input: unknown;
}

/** 500 body of `replay`. */
export interface ReplayRecovery {
  error: string;
  sequenceNumber: number;
  eventName: string;
  deletedRows: number;
  raised: false;
  input: unknown;
}

/** 500 body of `update-input-and-rewind`. */
export interface UpdateInputRecovery {
  error: string;
  sequenceNumber: number;
  inputUpdated: true;
  rewound: false;
}

// B1

export interface StatsRequest {
  from: string;
  to: string;
  bins?: number;
  stuckAfterMinutes?: number;
  pendingAfterMinutes?: number;
}

export interface StatsBin {
  start: string;
  end: string;
  counts: Partial<Record<RuntimeStatus, number>>;
}

export interface StatsByName {
  name: string;
  started: number;
  completed: number;
  failed: number;
  running: number;
  failureRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastFailedAt: string | null;
}

export interface StatsSet {
  count: number;
  sampleIds: string[];
}

export interface StatsResponse {
  from: string;
  to: string;
  binCount: number;
  totals: Partial<Record<RuntimeStatus, number>> & { all: number; entities: number };
  bins: StatsBin[];
  byName: StatsByName[];
  entitiesByName: { name: string; count: number }[];
  stuck: StatsSet & { oldestLastUpdatedAt: string | null };
  oldestPending: StatsSet & { oldestCreatedAt: string | null };
  suspended: StatsSet & { oldestLastUpdatedAt: string | null };
  scanned: number;
  partial: boolean;
  cap: number;
  elapsedMs: number;
  generatedAt: string;
  cached: boolean;
}

export interface ChildInstance {
  instanceId: string;
  name: string;
  runtimeStatus: RuntimeStatus;
  createdTime: string;
  lastUpdatedTime: string;
}

export interface ChildrenResponse {
  children: ChildInstance[];
  /** False for Azure Storage: it matches generated child ids, so the list is never guaranteed complete. */
  complete: boolean;
}

// B2

export type SpanKind = 'orchestrator' | 'activity' | 'subOrchestration' | 'timer' | 'externalEvent' | 'eventWait';

export interface Span {
  id: string;
  kind: SpanKind;
  name: string;
  attempt: number;
  start: string;
  end: string | null;
  status: 'completed' | 'failed' | 'running' | 'fired' | 'waiting' | 'raised';
  sequenceNumbers: number[];
  subOrchestrationId?: string;
  durationMs: number | null;
}

export interface SpansTotals {
  activitiesMs: number;
  subOrchestrationsMs: number;
  timersMs: number;
  externalEventWaitMs: number;
  orchestratorMs: number | null;
  totalMs: number;
}

export interface SpansResponse {
  instanceId: string;
  executionId: string | null;
  generation: number | null;
  executionStartedAt: string | null;
  executionEndedAt: string | null;
  now: string;
  spans: Span[];
  totals: SpansTotals;
  historyRows: number;
  historyBytes: number | null;
  largeMessageBlobs: number | null;
}

// B3

export interface FailureInstance {
  instanceId: string;
  createdTime: string;
  completedTime: string | null;
  durationMs: number | null;
  reason: string;
}

export interface FailureGroup {
  key: string;
  name: string;
  signature: string;
  count: number;
  lastSeenAt: string;
  sampleIds: string[];
  instances: FailureInstance[];
}

export interface FailuresResponse {
  groups: FailureGroup[];
  totalFailed: number;
  scanned: number;
  partial: boolean;
  cap: number;
  elapsedMs: number;
  generatedAt: string;
  cached: boolean;
}

export type BatchAction =
  'suspend' | 'resume' | 'rewind' | 'terminate' | 'raise-event' | 'set-custom-status' | 'restart' | 'purge';

export interface BatchRequest {
  action: BatchAction;
  instanceIds: string[];
  payload?: {
    reason?: string;
    name?: string;
    data?: unknown;
    customStatus?: unknown;
    restartWithNewInstanceId?: boolean;
  };
}

export interface BatchResultItem {
  instanceId: string;
  ok: boolean;
  status: number;
  message?: string;
}

export interface BatchResponse {
  action: BatchAction;
  results: BatchResultItem[];
  okCount: number;
  failedCount: number;
  elapsedMs: number;
}

// B4

export interface StorageQueue {
  name: string;
  kind: 'workitems' | 'control';
  partition: number | null;
  approximateMessageCount: number | null;
}

export interface StoragePartition {
  name: string;
  owner: string | null;
  ownedSince: string | null;
  isDraining: boolean | null;
  nextOwner: string | null;
  source: 'table' | 'lease-blob' | 'none';
}

export interface StorageResponse {
  provider: 'AzureStorage' | string;
  accountName: string;
  taskHub: {
    name: string;
    partitionCount: number | null;
    createdAt: string | null;
    source: 'taskhub.json' | 'unknown';
  };
  queues: StorageQueue[];
  partitions: StoragePartition[];
  tables: { instances: string; history: string; partitions: string | null; audit: string | null };
  largeMessages: { container: string; exists: boolean; blobCount: number | null; totalBytes: number | null };
  counts: { instancesRows: number | null; historyRows: number | null; partial: boolean };
  generatedAt: string;
  elapsedMs: number;
  cached: boolean;
}

export interface EntityRow {
  instanceId: string;
  entityName: string;
  key: string;
  state: unknown | null;
  stateSummary: string | null;
  stateError: string | null;
  lastUpdatedTime: string;
  runtimeStatus: RuntimeStatus;
}

export interface EntitiesResponse {
  entities: EntityRow[];
  hasMore: boolean;
}

// B5

export interface AuditRow {
  at: string;
  user: string;
  operation: string;
  kind: 'Write' | 'Dangerous';
  instanceId: string | null;
  outcome: 'ok' | 'failed';
  status: number;
  message: string | null;
}

export interface AuditResponse {
  rows: AuditRow[];
  hasMore: boolean;
  /** False when auditing is off or the provider cannot serve records: an empty page, not an error. */
  enabled: boolean;
}

// Hub-level and host-level calls

export interface PurgeHistoryRequest {
  timeFrom: string;
  timeTill: string;
  statuses: RuntimeStatus[];
  entityType: EntityType;
}

export interface PurgeHistoryResponse {
  instancesDeleted: number;
}

export interface CleanEntityStorageRequest {
  removeEmptyEntities: boolean;
  releaseOrphanedLocks: boolean;
}

export interface CleanEntityStorageResponse {
  numberOfEmptyEntitiesRemoved: number;
  numberOfOrphanedLocksRemoved: number;
}

export interface ConnectionInfo {
  /** Masked by the backend; never the real secret. */
  connectionString: string;
  hubName: string;
  isReadOnly: boolean;
}

export interface EasyAuthConfig {
  clientId?: string;
  authority?: string;
  userName?: string;
}

export interface StartNewInstanceRequest {
  id?: string;
  name: string;
  data: unknown;
}

export interface StartNewInstanceResponse {
  instanceId: string;
}

/** One node of `/function-map`, as the Liquid template produces it. */
export interface FunctionMapNode {
  isCalledBy?: string[];
  isSignalledBy?: { name: string; signalName: string }[];
  isCalledByHttp?: boolean;
  bindings?: { type?: string; direction?: string; [key: string]: unknown }[];
  filePath?: string;
  lineNumber?: number;
  [key: string]: unknown;
}

export type FunctionsMap = Record<string, FunctionMapNode>;
export type ProxiesMap = Record<string, FunctionMapNode>;

export interface FunctionMapResponse {
  functions: FunctionsMap;
  proxies: ProxiesMap;
}

/** Query of the Instances screen, already turned into OData by `src/lib/filters/odata.ts`. */
export interface OrchestrationsQuery {
  filter: string;
  orderBy?: string;
  top: number;
  skip: number;
  /** Columns the backend may leave out of the response, joined with `|` on the wire. */
  hiddenColumns?: string[];
}

export interface HistoryQuery {
  top: number;
  skip: number;
  filter?: string;
}

export interface EntitiesQuery {
  name?: string;
  keyPrefix?: string;
  updatedFrom?: string;
  updatedTo?: string;
  top?: number;
  skip?: number;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  operation?: string;
  top?: number;
  skip?: number;
}

export interface FailuresQuery {
  from: string;
  to: string;
}

export interface StorageQuery {
  counts?: boolean;
  instanceId?: string;
}
