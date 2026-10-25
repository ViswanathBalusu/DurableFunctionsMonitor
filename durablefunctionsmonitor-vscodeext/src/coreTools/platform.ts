// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// A platform Azure Functions Core Tools is published for
export type CoreToolsPlatform = {

    // Key into the 'assets' of manifest.json
    rid: 'win-x64' | 'win-arm64' | 'win-x86' | 'linux-x64' | 'linux-arm64' | 'osx-x64' | 'osx-arm64';

    // Name of the executable inside of the archive
    executable: 'func.exe' | 'func';
};

// Maps what Node reports to a Core Tools platform. Returns undefined for a platform Core Tools is not published for.
// Windows gets the 'min' packages (see manifest.json): about 75 MB instead of about 560 MB, and the backend
// of this extension is a .NET isolated app, for which the in-process runtimes that only the full packages carry are not needed.
// The other platforms only have the full packages.
export function getCoreToolsPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): CoreToolsPlatform | undefined {

    switch (`${platform}-${arch}`) {
        case 'win32-x64': return { rid: 'win-x64', executable: 'func.exe' };
        case 'win32-arm64': return { rid: 'win-arm64', executable: 'func.exe' };
        case 'win32-ia32': return { rid: 'win-x86', executable: 'func.exe' };
        case 'linux-x64': return { rid: 'linux-x64', executable: 'func' };
        case 'linux-arm64': return { rid: 'linux-arm64', executable: 'func' };
        case 'darwin-x64': return { rid: 'osx-x64', executable: 'func' };
        case 'darwin-arm64': return { rid: 'osx-arm64', executable: 'func' };
    }

    return undefined;
}
