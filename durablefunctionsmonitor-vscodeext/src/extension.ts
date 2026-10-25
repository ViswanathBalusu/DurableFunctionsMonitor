// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';

import { DotnetRuntimeService } from './backend/DotnetRuntimeService';
import { CoreToolsService } from './coreTools/CoreToolsService';
import { FunctionGraphList } from './functionGraph/FunctionGraphList';
import type { Log } from './logging';
import { SetupService } from './setup/SetupService';
import { MonitorTreeDataProvider } from './views/MonitorTreeDataProvider';

// What activate() hands out. Not an API for other extensions: the integration tests need to get at the tree, which VsCode gives
// no way to read from the outside.
export type ExtensionTestApi = {
    treeDataProvider: MonitorTreeDataProvider;
};

let monitorTreeDataProvider: MonitorTreeDataProvider | undefined;
let functionGraphList: FunctionGraphList | undefined;

// Name for our logging OutputChannel
const OutputChannelName = 'Durable Functions Monitor';

export function activate(context: vscode.ExtensionContext): ExtensionTestApi {

    // For logging
    const logChannel = vscode.window.createOutputChannel(OutputChannelName, { log: true });
    context.subscriptions.push(logChannel);

    const log: Log = line => logChannel.info(line.trimEnd());

    const azureProvider = new VSCodeAzureSubscriptionProvider(logChannel);

    const coreTools = new CoreToolsService(context, log);
    const dotnet = new DotnetRuntimeService(context.extension.id, log);

    const graphList = functionGraphList = new FunctionGraphList(context, log);
    const setup = new SetupService(context, coreTools, log);
    const treeProvider = monitorTreeDataProvider = new MonitorTreeDataProvider(azureProvider, context, graphList, coreTools, dotnet, setup, log);

    // A command that fails says so, instead of leaving the user with a command that did nothing
    const register = (command: string, handler: (...args: any[]) => any) => {

        return vscode.commands.registerCommand(command, async (...args: any[]) => {

            try {
                return await handler(...args);
            } catch (err: any) {

                log(`${command} failed. ${err?.stack ?? err}`);
                vscode.window.showErrorMessage(err?.message ?? String(err));
            }
        });
    };

    context.subscriptions.push(

        treeProvider,
        azureProvider,

        vscode.debug.onDidStartDebugSession(() => treeProvider.handleOnDebugSessionStarted()),

        vscode.window.registerTreeDataProvider('durableFunctionsMonitorTreeView', treeProvider),

        register('durable-functions-monitor.signInToAzure',
            async () => {
                await azureProvider.signIn();
                treeProvider.refresh();
            }),

        register('durable-functions-monitor.durableFunctionsMonitor',
            () => treeProvider.createOrActivateMonitorView(false)),

        register('durable-functions-monitor.durableFunctionsMonitorPurgeHistory',
            () => treeProvider.createOrActivateMonitorView(false, { id: 'purgeHistory' })),

        register('durable-functions-monitor.durableFunctionsMonitorCleanEntityStorage',
            () => treeProvider.createOrActivateMonitorView(false, { id: 'cleanEntityStorage' })),

        register('durable-functions-monitor.durableFunctionsMonitorBatchOps',
            () => treeProvider.createOrActivateMonitorView(false, { id: 'batchOps' })),

        register('durable-functions-monitor.durableFunctionsMonitorGotoInstanceId',
            () => treeProvider.gotoInstanceId(null)),

        register('durable-functions-monitor.durableFunctionsMonitorVisualizeAsGraph',
            (item) => graphList.visualize(item)),

        register('durable-functions-monitor.installCoreTools',
            async () => {

                const funcPath = await coreTools.installNow();
                vscode.window.showInformationMessage(`Azure Functions Core Tools are ready: ${funcPath}`);
            }),

        register('durable-functions-monitor.showLog',
            () => logChannel.show()),

        register('durable-functions-monitor.openSettings',
            (setting?: string) => setup.openSettings(typeof setting === 'string' ? setting : undefined)),

        register('durable-functions-monitor.configureStorageEmulator',
            () => setup.configureStorageEmulator()),

        register('durable-functions-monitor.openDotnetDownload',
            (needed?: string) => setup.openDotnetDownload(typeof needed === 'string' ? needed : undefined)),

        register('durableFunctionsMonitorTreeView.purgeHistory',
            (item) => treeProvider.attachToTaskHub(item, { id: 'purgeHistory' })),

        register('durableFunctionsMonitorTreeView.cleanEntityStorage',
            (item) => treeProvider.attachToTaskHub(item, { id: 'cleanEntityStorage' })),

        register('durableFunctionsMonitorTreeView.batchOps',
            (item) => treeProvider.attachToTaskHub(item, { id: 'batchOps' })),

        register('durableFunctionsMonitorTreeView.startNewInstance',
            (item) => treeProvider.attachToTaskHub(item, { id: 'startNewInstance' })),

        register('durableFunctionsMonitorTreeView.attachToTaskHub',
            (item) => treeProvider.attachToTaskHub(item)),

        register('durableFunctionsMonitorTreeView.detachFromTaskHub',
            (item) => treeProvider.detachFromTaskHub(item)),

        register('durableFunctionsMonitorTreeView.deleteTaskHub',
            (item) => treeProvider.deleteTaskHub(item)),

        register('durableFunctionsMonitorTreeView.gotoInstanceId',
            (item) => treeProvider.gotoInstanceId(item)),

        register('durableFunctionsMonitorTreeView.refresh',
            () => treeProvider.refresh()),

        register('durableFunctionsMonitorTreeView.attachToAnotherTaskHub',
            () => treeProvider.createOrActivateMonitorView(true)),

        register('durableFunctionsMonitorTreeView.detachFromAllTaskHubs',
            () => treeProvider.detachFromAllTaskHubs()),

        register('durableFunctionsMonitorTreeView.openInstancesInStorageExplorer',
            (item) => treeProvider.openTableInStorageExplorer(item, 'Instances')),

        register('durableFunctionsMonitorTreeView.openHistoryInStorageExplorer',
            (item) => treeProvider.openTableInStorageExplorer(item, 'History')),

        register('durableFunctionsMonitorTreeView.forgetConnectionString',
            (item) => treeProvider.forgetConnectionString(item)),
    );

    return { treeDataProvider: treeProvider };
}

// Stops the backends (and everything they started), and closes the views. VsCode waits for this to finish, but not for long.
export async function deactivate(): Promise<void> {

    await Promise.allSettled([
        functionGraphList?.cleanup(),
        monitorTreeDataProvider?.cleanup()
    ]);
}
