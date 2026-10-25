// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as crypto from 'crypto';

// Creates the SharedKeyLite signature to query Table Storage REST API, also adds other needed headers
export function createSharedKeyLiteHeaders(accountName: string, accountKey: string, tableEndpointUrl: string, resource: string = 'Tables', now: Date = new Date()): Record<string, string> {

    // Local emulator URLs contain account name _after_ host (like http://127.0.0.1:10002/devstoreaccount1/ ),
    // and this part should be included when obtaining SAS
    const tableEndpointUrlParts = tableEndpointUrl.split('/');
    const tableQueryUrl = (tableEndpointUrlParts.length > 3 && !!tableEndpointUrlParts[3]) ?
        `${tableEndpointUrlParts[3]}/${resource}` :
        resource;

    const dateInUtc = now.toUTCString();
    const signature = crypto
        .createHmac('sha256', Buffer.from(accountKey, 'base64'))
        .update(`${dateInUtc}\n/${accountName}/${tableQueryUrl}`)
        .digest('base64');

    return {
        'Authorization': `SharedKeyLite ${accountName}:${signature}`,
        'x-ms-date': dateInUtc,
        'x-ms-version': '2015-12-11',
        'Accept': 'application/json;odata=nometadata'
    };
}

// The headers to query Table Storage REST API with a token of the user (that has got the https://storage.azure.com audience)
export function createBearerHeaders(accessToken: string, now: Date = new Date()): Record<string, string> {

    return {
        'Authorization': `Bearer ${accessToken}`,
        'x-ms-date': now.toUTCString(),
        'x-ms-version': '2020-12-06',
        'Accept': 'application/json;odata=nometadata'
    };
}
