// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Specialized;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using Microsoft.Azure.Functions.Worker.Http;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;

[assembly: InternalsVisibleToAttribute("durablefunctionsmonitor.dotnetisolated.core.tests")]
[assembly: InternalsVisibleToAttribute("durablefunctionsmonitor.dotnetisolated.core.integrationtests")]
[assembly: InternalsVisibleToAttribute("durablefunctionsmonitor.dotnetisolated.netherite")]

namespace DurableFunctionsMonitor.DotNetIsolated
{
    static class EnvVariableNames
    {
        public const string AzureWebJobsStorage = "AzureWebJobsStorage";
        public const string AzureWebJobsFeatureFlags = "AzureWebJobsFeatureFlags";
        public const string WEBSITE_SITE_NAME = "WEBSITE_SITE_NAME";
        public const string WEBSITE_AUTH_V2_CONFIG_JSON = "WEBSITE_AUTH_V2_CONFIG_JSON";
        public const string WEBSITE_AUTH_CLIENT_ID = "WEBSITE_AUTH_CLIENT_ID";
        public const string WEBSITE_AUTH_OPENID_ISSUER = "WEBSITE_AUTH_OPENID_ISSUER";
        public const string WEBSITE_AUTH_UNAUTHENTICATED_ACTION = "WEBSITE_AUTH_UNAUTHENTICATED_ACTION";
        public const string DFM_ALLOWED_USER_NAMES = "DFM_ALLOWED_USER_NAMES";
        public const string DFM_ALLOWED_APP_ROLES = "DFM_ALLOWED_APP_ROLES";
        public const string DFM_ALLOWED_FULL_ACCESS_APP_ROLES = "DFM_ALLOWED_FULL_ACCESS_APP_ROLES";
        public const string DFM_ALLOWED_READ_ONLY_APP_ROLES = "DFM_ALLOWED_READ_ONLY_APP_ROLES";
        public const string DFM_HUB_NAME = "DFM_HUB_NAME";
        public const string DFM_NONCE = "DFM_NONCE";
        public const string DFM_CLIENT_CONFIG = "DFM_CLIENT_CONFIG";
        public const string DFM_MODE = "DFM_MODE";
        public const string DFM_USERNAME_CLAIM_NAME = "DFM_USERNAME_CLAIM_NAME";
        public const string DFM_ROLES_CLAIM_NAME = "DFM_ROLES_CLAIM_NAME";
        public const string DFM_ALTERNATIVE_CONNECTION_STRING_PREFIX = "DFM_ALTERNATIVE_CONNECTION_STRING_";
        public const string DFM_INGRESS_ROUTE_PREFIX = "DFM_INGRESS_ROUTE_PREFIX";
    }

    static class Globals
    {
        public const string XsrfTokenCookieAndHeaderName = "x-dfm-xsrf-token";
        public const string TemplateContainerName = "durable-functions-monitor";
        public const string TabTemplateFolderName = "tab-templates";
        public const string FunctionMapFolderName = "function-maps";
        public const string FunctionMapFilePrefix = "dfm-func-map";
        public const string CustomMetaTagBlobName = "custom-meta-tag.htm";

        public const string ConnAndTaskHubNameSeparator = "-";

        public const string HubNameRouteParamName = "{hubName}";

        public const string DfMonRoutePrefix = "durable-functions-monitor";

        // Constant, that defines the /a/p/i/{connName}-{hubName} route prefix, to let Functions Host distinguish api methods from statics
        public const string ApiRoutePrefix = DfMonRoutePrefix + "/a/p/i/{connName}-{hubName}";

        public const string IdentityBasedConnectionSettingAccountNameSuffix = "__accountName";
        public const string IdentityBasedConnectionSettingTableServiceUriSuffix = "__tableServiceUri";
        public const string IdentityBasedConnectionSettingBlobServiceUriSuffix = "__blobServiceUri";
        public const string IdentityBasedConnectionSettingCredentialSuffix = "__credential";
        public const string IdentityBasedConnectionSettingClientIdSuffix = "__clientId";
        public const string IdentityBasedConnectionSettingCredentialValue = "managedidentity";

        public const string DfmModeContextValue = "DfmModeContextValue";

        public const string DfMonDisableNewParentIdResolutionAlgorithm = "DfMonDisableNewParentIdResolutionAlgorithm";

        /// <summary>
        /// Provides support for dedicated Storage accounts (different from AzureWebJobsStorage)
        /// </summary>
        internal static string StorageConnStringEnvVarName = EnvVariableNames.AzureWebJobsStorage;

        public static void SplitConnNameAndHubName(string connAndHubName, out string connName, out string hubName)
        {
            int pos = connAndHubName.LastIndexOf("-");
            if (pos < 0)
            {
                connName = null;
                hubName = connAndHubName;
            }
            else
            {
                connName = connAndHubName.Substring(0, pos);
                hubName = connAndHubName.Substring(pos + 1);
            }
        }

        public static string CombineConnNameAndHubName(string connName, string hubName)
        {
            if (string.IsNullOrEmpty(connName) || connName == "-")
            {
                return hubName;
            }

            return $"{connName}{ConnAndTaskHubNameSeparator}{hubName}";
        }

        public static bool IsDefaultConnectionStringName(string connName)
        {
            return string.IsNullOrEmpty(connName) || connName == "-";
        }

        public static string GetFullConnectionStringEnvVariableName(string connName)
        {
            if (IsDefaultConnectionStringName(connName))
            {
                return StorageConnStringEnvVarName;
            }
            else
            {
                return EnvVariableNames.DFM_ALTERNATIVE_CONNECTION_STRING_PREFIX + connName;
            }
        }


        // Fighting with https://github.com/Azure/azure-functions-durable-js/issues/94
        // Could use a custom JsonConverter, but it won't be invoked for nested items :(
        public static string FixUndefinedsInJson(this string json)
        {
            return json.Replace("\": undefined", "\": null");
        }

        // A custom way of returning JSON
        public static async Task<HttpResponseData> ReturnJson(this HttpRequestData req, object result, Func<string, string> applyThisToJson = null)
        {
            string json = JsonConvert.SerializeObject(result, Globals.SerializerSettings);
            if (applyThisToJson != null)
            {
                json = applyThisToJson(json);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json");
            await response.WriteStringAsync(json);

            return response;
        }

        // Routine to return an HTTP status and a string body
        public static async Task<HttpResponseData> ReturnStatus(this HttpRequestData req, HttpStatusCode status, string body = null)
        {
            var result = req.CreateResponse(status);
            if (!string.IsNullOrEmpty(body))
            {
                await result.WriteStringAsync(body);
            }
            return result;
        }

        // Lists the names of all blobs in an Azure Blob Container that start with the given prefix
        public static async Task<IEnumerable<string>> ListBlobNamesAsync(this BlobContainerClient container, string prefix)
        {
            var result = new List<string>();

            // AsyncPageable transparently follows continuation tokens
            await foreach (var blob in container.GetBlobsAsync(BlobTraits.None, BlobStates.None, prefix, CancellationToken.None))
            {
                result.Add(blob.Name);
            }

            return result;
        }

        public static IEnumerable<T> ApplyTop<T>(this IEnumerable<T> collection, NameValueCollection query)
        {
            var clause = query["$top"];
            return !string.IsNullOrEmpty(clause) ? collection.Take(int.Parse(clause)) : collection;
        }
        
        public static IEnumerable<T> ApplySkip<T>(this IEnumerable<T> collection, NameValueCollection query)
        {
            var clause = query["$skip"];
            return !string.IsNullOrEmpty(clause) ? collection.Skip(int.Parse(clause)) : collection;
        }

        public static string GetVersion()
        {
            var version = typeof(ExtensionMethods).Assembly.GetName().Version;
            return $"{version.Major}.{version.Minor}.{version.Build}";
        }

        public static string GetHostJsonPath()
        {
            string assemblyLocation = Assembly.GetExecutingAssembly().Location;

            // First trying current folder
            string result = Path.Combine(Path.GetDirectoryName(assemblyLocation), "host.json");

            if (File.Exists(result))
            {
                return result;
            }

            // Falling back to parent folder
            result = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(assemblyLocation)), "host.json");

            return result;
        }
        
        public static BlobServiceClient GetBlobServiceClient(string connStringName)
        {
            var options = new BlobClientOptions();
            ApplyCustomUserAgent(options);

            string connectionString = Environment.GetEnvironmentVariable(connStringName);
            if (string.IsNullOrEmpty(connectionString))
            {
                // Trying with Managed Identity/local Azure login

                string blobServiceUri = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingBlobServiceUriSuffix);
                if (string.IsNullOrEmpty(blobServiceUri))
                {
                    string accountName = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingAccountNameSuffix);
                    blobServiceUri = $"https://{accountName}.blob.core.windows.net";
                }

                return new BlobServiceClient(new Uri(blobServiceUri), IdentityBasedTokenSource.GetCredential(), options);
            }
            else
            {
                // Using classic connection string
                return new BlobServiceClient(connectionString, options);
            }
        }

        /// <summary>
        /// Stamps DfMon's identifier onto the User-Agent header of every Storage request made
        /// through these client options. See CustomUserAgentPolicy for why this is a pipeline
        /// policy rather than ClientOptions.Diagnostics.ApplicationId.
        /// </summary>
        public static void ApplyCustomUserAgent(ClientOptions options)
        {
            if (!string.IsNullOrEmpty(TableClient.CustomUserAgent))
            {
                options.AddPolicy(new CustomUserAgentPolicy(TableClient.CustomUserAgent), HttpPipelinePosition.PerRetry);
            }
        }

        /// <summary>
        /// The secondary (read-access geo-redundant) endpoint for a Blob service URI, following
        /// the standard "myaccount-secondary" naming. The legacy SDK exposed this as
        /// CloudBlobClient.StorageUri.SecondaryUri; Azure.Storage.Blobs does not, so we derive it.
        /// </summary>
        public static Uri GetSecondaryBlobServiceUri(Uri primaryUri)
        {
            string host = primaryUri.Host;

            // Emulator-style URIs (http://127.0.0.1:10000/devstoreaccount1) put the account in the
            // path, not the host, and have no secondary endpoint at all.
            if (System.Net.IPAddress.TryParse(host, out _))
            {
                return null;
            }

            int firstDot = host.IndexOf('.');
            if (firstDot < 0)
            {
                return null;
            }

            return new UriBuilder(primaryUri)
            {
                Host = $"{host.Substring(0, firstDot)}-secondary{host.Substring(firstDot)}"
            }.Uri;
        }

        // Shared JSON serialization settings
        public static JsonSerializerSettings SerializerSettings = GetSerializerSettings();

        private static JsonSerializerSettings GetSerializerSettings()
        {
            var settings = new JsonSerializerSettings
            {
                Formatting = Formatting.Indented,
                DateFormatString = "yyyy-MM-ddTHH:mm:ssZ",
                ContractResolver = new CamelCasePropertyNamesContractResolver()
            };
            settings.Converters.Add(new StringEnumConverter());
            return settings;
        }
    }
}