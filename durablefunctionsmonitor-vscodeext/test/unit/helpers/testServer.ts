// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as http from 'http';
import * as net from 'net';

export type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

// A real HTTP server on a free local port, for the tests of code that downloads and probes
export class TestServer {

    // Request paths in the order they came
    readonly requests: string[] = [];

    private readonly _server: http.Server;
    private readonly _routes = new Map<string, Route>();

    // What happens to a path nobody set a route for
    fallback: Route = (_req, res) => { res.statusCode = 404; res.end('not found'); };

    constructor() {

        this._server = http.createServer((req, res) => {

            this.requests.push(req.url ?? '');
            (this._routes.get((req.url ?? '').split('?')[0]) ?? this.fallback)(req, res);
        });
    }

    async start(): Promise<void> {
        await new Promise<void>(resolve => this._server.listen(0, '127.0.0.1', () => resolve()));
    }

    async stop(): Promise<void> {

        this._server.closeAllConnections();
        await new Promise<void>(resolve => this._server.close(() => resolve()));
    }

    get port(): number {
        return (this._server.address() as net.AddressInfo).port;
    }

    url(path: string = ''): string {
        return `http://127.0.0.1:${this.port}${path}`;
    }

    on(path: string, route: Route): void {
        this._routes.set(path, route);
    }

    // Serves a buffer
    serve(path: string, body: Buffer): void {

        this.on(path, (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
            res.end(body);
        });
    }
}
