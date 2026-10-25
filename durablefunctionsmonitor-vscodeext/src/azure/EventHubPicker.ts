// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';

import type { Log } from '../logging';
import { callArm, getArmToken, getAzureResources } from './azureResources';

const ApiVersion = '2017-04-01';

export class EventHubPicker {

    constructor(private _log: Log) { }

    // Asks user to choose an Event Hub connection string
    async pickEventHubConnectionString(subscription: AzureSubscription): Promise<string | undefined> {

        const namespaces = await getAzureResources(subscription, 'microsoft.eventhub/namespaces') as { id: string, name: string, sku: any, location: string }[];

        if (!namespaces.length) {

            throw new Error(`No Event Hubs namespaces found in current subscription. Connect to your Task Hub by explicitly providing connection strings (use 'Attach to Task Hub...' command for that).`);
        }

        const namespacePickResult = await vscode.window.showQuickPick(
            namespaces.map(n => {
                return {
                    label: n.name,
                    description: `location: ${n.location}, SKU: ${n.sku?.name}`,
                    id: n.id
                };
            }),
            { title: 'Select Azure Event Hubs namespace' }
        );

        if (!namespacePickResult) {

            return;
        }

        const accessToken = await getArmToken(subscription);

        let authRule: string | undefined = '';

        try {

            const authRules = await this.getRootAuthRules(subscription, namespacePickResult.id, accessToken);

            if (authRules.length === 1) {

                authRule = authRules[0];

            } else if (authRules.length > 1) {

                authRule = await vscode.window.showQuickPick(authRules, { title: `Select ${namespacePickResult.label} Authorization Rule to use` });
                if (!authRule) {
                    return;
                }
            }

        } catch (err: any) {

            this._log(`Failed to load root authorization rules for namespace ${namespacePickResult.label}. ${err.message ?? err}`);
        }

        if (authRule) {

            return await this.getConnectionStringForAuthRule(subscription, authRule, namespacePickResult.id, accessToken);
        }

        try {

            const authRules = await this.getHubAuthRules(subscription, namespacePickResult.id, accessToken);

            if (authRules.length > 0) {

                authRule = await vscode.window.showQuickPick(authRules, { title: `Select ${namespacePickResult.label} Authorization Rule to use` });
                if (!authRule) {
                    return;
                }

                return await this.getConnectionStringForAuthRule(subscription, authRule, namespacePickResult.id, accessToken);
            }

        } catch (err: any) {

            this._log(`Failed to load hub authorization rules for namespace ${namespacePickResult.label}. ${err.message ?? err}`);
        }

        throw new Error(`Failed to get an authorization rule for Event Hubs namespace ${namespacePickResult.label}. Connect to your Task Hub by explicitly providing connection strings (use 'Attach to Task Hub...' command for that).`);
    }

    private async getConnectionStringForAuthRule(subscription: AzureSubscription, authRule: string, namespaceId: string, accessToken: string): Promise<string> {

        const keys = await callArm(subscription, 'POST', `${namespaceId}/${authRule}/listKeys?api-version=${ApiVersion}`, accessToken);

        return keys?.primaryConnectionString;
    }

    private async getRootAuthRules(subscription: AzureSubscription, namespaceId: string, accessToken: string): Promise<string[]> {

        const response = await callArm(subscription, 'GET', `${namespaceId}/authorizationRules?api-version=${ApiVersion}`, accessToken);

        if (!response?.value) {

            return [];
        }

        return response.value.map((r: any) => `authorizationRules/${r.name}`);
    }

    private async getHubAuthRules(subscription: AzureSubscription, namespaceId: string, accessToken: string): Promise<string[]> {

        const response = await callArm(subscription, 'GET', `${namespaceId}/eventhubs?api-version=${ApiVersion}`, accessToken);
        const itemNames: string[] = response?.value?.map((t: any) => t.name);

        if (!itemNames) {
            return [];
        }

        const promises = itemNames.map(async itemName => {

            const authRulesResponse = await callArm(subscription, 'GET', `${namespaceId}/eventhubs/${itemName}/authorizationRules?api-version=${ApiVersion}`, accessToken);

            if (!authRulesResponse?.value) {
                return [];
            }

            return authRulesResponse.value.map((r: any) => `eventhubs/${itemName}/authorizationRules/${r.name}`) as string[];
        });

        return (await Promise.all(promises)).flat().sort();
    }
}
