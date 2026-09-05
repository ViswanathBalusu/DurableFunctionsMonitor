// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The set of optional features /about reports, so the UI can turn parts of itself on or off without
    /// ever branching on DfmExtensionPoints.ProviderName (decision D9). Serialized to camelCase by
    /// Globals.SerializerSettings; property names match docs/plans/svelte-rewrite/00-shared-contracts.md
    /// section 6 (About.capabilities).
    /// </summary>
    public record CapabilitySet
    {
        /// <summary>/stats is implemented for the current storage provider.</summary>
        public bool Stats { get; init; }

        /// <summary>/failures is implemented for the current storage provider.</summary>
        public bool Failures { get; init; }

        /// <summary>/orchestrations('{id}')/spans is available. Always true: it is a pure function over
        /// the history rows every provider has (episodeMarkers may still be false for the orchestrator lane).</summary>
        public bool Spans { get; init; }

        /// <summary>/orchestrations('{id}')/children is implemented for the current storage provider.</summary>
        public bool Children { get; init; }

        /// <summary>/orchestrations/batch is available. Always true: it only drives the existing per-instance operations.</summary>
        public bool Batch { get; init; }

        /// <summary>/storage is implemented for the current storage provider.</summary>
        public bool StorageHealth { get; init; }

        /// <summary>/audit is enabled and implemented for the current storage provider.</summary>
        public bool Audit { get; init; }

        /// <summary>/entities is implemented. Stays false until B4-S3-T1 wires the endpoint through the client API.</summary>
        public bool Entities { get; init; }

        /// <summary>update-input-and-rewind is implemented for the current storage provider.</summary>
        public bool UpdateInput { get; init; }

        /// <summary>replay (which truncates history) is implemented for the current storage provider.</summary>
        public bool TruncateHistory { get; init; }

        /// <summary>/purge-history is available for orchestrations. Always true today.</summary>
        public bool PurgeHistory { get; init; }

        /// <summary>/purge-history is available for entities. The isolated backend answers 400 for this today (see PurgeHistory.cs).</summary>
        public bool PurgeEntities { get; init; }

        /// <summary>/clean-entity-storage is implemented. The isolated backend answers 400 for this today (see CleanEntityStorage.cs).</summary>
        public bool CleanEntityStorage { get; init; }

        /// <summary>/delete-task-hub is implemented. The isolated backend answers 400 for this today (see DeleteTaskHub.cs).</summary>
        public bool DeleteTaskHub { get; init; }

        /// <summary>Conditional GET (ETag / If-None-Match) is supported on details and history. Always true after B0-S3.</summary>
        public bool ConditionalGet { get; init; }

        /// <summary>The orchestrator lane of /spans (episode markers) is implemented for the current storage provider.</summary>
        public bool EpisodeMarkers { get; init; }
    }

    /// <summary>
    /// Computes the CapabilitySet /about reports for the current DfmExtensionPoints and DfmSettings.
    /// </summary>
    internal static class Capabilities
    {
        /// <summary>
        /// Every flag is independent of <paramref name="mode"/>: a read-only instance still reports the
        /// same capabilities as a normal one (About.readOnly and About.dangerousOperations report the mode
        /// separately). The parameter is kept so callers do not need to special-case it and so a future
        /// capability that does depend on mode has somewhere to plug in.
        /// </summary>
        public static CapabilitySet Compute(DfmSettings settings, DfmExtensionPoints ext, DfmMode mode)
        {
            return new CapabilitySet
            {
                Stats = ext.GetStatsRoutine != null,
                Failures = ext.GetFailuresRoutine != null,
                Spans = true,
                Children = ext.GetChildrenRoutine != null,
                Batch = true,
                StorageHealth = ext.GetStorageHealthRoutine != null,

                // TODO(B5-S1-T1): DfmSettings does not carry AuditEnabled yet. Once it does, this becomes
                // 'settings.AuditEnabled && ext.ReadAuditRecordsRoutine != null'.
                Audit = false,

                // TODO(B4-S3-T1): flip to 'true' once /entities is implemented through the client API.
                Entities = false,

                UpdateInput = ext.UpdateHistoryEventInputRoutine != null,
                TruncateHistory = ext.TruncateHistoryRoutine != null,
                PurgeHistory = true,
                PurgeEntities = false,
                CleanEntityStorage = false,
                DeleteTaskHub = false,
                ConditionalGet = true,
                EpisodeMarkers = ext.GetEpisodeMarkersRoutine != null,
            };
        }
    }
}
