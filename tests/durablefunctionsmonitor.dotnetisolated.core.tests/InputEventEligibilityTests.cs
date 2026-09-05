// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Linq;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The rules for which of restart-in-place, update-input-and-rewind and replay applies to which
    /// input-bearing event. Pure logic, so every branch is covered here rather than through the endpoints.
    /// </summary>
    [TestClass]
    public class InputEventEligibilityTests
    {
        private static HistoryEvent Event(long? sequenceNumber, string eventType, string name = null, string input = null)
        {
            return new HistoryEvent
            {
                SequenceNumber = sequenceNumber,
                EventType = eventType,
                Name = name,
                Input = input,
                Timestamp = DateTimeOffset.UtcNow
            };
        }

        // An orchestration that started, got two external events and completed
        private static readonly HistoryEvent[] HistoryWithTwoRaisedEvents = new[]
        {
            Event(1, "ExecutionStarted", "MyOrchestrator", "{\"a\":1}"),
            Event(2, "TaskScheduled", "Activity1"),
            Event(5, "EventRaised", "Approval", "{\"ok\":true}"),
            Event(8, "TaskScheduled", "Activity2"),
            Event(11, "EventRaised", "Approval2", "{\"ok\":false}"),
            Event(14, "ExecutionCompleted")
        };

        private static readonly HistoryEvent[] HistoryWithoutRaisedEvents = new[]
        {
            Event(1, "ExecutionStarted", "MyOrchestrator", "{\"a\":1}"),
            Event(2, "TaskScheduled", "Activity1"),
            Event(5, "ExecutionCompleted")
        };

        private static InputEventsResult Compute(
            HistoryEvent[] history,
            OrchestrationRuntimeStatus status = OrchestrationRuntimeStatus.Failed,
            string parentInstanceId = null,
            bool dangerousOperationsEnabled = true,
            bool canUpdateInput = true,
            bool canTruncateHistory = true)
        {
            return InputEventEligibility.Compute("inst", status, parentInstanceId, history, dangerousOperationsEnabled, canUpdateInput, canTruncateHistory);
        }

        [TestMethod]
        public void ListsOnlyInputBearingEventsOfTheCurrentExecution()
        {
            // Arrange

            // A ContinueAsNew'ed instance: the first generation's events come before the current ExecutionStarted
            var history = new[]
            {
                Event(1, "ExecutionStarted", "MyOrchestrator", "{\"gen\":0}"),
                Event(3, "EventRaised", "Approval", "{\"old\":true}"),
                Event(10, "ExecutionStarted", "MyOrchestrator", "{\"gen\":1}"),
                Event(11, "TaskScheduled", "Activity1"),
                Event(12, "EventRaised", "Approval", "{\"new\":true}")
            };

            // Act

            var result = Compute(history);

            // Assert

            CollectionAssert.AreEqual(new long?[] { 10, 12 }, result.Events.Select(e => e.SequenceNumber).ToArray());
            Assert.AreEqual("ExecutionStarted", result.Events[0].EventType);
            Assert.AreEqual("EventRaised", result.Events[1].EventType);
            Assert.IsFalse(result.Events[0].IsLast);
            Assert.IsTrue(result.Events[1].IsLast);
            Assert.AreEqual("{\"new\":true}", result.Events[1].StoredInput);

            Assert.AreEqual("inst", result.InstanceId);
            Assert.AreEqual(OrchestrationRuntimeStatus.Failed, result.RuntimeStatus);
            Assert.IsTrue(result.DangerousOperationsEnabled);
            Assert.IsTrue(result.StorageSupports.UpdateInput);
            Assert.IsTrue(result.StorageSupports.TruncateHistory);
        }

        [TestMethod]
        public void OnlyTheLastRaisedEventGetsOperations()
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents);

            // Assert

            var executionStarted = result.Events.Single(e => e.SequenceNumber == 1);
            var firstRaised = result.Events.Single(e => e.SequenceNumber == 5);
            var lastRaised = result.Events.Single(e => e.SequenceNumber == 11);

            Assert.IsTrue(lastRaised.IsLast);
            Assert.IsTrue(lastRaised.Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
            Assert.IsTrue(lastRaised.Operations[InputEventOperations.Replay].Allowed);
            Assert.IsFalse(lastRaised.Operations[InputEventOperations.Replay].RequiresTerminate);
            Assert.IsFalse(lastRaised.Operations[InputEventOperations.RestartInPlace].Allowed);

            foreach (var operation in InputEventOperations.All)
            {
                Assert.IsFalse(firstRaised.Operations[operation].Allowed, operation);
                StringAssert.Contains(firstRaised.Operations[operation].Reason, "Only the last");
            }

            // Once external events were received, the initial input can neither be restarted nor rewound from
            Assert.IsFalse(executionStarted.Operations[InputEventOperations.RestartInPlace].Allowed);
            StringAssert.Contains(executionStarted.Operations[InputEventOperations.RestartInPlace].Reason, "external events");
            Assert.IsFalse(executionStarted.Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
            Assert.IsFalse(executionStarted.Operations[InputEventOperations.Replay].Allowed);
        }

        [TestMethod]
        public void RestartInPlaceIsAllowedForAFailedInstanceWithoutRaisedEvents()
        {
            // Act

            var result = Compute(HistoryWithoutRaisedEvents);

            // Assert

            var executionStarted = result.Events.Single();

            Assert.IsTrue(executionStarted.IsLast);
            Assert.IsTrue(executionStarted.Operations[InputEventOperations.RestartInPlace].Allowed);
            Assert.IsTrue(executionStarted.Operations[InputEventOperations.UpdateInputAndRewind].Allowed);

            // Replaying from the initial input is what restart-in-place is for
            Assert.IsFalse(executionStarted.Operations[InputEventOperations.Replay].Allowed);
        }

        [TestMethod]
        [DataRow(OrchestrationRuntimeStatus.Completed)]
        [DataRow(OrchestrationRuntimeStatus.Terminated)]
        [DataRow(OrchestrationRuntimeStatus.Running)]
        [DataRow(OrchestrationRuntimeStatus.Pending)]
        [DataRow(OrchestrationRuntimeStatus.Suspended)]
        public void RestartInPlaceAndRewindRequireAFailedInstance(OrchestrationRuntimeStatus status)
        {
            // Act

            var result = Compute(HistoryWithoutRaisedEvents, status);

            // Assert

            var executionStarted = result.Events.Single();

            Assert.IsFalse(executionStarted.Operations[InputEventOperations.RestartInPlace].Allowed);
            StringAssert.Contains(executionStarted.Operations[InputEventOperations.RestartInPlace].Reason, status.ToString());

            Assert.IsFalse(executionStarted.Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
            StringAssert.Contains(executionStarted.Operations[InputEventOperations.UpdateInputAndRewind].Reason, status.ToString());
        }

        [TestMethod]
        public void RestartInPlaceIsRefusedForSubOrchestrations()
        {
            // Act

            var result = Compute(HistoryWithoutRaisedEvents, parentInstanceId: "parent-instance");

            // Assert

            var executionStarted = result.Events.Single();

            Assert.IsFalse(executionStarted.Operations[InputEventOperations.RestartInPlace].Allowed);
            StringAssert.Contains(executionStarted.Operations[InputEventOperations.RestartInPlace].Reason, "Sub-orchestrations");

            // Rewinding a sub-orchestration is fine, the parent just needs to be told about
            var rewind = executionStarted.Operations[InputEventOperations.UpdateInputAndRewind];
            Assert.IsTrue(rewind.Allowed);
            StringAssert.Contains(rewind.Warning, "parent");
        }

        [TestMethod]
        public void SubOrchestrationsGetAWarningOnReplay()
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents, OrchestrationRuntimeStatus.Completed, parentInstanceId: "parent-instance");

            // Assert

            var replay = result.Events.Single(e => e.IsLast).Operations[InputEventOperations.Replay];

            Assert.IsTrue(replay.Allowed);
            StringAssert.Contains(replay.Warning, "parent");
            Assert.AreEqual("parent-instance", result.ParentInstanceId);
        }

        [TestMethod]
        public void DangerousOperationsRequireTheFlag()
        {
            // Act

            var withRaisedEvents = Compute(HistoryWithTwoRaisedEvents, dangerousOperationsEnabled: false);
            var withoutRaisedEvents = Compute(HistoryWithoutRaisedEvents, dangerousOperationsEnabled: false);

            // Assert

            Assert.IsFalse(withRaisedEvents.DangerousOperationsEnabled);

            var replay = withRaisedEvents.Events.Single(e => e.IsLast).Operations[InputEventOperations.Replay];
            Assert.IsFalse(replay.Allowed);
            StringAssert.Contains(replay.Reason, EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED);

            var restart = withoutRaisedEvents.Events.Single().Operations[InputEventOperations.RestartInPlace];
            Assert.IsFalse(restart.Allowed);
            StringAssert.Contains(restart.Reason, EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED);

            // Rewinding is an ordinary write operation and stays available
            Assert.IsTrue(withRaisedEvents.Events.Single(e => e.IsLast).Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
            Assert.IsTrue(withoutRaisedEvents.Events.Single().Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
        }

        [TestMethod]
        [DataRow(OrchestrationRuntimeStatus.Running, true)]
        [DataRow(OrchestrationRuntimeStatus.Pending, true)]
        [DataRow(OrchestrationRuntimeStatus.Suspended, true)]
        [DataRow(OrchestrationRuntimeStatus.Completed, false)]
        [DataRow(OrchestrationRuntimeStatus.Failed, false)]
        [DataRow(OrchestrationRuntimeStatus.Terminated, false)]
        public void ReplayRequiresTerminateForNonTerminalInstances(OrchestrationRuntimeStatus status, bool expectedRequiresTerminate)
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents, status);

            // Assert

            var replay = result.Events.Single(e => e.IsLast).Operations[InputEventOperations.Replay];

            Assert.IsTrue(replay.Allowed);
            Assert.AreEqual(expectedRequiresTerminate, replay.RequiresTerminate);
        }

        [TestMethod]
        [DataRow(OrchestrationRuntimeStatus.Completed)]
        [DataRow(OrchestrationRuntimeStatus.Running)]
        [DataRow(OrchestrationRuntimeStatus.Terminated)]
        public void UpdateInputAndRewindRequiresAFailedInstance(OrchestrationRuntimeStatus status)
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents, status);

            // Assert

            var rewind = result.Events.Single(e => e.IsLast).Operations[InputEventOperations.UpdateInputAndRewind];

            Assert.IsFalse(rewind.Allowed);
            StringAssert.Contains(rewind.Reason, status.ToString());
        }

        [TestMethod]
        public void StorageProviderCapabilitiesAreRespected()
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents, canUpdateInput: false, canTruncateHistory: false);

            // Assert

            Assert.IsFalse(result.StorageSupports.UpdateInput);
            Assert.IsFalse(result.StorageSupports.TruncateHistory);

            var lastRaised = result.Events.Single(e => e.IsLast);

            Assert.IsFalse(lastRaised.Operations[InputEventOperations.UpdateInputAndRewind].Allowed);
            StringAssert.Contains(lastRaised.Operations[InputEventOperations.UpdateInputAndRewind].Reason, "storage provider");

            Assert.IsFalse(lastRaised.Operations[InputEventOperations.Replay].Allowed);
            StringAssert.Contains(lastRaised.Operations[InputEventOperations.Replay].Reason, "storage provider");
        }

        [TestMethod]
        public void EventsWithoutSequenceNumbersCannotBeAddressed()
        {
            // Arrange

            var history = new[]
            {
                Event(null, "ExecutionStarted", "MyOrchestrator", "{\"a\":1}"),
                Event(null, "EventRaised", "Approval", "{\"ok\":true}")
            };

            // Act

            var result = Compute(history);

            // Assert

            Assert.AreEqual(2, result.Events.Count);

            foreach (var evt in result.Events)
            {
                foreach (var operation in InputEventOperations.All)
                {
                    Assert.IsFalse(evt.Operations[operation].Allowed);
                    StringAssert.Contains(evt.Operations[operation].Reason, "sequence numbers");
                }
            }
        }

        [TestMethod]
        public void EveryInputEventGetsAVerdictForEveryOperation()
        {
            // Act

            var result = Compute(HistoryWithTwoRaisedEvents);

            // Assert

            foreach (var evt in result.Events)
            {
                CollectionAssert.AreEquivalent(InputEventOperations.All, evt.Operations.Keys.ToArray());

                foreach (var operation in evt.Operations.Values.Where(o => !o.Allowed))
                {
                    Assert.IsFalse(string.IsNullOrEmpty(operation.Reason), "A refused operation must say why");
                }
            }
        }
    }
}
