// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The bounded, projected scan every aggregation endpoint is built on. What can be checked
    /// without a Table endpoint: the argument validation, and that ITableClient.QueryAsync is
    /// mockable the same way the rest of the interface is (the integration tests cover the
    /// capping and the projection against Azurite).
    /// </summary>
    [TestClass]
    public class TableClientTests
    {
        [TestInitialize]
        public void TestInit()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            Environment.SetEnvironmentVariable(ConnStringName, "UseDevelopmentStorage=true");
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            Environment.SetEnvironmentVariable(ConnStringName, null);
        }

        [TestMethod]
        [DataRow(0)]
        [DataRow(-1)]
        [DataRow(int.MinValue)]
        public async Task RejectsANonPositiveMaxRows(int maxRows)
        {
            // A cap of zero or less is a bug in the caller, not an empty result - it would silently
            // report every hub as empty. Checked before anything goes over the wire.

            var client = DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName);

            var ex = await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(
                () => client.QueryAsync("HubInstances", null, null, maxRows, CancellationToken.None));

            Assert.AreEqual("maxRows", ex.ParamName);
        }

        [TestMethod]
        public async Task IsMockable()
        {
            // Every aggregation routine takes an ITableClient, so the new member has to be
            // set-up-able on a strict mock just like the older ones

            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);

            var rows = new List<TableEntity>
            {
                new TableEntity("instance-1", string.Empty) { ["RuntimeStatus"] = "Running" },
                new TableEntity("instance-2", string.Empty) { ["RuntimeStatus"] = "Completed" }
            };

            tableClient
                .Setup(c => c.QueryAsync(
                    "HubInstances",
                    "RuntimeStatus ne 'Pending'",
                    It.IsAny<IEnumerable<string>>(),
                    2,
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(((IReadOnlyList<TableEntity>)rows, true));

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            var client = DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName);

            // Act

            var result = await client.QueryAsync(
                "HubInstances", "RuntimeStatus ne 'Pending'", new[] { "RuntimeStatus" }, 2, CancellationToken.None);

            // Assert

            Assert.AreEqual(2, result.rows.Count);
            Assert.IsTrue(result.truncated);
            CollectionAssert.AreEqual(
                new[] { "instance-1", "instance-2" },
                result.rows.Select(r => r.PartitionKey).ToArray());
        }

        private const string ConnStringName = "DfmTestTableClientConnString";
    }
}
