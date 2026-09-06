// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Specialized;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Runtime.CompilerServices;
using Microsoft.Azure.Functions.Worker.Http;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Queues;
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
        public const string DFM_DANGEROUS_OPERATIONS_ENABLED = "DFM_DANGEROUS_OPERATIONS_ENABLED";
        public const string DFM_AUDIT_ENABLED = "DFM_AUDIT_ENABLED";
        public const string DFM_AGGREGATION_CACHE_SECONDS = "DFM_AGGREGATION_CACHE_SECONDS";
        public const string DFM_STATS_CAP = "DFM_STATS_CAP";
        public const string DFM_CUSTOM_TEMPLATES_FOLDER = "DFM_CUSTOM_TEMPLATES_FOLDER";
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
        public const string IdentityBasedConnectionSettingQueueServiceUriSuffix = "__queueServiceUri";
        public const string IdentityBasedConnectionSettingCredentialSuffix = "__credential";
        public const string IdentityBasedConnectionSettingClientIdSuffix = "__clientId";
        public const string IdentityBasedConnectionSettingCredentialValue = "managedidentity";

        public const string DfmModeContextValue = "DfmModeContextValue";

        /// <summary>
        /// FunctionContext.Items key under which the middleware publishes the name of the authenticated
        /// user, so that functions (and the audit writer) do not have to re-validate the identity.
        /// </summary>
        public const string DfmUserNameContextValue = "DfmUserNameContextValue";

        /// <summary>
        /// FunctionContext.Items key any function may set to a short string, to be recorded as the
        /// 'message' of its audit record (the batch endpoint puts its counts here, replay the number of
        /// deleted history rows).
        /// </summary>
        public const string DfmAuditMessageContextValue = "DfmAuditMessage";

        /// <summary>
        /// FunctionContext.Items key any function may set to refine the operation name of its audit
        /// record. The batch endpoint appends the action it ran ('Batch terminate'), so that the /audit
        /// operation filter can tell one kind of batch from another.
        /// </summary>
        public const string DfmAuditOperationContextValue = "DfmAuditOperation";

        /// <summary>User name recorded when authentication is disabled and nobody was identified.</summary>
        public const string AnonymousUserName = "anonymous";

        /// <summary>User name recorded when the call was authenticated by the VS Code extension's nonce.</summary>
        public const string VsCodeUserName = "vscode";

        // Permission names returned by the /about endpoint, which the UI uses to decide what to show
        public const string ReadWritePermission = "DurableFunctionsMonitor.ReadWrite";
        public const string DangerousOperationsPermission = "DurableFunctionsMonitor.DangerousOperations";

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
        public static async Task<HttpResponseData> ReturnJson(this HttpRequestData req, object result, Func<string, string> applyThisToJson = null, HttpStatusCode status = HttpStatusCode.OK)
        {
            string json = JsonConvert.SerializeObject(result, Globals.SerializerSettings);
            if (applyThisToJson != null)
            {
                json = applyThisToJson(json);
            }

            var response = req.CreateResponse(status);
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
        
        /// <summary>
        /// Pulls the connection name and the Task Hub name out of a DfMon API path
        /// ('/a/p/i/{connName}-{hubName}/...'). False when the path does not address a Task Hub at all
        /// (/about of a hub-less deployment, the statics).
        /// </summary>
        public static bool TryGetConnAndHubNames(string absolutePath, out string connName, out string hubName)
        {
            connName = null;
            hubName = null;

            var match = ConnAndHubNameRegex.Match(absolutePath ?? string.Empty);
            if (!match.Success)
            {
                return false;
            }

            connName = match.Groups[1].Value;
            hubName = match.Groups[2].Value;

            return true;
        }

        // The same shape Auth validates task hub names with: /a/p/i/{connName}-{hubName}/
        private static readonly Regex ConnAndHubNameRegex = new Regex(@"/a/p/i/([^/]+)-([^/]+)/", RegexOptions.IgnoreCase | RegexOptions.Compiled);

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
        /// A TableServiceClient for the given connection setting, built the same way as the blob and queue
        /// clients above (connection string, or an identity-based connection through
        /// '{conn}__tableServiceUri' / '{conn}__accountName').
        ///
        /// ITableClient covers the reads and writes of existing tables; this is for the one thing it does
        /// not do - creating a table (the audit log creates its own on first write).
        /// </summary>
        public static TableServiceClient GetTableServiceClient(string connStringName)
        {
            var options = new TableClientOptions();
            ApplyCustomUserAgent(options);

            string connectionString = Environment.GetEnvironmentVariable(connStringName);
            if (string.IsNullOrEmpty(connectionString))
            {
                // Trying with Managed Identity/local Azure login

                string tableServiceUri = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingTableServiceUriSuffix);
                if (string.IsNullOrEmpty(tableServiceUri))
                {
                    string accountName = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingAccountNameSuffix);
                    tableServiceUri = $"https://{accountName}.table.core.windows.net";
                }

                return new TableServiceClient(new Uri(tableServiceUri), IdentityBasedTokenSource.GetCredential(), options);
            }
            else
            {
                // Using classic connection string
                return new TableServiceClient(connectionString, options);
            }
        }

        public static QueueServiceClient GetQueueServiceClient(string connStringName)
        {
            var options = new QueueClientOptions();
            ApplyCustomUserAgent(options);

            string connectionString = Environment.GetEnvironmentVariable(connStringName);
            if (string.IsNullOrEmpty(connectionString))
            {
                // Trying with Managed Identity/local Azure login

                string queueServiceUri = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingQueueServiceUriSuffix);
                if (string.IsNullOrEmpty(queueServiceUri))
                {
                    string accountName = Environment.GetEnvironmentVariable(connStringName + Globals.IdentityBasedConnectionSettingAccountNameSuffix);
                    queueServiceUri = $"https://{accountName}.queue.core.windows.net";
                }

                return new QueueServiceClient(new Uri(queueServiceUri), IdentityBasedTokenSource.GetCredential(), options);
            }
            else
            {
                // Using classic connection string
                return new QueueServiceClient(connectionString, options);
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