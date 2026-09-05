// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Hub segment rules of contracts §5, ported verbatim from
// durablefunctionsmonitor.react/src/services/BackendClient.ts (getTaskHubName).

/**
 * The hub segment as the API route expects it: the backend route is `{connName}-{hubName}`,
 * so a plain hub name gets a `--` prefix (default connection). Keeps the workaround for
 * https://github.com/Azure/azure-functions-durable-extension/issues/1926: a hub name ending
 * with `TestHubName` is lower-cased when POSTing to `/orchestrations` or `.../restart`,
 * which bypasses the function name validation.
 */
export function apiHubSegment(hub: string, method: string, url: string): string {
  let hubName = hub ?? '';

  if (hubName.endsWith('TestHubName') && method.toUpperCase() === 'POST' && /\/(orchestrations|restart)$/i.test(url)) {
    hubName = hubName.replace('TestHubName', 'testhubname');
  }

  // Need to add preceding dashes to a plain taskHubName, otherwise it won't route properly
  if (!hubName.includes('-')) {
    hubName = '--' + hubName;
  }

  return hubName;
}

/** The hub segment as typed by the user, which is what client-side routes use (contracts §4). */
export function clientHubSegment(hub: string): string {
  return hub ?? '';
}
