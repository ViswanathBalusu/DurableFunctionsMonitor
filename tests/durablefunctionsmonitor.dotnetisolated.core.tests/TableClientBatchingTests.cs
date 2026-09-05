// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Linq;
using Azure.Data.Tables;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// How entity deletions are split into table transactions: the remainder first, so the last batch is a full one
    /// </summary>
    [TestClass]
    public class TableClientBatchingTests
    {
        [TestMethod]
        [DataRow(0, new int[0])]
        [DataRow(1, new[] { 1 })]
        [DataRow(5, new[] { 5 })]
        [DataRow(100, new[] { 100 })]
        [DataRow(101, new[] { 1, 100 })]
        [DataRow(250, new[] { 50, 100, 100 })]
        public void PutsTheRemainderFirst(int count, int[] expectedBatchSizes)
        {
            // Arrange

            var entities = Enumerable.Range(0, count).Select(i => new TableEntity("p", i.ToString("X16"))).ToList();

            // Act

            var batches = DurableFunctionsMonitor.DotNetIsolated.TableClient.SplitIntoBatches(entities, 100).ToList();

            // Assert

            CollectionAssert.AreEqual(expectedBatchSizes, batches.Select(b => b.Count).ToArray());

            // Order is preserved across the batches
            CollectionAssert.AreEqual(entities, batches.SelectMany(b => b).ToList());
        }
    }
}
