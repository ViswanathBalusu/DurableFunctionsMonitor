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
