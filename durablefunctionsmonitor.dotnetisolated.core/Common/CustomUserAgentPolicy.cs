// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Azure.Core;
using Azure.Core.Pipeline;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Prepends DfMon's own identifier to the User-Agent header of Storage requests, so DfMon's
    /// traffic can be told apart in Storage analytics logs.
    ///
    /// NOTE: this deliberately does not go through ClientOptions.Diagnostics.ApplicationId.
    /// Azure.Core caps that at 24 characters and throws ArgumentOutOfRangeException while building
    /// the pipeline, and DfMon's identifiers ("DurableFunctionsMonitorIsolated-Standalone/6.9.0"
    /// and friends) are roughly twice that long.
    /// </summary>
    class CustomUserAgentPolicy : HttpPipelineSynchronousPolicy
    {
        public CustomUserAgentPolicy(string userAgentPrefix)
        {
            this._userAgentPrefix = userAgentPrefix;
        }

        public override void OnSendingRequest(HttpMessage message)
        {
            // Keeping the SDK's own User-Agent after ours, since it is what Azure Storage support
            // looks at. Registered as a per-retry policy so that it runs after the built-in
            // telemetry policy has filled the header in.
            if (message.Request.Headers.TryGetValue(UserAgentHeaderName, out string existingUserAgent) &&
                !string.IsNullOrEmpty(existingUserAgent))
            {
                message.Request.Headers.SetValue(UserAgentHeaderName, $"{this._userAgentPrefix} {existingUserAgent}");
            }
            else
            {
                message.Request.Headers.SetValue(UserAgentHeaderName, this._userAgentPrefix);
            }
        }

        private const string UserAgentHeaderName = "User-Agent";

        private readonly string _userAgentPrefix;
    }
}
