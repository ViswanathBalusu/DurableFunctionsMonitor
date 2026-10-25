// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
    type EmulatorPorts, DefaultEmulatorPorts, buildEmulatorConnectionString, formatEndpoints, getAzuriteCommand,
    isDefaultEmulatorConnectionString, parseEmulatorEndpoints, portsFromBlobPort, validateBlobPort
} from './emulator';
import { type EmulatorState, probeEmulator } from './probe';

// The command that says where the local Storage emulator is. The questions go through `ui`, so that this runs without VsCode.

export type PickChoice = 'default' | 'other';

export type ConfigureEmulatorUi = {

    // Returns the choice, or undefined if the person gave up
    pick: (choices: { choice: PickChoice, label: string, description: string, detail: string }[], placeHolder: string) => PromiseLike<PickChoice | undefined>;

    // Returns the text, or undefined if the person gave up
    input: (options: { prompt: string, value: string, validateInput: (text: string) => string | undefined }) => PromiseLike<string | undefined>;

    // Says where the emulator is now looked for, and whether it is there
    report: (outcome: ConfigureOutcome) => void;
};

export type ConfigureOutcome = {
    ports: EmulatorPorts;
    state: EmulatorState;

    // What starts an emulator there
    azuriteCommand: string;
};

// The result of asking
export type ConfigureResult =
    | { changed: false }
    | { changed: true, connString: string | undefined, outcome: ConfigureOutcome };

export async function configureEmulator(
    current: string,
    ui: ConfigureEmulatorUi,
    // Stores the connection string. Undefined takes the setting away, which brings the default back.
    save: (connString: string | undefined) => PromiseLike<void>,
    probe: (connString: string) => Promise<EmulatorState> = connString => probeEmulator(parseEmulatorEndpoints(connString))
): Promise<ConfigureResult> {

    const now = parseEmulatorEndpoints(current);
    const isDefault = isDefaultEmulatorConnectionString(current);

    const choice = await ui.pick([
        {
            choice: 'default',
            label: `Azurite's default ports`,
            description: `${DefaultEmulatorPorts.blob}, ${DefaultEmulatorPorts.queue}, ${DefaultEmulatorPorts.table}`,
            detail: isDefault ? 'This is what is set now.' : 'Takes the setting away, so that the default applies.'
        },
        {
            choice: 'other',
            label: 'Other ports...',
            description: 'when something else uses the default ones',
            detail: 'Windows reserves some ranges of ports, and nothing can listen on them: netsh int ipv4 show excludedportrange protocol=tcp'
        }
    ], `Where is the Storage emulator? Now: ${formatEndpoints(now) || 'nowhere in particular'}`);

    if (!choice) {
        return { changed: false };
    }

    let connString: string | undefined;
    let ports: EmulatorPorts;

    if (choice === 'default') {

        connString = undefined;
        ports = DefaultEmulatorPorts;

    } else {

        const first = await ui.input({
            prompt: `The port of the blob service. Azurite's queue and table services follow it: the next two ports.`,
            value: String(now.blob?.port ?? DefaultEmulatorPorts.blob),
            validateInput: validateBlobPort
        });

        if (first === undefined) {
            return { changed: false };
        }

        ports = portsFromBlobPort(Number(first.trim()));
        connString = buildEmulatorConnectionString(ports);
    }

    await save(connString);

    const state = await probe(connString ?? buildEmulatorConnectionString(DefaultEmulatorPorts));
    const outcome: ConfigureOutcome = { ports, state, azuriteCommand: getAzuriteCommand(ports) };

    ui.report(outcome);

    return { changed: true, connString, outcome };
}
