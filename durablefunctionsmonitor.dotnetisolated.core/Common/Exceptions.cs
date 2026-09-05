// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

namespace DurableFunctionsMonitor.DotNetIsolated
{
    internal class DfmUnauthorizedException: Exception
    {
        public DfmUnauthorizedException(string msg) : base(msg) {}
    }

    internal class DfmAccessViolationException: Exception
    {
        public DfmAccessViolationException(string msg) : base(msg) {}
    }

    internal class DfmNotInitializedException: Exception
    {
        public DfmNotInitializedException() : base("Make sure you called UseDurableFunctionsMonitor() at your Function's startup") {}
    }

    /// <summary>
    /// The request body or a parameter is malformed. Answered with 400.
    /// </summary>
    internal class DfmBadRequestException : Exception
    {
        public DfmBadRequestException(string msg) : base(msg) {}
    }

    /// <summary>
    /// The addressed instance or history event does not exist. Answered with 404.
    /// </summary>
    internal class DfmNotFoundException : Exception
    {
        public DfmNotFoundException(string msg) : base(msg) {}
    }

    /// <summary>
    /// A precondition of the operation does not hold: wrong runtime status, a stale sequence number,
    /// or a concurrent change to the data being edited. Answered with 409.
    /// </summary>
    internal class DfmConflictException : Exception
    {
        public DfmConflictException(string msg) : base(msg) {}
    }

    /// <summary>
    /// A payload is too large to be stored inline. Answered with 413.
    /// </summary>
    internal class DfmPayloadTooLargeException : Exception
    {
        public DfmPayloadTooLargeException(string msg) : base(msg) {}
    }

    /// <summary>
    /// The configured storage provider does not support the operation. Answered with 400.
    /// </summary>
    internal class DfmNotSupportedException : Exception
    {
        public DfmNotSupportedException(string msg) : base(msg) {}
    }

    /// <summary>
    /// Reading Task Hub storage failed before anything was changed. Answered with 500.
    /// </summary>
    internal class DfmStorageException : Exception
    {
        public DfmStorageException(string msg, Exception inner) : base(msg, inner) {}
    }
}