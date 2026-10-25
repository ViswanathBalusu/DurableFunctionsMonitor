#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Stands in for Azure Functions Core Tools in the integration tests: 'func start --port <port>'.
// It serves the routes the extension talks to, exactly where the real backend serves them
// (Globals.ApiRoutePrefix), and only to requests that carry the nonce it was started with.
// What it saw goes to the file that FAKE_FUNC_LOG names, one JSON object per line.

const fs = require('fs');
const http = require('http');

const args = process.argv.slice(2);
if (args[0] !== 'start' || args[1] !== '--port') {
    console.error(`unexpected arguments: ${args.join(' ')}`);
    process.exit(2);
}

const port = parseInt(args[2]);
const nonce = process.env.DFM_NONCE;
const logFile = process.env.FAKE_FUNC_LOG;

function record(event) {
    if (logFile) {
        fs.appendFileSync(logFile, JSON.stringify(event) + '\n');
    }
}

record({ event: 'start', pid: process.pid, port, cwd: process.cwd(), storage: process.env.AzureWebJobsStorage, workerRuntime: process.env.FUNCTIONS_WORKER_RUNTIME, hasNonce: !!nonce });

// What func prints while it starts: a little noise on stderr is normal
console.log('Azure Functions Core Tools (fake)');
console.error('warn: fake func warns about something harmless');

const apiPrefix = '/durable-functions-monitor/a/p/i/';

http.createServer((req, res) => {

    const authorized = req.headers['x-dfm-nonce'] === nonce;
    record({ event: 'request', method: req.method, url: req.url, authorized });

    if (!req.url.startsWith(apiPrefix)) {
        res.writeHead(404);
        res.end('not here');
        return;
    }

    if (!authorized) {
        res.writeHead(401);
        res.end('no nonce, no service');
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });

    if (req.url.endsWith('/about')) {
        res.end(JSON.stringify({ accountName: 'fake', hubName: req.url.substring(apiPrefix.length).split('/')[0].substring(2), version: 'fake', permissions: [], provider: 'AzureStorage', readOnly: false, capabilities: {} }));
    } else if (req.url.endsWith('/task-hub-names')) {
        res.end('[]');
    } else {
        res.end('{}');
    }

}).listen(port, '127.0.0.1');
