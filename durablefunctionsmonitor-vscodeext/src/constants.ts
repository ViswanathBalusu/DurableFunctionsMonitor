// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Everything the extension and the backend have to agree on. test/unit/backendContract.test.ts reads the
// backend's own source files and fails when any of these drifts away from them. That is what was missing
// when the backend moved all its routes under /durable-functions-monitor/ and the extension kept waiting
// for /a/p/i/... to answer: the backend was up, and the extension timed out.

// Environment variables the backend is started with
export const NonceEnvironmentVariableName = 'DFM_NONCE';
export const MsSqlConnStringEnvironmentVariableName = 'DFM_SQL_CONNECTION_STRING';
export const MsSqlSchemaNameEnvironmentVariableName = 'AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName';
export const HubNameEnvironmentVariableName = 'DFM_HUB_NAME';
export const EventHubsConnStringEnvironmentVariableName = 'EventHubsConnection';

// Header that carries the nonce on every request to the backend
export const NonceHeaderName = 'x-dfm-nonce';

// The first segment of every route the backend serves (Globals.DfMonRoutePrefix)
export const BackendRoutePrefix = 'durable-functions-monitor';

// Where the API lives, below the host and the port. The Task Hub segment, '--{hubName}' for a connection
// that is not named, comes right after it (Globals.ApiRoutePrefix)
export const BackendApiPath = `/${BackendRoutePrefix}/a/p/i`;

// Section of VsCode settings that holds all the settings of this extension
export const SettingsSection = 'durableFunctionsMonitor';

// Port range the backends are started in, unless the backendBaseUrl setting says otherwise
export const DefaultPortRange = { from: 37072, to: 38000 };
