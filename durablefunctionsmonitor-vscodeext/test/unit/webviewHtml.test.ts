// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'vitest';

import { createNonce, renderWebviewHtml, type WebviewHtmlOptions } from '../../src/views/webviewHtml';

// The two characters that end a line in JavaScript, and in JSON do not
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

// The index.html of the Svelte UI, as it is built (the 'seven tags' of contracts §2)
const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Durable Functions Monitor</title>
    <link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />
    <link rel="shortcut icon" href="/favicon.png" />
    <script type="module" crossorigin src="/static/js/main.ead4d95e.js"></script>
    <link rel="stylesheet" crossorigin href="/static/css/main.2b5c2136.css">
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <meta name="durable-functions-monitor-meta">
    <script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>
    <script>var DfmRoutePrefix=""</script>
    <script>var DfmApiRoutePrefix=""</script>
    <script>var DfmClientConfig={}</script>
    <script>var DfmViewMode=0</script>
    <script>var IsFunctionGraphAvailable=0</script>
    <div id="root"></div>
  </body>
</html>`;

function render(overrides: Partial<WebviewHtmlOptions> = {}): string {

    return renderWebviewHtml({
        html: indexHtml,
        toWebviewUri: p => `https://webview.test/${p}`,
        cspSource: 'https://webview.test',
        nonce: 'NONCE',
        clientConfig: { theme: 'dark', showTimeAs: 'UTC', hubName: 'my-hub' },
        isFunctionGraphAvailable: false,
        ...overrides
    });
}

describe('renderWebviewHtml', () => {

    test('points the links to the static files to the webview', () => {

        const html = render();

        expect(html).toContain('<link rel="manifest" href="https://webview.test/manifest.json" crossorigin="use-credentials" />');
        expect(html).toContain('src="https://webview.test/static/js/main.ead4d95e.js"');
        expect(html).toContain('href="https://webview.test/static/css/main.2b5c2136.css"');
        expect(html).not.toMatch(/(href|src)="\//);
    });

    test('leaves links to somewhere else alone', () => {

        const html = render({ html: '<head></head><a href="//example.com/x"></a><img src="data:image/png;base64,AAAA"><a href="https://example.com/">x</a><a href="#top">y</a>' });

        expect(html).toContain('href="//example.com/x"');
        expect(html).toContain('src="data:image/png;base64,AAAA"');
        expect(html).toContain('href="https://example.com/"');
        expect(html).toContain('href="#top"');
    });

    test('tells the UI the theme, the time zone and the Task Hub', () => {

        const html = render();

        expect(html).toContain('var DfmClientConfig={"theme":"dark","showTimeAs":"UTC","hubName":"my-hub"}');
    });

    test('opens an instance, with the state that was persisted', () => {

        const html = render({ orchestrationId: 'abc-123', state: { 'dfm.filter': 'x' } });

        expect(html).toContain('var OrchestrationIdFromVsCode="abc-123",StateFromVsCode={"dfm.filter":"x"}');
    });

    test('opens no instance and has no state, when there is none', () => {

        expect(render()).toContain('var OrchestrationIdFromVsCode="",StateFromVsCode={}');
    });

    test('tells whether the graph of functions is available, and which view this is', () => {

        expect(render({ isFunctionGraphAvailable: true })).toContain('var IsFunctionGraphAvailable=1');
        expect(render({ isFunctionGraphAvailable: false })).toContain('var IsFunctionGraphAvailable=0');
        expect(render({ viewMode: 1 })).toContain('var DfmViewMode=1');
        expect(render()).toContain('var DfmViewMode=0');
    });

    test('leaves the tags it does not know about as they are', () => {

        const html = render();

        expect(html).toContain('var DfmRoutePrefix=""');
        expect(html).toContain('var DfmApiRoutePrefix=""');
        expect(html).toContain('<meta name="durable-functions-monitor-meta">');
    });

    test('an instance id cannot break out of the script it is written into', () => {

        const hostile = '"</script><script>alert(1)</script>';
        const html = render({ orchestrationId: hostile });

        // The only script tags are the ones the page has
        expect(html.match(/<script/g)!.length).toBe(indexHtml.match(/<script/g)!.length);
        expect(html.match(/<\/script>/g)!.length).toBe(indexHtml.match(/<\/script>/g)!.length);
        expect(html).not.toContain('alert(1)</script>');

        // And the value arrives as it was
        const written = /var OrchestrationIdFromVsCode=(.*?),StateFromVsCode/.exec(html)![1];
        expect(JSON.parse(written)).toBe(hostile);
    });

    test('a Task Hub name cannot break out of the script either', () => {

        const html = render({ clientConfig: { theme: 'light', showTimeAs: 'UTC', hubName: '</script><img src=x onerror=alert(1)>' } });

        expect(html).not.toContain('</script><img');
        expect(html.match(/<\/script>/g)!.length).toBe(indexHtml.match(/<\/script>/g)!.length);
    });

    test('line separators, which end a line in JavaScript but not in JSON, are escaped', () => {

        const html = render({ orchestrationId: 'a' + LS + 'b' + PS + 'c' });

        expect(html).not.toContain(LS);
        expect(html).not.toContain(PS);
    });

    test('a dollar sign in a value is a dollar sign', () => {

        // String.replace would take $& and $' for patterns
        const html = render({ orchestrationId: "a$&b$'c$`d" });

        expect(/var OrchestrationIdFromVsCode=(.*?),StateFromVsCode/.exec(html)![1]).toBe(JSON.stringify("a$&b$'c$`d"));
    });

    test('puts the nonce on every inline script, and on none that has a source', () => {

        const html = render();

        for (const script of html.match(/<script[^>]*>/g)!) {

            if (script.includes(' src=')) {
                expect(script).not.toContain('nonce=');
            } else {
                expect(script).toBe('<script nonce="NONCE">');
            }
        }
    });

    test('allows scripts of the extension and those with the nonce, and no network', () => {

        const csp = /Content-Security-Policy" content="([^"]+)"/.exec(render())![1];

        expect(csp).toContain(`default-src 'none'`);
        expect(csp).toContain(`script-src 'nonce-NONCE' https://webview.test`);
        // Nothing may be loaded from or sent to anywhere else
        expect(csp).not.toContain('connect-src');
        expect(csp).not.toMatch(/https?:\/\/(?!webview\.test)/);
        // 'unsafe-eval' and 'unsafe-inline' for scripts would make the nonce pointless
        expect(csp.split(';').find(d => d.trim().startsWith('script-src'))).not.toContain('unsafe');
    });

    test('puts the policy at the start of the head', () => {

        const html = render();

        expect(html.indexOf('Content-Security-Policy')).toBeGreaterThan(html.indexOf('<head>'));
        expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<title>'));
    });

    test('still has a policy, when the page has no head', () => {

        expect(render({ html: '<body>hi</body>' })).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    });

    test('works with the UI that is built right now', () => {

        const built = path.resolve(__dirname, '../../../durablefunctionsmonitor.svelte/build/index.html');
        if (!fs.existsSync(built)) {
            return;
        }

        const html = render({ html: fs.readFileSync(built, 'utf8'), orchestrationId: 'x' });

        expect(html).toContain('var OrchestrationIdFromVsCode="x"');
        expect(html).toContain('var DfmClientConfig={"theme"');
        expect(html).not.toMatch(/(href|src)="\/[^/]/);
    });
});

describe('createNonce', () => {

    test('is different every time, and has no characters a policy would take for something else', () => {

        const nonces = new Set(Array.from({ length: 50 }, createNonce));

        expect(nonces.size).toBe(50);
        for (const nonce of nonces) {
            expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
        }
    });
});
