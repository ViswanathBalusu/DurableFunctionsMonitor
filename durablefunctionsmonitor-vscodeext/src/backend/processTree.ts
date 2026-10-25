// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as cp from 'child_process';

// Whether a spawned process has to be started as the leader of a process group, to be killed along with all its children later
export const StartsProcessGroup = process.platform !== 'win32';

// Kills a process along with everything it started, and resolves when it is gone.
// func starts a worker process of its own, and the backend is that worker. Killing func alone, which is
// all that ChildProcess.kill() does, can leave the worker behind, still holding a port and its files.
export async function killProcessTree(child: cp.ChildProcess, graceInMs: number = 5000): Promise<void> {

    const pid = child.pid;
    if (!pid || child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));

    if (process.platform === 'win32') {

        // /T: the whole tree, /F: without asking the processes to close
        await new Promise<void>(resolve => {
            cp.execFile('taskkill', ['/PID', pid.toString(), '/T', '/F'], { windowsHide: true }, () => resolve());
        });

    } else {

        // A negative pid is the process group, which the process leads (see StartsProcessGroup)
        const signalGroup = (signal: NodeJS.Signals) => {
            try {
                process.kill(-pid, signal);
            } catch {
                // It is gone already
            }
        };

        signalGroup('SIGTERM');

        const killTimer = setTimeout(() => signalGroup('SIGKILL'), graceInMs);
        await exited;
        clearTimeout(killTimer);
    }

    // Not waiting forever for an exit event that might have been missed
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, graceInMs))]);
}
