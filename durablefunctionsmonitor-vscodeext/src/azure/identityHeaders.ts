// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';

import { createBearerHeaders } from './tableAuth';
import type { IdentityHeadersProvider } from './TaskHubsCollector';

// Gives the headers that authenticate requests to Table Storage as the user, for the tenant of the subscription
export function getIdentityHeadersProvider(subscription: AzureSubscription): IdentityHeadersProvider {

    return async () => {

        // Looks like azureSubscription.credential.getToken(scopes) does not always respect scopes (getting a token with default 'https://management.core.windows.net' audience instead of Storage-specific scope)
        // Issue: https://github.com/microsoft/vscode-azuretools/issues/1596
        // So using vscode.authentication directly

        const providerId = 'microsoft';

        const scopes = [
            'https://storage.azure.com/user_impersonation',
            `VSCODE_TENANT:${subscription.tenantId}`
        ];

        // First trying silent mode
        let authSession = await vscode.authentication.getSession(providerId, scopes, { silent: true });

        if (!authSession) {

            // Now asking to authenticate, if needed
            authSession = await vscode.authentication.getSession(providerId, scopes, { createIfNone: true });
        }

        return createBearerHeaders(authSession.accessToken);
    };
}
