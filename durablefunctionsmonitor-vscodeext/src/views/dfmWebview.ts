// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { Settings } from '../Settings';
import { createNonce, renderWebviewHtml } from './webviewHtml';

export type DfmWebviewOptions = {

    viewType: string;
    title: string;

    // Folder with the built UI (index.html and static/), which is the only place the webview may load files from
    staticsFolder: string;

    // Task Hub the view is bound to, if any
    hubName?: string;

    // Instance to open at once
    orchestrationId?: string;

    // What the UI persisted last time
    state?: object;

    isFunctionGraphAvailable: boolean;

    // 0 for the monitor, 1 for the view that only shows the graph of functions
    viewMode: 0 | 1;
};

// Opens a webview with the UI in it
export function createDfmWebview(options: DfmWebviewOptions): vscode.WebviewPanel {

    const panel = vscode.window.createWebviewPanel(
        options.viewType,
        options.title,
        vscode.ViewColumn.One,
        {
            retainContextWhenHidden: true,
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(options.staticsFolder)]
        }
    );

    const indexPath = path.join(options.staticsFolder, 'index.html');
    if (!fs.existsSync(indexPath)) {

        panel.dispose();
        throw new Error(`The UI is not in ${options.staticsFolder}: there is no index.html. The backend that is used has to come with its UI (the DfmStatics folder).`);
    }

    const themeKind = vscode.window.activeColorTheme.kind;

    panel.webview.html = renderWebviewHtml({
        html: fs.readFileSync(indexPath, 'utf8'),
        toWebviewUri: relativePath => panel.webview.asWebviewUri(vscode.Uri.file(path.join(options.staticsFolder, relativePath))).toString(),
        cspSource: panel.webview.cspSource,
        nonce: createNonce(),
        clientConfig: {
            theme: themeKind === vscode.ColorThemeKind.Dark || themeKind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light',
            showTimeAs: Settings().showTimeAs,
            hubName: options.hubName
        },
        orchestrationId: options.orchestrationId,
        state: options.state,
        isFunctionGraphAvailable: options.isFunctionGraphAvailable,
        viewMode: options.viewMode
    });

    return panel;
}

// An answer to a request of the UI that does not need the backend. The UI waits for it.
export function replyOk(webview: vscode.Webview, request: { id?: string }): void {

    if (request.id) {
        webview.postMessage({ id: request.id });
    }
}

// An answer to a request that failed. The UI reads the message.
export function replyError(webview: vscode.Webview, request: { id?: string }, message: string): void {

    if (request.id) {
        webview.postMessage({ id: request.id, err: { message } });
    }
}

// Validates incoming SVG, just to be extra sure...
export function looksLikeSvg(data: unknown): data is string {

    return typeof data === 'string' && data.startsWith('<svg') && data.endsWith('</svg>') && !data.toLowerCase().includes('<script');
}

// Where a Save dialog starts: in the workspace, if there is one
function getDefaultFolder(): vscode.Uri {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
}

// Asks where to save a file, and saves it. Resolves to false when the user changes his mind.
export async function saveWithDialog(content: string | Uint8Array, defaultFileName: string, filters: { [name: string]: string[] }): Promise<boolean> {

    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(getDefaultFolder(), defaultFileName), filters });
    if (!target) {
        return false;
    }

    try {

        await vscode.workspace.fs.writeFile(target, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);

    } catch (err: any) {

        vscode.window.showErrorMessage(`Failed to save. ${err.message ?? err}`);
        throw err;
    }

    vscode.window.showInformationMessage(`Saved to ${target.fsPath}`);
    return true;
}

// Opens the source code of a function (or a proxy) at the place it is defined
export async function showFunctionCode(func: { filePath?: string, pos?: number } | undefined): Promise<void> {

    if (!func?.filePath) {
        return;
    }

    const editor = await vscode.window.showTextDocument(vscode.Uri.file(func.filePath));

    const pos = editor.document.positionAt(func.pos ? func.pos : 0);

    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
}
