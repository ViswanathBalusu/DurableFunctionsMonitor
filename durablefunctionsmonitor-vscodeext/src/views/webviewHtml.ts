// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';

// What the UI is told about the place it runs in. See contracts §2 of the plan: the index.html of the UI has
// a few placeholder tags, which the host replaces by exact string match. This is the host.
export type WebviewHtmlOptions = {

    // The index.html of the UI, as it was built
    html: string;

    // Turns a root-absolute path of a static file ('static/js/main.js') into a URL the webview can load it from
    toWebviewUri: (relativePath: string) => string;

    // webview.cspSource
    cspSource: string;

    // A fresh value for every webview. Only scripts that carry it run, besides the ones from the extension's own files.
    nonce: string;

    clientConfig: { theme: 'light' | 'dark', showTimeAs: string, hubName?: string };

    // An instance to open at once, for a view of a single instance
    orchestrationId?: string;

    // What the UI persisted last time
    state?: object;

    isFunctionGraphAvailable: boolean;

    // 0 for the monitor, 1 for the view that only shows the graph of functions
    viewMode?: 0 | 1;
};

export function createNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

// The two characters that end a line in JavaScript and do not in JSON
const LineSeparator = String.fromCharCode(0x2028);
const ParagraphSeparator = String.fromCharCode(0x2029);

// Makes a value safe to be placed in an inline script: JSON, in which nothing can close the script tag or start a comment
function toScriptValue(value: unknown): string {

    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .split(LineSeparator).join('\\u2028')
        .split(ParagraphSeparator).join('\\u2029');
}

// Replaces a placeholder tag, if the UI has it. Not finding it is fine: an older UI does not have all of them.
function replaceTag(html: string, tag: string, replacement: string): string {

    // Not String.replace(tag, replacement): the replacement has $ characters, which that treats specially
    const index = html.indexOf(tag);
    return index < 0 ? html : html.substring(0, index) + replacement + html.substring(index + tag.length);
}

// Prepares the index.html of the UI to be shown in a webview
export function renderWebviewHtml(options: WebviewHtmlOptions): string {

    let html = options.html;

    // Links to the static files are root-absolute, and there is no root in a webview
    html = html.replace(/(\s(?:href|src))="\/(?!\/)([^"#?]+)"/gi, (_match, attribute: string, relativePath: string) => {
        return `${attribute}="${options.toWebviewUri(relativePath)}"`;
    });

    html = replaceTag(html, '<script>var OrchestrationIdFromVsCode="",StateFromVsCode={}</script>',
        `<script>var OrchestrationIdFromVsCode=${toScriptValue(options.orchestrationId ?? '')},StateFromVsCode=${toScriptValue(options.state ?? {})}</script>`);

    html = replaceTag(html, '<script>var DfmClientConfig={}</script>',
        `<script>var DfmClientConfig=${toScriptValue(options.clientConfig)}</script>`);

    html = replaceTag(html, '<script>var DfmViewMode=0</script>',
        `<script>var DfmViewMode=${options.viewMode ?? 0}</script>`);

    html = replaceTag(html, '<script>var IsFunctionGraphAvailable=0</script>',
        `<script>var IsFunctionGraphAvailable=${options.isFunctionGraphAvailable ? 1 : 0}</script>`);

    // Only the inline scripts that are there now are ours (the host has just written them)
    html = html.replace(/<script>/g, `<script nonce="${options.nonce}">`);

    // No network: everything the UI needs from the backend goes through the extension, by postMessage
    const csp = [
        `default-src 'none'`,
        `script-src 'nonce-${options.nonce}' ${options.cspSource}`,
        `style-src ${options.cspSource} 'unsafe-inline'`,
        `img-src ${options.cspSource} data: blob:`,
        `font-src ${options.cspSource} data:`,
        `manifest-src ${options.cspSource}`,
        `worker-src blob:`
    ].join('; ');

    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, head => `${head}\n    ${meta}`) : meta + html;
}
