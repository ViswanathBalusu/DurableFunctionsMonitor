// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import * as vscode from 'vscode';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';

import { BackendProcess } from '../backend/BackendProcess';
import { getHubNameWithoutSchema } from '../backend/backendEnvironment';
import { BackendRequestError, isAllowedMethod, isSafeRequestPath, sendToBackend } from '../backend/BackendHttp';
import { StorageConnectionSettings } from '../connections/StorageConnectionSettings';
import { ConnStringUtils } from '../connections/ConnStringUtils';
import type { FunctionGraphList } from '../functionGraph/FunctionGraphList';
import { type TraversalResult, findFunctionOrProxy } from '../functionGraph/traversal';
import type { Log } from '../logging';
import { callArm, getArmToken, getAzureResources, getPortalUrl } from '../azure/azureResources';
import { createDfmWebview, looksLikeSvg, replyError, replyOk, saveWithDialog, showFunctionCode } from './dfmWebview';
import { toSaveFileName } from './fileNames';

// What a main panel knows about its UI: whether it has said that it is ready for the messages of the extension
type PanelState = { ready: boolean, pending?: any };

// Represents the main view, along with all detailed views
export class MonitorView {

    // Storage Connection settings (connString and hubName) of this Monitor View
    get storageConnectionSettings(): StorageConnectionSettings {
        return new StorageConnectionSettings(this._backend.storageConnectionString, this._hubName);
    }

    get isVisible(): boolean {
        return !!this._webViewPanel;
    }

    // Path to html statics
    get staticsFolder(): string {
        return path.join(this._backend.binariesFolder, 'DfmStatics');
    }

    constructor(private _context: vscode.ExtensionContext,
        private _backend: BackendProcess,
        private _hubName: string,
        private _functionGraphList: FunctionGraphList,
        private _getSubscriptionForConnectionString: (connString: string) => Promise<AzureSubscription | undefined>,
        private _onViewStatusChanged: () => void,
        private _log: Log,
        private _functionProjectPath?: string
    ) {
    }

    // Closes all WebViews
    cleanup(): void {

        for (const childPanel of this._childWebViewPanels) {
            childPanel.dispose();
        }
        this._childWebViewPanels = [];

        if (this._webViewPanel) {
            this._webViewPanel.dispose();
        }
    }

    // Shows or makes active the main view
    async show(messageToWebView: any = undefined): Promise<void> {

        if (this._webViewPanel) {

            this._webViewPanel.reveal();

            if (messageToWebView) {
                this.deliver(this._mainPanelState, this._webViewPanel.webview, messageToWebView);
            }

            return;
        }

        await this._backend.getBackend();

        this._mainPanelState = { ready: false, pending: messageToWebView };
        this._webViewPanel = this.showWebView('', this._mainPanelState);

        this._webViewPanel.onDidDispose(() => {
            this._webViewPanel = null;
            this._onViewStatusChanged();
        });
    }

    // Permanently deletes all underlying Storage resources for this Task Hub
    async deleteTaskHub(): Promise<void> {

        if (!this._backend.backendUrl) {
            throw new Error('Backend is not started');
        }

        await this.callBackend('POST', '/delete-task-hub', {});

        this.cleanup();
    }

    // Handles 'Goto instanceId...' context menu item
    async gotoInstanceId(): Promise<void> {

        const instanceId = await this.askForInstanceId();

        if (!instanceId) {
            return;
        }

        // Opening another WebView
        this._childWebViewPanels.push(this.showWebView(instanceId));
    }

    // Reference to the already opened WebView with the main page
    private _webViewPanel: vscode.WebviewPanel | null = null;

    private _mainPanelState: PanelState = { ready: false };

    // Reference to all child WebViews
    private _childWebViewPanels: vscode.WebviewPanel[] = [];

    // Functions and proxies currently shown
    private _traversalResult?: TraversalResult;

    private static readonly ViewType = 'durableFunctionsMonitor';

    // The key the UI's state is persisted under. It is what earlier versions used, so what was persisted stays.
    private static readonly GlobalStateName = MonitorView.ViewType + 'WebViewState';

    // Sends a message to the UI, as soon as the UI can take it. A UI that is not ready (it is still loading, or it is hidden
    // and was not given the chance to run) would miss it.
    private deliver(state: PanelState, webview: vscode.Webview, message: any): void {

        if (state.ready) {
            webview.postMessage(message);
        } else {
            state.pending = message;
        }
    }

    // Opens a WebView with main page or orchestration page in it
    private showWebView(orchestrationId: string = '', state?: PanelState): vscode.WebviewPanel {

        const panel = createDfmWebview({
            viewType: MonitorView.ViewType,
            title: (orchestrationId) ? `Instance '${orchestrationId}'` : `Durable Functions Monitor (${this.taskHubFullTitle})`,
            staticsFolder: this.staticsFolder,
            hubName: this.hubNameWithoutSchema,
            orchestrationId,
            // Also passing persisted settings via HTML
            state: this._context.globalState.get(MonitorView.GlobalStateName, {}),
            isFunctionGraphAvailable: !!this._functionProjectPath,
            viewMode: 0
        });

        // handle events from WebView
        panel.webview.onDidReceiveMessage(request => this.handleMessageFromWebView(panel.webview, request, state), undefined, this._context.subscriptions);

        return panel;
    }

    private get hubNameWithoutSchema(): string {
        return getHubNameWithoutSchema(this._hubName);
    }

    // Sends a request to the backend, on behalf of this view's Task Hub
    private callBackend(method: string, url: string, data?: unknown, hubName: string = this.hubNameWithoutSchema) {

        return sendToBackend({
            backendUrl: this._backend.backendUrl,
            hubName,
            method,
            url,
            data,
            nonce: this._backend.backendCommunicationNonce
        });
    }

    // Does communication between code in WebView and this class
    private handleMessageFromWebView(webView: vscode.Webview, request: any, state?: PanelState): void {

        if (!request || typeof request !== 'object') {
            return;
        }

        switch (request.method) {

            case 'IAmReady': {

                // Sending an initial message (if any), when the webView is ready
                if (state) {

                    state.ready = true;

                    if (state.pending) {
                        webView.postMessage(state.pending);
                        state.pending = undefined;
                    }
                }

                return;
            }
            case 'PersistState': {

                // Persisting state values
                const webViewState = this._context.globalState.get(MonitorView.GlobalStateName, {}) as any;
                webViewState[request.key] = request.data;
                this._context.globalState.update(MonitorView.GlobalStateName, webViewState);

                return;
            }
            case 'OpenInNewWindow': {

                if (typeof request.url !== 'string' || !request.url) {
                    replyError(webView, request, 'No instanceId');
                    return;
                }

                // Opening another WebView
                this._childWebViewPanels.push(this.showWebView(request.url));
                replyOk(webView, request);

                return;
            }
            case 'SaveAs': {

                // Just to be extra sure...
                if (!looksLikeSvg(request.data)) {
                    vscode.window.showErrorMessage(`Invalid data format. Save failed.`);
                    replyError(webView, request, 'Invalid data format');
                    return;
                }

                // Saving some file to local hard drive
                saveWithDialog(request.data, toSaveFileName(request.url, 'diagram', '.svg'), { 'SVG Images': ['svg'] })
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;
            }
            case 'SaveFunctionGraphAsJson': {

                if (!this._traversalResult) {
                    replyError(webView, request, 'There is no graph to save yet');
                    return;
                }

                saveWithDialog(JSON.stringify(this._traversalResult, null, 3), 'dfm-func-map.json', { 'JSON': ['json'] })
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;
            }
            case 'GotoFunctionCode': {

                showFunctionCode(findFunctionOrProxy(this._traversalResult, request.url))
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;
            }
            case 'GotoBinding': {

                const func = findFunctionOrProxy(this._traversalResult, request.url);
                const binding = func?.bindings?.[request.data];

                if (!binding) {
                    replyOk(webView, request);
                    return;
                }

                this.navigateToBinding(binding)
                    .catch(err => this._log(`Failed to navigate to binding. ${err.message ?? err}`))
                    .finally(() => replyOk(webView, request));

                return;
            }
            case 'Download': {

                if (!isSafeRequestPath(request.url)) {
                    replyError(webView, request, 'Invalid request');
                    return;
                }

                this.callBackend('POST', request.url, undefined, this.getRequestHubName(request))
                    .then(async response => {

                                                let fileName;
                        let filters;

                        if (response.contentType.startsWith('application/json')) {

                            fileName = toSaveFileName(request.data, 'download', '.json');
                            filters = { 'JSON Files': ['json'] };

                        } else if (response.contentType.startsWith('text/plain')) {

                            fileName = toSaveFileName(request.data, 'download', '.txt');
                            filters = { 'TXT Files': ['txt'] };

                        } else {

                            fileName = toSaveFileName(request.data, 'download', '.dat');
                            filters = { 'DAT Files': ['dat'] };
                        }

                        await saveWithDialog(response.bytes, fileName, filters);

                        replyOk(webView, request);
                    })
                    .catch(err => replyError(webView, request, err.message ?? String(err)));

                return;
            }
        }

        // Intercepting request for Function Map
        if (request.method === 'GET' && request.url === '/function-map') {

            if (!this._functionProjectPath) {
                return;
            }

            this._functionGraphList.traverseFunctions(this._functionProjectPath).then(result => {

                this._traversalResult = result;

                webView.postMessage({
                    id: request.id,
                    data: {
                        functions: result.functions,
                        proxies: result.proxies
                    }
                });

            }, err => {

                this._log(`Failed to traverse the functions of ${this._functionProjectPath}. ${err.message ?? err}`);

                // err might fail to serialize here, so passing err.message only
                webView.postMessage({ id: request.id, err: { message: err.message } });
            });

            return;
        }

        // Then it's just a propagated HTTP request. The UI is ours, but what it asks for is not trusted blindly:
        // it can only ask for what is below the Task Hub of this view.
        if (!isAllowedMethod(request.method) || !isSafeRequestPath(request.url)) {

            this._log(`Refused a request of the UI: ${String(request.method)} ${String(request.url)}`);
            replyError(webView, request, 'Invalid request');
            return;
        }

        this.callBackend(request.method, request.url, request.data, this.getRequestHubName(request))
            .then(response => {

                webView.postMessage({ id: request.id, data: response.data });

            }, err => {

                webView.postMessage({
                    id: request.id,
                    err: { message: err.message, response: { data: err instanceof BackendRequestError ? err.responseData : undefined } }
                });
            });
    }

    // The Task Hub name for a request of the UI
    private getRequestHubName(request: { method: string, url: string }): string {

        // Workaround for https://github.com/Azure/azure-functions-durable-extension/issues/1926
        if (this.hubNameWithoutSchema === 'TestHubName' && request.method === 'POST' && /\/(orchestrations|restart)$/i.test(request.url)) {

            // Turning task hub name into lower case, this allows to bypass function name validation
            return 'testhubname';
        }

        return this.hubNameWithoutSchema;
    }

    private askForInstanceId(): Promise<string> {
        return new Promise<string>(resolve => {

            let instanceId = '';
            const instanceIdPick = vscode.window.createQuickPick();

            instanceIdPick.onDidHide(() => {

                instanceIdPick.dispose();
                resolve('');
            });

            instanceIdPick.onDidChangeSelection(items => {
                if (!!items && !!items.length) {
                    instanceId = items[0].label;
                }
            });

            // Still allowing to type free text
            instanceIdPick.onDidChangeValue(value => {
                instanceId = value;

                // Loading suggestions from backend
                if (instanceId.length > 1) {
                    this.getInstanceIdSuggestions(instanceId).then(suggestions => {

                        instanceIdPick.items = suggestions.map(id => {
                            return { label: id };
                        });
                    }, err => this._log(`Failed to load instanceId suggestions. ${err.message ?? err}`));
                } else {
                    instanceIdPick.items = [];
                }
            });

            instanceIdPick.onDidAccept(() => {

                instanceIdPick.hide();
                resolve(instanceId);
            });

            instanceIdPick.title = `(${this.taskHubFullTitle}) instanceId to go to:`;

            instanceIdPick.show();
        });
    }

    // Human-readable TaskHub title in form '[storage-account]/[task-hub]'
    private get taskHubFullTitle(): string {

        return `${ConnStringUtils.GetStorageName(this._backend.storageConnectionString)}/${this._hubName}`;
    }

    // Returns orchestration/entity instanceIds that start with prefix
    private async getInstanceIdSuggestions(prefix: string): Promise<string[]> {

        // The prefix is typed by the user, and ends up inside of a route: the quote that closes it has to be encoded too
        const encoded = encodeURIComponent(prefix).replace(/'/g, '%27');

        const response = await this.callBackend('GET', `/id-suggestions(prefix='${encoded}')`);
        return response.data as string[];
    }

    private async navigateToBinding(binding: any): Promise<void> {

        const subscription = await this._getSubscriptionForConnectionString(this._backend.storageConnectionString);
        if (!subscription) {
            return;
        }

        const storageAccountName = ConnStringUtils.GetAccountName(this._backend.storageConnectionString);

        switch (binding.type) {

            case 'blob':
            case 'blobTrigger': {

                if (!storageAccountName) {
                    return;
                }

                const blobPath = binding.blobPath ?? (binding.path ?? '');

                await this.navigateToStorageBlob(subscription, storageAccountName, blobPath);
            }
            break;
            case 'queue':
            case 'queueTrigger': {

                if (!storageAccountName) {
                    return;
                }

                await this.navigateToStorageQueue(subscription, storageAccountName, binding.queueName);
            }
            break;
            case 'table': {

                if (!storageAccountName) {
                    return;
                }

                await this.navigateToStorageTable(subscription, storageAccountName, binding.tableName);
            }
            break;
            case 'serviceBus':
            case 'serviceBusTrigger': {

                const queueOrTopicName =
                    binding.queueOrTopicName ?? (
                        binding.queueName ?? (
                            binding.topicName ?? ''));

                await this.navigateToServiceBusQueueOrTopic(subscription, queueOrTopicName);
            }
            break;
            case 'eventHub':
            case 'eventHubTrigger': {

                await this.navigateToEventHub(subscription, binding.eventHubName);
            }
            break;
        }
    }

    private async findStorageAccountId(subscription: AzureSubscription, storageAccountName: string): Promise<string | undefined> {

        const storageAccounts = await getAzureResources(subscription, 'microsoft.storage/storageaccounts', storageAccountName.toLowerCase()) as { id: string }[];

        return storageAccounts.length === 1 ? storageAccounts[0].id : undefined;
    }

    private async navigateToStorageBlob(subscription: AzureSubscription, storageAccountName: string, blobPath: string): Promise<void> {

        const storageAccountId = await this.findStorageAccountId(subscription, storageAccountName);
        if (!storageAccountId) {
            return;
        }

        const portalUrl = `${getPortalUrl(subscription)}/#view/Microsoft_Azure_Storage/ContainerMenuBlade/~/overview/storageAccountId/${encodeURIComponent(storageAccountId)}/path/${blobPath}`;

        await vscode.env.openExternal(vscode.Uri.parse(portalUrl));
    }

    private async navigateToStorageQueue(subscription: AzureSubscription, storageAccountName: string, queueName: string): Promise<void> {

        const storageAccountId = await this.findStorageAccountId(subscription, storageAccountName);
        if (!storageAccountId) {
            return;
        }

        const portalUrl = `${getPortalUrl(subscription)}/#view/Microsoft_Azure_Storage/QueueMenuBlade/~/overview/storageAccountId/${encodeURIComponent(storageAccountId)}/queueName/${queueName}`;

        await vscode.env.openExternal(vscode.Uri.parse(portalUrl));
    }

    private async navigateToStorageTable(subscription: AzureSubscription, storageAccountName: string, tableName: string): Promise<void> {

        const storageAccountId = await this.findStorageAccountId(subscription, storageAccountName);
        if (!storageAccountId) {
            return;
        }

        // Using Azure Storage extension for this, since it is not (yet) possible to navigate to a Storage Table in portal
        const storageExt = vscode.extensions.getExtension('ms-azuretools.vscode-azurestorage');
        if (!storageExt) {
            return;
        }

        if (!storageExt.isActive) {
            await storageExt.activate();
        }

        await vscode.commands.executeCommand('azureStorage.openTable', {

            root: {
                storageAccountId,
                // This works with older versions of Azure Storage ext
                subscriptionId: subscription.subscriptionId
            },

            subscription: {
                // This works with newer versions of Azure Storage ext
                subscriptionId: subscription.subscriptionId
            },

            tableName
        });
    }

    private async navigateToServiceBusQueueOrTopic(subscription: AzureSubscription, queueOrTopicName: string): Promise<void> {

        const namespaces = await getAzureResources(subscription, 'microsoft.servicebus/namespaces') as { id: string, name: string, sku: any, location: string }[];
        if (!namespaces.length) {
            return;
        }

        const accessToken = await getArmToken(subscription);

        const promises = namespaces.map(async ns => {

            const queuesPromise = callArm(subscription, 'GET', `${ns.id}/queues?api-version=2017-04-01`, accessToken);
            const topicsPromise = callArm(subscription, 'GET', `${ns.id}/topics?api-version=2017-04-01`, accessToken);

            const queues: { id: string, name: string }[] = ((await queuesPromise)?.value) ?? [];
            const topics: { id: string, name: string }[] = ((await topicsPromise)?.value) ?? [];

            const matchedQueue = queues.find(q => q.name.toLowerCase() === queueOrTopicName.toLowerCase());
            const matchedTopic = topics.find(t => t.name.toLowerCase() === queueOrTopicName.toLowerCase());

            return {
                name: ns.name,
                location: ns.location,
                sku: ns.sku,
                matchedQueueId: matchedQueue ? matchedQueue.id : '',
                matchedTopicId: matchedTopic ? matchedTopic.id : '',
            };
        });

        const namespacesContainingThisName = (await Promise.all(promises))
            .filter(i => !!i.matchedQueueId || !!i.matchedTopicId);

        let namespace: { matchedQueueId: string, matchedTopicId: string } | undefined;

        if (namespacesContainingThisName.length > 1) {

            // Asking user to resolve namespace ambiguity
            namespace = await vscode.window.showQuickPick(namespacesContainingThisName.map(ns => {

                return {
                    label: ns.name,
                    description: `location: ${ns.location}, SKU: ${ns.sku?.name}`,
                    matchedQueueId: ns.matchedQueueId,
                    matchedTopicId: ns.matchedTopicId,
                };

            }), { title: `"${queueOrTopicName}" is present in multiple Service Bus namespaces. Pick up the namespace to navigate to.` });

            if (!namespace) {
                return;
            }

        } else if (namespacesContainingThisName.length === 1) {

            namespace = namespacesContainingThisName[0];

        } else {
            return;
        }

        // An empty string is no id: a queue that was not found leaves one, and then it is the topic that matched
        const resourceId = namespace.matchedQueueId || namespace.matchedTopicId;
        const portalUrl = `${getPortalUrl(subscription)}/#@${subscription.tenantId}/resource/${resourceId}`;

        await vscode.env.openExternal(vscode.Uri.parse(portalUrl));
    }

    private async navigateToEventHub(subscription: AzureSubscription, hubName: string): Promise<void> {

        const namespaces = await getAzureResources(subscription, 'microsoft.eventhub/namespaces') as { id: string, name: string, sku: any, location: string }[];
        if (!namespaces.length) {
            return;
        }

        const accessToken = await getArmToken(subscription);

        const promises = namespaces.map(async ns => {

            const hubsResponse = await callArm(subscription, 'GET', `${ns.id}/eventhubs?api-version=2017-04-01`, accessToken);

            const hubs: { id: string, name: string }[] = (hubsResponse?.value) ?? [];

            const matchedHub = hubs.find(q => q.name.toLowerCase() === hubName.toLowerCase());

            return {
                name: ns.name,
                location: ns.location,
                sku: ns.sku,
                matchedHubId: matchedHub ? matchedHub.id : '',
            };
        });

        const namespacesContainingThisName = (await Promise.all(promises))
            .filter(i => !!i.matchedHubId);

        let namespace: { matchedHubId: string } | undefined;

        if (namespacesContainingThisName.length > 1) {

            // Asking user to resolve namespace ambiguity
            namespace = await vscode.window.showQuickPick(namespacesContainingThisName.map(ns => {

                return {
                    label: ns.name,
                    description: `location: ${ns.location}, SKU: ${ns.sku?.name}`,
                    matchedHubId: ns.matchedHubId,
                };

            }), { title: `"${hubName}" is present in multiple Event Hub namespaces. Pick up the namespace to navigate to.` });

            if (!namespace) {
                return;
            }

        } else if (namespacesContainingThisName.length === 1) {

            namespace = namespacesContainingThisName[0];

        } else {
            return;
        }

        const portalUrl = `${getPortalUrl(subscription)}/#@${subscription.tenantId}/resource/${namespace.matchedHubId}`;

        await vscode.env.openExternal(vscode.Uri.parse(portalUrl));
    }
}
