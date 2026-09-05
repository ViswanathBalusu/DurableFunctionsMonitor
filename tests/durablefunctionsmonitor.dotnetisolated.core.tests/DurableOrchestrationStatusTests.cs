// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Generic;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json.Linq;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// Custom tags copied from OrchestrationMetadata onto the details DTO (B0-S4-T2).
    /// </summary>
    [TestClass]
    public class DurableOrchestrationStatusTests
    {
        [TestMethod]
        public void ConstructorCopiesTagsFromMetadata()
        {
            // Arrange

            var metadata = new OrchestrationMetadata("MyOrchestrator", "instance1")
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running,
                Tags = new Dictionary<string, string> { ["env"] = "prod", ["team"] = "core" }
            };

            // Act

            var status = new DurableOrchestrationStatus(metadata);

            // Assert

            Assert.IsNotNull(status.Tags);
            Assert.AreEqual(2, status.Tags.Count);
            Assert.AreEqual("prod", status.Tags["env"]);
            Assert.AreEqual("core", status.Tags["team"]);
        }

        [TestMethod]
        public void ConstructorLeavesTagsNullWhenMetadataHasNone()
        {
            // Arrange

            var metadata = new OrchestrationMetadata("MyOrchestrator", "instance1")
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running
            };

            // Act

            var status = new DurableOrchestrationStatus(metadata);

            // Assert

            Assert.IsNull(status.Tags);
        }

        [TestMethod]
        public void DetailsSerializeTagsWithBothKeys()
        {
            // Arrange

            var metadata = new OrchestrationMetadata("MyOrchestrator", "instance1")
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running,
                Tags = new Dictionary<string, string> { ["env"] = "prod", ["team"] = "core" }
            };
            var status = new DurableOrchestrationStatus(metadata);

            // Act

            string json = Newtonsoft.Json.JsonConvert.SerializeObject(status, Globals.SerializerSettings);
            var jObject = JObject.Parse(json);

            // Assert

            Assert.AreEqual("prod", jObject["tags"]["env"].Value<string>());
            Assert.AreEqual("core", jObject["tags"]["team"].Value<string>());
        }

        [TestMethod]
        public async Task CreateFromCopiesTagsOntoDetailedStatus()
        {
            // Arrange

            var metadata = new OrchestrationMetadata("MyOrchestrator", "instance1")
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running,
                Tags = new Dictionary<string, string> { ["env"] = "prod", ["team"] = "core" }
            };
            var that = new DurableOrchestrationStatus(metadata);

            var extensionPoints = new DfmExtensionPoints
            {
                GetParentInstanceIdRoutine = (client, connEnvVar, hubName, instanceId) => Task.FromResult<string>(null)
            };

            // Act

            var detailedStatus = await DetailedOrchestrationStatus.CreateFrom(
                that,
                new FakeDurableTaskClient(),
                "-",
                "Hub",
                NullLoggerFactory.Instance.CreateLogger("Test"),
                new DfmSettings(),
                extensionPoints
            );

            // Assert

            Assert.IsNotNull(detailedStatus.Tags);
            Assert.AreEqual(2, detailedStatus.Tags.Count);
            Assert.AreEqual("prod", detailedStatus.Tags["env"]);
            Assert.AreEqual("core", detailedStatus.Tags["team"]);
        }

        [TestMethod]
        public void ListStatusDoesNotCopyTags()
        {
            // Arrange

            var metadata = new OrchestrationMetadata("MyOrchestrator", "instance1")
            {
                RuntimeStatus = OrchestrationRuntimeStatus.Running,
                Tags = new Dictionary<string, string> { ["env"] = "prod" }
            };
            var that = new DurableOrchestrationStatus(metadata);

            // Act

            var listStatus = new ExpandedOrchestrationStatus(that, Task.FromResult<string>(null), new HashSet<string>());

            // Assert

            Assert.IsNull(listStatus.Tags);
        }
    }
}
