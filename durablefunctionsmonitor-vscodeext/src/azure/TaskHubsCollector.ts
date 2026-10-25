// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createSharedKeyLiteHeaders } from './tableAuth';

export type StorageType = 'default' | 'netherite';

// Gives the headers that authenticate a request to Table Storage with the identity of the user. The caller
// provides this one, because getting a token is a matter of VsCode.
export type IdentityHeadersProvider = () => Promise<Record<string, string>>;

// Tries to load the list of TaskHub names from a storage account.
export class TaskHubsCollector {

    constructor(tableEndpointUrl: string, accountName: string) {

        if (!tableEndpointUrl) {
            tableEndpointUrl = `https://${accountName}.table.core.windows.net/`;
        } else if (!tableEndpointUrl.endsWith('/')) {
            tableEndpointUrl += '/';
        }

        this._tableEndpointUrl = tableEndpointUrl;
        this._accountName = accountName;
    }

    async getTaskHubNamesWithKey(accountKey: string): Promise<{ hubNames: string[], storageType: StorageType }> {

        const netheriteHubsPromise = this.getTaskHubNamesFromNetheriteStorageWithKey(accountKey);
        const defaultHubsPromise = this.getTaskHubNamesFromTableStorageWithKey(accountKey);

        const netheriteHubs = await netheriteHubsPromise;

        if (netheriteHubs) {

            // Nobody is waiting for this one, and it must not become an unhandled rejection
            defaultHubsPromise.catch(() => { });

            return { hubNames: netheriteHubs, storageType: 'netherite' };
        }

        const defaultHubs = await defaultHubsPromise;

        return { hubNames: defaultHubs ?? [], storageType: 'default' };
    }

    async getTaskHubNamesWithUserToken(getIdentityHeaders: IdentityHeadersProvider): Promise<{ hubNames: string[], storageType: StorageType }> {

        const netheriteHubsPromise = this.getTaskHubNamesFromNetheriteStorageWithUserToken(getIdentityHeaders);
        const defaultHubsPromise = this.getTaskHubNamesFromTableStorageWithUserToken(getIdentityHeaders);

        const netheriteHubs = await netheriteHubsPromise;

        if (netheriteHubs) {

            defaultHubsPromise.catch(() => { });

            return { hubNames: netheriteHubs, storageType: 'netherite' };
        }

        const defaultHubs = await defaultHubsPromise;

        return { hubNames: defaultHubs ?? [], storageType: 'default' };
    }

    async getTaskHubNamesFromTableStorageWithKey(accountKey: string): Promise<string[] | undefined> {

        return this.getTaskHubNamesFromTableStorage(() => createSharedKeyLiteHeaders(this._accountName, accountKey, this._tableEndpointUrl));
    }

    async getTaskHubNamesFromTableStorageWithUserToken(getIdentityHeaders: IdentityHeadersProvider): Promise<string[] | undefined> {

        return this.getTaskHubNamesFromTableStorage(getIdentityHeaders);
    }

    async getTaskHubNamesFromNetheriteStorageWithKey(accountKey: string): Promise<string[] | undefined> {

        return this.getTaskHubNamesFromNetheriteStorage(() => createSharedKeyLiteHeaders(this._accountName, accountKey, this._tableEndpointUrl, 'DurableTaskPartitions()'));
    }

    async getTaskHubNamesFromNetheriteStorageWithUserToken(getIdentityHeaders: IdentityHeadersProvider): Promise<string[] | undefined> {

        return this.getTaskHubNamesFromNetheriteStorage(getIdentityHeaders);
    }

    private readonly _tableEndpointUrl: string;
    private readonly _accountName: string;

    private getTaskHubNamesFromTableNames(tableNames: { TableName: string }[]): string[] {

        const instancesTables: string[] = tableNames.map(table => table.TableName)
            .filter((tableName: string) => tableName.endsWith('Instances'))
            .map((tableName: string) => tableName.substring(0, tableName.length - 'Instances'.length));

        const historyTables: string[] = tableNames.map(table => table.TableName)
            .filter((tableName: string) => tableName.endsWith('History'))
            .map((tableName: string) => tableName.substring(0, tableName.length - 'History'.length));

        // Considering it to be a hub, if it has both *Instances and *History tables
        return instancesTables.filter(name => historyTables.indexOf(name) >= 0);
    }

    private async getTaskHubNamesFromTableStorage(getHeaders: () => Record<string, string> | Promise<Record<string, string>>): Promise<string[] | undefined> {

        let result: { TableName: string }[] | undefined = undefined;

        let url = `${this._tableEndpointUrl}Tables`;
        while (true) {

            // The signature includes the time, so every request needs its own
            const response = await fetch(url, { headers: await getHeaders() });

            if (!response.ok) {
                throw new Error(`Request failed with status code ${response.status}`);
            }

            const body: any = await response.json();

            if (body?.value) {

                result ??= [];
                result.push(...body.value);
            }

            const nextTableName = response.headers.get('x-ms-continuation-nexttablename');
            if (!nextTableName) {
                break;
            }

            url = `${this._tableEndpointUrl}Tables?NextTableName=${encodeURIComponent(nextTableName)}`;
        }

        if (result) {

            return this.getTaskHubNamesFromTableNames(result);
        }
    }

    private async getTaskHubNamesFromNetheriteStorage(getHeaders: () => Record<string, string> | Promise<Record<string, string>>): Promise<string[] | undefined> {

        try {

            const response = await fetch(`${this._tableEndpointUrl}DurableTaskPartitions()?$select=PartitionKey`, { headers: await getHeaders() });

            if (!response.ok) {
                return;
            }

            const body: any = await response.json();

            if (!body?.value) {
                return;
            }

            const partitionKeys: string[] = body.value.map((v: any) => v.PartitionKey);
            return partitionKeys.filter((name, index, self) => self.indexOf(name) === index);

        } catch {

            return;
        }
    }
}
