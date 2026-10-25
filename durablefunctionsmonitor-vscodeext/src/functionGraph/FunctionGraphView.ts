// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import * as vscode from 'vscode';

import type { Log } from '../logging';
import type { FunctionGraphList } from './FunctionGraphList';
import { type TraversalResult, findFunctionOrProxy } from './traversal';
import { createDfmWebview, looksLikeSvg, replyError, replyOk, saveWithDialog, showFunctionCode } from '../views/dfmWebview';
import { toSaveFileName } from '../views/fileNames';

// Represents the function graph view
export class FunctionGraphView {

    constructor(private _context: vscode.ExtensionContext,
        private _functionProjectPath: string,
        private _functionGraphList: FunctionGraphList,
        private _log: Log) {

        this._staticsFolder = path.join(this._context.extensionPath, 'backend', 'DfmStatics');

        this._webViewPanel = this.showWebView();
    }

    // Closes this web view
    cleanup(): void {

        if (this._webViewPanel) {
            this._webViewPanel.dispose();
        }
    }

    // Path to html statics
    private _staticsFolder: string;

    // Reference to the already opened WebView with the main page
    private _webViewPanel: vscode.WebviewPanel | null = null;

    // Functions and proxies currently shown
    private _traversalResult?: TraversalResult;

    private static readonly ViewType = 'durableFunctionsMonitorFunctionGraph';

    // Opens a WebView with function graph page in it
    private showWebView(): vscode.WebviewPanel {

        const panel = createDfmWebview({
            viewType: FunctionGraphView.ViewType,
            title: `Functions Graph (${this._functionProjectPath})`,
            staticsFolder: this._staticsFolder,
            isFunctionGraphAvailable: !!this._functionProjectPath,
            viewMode: 1
        });

        // handle events from WebView
        panel.webview.onDidReceiveMessage(request => this.handleMessageFromWebView(panel.webview, request), undefined, this._context.subscriptions);

        panel.onDidDispose(() => { this._webViewPanel = null; });

        return panel;
    }

    // Does communication between code in WebView and this class
    private handleMessageFromWebView(webView: vscode.Webview, request: any): void {

        switch (request?.method) {

            case 'SaveAs':

                if (!looksLikeSvg(request.data)) {
                    vscode.window.showErrorMessage(`Invalid data format. Save failed.`);
                    replyError(webView, request, 'Invalid data format');
                    return;
                }

                // Saving some file to local hard drive
                saveWithDialog(request.data, toSaveFileName(request.url, 'function-graph', '.svg'), { 'SVG Images': ['svg'] })
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;

            case 'SaveFunctionGraphAsJson':

                if (!this._traversalResult) {
                    replyError(webView, request, 'There is no graph to save yet');
                    return;
                }

                saveWithDialog(JSON.stringify(this._traversalResult, null, 3), 'dfm-func-map.json', { 'JSON': ['json'] })
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;

            case 'GotoFunctionCode':

                showFunctionCode(findFunctionOrProxy(this._traversalResult, request.url))
                    .then(() => replyOk(webView, request), err => replyError(webView, request, err.message ?? String(err)));

                return;
        }

        // Intercepting request for Function Map
        if (request?.method === 'GET' && request.url === '/function-map') {

            if (!this._functionProjectPath) {
                return;
            }

            const requestId = request.id;
            this._functionGraphList.traverseFunctions(this._functionProjectPath).then(result => {

                this._traversalResult = result;

                webView.postMessage({
                    id: requestId, data: {
                        functions: result.functions,
                        proxies: result.proxies
                    }
                });

            }, err => {

                this._log(`Failed to traverse the functions of ${this._functionProjectPath}. ${err.message ?? err}`);

                // err might fail to serialize here, so passing err.message only
                webView.postMessage({ id: requestId, err: { message: err.message } });
            });
        }
    }
}
