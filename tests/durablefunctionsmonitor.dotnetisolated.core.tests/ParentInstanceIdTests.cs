// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The default parent lookup: the ParentInstanceId column of the Instances row, when the engine wrote one
    /// </summary>
    [TestClass]
    public class ParentInstanceIdTests
    {
        [TestInitialize]
        public void TestInit()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        [TestMethod]
        public async Task ReturnsTheParentRecordedOnTheInstanceRow()
        {
            // Arrange

            var durableClient = new FakeDurableTaskClient();
            var tableClient = new Mock<ITableClient>(MockBehavior.Strict);

            tableClient
                .Setup(c => c.GetEntityAsync($"{durableClient.Name}Instances", "child-instance", string.Empty))
                .ReturnsAsync(new TableEntity("child-instance", string.Empty)
                {
                    ["ExecutionId"] = "exec-1",
                    ["ParentInstanceId"] = "parent-instance"
                });

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            // Act

            string parentInstanceId = await DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable(durableClient, "SomeConnString", "Hub", "child-instance");

            // Assert

            Assert.AreEqual("parent-instance", parentInstanceId);

            // No history scan was needed
            tableClient.Verify(c => c.GetAllAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
            tableClient.Verify(c => c.GetAllAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        }

        [TestMethod]
        public async Task FallsBackToTheOldFormatIdWhenTheColumnIsAbsent()
        {
            // Arrange

            var durableClient = new FakeDurableTaskClient();
            var tableClient = new Mock<ITableClient>();

            tableClient
                .Setup(c => c.GetEntityAsync($"{durableClient.Name}Instances", "parent-execution:3", string.Empty))
                .ReturnsAsync(new TableEntity("parent-execution:3", string.Empty) { ["ExecutionId"] = "exec-1" });

            tableClient
                .Setup(c => c.GetAllAsync($"{durableClient.Name}Instances", It.Is<string>(f => f.Contains("parent-execution"))))
                .ReturnsAsync(new[] { new TableEntity("parent-instance", string.Empty) { ["ExecutionId"] = "parent-execution" } });

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = tableClient.Object;

            // Act

            string parentInstanceId = await DetailedOrchestrationStatus.GetParentInstanceIdDirectlyFromTable(durableClient, "SomeConnString", "Hub", "parent-execution:3");

            // Assert

            Assert.AreEqual("parent-instance", parentInstanceId);
        }
    }
}
