// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The audit hook the middleware calls after every DfMon invocation (B5-S2-T2): what it records, what
    /// it refuses to record, and the two rules it must never break - auditing does not change a response,
    /// and auditing does not fail a request.
    ///
    /// AuditWriter is exercised directly rather than through the worker pipeline: the middleware hands it
    /// exactly these arguments, and a real FunctionContext cannot be built outside the host.
    /// </summary>
    [TestClass]
    public class AuditMiddlewareTests
    {
        private DfmSettings _settings;
        private DfmExtensionPoints _extensionPoints;
        private readonly List<(string ConnEnvVariableName, string HubName, AuditRecord Record)> _written = new();

        [TestInitialize]
        public void TestInit()
        {
            this._settings = new DfmSettings { AuditEnabled = true };

            this._written.Clear();

            this._extensionPoints = new DfmExtensionPoints
            {
                WriteAuditRecordRoutine = (connEnvVariableName, hubName, record) =>
                {
                    lock (this._written)
                    {
                        this._written.Add((connEnvVariableName, hubName, record));
                    }

                    return Task.CompletedTask;
                }
            };
        }

        [TestMethod]
        public async Task RecordsAWriteOperation()
        {
            // Arrange

            var context = Context(userName: "alice@contoso.com", action: "terminate");
            var request = Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST");

            // Act

            AuditWriter.Record(context, request, OperationKind.Write, this._settings, this._extensionPoints, HttpStatusCode.OK, NullLogger.Instance);

            // Assert

            var (connEnvVariableName, hubName, record) = await this.WaitForOneRecordAsync();

            Assert.AreEqual("AzureWebJobsStorage", connEnvVariableName);
            Assert.AreEqual("DurableFunctionsHub", hubName);

            Assert.AreEqual("Terminate", record.Operation);
            Assert.AreEqual("Write", record.Kind);
            Assert.AreEqual("order-1", record.InstanceId);
            Assert.AreEqual("alice@contoso.com", record.User);
            Assert.AreEqual("ok", record.Outcome);
            Assert.AreEqual(200, record.Status);
            Assert.AreEqual("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", record.Route);
            Assert.IsTrue((DateTimeOffset.UtcNow - record.At).Duration() < TimeSpan.FromMinutes(1));
        }

        [TestMethod]
        public void RecordsNothingForAReadOperation()
        {
            // Act: the log is about what was changed, and every screen refresh would otherwise drown it

            AuditWriter.Record(
                Context(),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations", "GET"),
                OperationKind.Read,
                this._settings,
                this._extensionPoints,
                HttpStatusCode.OK,
                NullLogger.Instance);

            // Assert

            Assert.AreEqual(0, this._written.Count);
        }

        [TestMethod]
        public void RecordsNothingWhenAuditingIsOff()
        {
            // Arrange: an operator opts in with DFM_AUDIT_ENABLED

            this._settings.AuditEnabled = false;

            // Act

            AuditWriter.Record(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                this._settings,
                this._extensionPoints,
                HttpStatusCode.OK,
                NullLogger.Instance);

            // Assert

            Assert.AreEqual(0, this._written.Count);
        }

        [TestMethod]
        public void RecordsNothingWhenTheProviderCannotStoreRecords()
        {
            // Arrange: MSSQL nulls both audit routines out

            this._extensionPoints.WriteAuditRecordRoutine = null;

            // Act

            AuditWriter.Record(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                this._settings,
                this._extensionPoints,
                HttpStatusCode.OK,
                NullLogger.Instance);

            // Assert

            Assert.AreEqual(0, this._written.Count);
        }

        [TestMethod]
        public void RecordsNothingWhenThePathNamesNoTaskHub()
        {
            // Act: there would be nowhere to write the record to

            AuditWriter.Record(
                Context(),
                Request("/a/p/i/about", "POST"),
                OperationKind.Write,
                this._settings,
                this._extensionPoints,
                HttpStatusCode.OK,
                NullLogger.Instance);

            // Assert

            Assert.AreEqual(0, this._written.Count);
        }

        [TestMethod]
        public async Task AThrowingRoutineDoesNotAffectTheCaller()
        {
            // Arrange

            this._extensionPoints.WriteAuditRecordRoutine = (connEnvVariableName, hubName, record) =>
                throw new InvalidOperationException("the audit store is unreachable");

            // Act: the response is already on its way; this must not throw, here or on the pool thread

            AuditWriter.Record(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                this._settings,
                this._extensionPoints,
                HttpStatusCode.OK,
                NullLogger.Instance);

            // Assert: give the fire-and-forget task a chance to fail, then observe that nothing escaped

            await Task.Delay(50);
        }

        [TestMethod]
        public void RecordsAFailedOperationWithItsStatusAndTheResponseBody()
        {
            // Act

            var record = AuditWriter.BuildRecord(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                HttpStatusCode.Conflict,
                "Instance is not running");

            // Assert

            Assert.AreEqual("failed", record.Outcome);
            Assert.AreEqual(409, record.Status);
            Assert.AreEqual("Instance is not running", record.Message);
        }

        [TestMethod]
        public void ASuccessfulOperationNeedsNoMessage()
        {
            // Act

            var record = AuditWriter.BuildRecord(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                HttpStatusCode.OK,
                responseBody: "{\"whatever\":true}");

            // Assert: the operation and the status say everything there is to say

            Assert.IsNull(record.Message);
        }

        [TestMethod]
        public void AFunctionCanRefineItsOperationNameAndMessage()
        {
            // Arrange: what the batch endpoint does, so one bulk call is one recognizable row

            var context = Context();
            context.Items[Globals.DfmAuditOperationContextValue] = "Batch terminate";
            context.Items[Globals.DfmAuditMessageContextValue] = "3 ok, 1 failed, of 4 instances";

            // Act

            var record = AuditWriter.BuildRecord(
                context,
                Request("/a/p/i/--DurableFunctionsHub/orchestrations/batch", "POST"),
                OperationKind.Write,
                HttpStatusCode.OK,
                responseBody: null);

            // Assert

            Assert.AreEqual("Batch terminate", record.Operation);
            Assert.AreEqual("3 ok, 1 failed, of 4 instances", record.Message);
        }

        [TestMethod]
        public void ADangerousOperationIsRecordedAsSuch()
        {
            // Act

            var record = AuditWriter.BuildRecord(
                Context(),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/replay", "POST"),
                OperationKind.Dangerous,
                HttpStatusCode.OK,
                responseBody: null);

            // Assert: the kind the function declared, which is what an operator's policy is written against

            Assert.AreEqual("Replay", record.Operation);
            Assert.AreEqual("Dangerous", record.Kind);
        }

        [TestMethod]
        public void AnUnidentifiedCallerIsRecordedAsAnonymous()
        {
            // Arrange: authentication is disabled, so the middleware published no user name

            var context = Context();
            context.Items.Remove(Globals.DfmUserNameContextValue);

            // Act

            var record = AuditWriter.BuildRecord(
                context,
                Request("/a/p/i/--DurableFunctionsHub/purge-history", "POST"),
                OperationKind.Write,
                HttpStatusCode.OK,
                responseBody: null);

            // Assert

            Assert.AreEqual(Globals.AnonymousUserName, record.User);
            Assert.AreEqual("Purge history", record.Operation);

            // A hub-wide operation is not about an instance
            Assert.IsNull(record.InstanceId);
        }

        [TestMethod]
        public void TruncatesAVeryLongMessage()
        {
            // Act

            var record = AuditWriter.BuildRecord(
                Context(action: "terminate"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('order-1')/terminate", "POST"),
                OperationKind.Write,
                HttpStatusCode.InternalServerError,
                new string('x', AuditStore.MaxMessageChars + 100));

            // Assert

            Assert.AreEqual(AuditStore.MaxMessageChars, record.Message.Length);
        }

        [TestMethod]
        public void ReadsTheInstanceIdOfAnIdContainingAQuote()
        {
            // Act: the caller percent-encodes a quote inside the id as %27

            var record = AuditWriter.BuildRecord(
                Context(action: "purge"),
                Request("/a/p/i/--DurableFunctionsHub/orchestrations('a%27b')/purge", "POST"),
                OperationKind.Write,
                HttpStatusCode.OK,
                responseBody: null);

            // Assert

            Assert.AreEqual("a'b", record.InstanceId);
        }

        #region Fixture helpers

        private async Task<(string ConnEnvVariableName, string HubName, AuditRecord Record)> WaitForOneRecordAsync()
        {
            // The write is fire-and-forget, so the assertion waits for it rather than assuming it already ran
            for (int i = 0; i < 100; i++)
            {
                lock (this._written)
                {
                    if (this._written.Count > 0)
                    {
                        return this._written.Single();
                    }
                }

                await Task.Delay(10);
            }

            Assert.Fail("no audit record was written");
            return default;
        }

        private static FakeAuditFunctionContext Context(string userName = "alice@contoso.com", string action = null)
        {
            var context = new FakeAuditFunctionContext(action);

            if (userName != null)
            {
                context.Items[Globals.DfmUserNameContextValue] = userName;
            }

            return context;
        }

        private static FakeHttpRequestData Request(string path, string method)
        {
            return new FakeHttpRequestData(new Uri("http://localhost" + path), method);
        }

        /// <summary>
        /// The parts of a FunctionContext the audit writer reads: the Items bag and the {action} route
        /// value. Everything else it touches is already wrapped in try/catch there, because a real
        /// invocation may or may not have it.
        /// </summary>
        private class FakeAuditFunctionContext : FunctionContext
        {
            private readonly BindingContext _bindingContext;

            public FakeAuditFunctionContext(string action)
            {
                this._bindingContext = new FakeBindingContext(action);
            }

            public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();

            public override BindingContext BindingContext => this._bindingContext;

            public override FunctionDefinition FunctionDefinition => throw new NotImplementedException();
            public override IServiceProvider InstanceServices { get => throw new NotImplementedException(); set => throw new NotImplementedException(); }
            public override string InvocationId => throw new NotImplementedException();
            public override string FunctionId => throw new NotImplementedException();
            public override TraceContext TraceContext => throw new NotImplementedException();
            public override Microsoft.Azure.Functions.Worker.RetryContext RetryContext => throw new NotImplementedException();
            public override IInvocationFeatures Features => throw new NotImplementedException();
        }

        private class FakeBindingContext : BindingContext
        {
            public FakeBindingContext(string action)
            {
                this.BindingData = action == null
                    ? new Dictionary<string, object>()
                    : new Dictionary<string, object> { { "action", action } };
            }

            public override IReadOnlyDictionary<string, object> BindingData { get; }
        }

        #endregion
    }
}
