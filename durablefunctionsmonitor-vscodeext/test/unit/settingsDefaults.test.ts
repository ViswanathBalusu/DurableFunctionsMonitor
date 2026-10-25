// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'vitest';

import { SettingsDefaults } from '../../src/settingsDefaults';

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
const properties = manifest.contributes.configuration.properties as { [name: string]: { default?: unknown, scope?: string, type: string } };

describe('settings', () => {

    test('the defaults in code are the defaults of package.json', () => {

        for (const [name, defaultValue] of Object.entries(SettingsDefaults)) {

            const property = properties[`durableFunctionsMonitor.${name}`];

            expect(property, `package.json has no setting ${name}`).toBeDefined();

            // A string setting without a default has none: the empty string of the code is that
            expect(property.default ?? '', name).toEqual(defaultValue);
        }
    });

    test('package.json has no setting the code does not know', () => {

        const known = new Set(Object.keys(SettingsDefaults).map(n => `durableFunctionsMonitor.${n}`));

        expect(Object.keys(properties).filter(n => !known.has(n))).toEqual([]);
    });

    test('a workspace cannot choose what is run: the paths to executables and the backend are machine settings', () => {

        // A folder somebody else made must not be able to point the extension to a program of its own just by being opened
        for (const name of ['customPathToAzureFunctionsHost', 'customPathToBackendBinaries', 'backendBaseUrl', 'coreTools.download']) {
            expect(properties[`durableFunctionsMonitor.${name}`].scope, name).toBe('machine');
        }
    });
});

describe('the manifest', () => {

    test('every command that is in a menu or in the code is declared', () => {

        const declared = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));

        for (const menu of Object.values(manifest.contributes.menus) as { command: string }[][]) {
            for (const item of menu) {
                expect(declared.has(item.command), item.command).toBe(true);
            }
        }
    });

    test('commands that only make sense in the context menu of the tree are not in the command palette', () => {

        const hidden = new Set((manifest.contributes.menus.commandPalette as { command: string, when: string }[]).filter(i => i.when === 'false').map(i => i.command));

        for (const command of ['attachToTaskHub', 'detachFromTaskHub', 'deleteTaskHub', 'purgeHistory', 'cleanEntityStorage', 'batchOps', 'gotoInstanceId', 'startNewInstance', 'forgetConnectionString']) {
            expect(hidden.has(`durableFunctionsMonitorTreeView.${command}`), command).toBe(true);
        }
    });

    test('the view lives in a container this extension contributes, not in one that needs another extension', () => {

        const containers = Object.keys(manifest.contributes.views);
        const own = manifest.contributes.viewsContainers.activitybar.map((c: { id: string }) => c.id);

        for (const container of containers) {
            expect(own).toContain(container);
        }

        // The icon of the container exists
        for (const container of manifest.contributes.viewsContainers.activitybar) {
            expect(fs.existsSync(path.resolve(__dirname, '../..', container.icon)), container.icon).toBe(true);
        }
    });

    test('does not list activation events VsCode generates from the contributions', () => {

        expect((manifest.activationEvents as string[]).filter(e => e.startsWith('onCommand:') || e.startsWith('onView:'))).toEqual([]);
    });

    test('is packaged from the bundle, which exists after a build', () => {

        expect(manifest.main).toBe('./dist/extension.js');
    });

    test('has the same version as the UI and the backends are built with', () => {

        const props = fs.readFileSync(path.resolve(__dirname, '../../../Directory.Build.props'), 'utf8');
        const prefix = /<VersionPrefix>([^<]+)<\/VersionPrefix>/.exec(props)?.[1];

        // build.yml stamps it for a release, but what is checked in should not be left behind
        expect(manifest.version).toBe(prefix);
    });
});
