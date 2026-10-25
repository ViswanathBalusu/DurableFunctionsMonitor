// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, test } from 'vitest';

import { SettingsDefaults } from '../../src/settingsDefaults';
import { type ConfigureEmulatorUi, type ConfigureOutcome, type PickChoice, configureEmulator } from '../../src/setup/configureEmulator';
import { buildEmulatorConnectionString, portsFromBlobPort } from '../../src/setup/emulator';
import type { EmulatorState } from '../../src/setup/probe';

// A person who answers what is planned, and a settings.json that remembers what it was told
function scenario(answers: { pick?: PickChoice, input?: string }, state: EmulatorState = 'listening') {

    const seen = {
        placeHolder: '',
        choices: [] as string[],
        inputOptions: undefined as { prompt: string, value: string, validateInput: (text: string) => string | undefined } | undefined,
        reports: [] as ConfigureOutcome[],
        saved: [] as (string | undefined)[],
        probed: [] as string[]
    };

    const ui: ConfigureEmulatorUi = {
        pick: async (choices, placeHolder) => { seen.placeHolder = placeHolder; seen.choices = choices.map(c => c.choice); return answers.pick; },
        input: async options => { seen.inputOptions = options; return answers.input; },
        report: outcome => seen.reports.push(outcome)
    };

    const save = async (connString: string | undefined) => { seen.saved.push(connString); };
    const probe = async (connString: string) => { seen.probed.push(connString); return state; };

    return { seen, run: (current: string) => configureEmulator(current, ui, save, probe) };
}

describe('configureEmulator', () => {

    test('stores nothing when the person gives up on the question of which ports', async () => {

        const { seen, run } = scenario({ pick: undefined });

        expect(await run(SettingsDefaults.storageEmulatorConnectionString)).toEqual({ changed: false });
        expect(seen.saved).toEqual([]);
        expect(seen.reports).toEqual([]);
    });

    test('stores nothing when the person gives up on the port', async () => {

        const { seen, run } = scenario({ pick: 'other', input: undefined });

        expect(await run(SettingsDefaults.storageEmulatorConnectionString)).toEqual({ changed: false });
        expect(seen.saved).toEqual([]);
    });

    test('takes the setting away for the default ports, so that the default applies', async () => {

        const { seen, run } = scenario({ pick: 'default' });
        const current = buildEmulatorConnectionString(portsFromBlobPort(11000));

        const result = await run(current);

        expect(seen.saved).toEqual([undefined]);
        expect(result).toMatchObject({ changed: true, connString: undefined, outcome: { ports: { blob: 10000, queue: 10001, table: 10002 }, azuriteCommand: 'azurite' } });

        // The default is what is looked for now
        expect(seen.probed).toEqual([SettingsDefaults.storageEmulatorConnectionString]);
    });

    test('stores the connection string of the ports after the first one, and says how to start Azurite there', async () => {

        const { seen, run } = scenario({ pick: 'other', input: ' 11000 ' }, 'not listening');

        const result = await run(SettingsDefaults.storageEmulatorConnectionString);

        const expected = buildEmulatorConnectionString({ blob: 11000, queue: 11001, table: 11002 });

        expect(seen.saved).toEqual([expected]);
        expect(seen.probed).toEqual([expected]);
        expect(seen.reports).toEqual([{
            ports: { blob: 11000, queue: 11001, table: 11002 },
            state: 'not listening',
            azuriteCommand: 'azurite --blobPort 11000 --queuePort 11001 --tablePort 11002'
        }]);
        expect(result).toMatchObject({ changed: true, connString: expected });
    });

    test('offers the port it looks on now, and the default when it looks on the default', async () => {

        const custom = scenario({ pick: 'other', input: '11000' });
        await custom.run(buildEmulatorConnectionString(portsFromBlobPort(12000)));
        expect(custom.seen.inputOptions?.value).toBe('12000');

        const standard = scenario({ pick: 'other', input: '11000' });
        await standard.run(SettingsDefaults.storageEmulatorConnectionString);
        expect(standard.seen.inputOptions?.value).toBe('10000');
    });

    test('tells where it looks now, in the question', async () => {

        const { seen, run } = scenario({ pick: undefined });

        await run(buildEmulatorConnectionString(portsFromBlobPort(11000)));

        expect(seen.placeHolder).toContain('127.0.0.1:11000-11002');
        expect(seen.choices).toEqual(['default', 'other']);
    });

    test('lets the input box refuse a port', async () => {

        const { seen, run } = scenario({ pick: 'other', input: '11000' });

        await run(SettingsDefaults.storageEmulatorConnectionString);

        expect(seen.inputOptions?.validateInput('abc')).toMatch(/number/);
        expect(seen.inputOptions?.validateInput('11000')).toBeUndefined();
    });
});
