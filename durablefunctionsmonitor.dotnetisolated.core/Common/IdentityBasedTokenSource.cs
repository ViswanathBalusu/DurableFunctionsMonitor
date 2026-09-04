// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Azure.Identity;
using Azure.Core;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    // Supplies identity-based credentials for Storage.
    //
    // NOTE: this used to hand out raw bearer token strings and cache them itself, because the
    // legacy WindowsAzure.Storage SDK took a token string. Azure.Data.Tables and
    // Azure.Storage.Blobs take a TokenCredential and do the fetching, caching and refreshing
    // themselves, so all that is left here is choosing which credential to hand them.
    class IdentityBasedTokenSource
    {
        // Cannot use DI functionality (our startup method will not be called when installed as a NuGet package),
        // so just leaving this as an internal static variable.
        internal static TokenCredential MockedTokenCredential = null;

        // The credential to authenticate Storage requests with
        public static TokenCredential GetCredential()
        {
            return MockedTokenCredential ?? GetTokenCredential();
        }

        internal static TokenCredential GetTokenCredential()
        {
            // Supporting user-assigned Managed Identities as well

            if (Globals.IdentityBasedConnectionSettingCredentialValue == Environment.GetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage + Globals.IdentityBasedConnectionSettingCredentialSuffix))
            {
                string clientId = Environment.GetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage + Globals.IdentityBasedConnectionSettingClientIdSuffix);
                return new DefaultAzureCredential(new DefaultAzureCredentialOptions { ManagedIdentityClientId = clientId });
            }
            else
            {
                return new DefaultAzureCredential();
            }
        }
    }
}
