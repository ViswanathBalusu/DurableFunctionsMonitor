// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ExtensionTestApi } from '../../src/extension';

// These run inside of a real VsCode, with the built extension (npm run build first). The Azure Functions Core Tools
// are a stand-in (fixtures/fake-func.cjs): it answers where the real backend answers, and checks the nonce.

const ExtensionId = 'DurableFunctionsMonitor.durablefunctionsmonitor-reimagined';
const Section = 'durableFunctionsMonitor';

const repoRoot = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

let api: ExtensionTestApi;
let temp: string;

// Settings that are machine-scoped can only be written at the user level
const config = () => vscode.workspace.getConfiguration(Section);
const setUserSetting = (name: string, value: unknown) => config().update(name, value, vscode.ConfigurationTarget.Global);

// A func that is a program: a .cmd on Windows (which is how npm installs one, and how Node can only start it through a shell), a script elsewhere
function createFakeFunc(folder: string): string {

    const script = path.join(repoRoot, 'test', 'integration', 'fixtures', 'fake-func.cjs');

    if (process.platform === 'win32') {

        const cmd = path.join(folder, 'func.cmd');
        fs.writeFileSync(cmd, `@echo off\r\nnode "${script}" %*\r\n`);
        return cmd;
    }

    const sh = path.join(folder, 'func');
    fs.writeFileSync(sh, `#!/bin/sh\nexec node "${script}" "$@"\n`, { mode: 0o755 });
    return sh;
}

// A folder the backend is started from: it needs the UI, like the real one has
function createBackendFolder(folder: string): string {

    const backend = path.join(folder, 'backend');
    const statics = path.join(backend, 'DfmStatics');
    fs.mkdirSync(statics, { recursive: true });

    // The UI as it is built right now, if it is. That is the one the placeholders have to fit.
    const builtUi = path.join(repoRoot, '..', 'durablefunctionsmonitor.svelte', 'build');

    if (fs.existsSync(path.join(builtUi, 'index.html'))) {
        fs.cpSync(builtUi, statics, { recursive: true });
    } else {
        fs.writeFileSync(path.join(statics, 'index.html'), '<!doctype html><html><head><title>DFM</title></head><body><script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script><script>var DfmClientConfig={}</script></body></html>');
    }

    return backend;
}

function readFakeFuncLog(file: string): any[] {

    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

async function waitFor(condition: () => boolean, what: string, timeoutInMs = 20000): Promise<void> {

    const deadline = Date.now() + timeoutInMs;
    while (!condition()) {

        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const findDfmTabs = () => vscode.window.tabGroups.all
    .flatMap(g => g.tabs)
    .filter(t => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('durableFunctionsMonitor'));

suite('Durable Functions Monitor', () => {

    suiteSetup(async () => {

        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-integration-'));

        const extension = vscode.extensions.getExtension(ExtensionId);
        assert.ok(extension, `${ExtensionId} is not loaded`);

        api = await extension.activate();
    });

    suiteTeardown(async () => {

        await api.treeDataProvider.cleanup();

        for (const name of ['customPathToAzureFunctionsHost', 'customPathToBackendBinaries']) {
            await setUserSetting(name, undefined);
        }

        fs.rmSync(temp, { recursive: true, force: true });
    });

    test('is active', () => {

        assert.ok(vscode.extensions.getExtension(ExtensionId)!.isActive);
    });

    test('registers every command of the manifest, and the views of the container', async () => {

        const registered = new Set(await vscode.commands.getCommands(true));

        for (const { command } of manifest.contributes.commands) {
            assert.ok(registered.has(command), `${command} is declared in package.json, and nothing handles it`);
        }

        // VsCode makes these for a container and a view that are contributed
        assert.ok(registered.has('workbench.view.extension.durableFunctionsMonitor'), 'the activity bar container is not there');
        assert.ok(registered.has('durableFunctionsMonitorTreeView.focus'), 'the view is not there');
    });

    test('has the settings of the manifest, with the defaults of the manifest', () => {

        for (const [key, property] of Object.entries(manifest.contributes.configuration.properties as { [key: string]: { default?: unknown, type: string } })) {

            const name = key.substring(`${Section}.`.length);
            const inspected = config().inspect(name);

            assert.ok(inspected, `${key} is not a setting`);

            // A string setting that declares no default is an empty string to VsCode
            assert.deepStrictEqual(inspected.defaultValue, property.default ?? (property.type === 'string' ? '' : undefined), key);
        }
    });

    test('does not let a workspace choose what is run', async () => {

        // Machine settings cannot be written to a workspace. That is the point of them.
        await assert.rejects(async () => { await config().update('customPathToAzureFunctionsHost', 'C:\\evil\\func.exe', vscode.ConfigurationTarget.Workspace); });
        await assert.rejects(async () => { await config().update('customPathToBackendBinaries', '/tmp/evil', vscode.ConfigurationTarget.Workspace); });
    });

    test('shows the project of the workspace, with the Task Hub its files name', async () => {

        const root = await api.treeDataProvider.getChildren();
        assert.deepStrictEqual(root.map(n => n.contextValue), ['subscriptions', 'connectionStrings', 'localProject', 'storageEmulator']);

        const project = await api.treeDataProvider.getChildren(root[2]);
        assert.strictEqual(project.length, 1);
        assert.strictEqual(project[0].label, 'FixtureHub');
        assert.strictEqual(project[0].contextValue, 'taskHub-detached');
    });

    test('tells that there is no emulator, instead of failing, when nothing listens where the emulator should', async () => {

        // Nothing listens on the default ports of a machine that runs the tests
        const root = await api.treeDataProvider.getChildren();
        const emulator = await api.treeDataProvider.getChildren(root.find(n => n.contextValue === 'storageEmulator'));

        assert.strictEqual(emulator.length, 1);
        assert.match(String(emulator[0].label), /No Task Hubs found|Failed to load Task Hubs/);
    });

    test('has nothing stored to begin with, and offers to attach', async () => {

        const root = await api.treeDataProvider.getChildren();
        const stored = await api.treeDataProvider.getChildren(root.find(n => n.contextValue === 'connectionStrings'));

        assert.strictEqual(stored.length, 1);
        assert.strictEqual(stored[0].label, 'Attach to Task Hub...');
    });

    test('starts the backend, finds it where the backend serves its API, and opens the monitor', async function () {

        const fakeFuncFolder = path.join(temp, 'fake-func');
        fs.mkdirSync(fakeFuncFolder);

        const logFile = path.join(temp, 'fake-func.log');
        process.env['FAKE_FUNC_LOG'] = logFile;

        await setUserSetting('customPathToAzureFunctionsHost', createFakeFunc(fakeFuncFolder));
        await setUserSetting('customPathToBackendBinaries', createBackendFolder(temp));

        // The Task Hub of the project of the workspace
        const root = await api.treeDataProvider.getChildren();
        const project = await api.treeDataProvider.getChildren(root.find(n => n.contextValue === 'localProject'));

        assert.strictEqual(findDfmTabs().length, 0, 'there is a monitor open already');

        await api.treeDataProvider.attachToTaskHub(project[0] as any);

        // The monitor is open
        await waitFor(() => findDfmTabs().length === 1, 'the monitor to open');
        assert.match(findDfmTabs()[0].label, /Durable Functions Monitor \(.*FixtureHub\)/);

        // What the backend saw
        const log = readFakeFuncLog(logFile);

        const started = log.find(e => e.event === 'start');
        assert.ok(started, 'the backend was not started');
        assert.strictEqual(started.workerRuntime, 'dotnet-isolated');
        assert.strictEqual(started.hasNonce, true);
        assert.ok(started.port >= 37072 && started.port <= 38000, `port ${started.port} is not in the default range`);
        // UseDevelopmentStorage=true of local.settings.json is expanded to what the emulator is
        assert.match(started.storage, /AccountName=devstoreaccount1/);

        const about = log.filter(e => e.event === 'request' && e.url.endsWith('/--FixtureHub/about'));
        assert.ok(about.length > 0, 'the backend was never asked whether it is ready, on the URL it serves');
        assert.ok(about.some(e => e.authorized), 'the nonce did not go with the request');
        assert.ok(about[0].url.startsWith('/durable-functions-monitor/a/p/i/'), about[0].url);

        // Closing everything stops the backend, with whatever it started
        await api.treeDataProvider.cleanup();
        await waitFor(() => !isAlive(started.pid), 'the backend to stop', 15000);
    });

    test('says what is wrong, when the path to func leads nowhere', async () => {

        await setUserSetting('customPathToAzureFunctionsHost', path.join(temp, 'no-such-func'));

        const root = await api.treeDataProvider.getChildren();
        const project = await api.treeDataProvider.getChildren(root.find(n => n.contextValue === 'localProject'));

        const before = findDfmTabs().length;

        // The error is shown to the user, and the monitor is not opened
        await api.treeDataProvider.attachToTaskHub(project[0] as any);

        assert.strictEqual(findDfmTabs().length, before);
    });
});
