// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Drives AuditStore - the writer the middleware calls and the reader behind GET /audit - against a
    /// real Table endpoint: the table it creates on first write, the row layout that makes Table Storage's
    /// own ordering 'newest first', the day partitions the reader walks, paging and the operation filter.
    /// </summary>
    [TestClass]
    public class AuditStoreTests
    {
        [TestInitialize]
        public void TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            this._hubName = "DfmAudit" + Guid.NewGuid().ToString("N").Substring(0, 12);

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            this._tableService = new TableServiceClient(StorageEmulator.ConnectionString);

            this._now = DateTimeOffset.UtcNow;
        }

        [TestCleanup]
        public async Task TestCleanup()
        {
            if (this._tableService == null)
            {
                return;
            }

            try
            {
                await this._tableService.DeleteTableAsync(this.AuditTable);
            }
            catch (Azure.RequestFailedException)
            {
                // The test never wrote anything, so the table was never created
            }
        }

        [TestMethod]
        public async Task CreatesTheTableOnTheFirstWrite()
        {
            // Act

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Terminate", this._now));

            // Assert

            var tables = this._tableService.Query($"TableName eq '{this.AuditTable}'").ToList();
            Assert.AreEqual(1, tables.Count, "the audit table is created on first write, with no setup step");
        }

        [TestMethod]
        public async Task ReadsBackWhatWasWritten()
        {
            // Arrange

            var at = this._now.AddMinutes(-5);

            await AuditStore.WriteAsync(ConnStringName, this._hubName, new AuditRecord
            {
                At = at,
                User = "alice@contoso.com",
                Operation = "Terminate",
                Kind = "Write",
                InstanceId = "order-2026-09-04-000911",
                Outcome = "failed",
                Status = 409,
                Message = "Instance is not running",
                Route = "/a/p/i/--hub/orchestrations('order-2026-09-04-000911')/terminate"
            });

            // Act

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 10));

            // Assert

            var row = page.Rows.Single();
            Assert.AreEqual(at.ToUnixTimeSeconds(), row.At.ToUnixTimeSeconds());
            Assert.AreEqual("alice@contoso.com", row.User);
            Assert.AreEqual("Terminate", row.Operation);
            Assert.AreEqual("Write", row.Kind);
            Assert.AreEqual("order-2026-09-04-000911", row.InstanceId);
            Assert.AreEqual("failed", row.Outcome);
            Assert.AreEqual(409, row.Status);
            Assert.AreEqual("Instance is not running", row.Message);
            Assert.IsFalse(page.HasMore);
        }

        [TestMethod]
        public async Task ReturnsRecordsNewestFirstAcrossDays()
        {
            // Arrange: three records spread over two days

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Oldest", this._now.AddDays(-1).AddHours(-1)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Middle", this._now.AddHours(-2)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Newest", this._now.AddMinutes(-1)));

            // Act

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 10));

            // Assert: the row key ordering does the sorting, and the reader walks the days backwards

            CollectionAssert.AreEqual(
                new[] { "Newest", "Middle", "Oldest" },
                page.Rows.Select(r => r.Operation).ToArray());
        }

        [TestMethod]
        public async Task ReportsHasMoreWhenThePageIsFull()
        {
            // Arrange

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Oldest", this._now.AddDays(-1).AddHours(-1)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Middle", this._now.AddHours(-2)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Newest", this._now.AddMinutes(-1)));

            // Act

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 2));

            // Assert

            CollectionAssert.AreEqual(new[] { "Newest", "Middle" }, page.Rows.Select(r => r.Operation).ToArray());
            Assert.IsTrue(page.HasMore);
        }

        [TestMethod]
        public async Task SkipsIntoTheNextPage()
        {
            // Arrange

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Oldest", this._now.AddDays(-1).AddHours(-1)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Middle", this._now.AddHours(-2)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Newest", this._now.AddMinutes(-1)));

            // Act

            var query = this.Query(top: 2);
            query.Skip = 2;

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, query);

            // Assert

            Assert.AreEqual("Oldest", page.Rows.Single().Operation);
            Assert.IsFalse(page.HasMore);
        }

        [TestMethod]
        public async Task FiltersByOperation()
        {
            // Arrange

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Terminate", this._now.AddMinutes(-3)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Purge", this._now.AddMinutes(-2)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Terminate", this._now.AddMinutes(-1)));

            // Act

            var query = this.Query(top: 10);
            query.Operation = "Terminate";

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, query);

            // Assert

            Assert.AreEqual(2, page.Rows.Count);
            Assert.IsTrue(page.Rows.All(r => r.Operation == "Terminate"));
        }

        [TestMethod]
        public async Task LeavesOutRecordsOutsideTheRangeOnTheBoundaryDays()
        {
            // Arrange: both records are in today's partition, one of them before the range starts

            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("Inside", this._now.AddMinutes(-5)));
            await AuditStore.WriteAsync(ConnStringName, this._hubName, Record("TooEarly", this._now.AddHours(-10)));

            // Act (a range that only covers the last hour)

            var query = this.Query(top: 10);
            query.From = this._now.AddHours(-1);

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, query);

            // Assert: a partition is a whole day, the range is not

            Assert.AreEqual("Inside", page.Rows.Single().Operation);
        }

        [TestMethod]
        public async Task AHubThatWasNeverAuditedReadsAsAnEmptyLog()
        {
            // Act (nothing was ever written, so the table does not exist)

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 10));

            // Assert

            Assert.AreEqual(0, page.Rows.Count);
            Assert.IsFalse(page.HasMore);
        }

        [TestMethod]
        public async Task TruncatesAVeryLongMessage()
        {
            // Arrange: a whole error body would be pointless to store and expensive to read back

            await AuditStore.WriteAsync(ConnStringName, this._hubName, new AuditRecord
            {
                At = this._now.AddMinutes(-1),
                User = "anonymous",
                Operation = "Terminate",
                Kind = "Write",
                Outcome = "failed",
                Status = 500,
                Message = new string('x', AuditStore.MaxMessageChars + 500)
            });

            // Act

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 10));

            // Assert

            Assert.AreEqual(AuditStore.MaxMessageChars, page.Rows.Single().Message.Length);
        }

        [TestMethod]
        public async Task AHubWideOperationHasNoInstanceId()
        {
            // Arrange

            await AuditStore.WriteAsync(ConnStringName, this._hubName, new AuditRecord
            {
                At = this._now.AddMinutes(-1),
                User = "anonymous",
                Operation = "Purge history",
                Kind = "Write",
                InstanceId = null,
                Outcome = "ok",
                Status = 200
            });

            // Act

            var page = await AuditStore.ReadAsync(ConnStringName, this._hubName, this.Query(top: 10));

            // Assert: stored as an empty string (Table Storage cannot store a null), reported as null

            Assert.IsNull(page.Rows.Single().InstanceId);
        }

        #region Setup

        private static AuditRecord Record(string operation, DateTimeOffset at)
        {
            return new AuditRecord
            {
                At = at,
                User = "anonymous",
                Operation = operation,
                Kind = "Write",
                InstanceId = "order-1",
                Outcome = "ok",
                Status = 202,
                Message = null,
                Route = "/a/p/i/--hub/orchestrations('order-1')/terminate"
            };
        }

        private AuditQuery Query(int top)
        {
            return new AuditQuery
            {
                From = this._now.AddDays(-2),
                To = this._now,
                Top = top
            };
        }

        private string AuditTable => this._hubName + "DfmAudit";

        private const string ConnStringName = "DFM_TEST_AUDIT_CONN_STRING";

        private string _hubName;
        private DateTimeOffset _now;
        private TableServiceClient _tableService;

        #endregion
    }
}
