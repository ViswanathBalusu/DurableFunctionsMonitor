// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { BackendApiPath } from './constants';

// The default values of the settings. Better to have them hardcoded in code as well (not only in package.json),
// and test/unit/settingsDefaults.test.ts keeps the two from drifting apart.
export const SettingsDefaults = {

    backendBaseUrl: `http://localhost:{portNr}${BackendApiPath}`,
    customPathToBackendBinaries: '',
    customPathToAzureFunctionsHost: '',
    'coreTools.download': 'always' as 'always' | 'prompt' | 'never',
    backendTimeoutInSeconds: 60,
    storageEmulatorConnectionString: 'AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;DefaultEndpointsProtocol=http;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;',
    showTimeAs: 'UTC' as 'UTC' | 'Local',
    showWhenDebugSessionStarts: false,
    taskHubsDiscoveryMode: 'Default' as 'Default' | 'Do not use Storage keys' | 'Do not use Azure account'
};
