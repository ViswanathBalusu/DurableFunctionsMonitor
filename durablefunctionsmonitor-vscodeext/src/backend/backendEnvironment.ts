// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as SharedConstants from '../constants';

import { ConnStringUtils } from '../connections/ConnStringUtils';
import { StorageConnectionSettings } from '../connections/StorageConnectionSettings';

// For a hub named 'schema/hub' returns 'schema', for a plain 'hub' returns the default schema of MSSQL provider
export function getSchemaName(hubName: string): string {

    const slashPos = hubName.lastIndexOf('/');
    return slashPos < 0 ? 'dt' : hubName.substring(0, slashPos);
}

// For a hub named 'schema/hub' returns 'hub'
export function getHubNameWithoutSchema(hubName: string): string {

    const slashPos = hubName.lastIndexOf('/');
    return slashPos < 0 ? hubName : hubName.substring(slashPos + 1);
}

// Prepares the set of environment variables a backend process is started with
export function buildBackendEnvironment(baseEnv: NodeJS.ProcessEnv, connSettings: StorageConnectionSettings, nonce: string): NodeJS.ProcessEnv {

    // Important to inherit the context from VsCode, so that globally installed tools can be found
    const env: NodeJS.ProcessEnv = { ...baseEnv };

    env[SharedConstants.NonceEnvironmentVariableName] = nonce;

    // Also setting AzureWebJobsSecretStorageType to 'files', so that the backend doesn't need Azure Storage
    env['AzureWebJobsSecretStorageType'] = 'files';

    // Need to explicitly set this, to make sure it is not overshadowed by some global setting
    env['FUNCTIONS_WORKER_RUNTIME'] = 'dotnet-isolated';

    // Azure Functions Core Tools reports usage by default. It is started here on behalf of the user, without
    // the user having typed 'func', so it is not left to report anything, unless the user has said otherwise.
    env['FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT'] ??= '1';

    // To make sure we do not interfere with user's dev setup
    delete env['AzureWebJobsStorage'];
    delete env['AzureWebJobsStorage__accountName'];
    delete env[SharedConstants.MsSqlConnStringEnvironmentVariableName];
    delete env[SharedConstants.HubNameEnvironmentVariableName];
    delete env[SharedConstants.MsSqlSchemaNameEnvironmentVariableName];

    if (connSettings.isMsSql) {

        env[SharedConstants.MsSqlConnStringEnvironmentVariableName] = connSettings.storageConnString;

        env[SharedConstants.HubNameEnvironmentVariableName] = getHubNameWithoutSchema(connSettings.hubName);

        // Also passing the custom DB schema name
        env[SharedConstants.MsSqlSchemaNameEnvironmentVariableName] = getSchemaName(connSettings.hubName);

        return env;
    }

    if (connSettings.isIdentityBasedConnection) {

        env['AzureWebJobsStorage__accountName'] = ConnStringUtils.GetAccountName(connSettings.storageConnString);

    } else {

        env['AzureWebJobsStorage'] = connSettings.storageConnString;
    }

    if (connSettings.isNetherite) {

        env[SharedConstants.EventHubsConnStringEnvironmentVariableName] = connSettings.eventHubsConnString;
    }

    return env;
}
