// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { BackendApiPath, DefaultPortRange } from '../constants';

// Where a backend is to be started, as the backendBaseUrl setting describes it
export type BackendEndpoint = {

    scheme: string;
    host: string;

    // A fixed port, or a range to pick a free one from
    port?: number;
    portRange?: { from: number, to: number };
};

// Parses the backendBaseUrl setting:
//   http://localhost:{portNr}                        a free port from the default range (37072-38000)
//   http://127.0.0.1:[8080-9080]                     a free port from this range
//   http://localhost:8080                            this very port
// Only the scheme, the host and the port matter. The path is the one the backend serves (BackendApiPath),
// whatever the setting has after the port: older versions of this extension documented '/a/p/i' there,
// which is not what the backend answers on any more, and settings written for them must not break the monitor.
export function parseBackendBaseUrl(setting: string | undefined): BackendEndpoint | undefined {

    const match = /^(https?):\/\/(\[[^\]]+\]|[^:/\s]+)(?::(\{portNr\}|\[(\d+)-(\d+)\]|(\d+)))?(?:\/.*)?$/i.exec((setting ?? '').trim());
    if (!match) {
        return undefined;
    }

    const endpoint: BackendEndpoint = { scheme: match[1].toLowerCase(), host: match[2] };

    if (match[4] !== undefined) {

        endpoint.portRange = { from: parseInt(match[4]), to: parseInt(match[5]) };

    } else if (match[6] !== undefined) {

        endpoint.port = parseInt(match[6]);

    } else {

        endpoint.portRange = { ...DefaultPortRange };
    }

    return endpoint;
}

// The URL, below which the backend serves its API, once it listens on a port
export function getBackendUrl(endpoint: BackendEndpoint, port: number): string {

    return `${endpoint.scheme}://${endpoint.host}:${port}${BackendApiPath}`;
}
