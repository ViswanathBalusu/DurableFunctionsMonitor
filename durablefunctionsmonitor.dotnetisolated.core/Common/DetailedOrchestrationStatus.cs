// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Newtonsoft.Json.Linq;
using Newtonsoft.Json;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Azure.Data.Tables;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.Entities;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    // Adds extra fields to DurableOrchestrationStatus returned by IDurableClient.GetStatusAsync()
    class DetailedOrchestrationStatus : DurableOrchestrationStatus
    {
        public EntityTypeEnum EntityType { get; private set; }
        public EntityId? EntityId { get; private set; }
        public string ParentInstanceId { get; private set; }

        public List<string> TabTemplateNames { get; private set; }

        public JArray History { get; internal set; }

        internal static DetailedOrchestrationStatus CreateFrom(EntityMetadata that)
        {
            return new DetailedOrchestrationStatus
            {
                Name = that.Id.ToString(),
                InstanceId = that.Id.ToString(),
                CreatedTime = that.LastModifiedTime.UtcDateTime,
                LastUpdatedTime = that.LastModifiedTime.UtcDateTime,
                RuntimeStatus = OrchestrationRuntimeStatus.Running,

                EntityType = EntityTypeEnum.DurableEntity,
                EntityId = new EntityId(that.Id.Name, that.Id.Key),

                Input = that.IncludesState ? ConvertInput(ToJToken(that.State.Value)) : null
            };            
        }

        internal static async Task<DetailedOrchestrationStatus> CreateFrom(
            DurableOrchestrationStatus that, 
            DurableTaskClient durableClient, 
            string connName, 
            string hubName, 
            ILogger log, 
            DfmSettings settings,
            DfmExtensionPoints extensionPoints)
        {
            var connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

            var result = new DetailedOrchestrationStatus();

            result.Name = that.Name;
            result.InstanceId = that.InstanceId;
            result.CreatedTime = that.CreatedTime;
            result.LastUpdatedTime = that.LastUpdatedTime;
            result.RuntimeStatus = that.RuntimeStatus;
            result.Output = that.Output;
            result.CustomStatus = that.CustomStatus;
            result.Input = that.Input;
            result.Tags = that.Tags;

            // Trying to get parent orchestrationId for this instance, if it is a subOrchestration
            try
            {
                result.ParentInstanceId = await extensionPoints.GetParentInstanceIdRoutine(durableClient, connEnvVariableName, hubName, result.InstanceId);
            }
            catch(Exception ex)
            {
                log.LogWarning(ex, "Failed to get parent instanceId");
            }

            // Initializing custom liquid template names
            // The underlying Task never throws, so it's OK.
            var templatesMap = await CustomTemplates.GetTabTemplatesAsync(settings);
            result.TabTemplateNames = templatesMap.GetTemplateNames(result.GetInstanceTypeName());

            return result;
        }

        private static int GetParentInstanceIdTimeoutInSeconds = 15;

        /// <summary>
        /// Finds the parent of an instance, or null when it has none (or none can be found).
        ///
        /// Three places know, and they are asked from the cheapest to the dearest:
        ///
        ///   1. The instance's own XXXInstances row. The Durable Task Framework writes a ParentInstanceId column
        ///      onto every row: the parent's id for a sub-orchestration, an empty string for anything else. So a
        ///      row that has the column has the answer, and an empty one is an answer too: 'no parent'. One
        ///      point read, and nothing else, for every instance a current framework wrote.
        ///   2. The instance's own history. Rows of a framework from before that column still say who started
        ///      them: the ExecutionStarted event of a sub-orchestration carries its ParentInstance. That is a
        ///      query of one partition for one row, whatever the size of the table.
        ///   3. Only when neither says anything (an old row with no history yet, or with its history gone) is a
        ///      table scanned for it, the way it was before: XXXInstances for the ExecutionId an old-format id
        ///      ('{parent execution id}:{task id}') starts with, XXXHistory for the event that created the
        ///      instance. Those scans read every row of a table, so each stops at its first match, asks for
        ///      nothing but keys, and gives up after <see cref="ParentScanTimeout"/>.
        ///
        /// It used to go from an empty column in (1) straight to (3): every look at a top-level orchestration
        /// started a scan of the whole history table that could only end by timing out.
        /// </summary>
        internal static async Task<string> GetParentInstanceIdDirectlyFromTable(DurableTaskClient durableClient, string connEnvVariableName, string hubName, string instanceId)
        {
            var tableClient = TableClient.GetTableClient(connEnvVariableName);

            string instancesTable = $"{durableClient.Name}Instances";
            string historyTable = $"{durableClient.Name}History";

            // (1)
            var instanceEntity = await tableClient.GetEntityAsync(instancesTable, instanceId, string.Empty, ParentLookupColumns);

            if (instanceEntity != null && instanceEntity.TryGetValue(ParentInstanceIdColumn, out object recordedParentInstanceId))
            {
                return NullIfEmpty(recordedParentInstanceId as string);
            }

            // (2)
            // CreateQueryFilter escapes the interpolated values, so instanceId cannot break out of the filter
            string executionStartedFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"PartitionKey eq {instanceId} and EventType eq {HistoryEventTypes.ExecutionStarted}");

            var executionStartedRow = await FindFirstAsync(tableClient, historyTable, executionStartedFilter, ParentInstanceColumns, CancellationToken.None);

            if (executionStartedRow != null && TryParseParentInstance(executionStartedRow.GetString(ParentInstanceColumn), out string parentInstanceId))
            {
                return parentInstanceId;
            }

            // (3)
            using (var cts = new CancellationTokenSource(ParentScanTimeout))
            {
                TableEntity found;

                // Checking if instanceId looks like a suborchestration (old format)
                var match = SubOrchestrationIdRegex.Match(instanceId);
                if (match.Success)
                {
                    string parentExecutionId = match.Groups[1].Value;

                    string executionIdFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                        $"ExecutionId eq {parentExecutionId}");

                    found = await FindFirstAsync(tableClient, instancesTable, executionIdFilter, KeysOnly, cts.Token);
                }
                else
                {
                    // Trying history table instead (new format)
                    // Need to narrow the scan operation by timestamp (because history tables grow large)
                    // Also need to put it under a feature switch, as it still might be a performance issue

                    string featureFlags = Environment.GetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags);
                    bool isDisabled = featureFlags == null ? false : featureFlags.Contains(Globals.DfMonDisableNewParentIdResolutionAlgorithm);
                    if (isDisabled)
                    {
                        return null;
                    }

                    var createdTime = instanceEntity?.GetDateTimeOffset("CreatedTime");
                    if (createdTime == null)
                    {
                        return null;
                    }

                    var notBefore = createdTime.Value - TimeSpan.FromSeconds(5);
                    var notAfter = createdTime.Value + TimeSpan.FromSeconds(5);

                    string createdByFilter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                        $"Timestamp gt {notBefore} and Timestamp lt {notAfter} and InstanceId eq {instanceId}");

                    // An OperationCanceledException, when the timeout comes first, is handled by upper code
                    found = await FindFirstAsync(tableClient, historyTable, createdByFilter, KeysOnly, cts.Token);
                }

                return found?.PartitionKey;
            }
        }

        /// <summary>
        /// Reads the id of the parent out of the ParentInstance column of an ExecutionStarted history row, which
        /// holds DurableTask.Core's ParentInstance as JSON:
        /// { "Name": ..., "OrchestrationInstance": { "InstanceId": "...", "ExecutionId": "..." }, "TaskScheduleId": ... }.
        ///
        /// False when the column holds something else: that is not 'no parent', it is 'cannot tell', and the
        /// caller keeps looking. No column, an empty one and a JSON null are all a top-level orchestration.
        /// </summary>
        internal static bool TryParseParentInstance(string parentInstanceJson, out string parentInstanceId)
        {
            parentInstanceId = null;

            if (string.IsNullOrWhiteSpace(parentInstanceJson))
            {
                return true;
            }

            JToken parentInstance;
            try
            {
                // DateParseHandling.None: nothing in there is a date this needs, and an id that looks like one stays a string
                parentInstance = JsonConvert.DeserializeObject<JToken>(parentInstanceJson, InputSerializerSettings);
            }
            catch (JsonException)
            {
                return false;
            }

            if (parentInstance == null || parentInstance.Type == JTokenType.Null)
            {
                return true;
            }

            if (parentInstance is not JObject parentInstanceObject)
            {
                return false;
            }

            // OrdinalIgnoreCase, because nothing guarantees the casing of a column another library wrote
            var orchestrationInstance = parentInstanceObject.GetValue("OrchestrationInstance", StringComparison.OrdinalIgnoreCase) as JObject;
            var instanceIdToken = orchestrationInstance?.GetValue("InstanceId", StringComparison.OrdinalIgnoreCase);

            if (instanceIdToken == null || instanceIdToken.Type != JTokenType.String)
            {
                return false;
            }

            parentInstanceId = NullIfEmpty(instanceIdToken.Value<string>());

            return parentInstanceId != null;
        }

        // The first row that matches, or null. One row is asked for, so the scan ends at the first match
        // instead of going on to the end of the table; a page that comes back empty is not the end of it.
        private static async Task<TableEntity> FindFirstAsync(ITableClient tableClient, string tableName, string filter, IEnumerable<string> select, CancellationToken ct)
        {
            string continuationToken = null;

            do
            {
                var page = await tableClient.QueryPageAsync(tableName, filter, select, 1, continuationToken, ct);

                if (page.Rows.Count > 0)
                {
                    return page.Rows[0];
                }

                continuationToken = page.ContinuationToken;
            }
            while (continuationToken != null);

            return null;
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }

        private const string ParentInstanceIdColumn = "ParentInstanceId";
        private const string ParentInstanceColumn = "ParentInstance";

        /// <summary>How long a scan of a whole table for an instance's parent may take before it is given up.</summary>
        private static readonly TimeSpan ParentScanTimeout = TimeSpan.FromSeconds(GetParentInstanceIdTimeoutInSeconds);

        // What the lookup reads of the XXXInstances row: the answer, and what the last-resort scan is narrowed by
        private static readonly string[] ParentLookupColumns = new[] { ParentInstanceIdColumn, "CreatedTime" };

        private static readonly string[] ParentInstanceColumns = new[] { ParentInstanceColumn };

        // PartitionKey and RowKey come back regardless - ITableClient adds them to every projection
        private static readonly string[] KeysOnly = Array.Empty<string>();

        private static readonly Regex SubOrchestrationIdRegex = new Regex(@"(.+):\d+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static JsonSerializerSettings InputSerializerSettings = new JsonSerializerSettings
        {
            DateParseHandling = DateParseHandling.None
        };

        private DetailedOrchestrationStatus() {}

        internal string GetInstanceTypeName()
        {
            return this.EntityType == EntityTypeEnum.DurableEntity ? this.EntityId.Value.EntityName : this.Name;
        }

        private static JToken ConvertInput(JToken input)
        {
            if (input.Type == JTokenType.String)
            {
                return input;
            }

            var stateToken = input["state"];
            if (stateToken == null || stateToken.Type != JTokenType.String)
            {
                return input;
            }

            var stateString = stateToken.Value<string>();
            if (!(stateString.StartsWith('{') && stateString.EndsWith('}')))
            {
                return input;
            }

            // Converting JSON string into JSON object
            input["state"] = (JToken)JsonConvert.DeserializeObject(stateString, InputSerializerSettings);
            return input;
        }
    }
}