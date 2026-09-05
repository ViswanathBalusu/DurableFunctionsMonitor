// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class CapabilitiesTests
    {
        [TestMethod]
        public void AzureStorageDefaultsReportTheAzureStorageCapabilitySet()
        {
            // Arrange: the Azure Storage defaults set in DfmExtensionPoints()'s constructor, no aggregation
            // routines assigned (those are only set by their own B1-B5 epics).
            var settings = new DfmSettings();
            var ext = new DfmExtensionPoints();

            // Act
            var capabilities = Capabilities.Compute(settings, ext, DfmMode.Normal);

            // Assert
            Assert.IsFalse(capabilities.Stats);
            Assert.IsFalse(capabilities.Failures);
            Assert.IsTrue(capabilities.Spans);
            Assert.IsFalse(capabilities.Children);
            Assert.IsTrue(capabilities.Batch);
            Assert.IsFalse(capabilities.StorageHealth);
            Assert.IsFalse(capabilities.Audit);
            Assert.IsFalse(capabilities.Entities);

            // Azure Storage's default editing routines are set out of the box (input-events replay plan).
            Assert.IsTrue(capabilities.UpdateInput);
            Assert.IsTrue(capabilities.TruncateHistory);

            Assert.IsTrue(capabilities.PurgeHistory);
            Assert.IsFalse(capabilities.PurgeEntities);
            Assert.IsFalse(capabilities.CleanEntityStorage);
            Assert.IsFalse(capabilities.DeleteTaskHub);
            Assert.IsTrue(capabilities.ConditionalGet);
            Assert.IsTrue(capabilities.EpisodeMarkers); // B2-S1-T2 sets the Azure Storage default
        }

        [TestMethod]
        public void MsSqlLikeExtensionPointsReportNoHistoryEditingCapabilities()
        {
            // Arrange: mirrors durablefunctionsmonitor.dotnetisolated.mssql/ExtensionMethods.cs, which nulls
            // out the history-editing routines and, apart from episode markers / row info (B2-S1-T2), sets no aggregation routine.
            var settings = new DfmSettings();
            var ext = new DfmExtensionPoints
            {
                ProviderName = "MsSql",
                GetHistoryEventInputRoutine = null,
                UpdateHistoryEventInputRoutine = null,
                TruncateHistoryRoutine = null,
            };

            // Act
            var capabilities = Capabilities.Compute(settings, ext, DfmMode.Normal);

            // Assert
            Assert.IsFalse(capabilities.Stats);
            Assert.IsFalse(capabilities.Failures);
            Assert.IsFalse(capabilities.Children);
            Assert.IsFalse(capabilities.StorageHealth);
            Assert.IsTrue(capabilities.EpisodeMarkers); // MSSQL implements the routine (B2-S1-T2)
            Assert.IsFalse(capabilities.UpdateInput);
            Assert.IsFalse(capabilities.TruncateHistory);

            // Independent-of-provider capabilities are unaffected.
            Assert.IsTrue(capabilities.Spans);
            Assert.IsTrue(capabilities.Batch);
            Assert.IsTrue(capabilities.PurgeHistory);
            Assert.IsTrue(capabilities.ConditionalGet);
        }

        [TestMethod]
        public void NetheriteLikeExtensionPointsReportNoHistoryEditingCapabilities()
        {
            // Arrange: mirrors durablefunctionsmonitor.dotnetisolated.netherite/ExtensionMethods.cs.
            var settings = new DfmSettings();
            var ext = new DfmExtensionPoints
            {
                ProviderName = "Netherite",
                GetHistoryEventInputRoutine = null,
                UpdateHistoryEventInputRoutine = null,
                TruncateHistoryRoutine = null,
                GetEpisodeMarkersRoutine = null,
                GetInstanceRowInfoRoutine = null,
            };

            // Act
            var capabilities = Capabilities.Compute(settings, ext, DfmMode.Normal);

            // Assert
            Assert.IsFalse(capabilities.UpdateInput);
            Assert.IsFalse(capabilities.TruncateHistory);
            Assert.IsFalse(capabilities.Stats);
            Assert.IsFalse(capabilities.Failures);
            Assert.IsFalse(capabilities.Children);
            Assert.IsFalse(capabilities.StorageHealth);
            Assert.IsFalse(capabilities.EpisodeMarkers);
        }

        [TestMethod]
        public void EveryAggregationRoutineSetReportsItsCapabilityAsTrue()
        {
            // Arrange: an extension-points set where every later-epic routine has been assigned.
            var settings = new DfmSettings();
            var ext = new DfmExtensionPoints
            {
                GetStatsRoutine = (client, connName, hubName, query, ct) => Task.FromResult(new StatsResult()),
                GetFailuresRoutine = (client, connName, hubName, query, ct) => Task.FromResult(new FailuresResult()),
                GetChildrenRoutine = (client, connName, hubName, instanceId) => Task.FromResult(new ChildrenResult()),
                GetEpisodeMarkersRoutine = (client, connName, hubName, instanceId) =>
                    Task.FromResult((IReadOnlyList<EpisodeMarker>)new List<EpisodeMarker>()),
                GetStorageHealthRoutine = (connName, hubName, counts, instanceId, ct) => Task.FromResult(new StorageHealthResult()),
                ReadAuditRecordsRoutine = (connName, hubName, query) => Task.FromResult(new AuditPage()),
            };

            // Act
            var capabilities = Capabilities.Compute(settings, ext, DfmMode.Normal);

            // Assert
            Assert.IsTrue(capabilities.Stats);
            Assert.IsTrue(capabilities.Failures);
            Assert.IsTrue(capabilities.Children);
            Assert.IsTrue(capabilities.StorageHealth);
            Assert.IsTrue(capabilities.EpisodeMarkers);

            // Audit stays false here even though ReadAuditRecordsRoutine is set: settings.AuditEnabled
            // defaults to false (an operator must opt in). See AuditCapabilityRequiresBothTheSettingAndTheRoutine.
            Assert.IsFalse(capabilities.Audit);

            // Entities stays false until B4-S3-T1 wires the endpoint through the client API.
            Assert.IsFalse(capabilities.Entities);
        }

        [TestMethod]
        public void AuditCapabilityRequiresBothTheSettingAndTheRoutine()
        {
            // Arrange
            var routineSet = new DfmExtensionPoints
            {
                ReadAuditRecordsRoutine = (connName, hubName, query) => Task.FromResult(new AuditPage())
            };
            var routineNull = new DfmExtensionPoints { ReadAuditRecordsRoutine = null };

            // Setting enabled but no routine (e.g. MSSQL/Netherite before they implement audit reads): false
            Assert.IsFalse(Capabilities.Compute(new DfmSettings { AuditEnabled = true }, routineNull, DfmMode.Normal).Audit);

            // Routine set but the operator did not opt in: false
            Assert.IsFalse(Capabilities.Compute(new DfmSettings { AuditEnabled = false }, routineSet, DfmMode.Normal).Audit);

            // Both flipped on: true
            Assert.IsTrue(Capabilities.Compute(new DfmSettings { AuditEnabled = true }, routineSet, DfmMode.Normal).Audit);
        }

        [TestMethod]
        public void CapabilitiesAreIndependentOfDfmMode()
        {
            // Arrange
            var settings = new DfmSettings();
            var ext = new DfmExtensionPoints
            {
                GetStatsRoutine = (client, connName, hubName, query, ct) => Task.FromResult(new StatsResult()),
            };

            // Act
            var normal = Capabilities.Compute(settings, ext, DfmMode.Normal);
            var readOnly = Capabilities.Compute(settings, ext, DfmMode.ReadOnly);

            // Assert: read-only mode does not turn any capability off; that is reported separately (About.readOnly).
            Assert.AreEqual(normal, readOnly);
        }
    }
}
