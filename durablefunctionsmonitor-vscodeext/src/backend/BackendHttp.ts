// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { NonceHeaderName } from '../constants';

// Methods the UI may use. Anything else it sends is not a request to the backend.
const AllowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// Where a request of the UI is allowed to go, below the Task Hub of the view: a path with a query, and nothing else
export function isSafeRequestPath(url: unknown): url is string {

    return typeof url === 'string'
        && url.startsWith('/')
        // '//' would be a host, '\' is a '/' to some, and no line ends belong into a URL
        && !url.startsWith('//')
        && !/[\\\r\n]/.test(url)
        // Climbing out of the Task Hub segment, to another route
        && !url.split('?')[0].split('/').some(segment => segment === '..' || segment === '.');
}

export function isAllowedMethod(method: unknown): method is string {
    return typeof method === 'string' && AllowedMethods.includes(method.toUpperCase());
}

// What the UI gets, when a request fails. It reads the status code from the text of the message (see bridgeError() in the UI),
// so the text has to stay the way axios used to write it.
export class BackendRequestError extends Error {

    constructor(message: string, public readonly responseData?: unknown) {
        super(message);
        this.name = 'BackendRequestError';
    }
}

// The body of a response, as axios used to hand it out: JSON that is JSON, text that is not
function parseBody(text: string): unknown {

    if (!text) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export type BackendRequest = {

    // The URL below which the backend serves its API (BackendProcess.backendUrl)
    backendUrl: string;

    // Task Hub name, without the schema
    hubName: string;

    method: string;

    // What comes after the Task Hub segment: '/orchestrations?$top=50'
    url: string;

    data?: unknown;
    nonce: string;
};

// Builds the URL of a request to the backend
export function getRequestUrl(request: Pick<BackendRequest, 'backendUrl' | 'hubName' | 'url'>): string {

    // '--' is the connection name, which is empty: the segment is {connName}-{hubName}
    return `${request.backendUrl}/--${request.hubName}${request.url}`;
}

// Sends a request to the backend, and returns what it answers
export async function sendToBackend(request: BackendRequest, signal?: AbortSignal): Promise<{ data: unknown, contentType: string, bytes: Buffer }> {

    const headers: Record<string, string> = { [NonceHeaderName]: request.nonce };

    let body: string | undefined;
    if (request.data !== undefined && request.data !== null) {
        headers['Content-Type'] = 'application/json';
        body = typeof request.data === 'string' ? request.data : JSON.stringify(request.data);
    }

    const response = await fetch(getRequestUrl(request), { method: request.method.toUpperCase(), headers, body, signal });

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? '';
    const data = parseBody(bytes.toString('utf8'));

    if (!response.ok) {
        throw new BackendRequestError(`Request failed with status code ${response.status}`, data);
    }

    return { data, contentType, bytes };
}
