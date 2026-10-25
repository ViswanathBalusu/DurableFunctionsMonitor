// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Stands in for 'func start' in the tests of FuncHost. Run as:  node fakeBackend.cjs <mode> <port> [file]
//
//   ready          answers 404 for a moment, like a host that is up and has not got to its functions yet, then 200
//   ready-noisy    like ready, and writes to stderr all the time (func does, and it is not a failure)
//   401            answers 401, as a backend does to a Task Hub it does not know
//   never-ready    answers 404 forever
//   exits          writes a line and exits with code 3
//   bad-account    writes what func writes for a bad connection string, and keeps running
//   no-dotnet      writes what a missing .NET runtime looks like, and keeps running
//   port-taken     writes what a port that cannot be listened on looks like, and keeps running
//   family         starts a child process, writes its pid to <file>, and keeps running (a func with a worker)

const http = require('http');
const cp = require('child_process');
const fs = require('fs');

const [, , mode, port, file] = process.argv;

function serve(handler) {
    http.createServer(handler).listen(parseInt(port), '127.0.0.1');
}

function keepRunning() {
    setInterval(() => { }, 1000);
}

switch (mode) {

    case 'ready':
    case 'ready-noisy': {

        const readyAt = Date.now() + 700;

        if (mode === 'ready-noisy') {
            setInterval(() => process.stderr.write('warn: something func complains about\n'), 100);
        }

        console.log('Azure Functions Core Tools (fake)');
        serve((req, res) => {
            res.statusCode = Date.now() >= readyAt ? 200 : 404;
            res.end(res.statusCode === 200 ? '{"ok":true}' : 'not yet');
        });
        break;
    }

    case '401':
        serve((req, res) => { res.statusCode = 401; res.end('no'); });
        break;

    case 'never-ready':
        console.log('Host started, no functions');
        serve((req, res) => { res.statusCode = 404; res.end('nothing'); });
        break;

    case 'exits':
        console.log('about to fail');
        console.error('stderr: it went wrong');
        setTimeout(() => process.exit(3), 100);
        break;

    case 'bad-account':
        console.log('[2026-10-24T00:00:00Z] Microsoft.WindowsAzure.Storage: No valid combination of account information found.');
        keepRunning();
        break;

    case 'no-dotnet':
        console.log('You must install or update .NET to run this application.');
        console.log('');
        console.log("The framework 'Microsoft.NETCore.App', version '10.0.0' (x64) was not found.");
        keepRunning();
        break;

    case 'port-taken':
        console.log('Failed to bind to address http://127.0.0.1:1234: address already in use.');
        keepRunning();
        break;

    case 'family': {

        const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        fs.writeFileSync(file, String(child.pid));
        console.log('worker started');
        keepRunning();
        break;
    }

    default:
        console.error('unknown mode ' + mode);
        process.exit(9);
}
