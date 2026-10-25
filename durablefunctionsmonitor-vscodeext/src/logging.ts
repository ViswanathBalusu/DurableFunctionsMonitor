// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Where a line of the log goes. The modules that do not need VsCode (and are tested without it) take one of these.
export type Log = (line: string) => void;

// A log that goes nowhere, for the places that have none
export const NoLog: Log = () => { };
