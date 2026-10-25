// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';

const PublicArmEndpoint = 'https://management.azure.com';
const PublicPortalUrl = 'https://portal.azure.com';

// Azure Resource Manager of the cloud the subscription is in (Azure public cloud, or a sovereign one, or a custom one)
export function getArmEndpoint(subscription: Pick<AzureSubscription, 'environment'>): string {

    const endpoint: string | undefined = subscription.environment?.resourceManagerEndpointUrl;
    return (endpoint || PublicArmEndpoint).replace(/\/+$/, '');
}

// The portal of that cloud
export function getPortalUrl(subscription: Pick<AzureSubscription, 'environment'>): string {

    const url: string | undefined = subscription.environment?.portalUrl;
    return (url || PublicPortalUrl).replace(/\/+$/, '');
}

// Makes a value fit between the double quotes of a Kusto string literal
export function escapeKqlString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Queries Azure Resource Graph for the resources of a given type (and name) in the subscription
export async function getAzureResources(subscription: AzureSubscription, resourceType: string, resourceName?: string): Promise<any[]> {

    const resourceGraphClient = new ResourceGraphClient(subscription.credential, { endpoint: getArmEndpoint(subscription) });

    const response = await resourceGraphClient.resources({
        subscriptions: [subscription.subscriptionId],
        query: `resources | where type == "${escapeKqlString(resourceType)}"${resourceName ? ` and name == "${escapeKqlString(resourceName)}"` : ''}`
    });

    return response.data ?? [];
}

// A token for calling Azure Resource Manager
export async function getArmToken(subscription: AzureSubscription): Promise<string> {

    const accessToken = await subscription.credential.getToken([`${getArmEndpoint(subscription)}/.default`]);

    if (!accessToken?.token) {
        throw new Error('Failed to get an access token for Azure Resource Manager.');
    }

    return accessToken.token;
}

// Calls Azure Resource Manager. 'resourcePath' is what comes after the endpoint, with the query.
export async function callArm<T = any>(subscription: AzureSubscription, method: 'GET' | 'POST', resourcePath: string, accessToken?: string): Promise<T> {

    const token = accessToken ?? await getArmToken(subscription);

    const response = await fetch(`${getArmEndpoint(subscription)}${resourcePath}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
        throw new Error(`Azure Resource Manager responded with status code ${response.status} to ${method} ${resourcePath}`);
    }

    return await response.json() as T;
}
