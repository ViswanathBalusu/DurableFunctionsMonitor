// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// SpanBuilder turns an instance's history into the spans the Timeline tab, the 'where the time went'
    /// bars and the peek mini timeline draw (B2). It is pure, so these tests are the full specification of
    /// the algorithm: every pairing rule, the unmatched (still running) rows, retries, the episode markers
    /// and the long-history aggregation.
    /// </summary>
    [TestClass]
    public class SpanBuilderTests
    {
        #region Fixture helpers

        // All timestamps of the mockup fixture are on this day
        private static DateTimeOffset T(string timeOfDay)
        {
            return DateTimeOffset.Parse(
                "2026-09-04T" + timeOfDay + "Z",
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal);
        }

        private static HistoryEvent Event(
            string eventType,
            DateTimeOffset timestamp,
            string name = null,
            long? sequenceNumber = null,
            DateTimeOffset? scheduledTime = null,
            int? eventId = null,
            int? timerId = null,
            DateTimeOffset? fireAt = null,
            string subOrchestrationId = null)
        {
            return new HistoryEvent
            {
                SequenceNumber = sequenceNumber,
                Timestamp = timestamp,
                EventType = eventType,
                Name = name,
                EventId = eventId,
                ScheduledTime = scheduledTime,
                DurationInMs = scheduledTime == null ? 0 : (timestamp - scheduledTime.Value).TotalMilliseconds,
                TimerId = timerId,
                FireAt = fireAt,
                SubOrchestrationId = subOrchestrationId
            };
        }

        /// <summary>
        /// The history of the mockup instance, docs/ui-plans-artifacts/ScreenInstance.dc.html L311-L325,
        /// encoded the way DfMon's history reader returns it: a scheduled task is merged with its completion
        /// row, so the TaskCompleted/TaskFailed rows carry ScheduledTime and the sequence number of the
        /// scheduling row, and only rows that never completed appear as TaskScheduled /
        /// SubOrchestrationInstanceCreated.
        /// </summary>
        private static List<HistoryEvent> MockupHistory()
        {
            return new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("14:02:11.913"), "ProcessOrderOrchestrator", sequenceNumber: 1),
                Event("TaskCompleted", T("14:02:13.917"), "ReserveInventory", sequenceNumber: 2, scheduledTime: T("14:02:12.004")),
                Event("TaskCompleted", T("14:02:17.106"), "ChargePayment", sequenceNumber: 6, scheduledTime: T("14:02:14.002")),
                Event("TaskFailed", T("14:02:21.300"), "ChargePayment", sequenceNumber: 10, scheduledTime: T("14:02:17.210")),
                Event("TimerCreated", T("14:02:21.402"), sequenceNumber: 15, eventId: 15, fireAt: T("14:02:24.402")),
                Event("TimerFired", T("14:02:24.410"), sequenceNumber: 18, timerId: 15, fireAt: T("14:02:24.402")),
                Event("EventRaised", T("14:02:24.913"), "PaymentApproved", sequenceNumber: 27),
                Event("TaskCompleted", T("14:02:28.114"), "ChargePayment", sequenceNumber: 28, scheduledTime: T("14:02:25.001")),
                Event("SubOrchestrationInstanceCreated", T("14:02:28.400"), "NotifyCustomer", sequenceNumber: 31,
                    subOrchestrationId: "order-2026-09-04-000913:0")
            };
        }

        /// <summary>
        /// The four orchestrator episodes of the mockup's 'ProcessOrderOrchestrator' lane
        /// (ScreenInstance.dc.html L301), the last one still open.
        /// </summary>
        private static List<EpisodeMarker> MockupMarkers()
        {
            return new List<EpisodeMarker>
            {
                new EpisodeMarker { Start = T("14:02:11.913"), End = T("14:02:12.313") },
                new EpisodeMarker { Start = T("14:02:13.917"), End = T("14:02:14.017") },
                new EpisodeMarker { Start = T("14:02:21.300"), End = T("14:02:21.402") },
                new EpisodeMarker { Start = T("14:02:28.114"), End = null }
            };
        }

        // The mockup shows the sub-orchestration 'running 30.9 s' (ScreenInstance.dc.html L309)
        private static readonly DateTimeOffset MockupNow = T("14:02:59.300");

        private static string Describe(Span span)
        {
            return $"{span.Kind}/{span.Name ?? "(none)"}#{span.Attempt}/{span.Status}";
        }

        #endregion

        #region The mockup fixture

        [TestMethod]
        public void MockupHistory_ProducesTheMockupLanesInChronologicalOrder()
        {
            // Act
            var result = SpanBuilder.Build(MockupHistory(), MockupMarkers(), OrchestrationRuntimeStatus.Running, MockupNow);

            // Assert: the eight spans the mockup's history rows imply, interleaved with the four orchestrator
            // episodes of the 'orch' lane, ordered by start
            var expected = new[]
            {
                "orchestrator/ProcessOrderOrchestrator#1/completed",
                "activity/ReserveInventory#1/completed",
                "orchestrator/ProcessOrderOrchestrator#2/completed",
                "activity/ChargePayment#1/completed",
                "activity/ChargePayment#2/failed",
                "orchestrator/ProcessOrderOrchestrator#3/completed",
                "timer/(none)#1/fired",
                "eventWait/PaymentApproved#1/waiting",
                "externalEvent/PaymentApproved#1/raised",
                "activity/ChargePayment#3/completed",
                "orchestrator/ProcessOrderOrchestrator#4/running",
                "subOrchestration/NotifyCustomer#1/running"
            };

            CollectionAssert.AreEqual(expected, result.Spans.Select(Describe).ToArray());

            // The retried activity keeps its name, only the attempt number grows
            Assert.AreEqual(3, result.Spans.Count(s => s.Kind == SpanKinds.Activity && s.Name == "ChargePayment"));
        }

        [TestMethod]
        public void MockupHistory_SpanTimestampsIdsAndSequenceNumbers()
        {
            // Act
            var result = SpanBuilder.Build(MockupHistory(), MockupMarkers(), OrchestrationRuntimeStatus.Running, MockupNow);
            var spans = result.Spans.ToDictionary(s => s.Id);

            // Assert: a merged activity row spans from its ScheduledTime to its Timestamp...
            var reserve = spans["activity:2"];
            Assert.AreEqual(T("14:02:12.004"), reserve.Start);
            Assert.AreEqual(T("14:02:13.917"), reserve.End);
            Assert.AreEqual(1913, reserve.DurationMs.Value, 0.001);
            CollectionAssert.AreEqual(new long[] { 2 }, reserve.SequenceNumbers.ToArray());

            // ...the timer spans from TimerCreated to TimerFired and carries both rows...
            var timer = spans["timer:15"];
            Assert.AreEqual(T("14:02:21.402"), timer.Start);
            Assert.AreEqual(T("14:02:24.410"), timer.End);
            Assert.AreEqual(3008, timer.DurationMs.Value, 0.001);
            CollectionAssert.AreEqual(new long[] { 15, 18 }, timer.SequenceNumbers.ToArray());

            // ...the wait for an external event starts at the previous history row...
            var wait = spans["eventWait:27"];
            Assert.AreEqual(T("14:02:24.410"), wait.Start);
            Assert.AreEqual(T("14:02:24.913"), wait.End);
            Assert.AreEqual(503, wait.DurationMs.Value, 0.001);

            // ...the event itself is a zero-length mark...
            var raised = spans["externalEvent:27"];
            Assert.AreEqual(T("14:02:24.913"), raised.Start);
            Assert.AreEqual(T("14:02:24.913"), raised.End);
            Assert.AreEqual(0, raised.DurationMs.Value, 0.001);

            // ...and the running sub-orchestration has no end, but does have a child instance id
            var sub = spans["subOrchestration:31"];
            Assert.AreEqual(T("14:02:28.400"), sub.Start);
            Assert.IsNull(sub.End);
            Assert.IsNull(sub.DurationMs);
            Assert.AreEqual("order-2026-09-04-000913:0", sub.SubOrchestrationId);

            // Every id is unique, so the UI can key its rows by it
            Assert.AreEqual(result.Spans.Count, result.Spans.Select(s => s.Id).Distinct().Count());
        }

        [TestMethod]
        public void MockupHistory_Totals()
        {
            // Act
            var result = SpanBuilder.Build(MockupHistory(), MockupMarkers(), OrchestrationRuntimeStatus.Running, MockupNow);

            // Assert
            Assert.AreEqual(T("14:02:11.913"), result.ExecutionStartedAt.Value);
            Assert.IsNull(result.ExecutionEndedAt);

            // 1.913 + 3.104 + 4.090 + 3.113 s. (B2-S2-T1's "activities ~ 9.1 s" is the sum of the first
            // three activities only - it leaves out the third ChargePayment attempt, which the mockup's
            // history row n=30 does contain.)
            Assert.AreEqual(12220, result.Totals.ActivitiesMs, 0.001);
            Assert.IsTrue(result.Totals.ActivitiesMs > 5000 && result.Totals.ActivitiesMs < 20000,
                $"activities total is of the mockup's order of magnitude: {result.Totals.ActivitiesMs}");

            // The sub-orchestration is still running, so it counts until 'now'
            Assert.AreEqual(30900, result.Totals.SubOrchestrationsMs, 0.001);
            Assert.AreEqual(3008, result.Totals.TimersMs, 0.001);
            Assert.AreEqual(503, result.Totals.ExternalEventWaitMs, 0.001);

            // 400 + 100 + 102 ms of finished episodes, plus the open one until 'now'
            Assert.AreEqual(31788, result.Totals.OrchestratorMs.Value, 0.001);

            // now - ExecutionStarted
            Assert.AreEqual(47387, result.Totals.TotalMs, 0.001);
        }

        [TestMethod]
        public void MockupHistory_WithoutMarkers_HasNoOrchestratorSpansAndNoOrchestratorMs()
        {
            // Act
            var result = SpanBuilder.Build(MockupHistory(), null, OrchestrationRuntimeStatus.Running, MockupNow);

            // Assert
            Assert.AreEqual(0, result.Spans.Count(s => s.Kind == SpanKinds.Orchestrator));
            Assert.AreEqual(8, result.Spans.Count);
            Assert.IsNull(result.Totals.OrchestratorMs);

            // The other totals are unaffected
            Assert.AreEqual(12220, result.Totals.ActivitiesMs, 0.001);
        }

        [TestMethod]
        public void EmptyMarkerList_MeansZeroOrchestratorMsRatherThanNull()
        {
            // Act
            var result = SpanBuilder.Build(MockupHistory(), new List<EpisodeMarker>(), OrchestrationRuntimeStatus.Running, MockupNow);

            // Assert
            Assert.AreEqual(0, result.Spans.Count(s => s.Kind == SpanKinds.Orchestrator));
            Assert.AreEqual(0, result.Totals.OrchestratorMs.Value, 0.001);
        }

        [TestMethod]
        public void MockupHistory_SerializesToTheContractShape()
        {
            // Arrange
            var result = SpanBuilder.Build(MockupHistory(), MockupMarkers(), OrchestrationRuntimeStatus.Running, MockupNow);

            // Act: exactly the way the /spans function will serialize it
            string json = JsonConvert.SerializeObject(result, Globals.SerializerSettings);
            JObject parsed;
            using (var reader = new JsonTextReader(new System.IO.StringReader(json)) { DateParseHandling = DateParseHandling.None })
            {
                parsed = JObject.Load(reader);
            }

            // Assert: contracts section 6, Span and the totals of SpansResponse
            var activity = parsed["spans"].Single(s => s["id"].Value<string>() == "activity:2");

            Assert.AreEqual("activity", activity["kind"].Value<string>());
            Assert.AreEqual("ReserveInventory", activity["name"].Value<string>());
            Assert.AreEqual(1, activity["attempt"].Value<int>());
            Assert.AreEqual("completed", activity["status"].Value<string>());
            Assert.AreEqual(1913, activity["durationMs"].Value<double>(), 0.001);
            Assert.AreEqual(2L, activity["sequenceNumbers"].Single().Value<long>());

            // Span timestamps keep their milliseconds (ISO 8601 UTC), or a sub-second activity would draw
            // as a zero-width bar
            Assert.AreEqual("2026-09-04T14:02:12.004Z", activity["start"].Value<string>());
            Assert.AreEqual("2026-09-04T14:02:13.917Z", activity["end"].Value<string>());

            // subOrchestrationId is only there for sub-orchestration spans
            Assert.IsNull(activity["subOrchestrationId"]);
            Assert.AreEqual("order-2026-09-04-000913:0",
                parsed["spans"].Single(s => s["id"].Value<string>() == "subOrchestration:31")["subOrchestrationId"].Value<string>());

            // Open spans report a null end and a null duration
            var openSub = parsed["spans"].Single(s => s["id"].Value<string>() == "subOrchestration:31");
            Assert.AreEqual(JTokenType.Null, openSub["end"].Type);
            Assert.AreEqual(JTokenType.Null, openSub["durationMs"].Type);

            Assert.AreEqual(12220, parsed["totals"]["activitiesMs"].Value<double>(), 0.001);
            Assert.AreEqual(30900, parsed["totals"]["subOrchestrationsMs"].Value<double>(), 0.001);
            Assert.AreEqual(3008, parsed["totals"]["timersMs"].Value<double>(), 0.001);
            Assert.AreEqual(503, parsed["totals"]["externalEventWaitMs"].Value<double>(), 0.001);
            Assert.AreEqual(31788, parsed["totals"]["orchestratorMs"].Value<double>(), 0.001);
            Assert.AreEqual(47387, parsed["totals"]["totalMs"].Value<double>(), 0.001);

            Assert.AreEqual("2026-09-04T14:02:11.913Z", parsed["executionStartedAt"].Value<string>());
            Assert.AreEqual(JTokenType.Null, parsed["executionEndedAt"].Type);
        }

        [TestMethod]
        public void NoMarkers_SerializesOrchestratorMsAsNull()
        {
            // Arrange
            var result = SpanBuilder.Build(MockupHistory(), null, OrchestrationRuntimeStatus.Running, MockupNow);

            // Act
            var parsed = JObject.Parse(JsonConvert.SerializeObject(result, Globals.SerializerSettings));

            // Assert: the key is always there, its value is null
            Assert.AreEqual(JTokenType.Null, parsed["totals"]["orchestratorMs"].Type);
        }

        #endregion

        #region Activities and sub-orchestrations

        [TestMethod]
        public void UnmatchedTaskScheduled_IsARunningActivityWithoutAnEnd()
        {
            // Arrange: the activity was scheduled and never came back
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskScheduled", T("10:00:01.000"), "SlowActivity", sequenceNumber: 2)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:11.000"));

            // Assert
            var span = result.Spans.Single();
            Assert.AreEqual("activity:2", span.Id);
            Assert.AreEqual(SpanStatuses.Running, span.Status);
            Assert.AreEqual(T("10:00:01.000"), span.Start);
            Assert.IsNull(span.End);
            Assert.IsNull(span.DurationMs);

            // An open span counts until 'now' in the totals
            Assert.AreEqual(10000, result.Totals.ActivitiesMs, 0.001);
        }

        [TestMethod]
        public void UnmatchedSubOrchestrationInstanceCreated_IsARunningSubOrchestration()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("SubOrchestrationInstanceCreated", T("10:00:01.000"), "Child", sequenceNumber: 2, subOrchestrationId: "child-1")
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:03.000"));

            // Assert
            var span = result.Spans.Single();
            Assert.AreEqual(SpanKinds.SubOrchestration, span.Kind);
            Assert.AreEqual(SpanStatuses.Running, span.Status);
            Assert.AreEqual("child-1", span.SubOrchestrationId);
            Assert.IsNull(span.End);
            Assert.AreEqual(2000, result.Totals.SubOrchestrationsMs, 0.001);
        }

        [TestMethod]
        public void CompletedAndFailedSubOrchestrations_SpanFromScheduledTimeToTimestamp()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("SubOrchestrationInstanceCompleted", T("10:00:05.000"), "Child", sequenceNumber: 2,
                    scheduledTime: T("10:00:01.000"), subOrchestrationId: "child-1"),
                Event("SubOrchestrationInstanceFailed", T("10:00:09.000"), "Child", sequenceNumber: 6,
                    scheduledTime: T("10:00:06.000"), subOrchestrationId: "child-2"),
                Event("ExecutionCompleted", T("10:00:10.000"), sequenceNumber: 8)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            var completed = result.Spans.First();
            Assert.AreEqual(SpanStatuses.Completed, completed.Status);
            Assert.AreEqual(T("10:00:01.000"), completed.Start);
            Assert.AreEqual(T("10:00:05.000"), completed.End);
            Assert.AreEqual("child-1", completed.SubOrchestrationId);
            Assert.AreEqual(1, completed.Attempt);

            var failed = result.Spans.Last();
            Assert.AreEqual(SpanStatuses.Failed, failed.Status);
            Assert.AreEqual(T("10:00:06.000"), failed.Start);
            Assert.AreEqual(T("10:00:09.000"), failed.End);
            Assert.AreEqual("child-2", failed.SubOrchestrationId);

            // Same name and kind, so this is the second attempt
            Assert.AreEqual(2, failed.Attempt);

            Assert.AreEqual(7000, result.Totals.SubOrchestrationsMs, 0.001);
        }

        [TestMethod]
        public void Attempts_AreCountedPerKindAndName()
        {
            // Arrange: two activities and one sub-orchestration, all called 'Work'
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskFailed", T("10:00:02.000"), "Work", sequenceNumber: 2, scheduledTime: T("10:00:01.000")),
                Event("SubOrchestrationInstanceCompleted", T("10:00:04.000"), "Work", sequenceNumber: 4, scheduledTime: T("10:00:03.000")),
                Event("TaskCompleted", T("10:00:06.000"), "Work", sequenceNumber: 6, scheduledTime: T("10:00:05.000")),
                Event("TaskCompleted", T("10:00:08.000"), "Other", sequenceNumber: 8, scheduledTime: T("10:00:07.000")),
                Event("ExecutionCompleted", T("10:00:09.000"), sequenceNumber: 9)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            CollectionAssert.AreEqual(
                new[]
                {
                    "activity/Work#1/failed",
                    "subOrchestration/Work#1/completed",
                    "activity/Work#2/completed",
                    "activity/Other#1/completed"
                },
                result.Spans.Select(Describe).ToArray());
        }

        [TestMethod]
        public void ScheduledTimeAfterTimestamp_ClampsToAZeroLengthSpan()
        {
            // Arrange: clock skew between the workers put the scheduling row after the completion row
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskCompleted", T("10:00:02.000"), "Skewed", sequenceNumber: 2, scheduledTime: T("10:00:05.000")),
                Event("ExecutionCompleted", T("10:00:06.000"), sequenceNumber: 3)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            var span = result.Spans.Single();
            Assert.AreEqual(T("10:00:02.000"), span.Start);
            Assert.AreEqual(T("10:00:02.000"), span.End);
            Assert.AreEqual(0, span.DurationMs.Value, 0.001);
            Assert.AreEqual(0, result.Totals.ActivitiesMs, 0.001);
        }

        #endregion

        #region Timers

        [TestMethod]
        public void Timers_ArePairedByTimerIdEvenWhenTheyFireOutOfOrder()
        {
            // Arrange: two timers created in a row, the second one fires first
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2, eventId: 2, fireAt: T("10:00:31.000")),
                Event("TimerCreated", T("10:00:02.000"), sequenceNumber: 3, eventId: 3, fireAt: T("10:00:07.000")),
                Event("TimerFired", T("10:00:07.100"), sequenceNumber: 4, timerId: 3, fireAt: T("10:00:07.000")),
                Event("TimerFired", T("10:00:31.200"), sequenceNumber: 5, timerId: 2, fireAt: T("10:00:31.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:01:00.000"));

            // Assert: the long timer (EventId 2) is closed by the TimerFired that carries TimerId 2
            var timers = result.Spans.Where(s => s.Kind == SpanKinds.Timer).ToList();
            Assert.AreEqual(2, timers.Count);

            var first = timers.Single(s => s.Id == "timer:2");
            Assert.AreEqual(T("10:00:01.000"), first.Start);
            Assert.AreEqual(T("10:00:31.200"), first.End);
            Assert.AreEqual(SpanStatuses.Fired, first.Status);
            CollectionAssert.AreEqual(new long[] { 2, 5 }, first.SequenceNumbers.ToArray());

            var second = timers.Single(s => s.Id == "timer:3");
            Assert.AreEqual(T("10:00:02.000"), second.Start);
            Assert.AreEqual(T("10:00:07.100"), second.End);
            CollectionAssert.AreEqual(new long[] { 3, 4 }, second.SequenceNumbers.ToArray());
        }

        [TestMethod]
        public void Timers_WithoutTimerId_ArePairedFirstInFirstOut()
        {
            // Arrange: MSSQL reports neither TimerId nor FireAt
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2),
                Event("TimerCreated", T("10:00:02.000"), sequenceNumber: 3),
                Event("TimerFired", T("10:00:05.000"), sequenceNumber: 4),
                Event("TimerFired", T("10:00:09.000"), sequenceNumber: 5)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:01:00.000"));

            // Assert
            var timers = result.Spans.Where(s => s.Kind == SpanKinds.Timer).ToList();
            Assert.AreEqual(2, timers.Count);

            Assert.AreEqual(T("10:00:01.000"), timers[0].Start);
            Assert.AreEqual(T("10:00:05.000"), timers[0].End);
            Assert.AreEqual(SpanStatuses.Fired, timers[0].Status);

            Assert.AreEqual(T("10:00:02.000"), timers[1].Start);
            Assert.AreEqual(T("10:00:09.000"), timers[1].End);

            Assert.AreEqual(4000 + 7000, result.Totals.TimersMs, 0.001);
        }

        [TestMethod]
        public void UnpairedTimerCreated_WithFireAtInTheFuture_IsRunningUntilItIsDue()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2, eventId: 2, fireAt: T("10:05:00.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:30.000"));

            // Assert
            var timer = result.Spans.Single(s => s.Kind == SpanKinds.Timer);
            Assert.AreEqual(SpanStatuses.Running, timer.Status);
            Assert.AreEqual(T("10:00:01.000"), timer.Start);
            Assert.AreEqual(T("10:05:00.000"), timer.End);
            CollectionAssert.AreEqual(new long[] { 2 }, timer.SequenceNumbers.ToArray());
        }

        [TestMethod]
        public void UnpairedTimerCreated_WithoutFireAt_IsRunningWithoutAnEnd()
        {
            // Arrange: no FireAt column (MSSQL), no TimerFired row yet
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:31.000"));

            // Assert
            var timer = result.Spans.Single(s => s.Kind == SpanKinds.Timer);
            Assert.AreEqual(SpanStatuses.Running, timer.Status);
            Assert.IsNull(timer.End);
            Assert.IsNull(timer.DurationMs);

            // Open, so it counts until 'now'
            Assert.AreEqual(30000, result.Totals.TimersMs, 0.001);
        }

        [TestMethod]
        public void UnpairedTimerCreated_WhoseFireAtHasPassed_EndsWhenItWasDue()
        {
            // Arrange: the timer was due two minutes ago and the history has no TimerFired row for it
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2, eventId: 2, fireAt: T("10:00:31.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:02:31.000"));

            // Assert: the bar stops at the due moment rather than growing forever
            var timer = result.Spans.Single(s => s.Kind == SpanKinds.Timer);
            Assert.AreEqual(SpanStatuses.Fired, timer.Status);
            Assert.AreEqual(T("10:00:31.000"), timer.End);
            Assert.AreEqual(30000, result.Totals.TimersMs, 0.001);
        }

        [TestMethod]
        public void OrphanTimerFired_IsAZeroLengthFiredSpan()
        {
            // Arrange: the TimerCreated row is gone (truncated history)
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerFired", T("10:00:05.000"), sequenceNumber: 4, timerId: 2)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:01:00.000"));

            // Assert
            var timer = result.Spans.Single(s => s.Kind == SpanKinds.Timer);
            Assert.AreEqual(SpanStatuses.Fired, timer.Status);
            Assert.AreEqual(T("10:00:05.000"), timer.Start);
            Assert.AreEqual(T("10:00:05.000"), timer.End);
            Assert.AreEqual(0, result.Totals.TimersMs, 0.001);
        }

        #endregion

        #region External events and the open wait

        [TestMethod]
        public void FirstEventRaised_WaitsFromTheExecutionStart()
        {
            // Arrange: nothing happened between the start and the event
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("EventRaised", T("10:00:04.000"), "Approval", sequenceNumber: 2),
                Event("ExecutionCompleted", T("10:00:05.000"), sequenceNumber: 3)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            var wait = result.Spans.Single(s => s.Kind == SpanKinds.EventWait);
            Assert.AreEqual("Approval", wait.Name);
            Assert.AreEqual(SpanStatuses.Waiting, wait.Status);
            Assert.AreEqual(T("10:00:00.000"), wait.Start);
            Assert.AreEqual(T("10:00:04.000"), wait.End);
            Assert.AreEqual(4000, result.Totals.ExternalEventWaitMs, 0.001);

            var raised = result.Spans.Single(s => s.Kind == SpanKinds.ExternalEvent);
            Assert.AreEqual("Approval", raised.Name);
            Assert.AreEqual(SpanStatuses.Raised, raised.Status);
            Assert.AreEqual(0, raised.DurationMs.Value, 0.001);
        }

        [TestMethod]
        public void RunningInstance_WhoseLastRowIsClosed_GetsAnOpenUnnamedWait()
        {
            // Arrange: the last thing that happened is a completed activity, so the orchestrator is now
            // waiting for something external - the history cannot say what
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskCompleted", T("10:00:04.000"), "Work", sequenceNumber: 2, scheduledTime: T("10:00:01.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:34.000"));

            // Assert
            var wait = result.Spans.Single(s => s.Kind == SpanKinds.EventWait);
            Assert.AreEqual("eventWait:2", wait.Id);
            Assert.IsNull(wait.Name);
            Assert.AreEqual(SpanStatuses.Waiting, wait.Status);
            Assert.AreEqual(T("10:00:04.000"), wait.Start);
            Assert.IsNull(wait.End);
            Assert.IsNull(wait.DurationMs);
            Assert.AreEqual(0, wait.SequenceNumbers.Count);

            // Counts until 'now'
            Assert.AreEqual(30000, result.Totals.ExternalEventWaitMs, 0.001);
        }

        [TestMethod]
        public void SuspendedInstance_IsNotTerminalSoItAlsoGetsTheOpenWait()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskCompleted", T("10:00:04.000"), "Work", sequenceNumber: 2, scheduledTime: T("10:00:01.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Suspended, T("10:00:34.000"));

            // Assert
            Assert.AreEqual(1, result.Spans.Count(s => s.Kind == SpanKinds.EventWait && s.End == null));
        }

        [TestMethod]
        public void TerminalInstance_GetsNoOpenWait()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskCompleted", T("10:00:04.000"), "Work", sequenceNumber: 2, scheduledTime: T("10:00:01.000")),
                Event("ExecutionCompleted", T("10:00:05.000"), sequenceNumber: 3)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            Assert.AreEqual(0, result.Spans.Count(s => s.Kind == SpanKinds.EventWait));
            Assert.AreEqual(0, result.Totals.ExternalEventWaitMs, 0.001);
        }

        [TestMethod]
        public void RunningInstance_WaitingForAnActivityOrSubOrchestrationOrTimer_GetsNoOpenWait()
        {
            // Arrange
            var openActivity = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskScheduled", T("10:00:01.000"), "Work", sequenceNumber: 2)
            };

            var openSubOrchestration = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("SubOrchestrationInstanceCreated", T("10:00:01.000"), "Child", sequenceNumber: 2, subOrchestrationId: "child-1")
            };

            var openTimer = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2, eventId: 2, fireAt: T("10:05:00.000"))
            };

            // Act + Assert
            foreach (var history in new[] { openActivity, openSubOrchestration, openTimer })
            {
                var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:30.000"));

                Assert.AreEqual(0, result.Spans.Count(s => s.Kind == SpanKinds.EventWait),
                    $"no open wait expected after {history[history.Count - 1].EventType}");
            }
        }

        [TestMethod]
        public void RunningInstance_WhoseLastRowIsAFiredTimer_GetsTheOpenWait()
        {
            // Arrange: the timer fired, so the orchestrator is waiting for something else now
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TimerCreated", T("10:00:01.000"), sequenceNumber: 2, eventId: 2, fireAt: T("10:00:04.000")),
                Event("TimerFired", T("10:00:04.100"), sequenceNumber: 3, timerId: 2)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:34.100"));

            // Assert
            var wait = result.Spans.Single(s => s.Kind == SpanKinds.EventWait);
            Assert.AreEqual(T("10:00:04.100"), wait.Start);
            Assert.IsNull(wait.End);
        }

        #endregion

        #region Execution boundaries and robustness

        [TestMethod]
        public void OnlyTheCurrentExecutionCounts()
        {
            // Arrange: the instance continued as new, so the history holds two executions
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskCompleted", T("10:00:04.000"), "OldWork", sequenceNumber: 2, scheduledTime: T("10:00:01.000")),
                Event("ContinueAsNew", T("10:00:05.000"), sequenceNumber: 3),
                Event("ExecutionStarted", T("10:00:06.000"), "Orch", sequenceNumber: 4),
                Event("TaskCompleted", T("10:00:09.000"), "NewWork", sequenceNumber: 5, scheduledTime: T("10:00:07.000")),
                Event("ExecutionCompleted", T("10:00:10.000"), sequenceNumber: 6)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            Assert.AreEqual(T("10:00:06.000"), result.ExecutionStartedAt.Value);
            Assert.AreEqual(T("10:00:10.000"), result.ExecutionEndedAt.Value);

            var span = result.Spans.Single();
            Assert.AreEqual("NewWork", span.Name);
            Assert.AreEqual(2000, result.Totals.ActivitiesMs, 0.001);

            // ExecutionEndedAt - ExecutionStartedAt, not until 'now'
            Assert.AreEqual(4000, result.Totals.TotalMs, 0.001);
        }

        [TestMethod]
        public void ExecutionEndedAt_ComesFromTheTerminalRowWhicheverItIs()
        {
            foreach (string terminalEventType in new[] { "ExecutionCompleted", "ExecutionFailed", "ExecutionTerminated" })
            {
                // Arrange
                var history = new List<HistoryEvent>
                {
                    Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                    Event(terminalEventType, T("10:00:08.000"), sequenceNumber: 2)
                };

                // Act
                var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Failed, T("10:01:00.000"));

                // Assert
                Assert.AreEqual(T("10:00:08.000"), result.ExecutionEndedAt.Value, terminalEventType);
                Assert.AreEqual(8000, result.Totals.TotalMs, 0.001, terminalEventType);
                Assert.AreEqual(0, result.Spans.Count, terminalEventType);
            }
        }

        [TestMethod]
        public void RunningInstance_TotalMsCountsUntilNow()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskScheduled", T("10:00:01.000"), "Work", sequenceNumber: 2)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:20.000"));

            // Assert
            Assert.IsNull(result.ExecutionEndedAt);
            Assert.AreEqual(20000, result.Totals.TotalMs, 0.001);
        }

        [TestMethod]
        public void RowsWithoutATimestampAreSkipped()
        {
            // Arrange: a row the provider could not date at all
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                new HistoryEvent { EventType = "TaskCompleted", Name = "Undated", SequenceNumber = 2 },
                Event("TaskCompleted", T("10:00:04.000"), "Work", sequenceNumber: 3, scheduledTime: T("10:00:01.000")),
                Event("ExecutionCompleted", T("10:00:05.000"), sequenceNumber: 4)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            var span = result.Spans.Single();
            Assert.AreEqual("Work", span.Name);
        }

        [TestMethod]
        public void EmptyOrNullHistory_YieldsAnEmptyResult()
        {
            foreach (var history in new IReadOnlyList<HistoryEvent>[] { null, new List<HistoryEvent>() })
            {
                // Act
                var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Pending, T("10:00:00.000"));

                // Assert
                Assert.AreEqual(0, result.Spans.Count);
                Assert.IsNull(result.ExecutionStartedAt);
                Assert.IsNull(result.ExecutionEndedAt);
                Assert.AreEqual(0, result.Totals.TotalMs, 0.001);
                Assert.AreEqual(0, result.Totals.ActivitiesMs, 0.001);
                Assert.IsNull(result.Totals.OrchestratorMs);
            }
        }

        [TestMethod]
        public void HistoryWithoutExecutionStarted_StillProducesSpans()
        {
            // Arrange: a provider that does not return the ExecutionStarted row (or a purged prefix)
            var history = new List<HistoryEvent>
            {
                Event("TaskCompleted", T("10:00:04.000"), "Work", sequenceNumber: 2, scheduledTime: T("10:00:01.000")),
                Event("ExecutionCompleted", T("10:00:05.000"), sequenceNumber: 3)
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            Assert.IsNull(result.ExecutionStartedAt);
            Assert.AreEqual(T("10:00:05.000"), result.ExecutionEndedAt.Value);
            Assert.AreEqual(1, result.Spans.Count);

            // Falls back to the first row that is left
            Assert.AreEqual(1000, result.Totals.TotalMs, 0.001);
        }

        [TestMethod]
        public void SequenceNumbersAreEmptyWhenTheProviderDoesNotReportThem()
        {
            // Arrange: Netherite-style history without sequence numbers
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch"),
                Event("TaskCompleted", T("10:00:04.000"), "Work", scheduledTime: T("10:00:01.000")),
                Event("TaskCompleted", T("10:00:08.000"), "Work", scheduledTime: T("10:00:05.000")),
                Event("ExecutionCompleted", T("10:00:09.000"))
            };

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert: ids fall back to the row index, and they are still unique
            CollectionAssert.AreEqual(new[] { "activity:1", "activity:2" }, result.Spans.Select(s => s.Id).ToArray());
            Assert.IsTrue(result.Spans.All(s => s.SequenceNumbers.Count == 0));
        }

        #endregion

        #region Episode markers

        [TestMethod]
        public void OpenEpisode_IsARunningOrchestratorSpan()
        {
            // Arrange
            var history = new List<HistoryEvent>
            {
                Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1),
                Event("TaskScheduled", T("10:00:01.000"), "Work", sequenceNumber: 2)
            };

            var markers = new List<EpisodeMarker>
            {
                new EpisodeMarker { Start = T("10:00:00.000"), End = T("10:00:00.500") },
                new EpisodeMarker { Start = T("10:00:01.000"), End = null }
            };

            // Act
            var result = SpanBuilder.Build(history, markers, OrchestrationRuntimeStatus.Running, T("10:00:11.000"));

            // Assert
            var episodes = result.Spans.Where(s => s.Kind == SpanKinds.Orchestrator).ToList();
            Assert.AreEqual(2, episodes.Count);

            Assert.AreEqual("orchestrator:0", episodes[0].Id);
            Assert.AreEqual("Orch", episodes[0].Name);
            Assert.AreEqual(1, episodes[0].Attempt);
            Assert.AreEqual(SpanStatuses.Completed, episodes[0].Status);
            Assert.AreEqual(500, episodes[0].DurationMs.Value, 0.001);

            Assert.AreEqual("orchestrator:1", episodes[1].Id);
            Assert.AreEqual(2, episodes[1].Attempt);
            Assert.AreEqual(SpanStatuses.Running, episodes[1].Status);
            Assert.IsNull(episodes[1].End);
            Assert.IsNull(episodes[1].DurationMs);

            // 500 ms of the first episode plus the open one until 'now'
            Assert.AreEqual(500 + 10000, result.Totals.OrchestratorMs.Value, 0.001);
        }

        #endregion

        #region Long histories

        [TestMethod]
        public void HistoriesLongerThan5000Rows_AggregateSpansOfTheSameNameStartingWithin500Ms()
        {
            // Arrange: 6,000 fan-out activities, all scheduled inside the same 100 ms and all 1 s long
            var history = new List<HistoryEvent> { Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1) };

            var scheduledAt = T("10:00:01.000");
            for (int i = 0; i < 6000; i++)
            {
                // 6,000 rows spread over 100 ms: well inside the 500 ms aggregation window
                var scheduled = scheduledAt.AddTicks(i * TimeSpan.TicksPerMillisecond / 60);
                history.Add(Event("TaskCompleted", scheduled.AddSeconds(1), "FanOut", sequenceNumber: i + 2, scheduledTime: scheduled));
            }

            Assert.AreEqual(6001, history.Count);

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:30.000"));

            // Assert: one aggregated activity span (plus the open wait of the running instance)
            var activities = result.Spans.Where(s => s.Kind == SpanKinds.Activity).ToList();
            Assert.AreEqual(1, activities.Count);

            var aggregated = activities.Single();
            Assert.AreEqual("activity:2", aggregated.Id);
            Assert.AreEqual("FanOut", aggregated.Name);

            // Attempt is how many spans were folded in
            Assert.AreEqual(6000, aggregated.Attempt);
            Assert.AreEqual(SpanStatuses.Completed, aggregated.Status);
            Assert.AreEqual(scheduledAt, aggregated.Start);
            Assert.AreEqual(6000, aggregated.SequenceNumbers.Count);

            // The aggregated bar reaches the end of the last activity of the group
            Assert.AreEqual(history[history.Count - 1].Timestamp, aggregated.End.Value);
        }

        [TestMethod]
        public void Aggregation_KeepsSpansOfDifferentNamesAndOfDistantStartsApart()
        {
            // Arrange: 5,002 rows - two groups of the same activity 10 s apart, plus one other activity
            var history = new List<HistoryEvent> { Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1) };

            for (int i = 0; i < 2500; i++)
            {
                var firstGroup = T("10:00:01.000").AddTicks(i * TimeSpan.TicksPerMillisecond / 30);
                history.Add(Event("TaskCompleted", firstGroup.AddSeconds(1), "FanOut", sequenceNumber: history.Count + 1, scheduledTime: firstGroup));
            }

            history.Add(Event("TaskCompleted", T("10:00:06.000"), "Other", sequenceNumber: history.Count + 1, scheduledTime: T("10:00:05.000")));

            for (int i = 0; i < 2500; i++)
            {
                var secondGroup = T("10:00:11.000").AddTicks(i * TimeSpan.TicksPerMillisecond / 30);
                history.Add(Event("TaskCompleted", secondGroup.AddSeconds(1), "FanOut", sequenceNumber: history.Count + 1, scheduledTime: secondGroup));
            }

            history.Add(Event("ExecutionCompleted", T("10:00:20.000"), sequenceNumber: history.Count + 1));

            Assert.IsTrue(history.Count > SpanBuilder.MaxEventsBeforeStartAggregating);

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert
            CollectionAssert.AreEqual(
                new[] { "activity/FanOut#2500/completed", "activity/Other#1/completed", "activity/FanOut#2500/completed" },
                result.Spans.Select(Describe).ToArray());
        }

        [TestMethod]
        public void HistoriesOf5000RowsOrLessAreNotAggregated()
        {
            // Arrange: 4,000 identical activities, all inside the aggregation window
            var history = new List<HistoryEvent> { Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1) };

            for (int i = 0; i < 4000; i++)
            {
                var scheduled = T("10:00:01.000").AddTicks(i * TimeSpan.TicksPerMillisecond / 40);
                history.Add(Event("TaskCompleted", scheduled.AddSeconds(1), "FanOut", sequenceNumber: i + 2, scheduledTime: scheduled));
            }

            history.Add(Event("ExecutionCompleted", T("10:00:10.000"), sequenceNumber: 4002));

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Completed, T("10:01:00.000"));

            // Assert: every activity keeps its own span, numbered as an attempt
            Assert.AreEqual(4000, result.Spans.Count(s => s.Kind == SpanKinds.Activity));
            Assert.AreEqual(4000, result.Spans.Last(s => s.Kind == SpanKinds.Activity).Attempt);
        }

        [TestMethod]
        public void Aggregation_ReportsAnOpenGroupAsRunningAndAFailedOneAsFailed()
        {
            // Arrange: 5,001 rows where the last two of an otherwise completed group failed / never returned
            var history = new List<HistoryEvent> { Event("ExecutionStarted", T("10:00:00.000"), "Orch", sequenceNumber: 1) };

            for (int i = 0; i < 5000; i++)
            {
                var scheduled = T("10:00:01.000").AddTicks(i * TimeSpan.TicksPerMillisecond / 50);
                string eventType = i == 4998 ? "TaskFailed" : (i == 4999 ? "TaskScheduled" : "TaskCompleted");

                history.Add(eventType == "TaskScheduled"
                    ? Event(eventType, scheduled, "FanOut", sequenceNumber: i + 2)
                    : Event(eventType, scheduled.AddSeconds(1), "FanOut", sequenceNumber: i + 2, scheduledTime: scheduled));
            }

            // Act
            var result = SpanBuilder.Build(history, null, OrchestrationRuntimeStatus.Running, T("10:00:30.000"));

            // Assert
            var aggregated = result.Spans.Single(s => s.Kind == SpanKinds.Activity);
            Assert.AreEqual(5000, aggregated.Attempt);
            Assert.AreEqual(SpanStatuses.Failed, aggregated.Status);
            Assert.IsNull(aggregated.End);
        }

        #endregion
    }
}
