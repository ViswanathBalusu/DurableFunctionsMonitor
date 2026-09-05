// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Hosting;

namespace DurableFunctionsMonitor.DotNetIsolated.Netherite
{
    /// <summary>
    /// Extension methods for configuring DfMon
    /// </summary>
    public static class ExtensionMethods
    {
        /// <summary>
        /// Name of the table Netherite keeps its partition records in
        /// </summary>
        private const string PartitionsTableName = "DurableTaskPartitions";

        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IFunctionsWorkerApplicationBuilder UseDurableFunctionsMonitorWithNetheriteDurability(
            this IFunctionsWorkerApplicationBuilder builder,
            Action<DfmSettings> optionsBuilder = null
        )
        {
            return builder.UseDurableFunctionsMonitor((settings, extPoints) =>
            {
                optionsBuilder?.Invoke(settings);

                extPoints.ProviderName = "Netherite";

                // Netherite does not maintain the XXXInstances/XXXHistory tables the default routine
                // looks for, so Task Hub names have to be read from its own partitions table instead.
                extPoints.GetTaskHubNamesRoutine = GetTaskHubNames;

                // Netherite keeps history in FASTER storage, which cannot be edited from outside, so the
                // update-input-and-rewind and replay endpoints answer 400 for this provider.
                extPoints.GetHistoryEventInputRoutine = null;
                extPoints.UpdateHistoryEventInputRoutine = null;
                extPoints.TruncateHistoryRoutine = null;

                // For the same reason there are no episode markers and no instance row to read: /spans then
                // draws no orchestrator lane (totals.orchestratorMs == null) and /about reports
                // capabilities.episodeMarkers == false.
                extPoints.GetEpisodeMarkersRoutine = null;
                extPoints.GetInstanceRowInfoRoutine = null;

                // Netherite has no XXXInstances table to scan either, so there are no Task Hub statistics:
                // /stats answers 400 and /about reports capabilities.stats == false.
                extPoints.GetStatsRoutine = null;

                // And no way to find an instance's sub-orchestrations either: there is no Instances table
                // to match generated child ids in and no parent column to filter by, so
                // orchestrations('{id}')/children answers 400 and /about reports capabilities.children == false.
                extPoints.GetChildrenRoutine = null;

                // Netherite keeps its state in EventHubs partitions and FASTER stores, not in the
                // control queues, lease blobs and Partitions table /storage reports on, so
                // /storage answers 400 and /about reports capabilities.storageHealth == false.
                extPoints.GetStorageHealthRoutine = null;
            });
        }

        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IHostBuilder UseDurableFunctionsMonitorWithNetheriteDurability(this IHostBuilder hostBuilder, Action<DfmSettings> optionsBuilder = null)
        {
            return hostBuilder.ConfigureFunctionsWorkerDefaults((HostBuilderContext builderContext, IFunctionsWorkerApplicationBuilder builder) =>
            {
                builder.UseDurableFunctionsMonitorWithNetheriteDurability(optionsBuilder);
            });
        }

        /// <summary>
        /// Custom routine for fetching Task Hub names
        /// </summary>
        public static async Task<IEnumerable<string>> GetTaskHubNames(string connName)
        {
            var tableClient = TableClient.GetTableClient(connName);

            // No filter - Netherite keeps one row per partition, and we want them all
            var partitions = await tableClient.GetAllAsync(PartitionsTableName, null);

            return partitions.Select(p => p.PartitionKey).Distinct();
        }
    }
}
