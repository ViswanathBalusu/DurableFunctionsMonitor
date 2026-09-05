// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class AuditOperationsTests
    {
        private const string RoutePrefix = "/a/p/i/conn-hub";

        // The single-instance endpoints all share DfmPostOrchestrationFunction's route
        // (orchestrations('{instanceId}')/{action?}), so the action route value is populated.
        [TestMethod]
        [DataRow("suspend", "Suspend", false, DisplayName = "suspend -> Suspend")]
        [DataRow("resume", "Resume", false, DisplayName = "resume -> Resume")]
        [DataRow("rewind", "Rewind", false, DisplayName = "rewind -> Rewind")]
        [DataRow("terminate", "Terminate", false, DisplayName = "terminate -> Terminate")]
        [DataRow("raise-event", "Raise event", false, DisplayName = "raise-event -> Raise event")]
        [DataRow("set-custom-status", "Set customStatus", false, DisplayName = "set-custom-status -> Set customStatus")]
        [DataRow("restart", "Restart", false, DisplayName = "restart -> Restart")]
        [DataRow("purge", "Purge", false, DisplayName = "purge -> Purge")]
        public void MapsActionRouteSegments(string action, string expectedOperation, bool expectedDangerous)
        {
            string path = $"{RoutePrefix}/orchestrations('inst1')/{action}";

            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("POST", path, action);

            Assert.AreEqual(expectedOperation, operation);
            Assert.AreEqual(expectedDangerous, dangerous);
            Assert.AreEqual("inst1", instanceId);
        }

        // The input-events endpoints and the bulk endpoints live at fixed (non-wildcard) routes,
        // so the middleware has no {action} route value for them and the path itself is parsed.
        [TestMethod]
        [DataRow("/orchestrations('inst1')/input-events/update-input-and-rewind", "Update input and rewind", false, "inst1", DisplayName = "update-input-and-rewind")]
        [DataRow("/orchestrations('inst1')/input-events/replay", "Replay", true, "inst1", DisplayName = "replay (dangerous)")]
        [DataRow("/orchestrations('inst1')/input-events/restart-in-place", "Restart in place", true, "inst1", DisplayName = "restart-in-place (dangerous)")]
        [DataRow("/orchestrations/batch", "Batch", false, null, DisplayName = "orchestrations/batch -> Batch")]
        [DataRow("/purge-history", "Purge history", false, null, DisplayName = "purge-history -> Purge history")]
        [DataRow("/clean-entity-storage", "Clean entity storage", false, null, DisplayName = "clean-entity-storage -> Clean entity storage")]
        [DataRow("/delete-task-hub", "Delete task hub", false, null, DisplayName = "delete-task-hub -> Delete task hub")]
        public void MapsFixedPathSegments(string routeSuffix, string expectedOperation, bool expectedDangerous, string expectedInstanceId)
        {
            string path = RoutePrefix + routeSuffix;

            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("POST", path, action: null);

            Assert.AreEqual(expectedOperation, operation);
            Assert.AreEqual(expectedDangerous, dangerous);
            Assert.AreEqual(expectedInstanceId, instanceId);
        }

        [TestMethod]
        public void MapsPostOrchestrationsToStartNewInstance()
        {
            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("POST", $"{RoutePrefix}/orchestrations", action: null);

            Assert.AreEqual("Start new instance", operation);
            Assert.IsFalse(dangerous);
            Assert.IsNull(instanceId);
        }

        [TestMethod]
        public void DoesNotMapGetOrchestrationsToStartNewInstance()
        {
            // Only the POST (create) verb means "Start new instance"; GET is the listing endpoint
            // and, being a Read operation, is never audited anyway - but the mapping must still be sane.
            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("GET", $"{RoutePrefix}/orchestrations", action: null);

            Assert.AreEqual("orchestrations", operation);
            Assert.IsFalse(dangerous);
            Assert.IsNull(instanceId);
        }

        [TestMethod]
        public void DecodesAnInstanceIdContainingAnEncodedQuote()
        {
            // A literal quote inside the instance id is percent-encoded (%27) by the caller; the
            // literal, unencoded quotes are what delimit the OData-style id in the route.
            string path = $"{RoutePrefix}/orchestrations('abc%27def')/terminate";

            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("POST", path, action: "terminate");

            Assert.AreEqual("Terminate", operation);
            Assert.IsFalse(dangerous);
            Assert.AreEqual("abc'def", instanceId);
        }

        [TestMethod]
        public void FallsBackToTheLastPathSegmentForAnUnrecognisedOperation()
        {
            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("GET", $"{RoutePrefix}/manage-connection", action: null);

            Assert.AreEqual("manage-connection", operation);
            Assert.IsFalse(dangerous);
            Assert.IsNull(instanceId);
        }

        [TestMethod]
        public void FallsBackToTheLastPathSegmentWhenTheInstanceIdHasNoRecognisedAction()
        {
            // The action route value can be an unmapped segment too (e.g. the field-download actions
            // input/output/custom-status share DfmPostOrchestrationFunction's route): still falls back
            // to the segment itself, verbatim.
            var (operation, dangerous, instanceId) = AuditOperations.FromRequest("POST", $"{RoutePrefix}/orchestrations('inst1')/input", action: "input");

            Assert.AreEqual("input", operation);
            Assert.IsFalse(dangerous);
            Assert.AreEqual("inst1", instanceId);
        }
    }
}
