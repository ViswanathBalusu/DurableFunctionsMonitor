// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;
using System.Threading.Tasks;
using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class AboutTests
    {
        [TestMethod]
        public async Task DfmAboutFunctionSucceeds()
        {
            // Arrange
            var request = new FakeHttpRequestData(new Uri("http://localhost"));

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage, "blah-blah AccountName=Tino; blah-blah");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, "Hub1,Hub2,Hub3");

            request.FunctionContext.Items[Globals.DfmModeContextValue] = DfmMode.Normal;

            // Act
            var result = await new About(new DfmSettings(), new DfmExtensionPoints())
                .DfmAboutFunction(request, "-", "Hub1", request.FunctionContext);

            // Assert

            result.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(result.Body))
            {
                dynamic resultJson = JsonConvert.DeserializeObject(reader.ReadToEnd());

                Assert.AreEqual("Tino", resultJson.accountName.ToString());
                Assert.AreEqual("Hub1", resultJson.hubName.ToString());
            }
        }

        // B0-S2-T2: provider/readOnly/dangerousOperations/capabilities/templates, in every combination
        // of DfmMode and the DFM_DANGEROUS_OPERATIONS_ENABLED-backed setting that reaches DfmAboutFunction.
        [TestMethod]
        [DataRow(DfmMode.Normal, false, false, false, DisplayName = "Normal, dangerous operations off")]
        [DataRow(DfmMode.Normal, true, false, true, DisplayName = "Normal, dangerous operations on")]
        [DataRow(DfmMode.ReadOnly, false, true, false, DisplayName = "ReadOnly, dangerous operations off")]
        [DataRow(DfmMode.ReadOnly, true, true, false, DisplayName = "ReadOnly, dangerous operations on (still reports off: only Normal mode grants it)")]
        public async Task DfmAboutFunctionReportsProviderReadOnlyAndDangerousOperations(
            DfmMode mode, bool dangerousOperationsEnabled, bool expectedReadOnly, bool expectedDangerousOperations)
        {
            // Arrange
            var request = new FakeHttpRequestData(new Uri("http://localhost"));

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage, "blah-blah AccountName=Tino; blah-blah");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, "Hub1,Hub2,Hub3");

            request.FunctionContext.Items[Globals.DfmModeContextValue] = mode;

            var settings = new DfmSettings { DangerousOperationsEnabled = dangerousOperationsEnabled };
            var ext = new DfmExtensionPoints { ProviderName = "MsSql" };

            // Act
            var result = await new About(settings, ext)
                .DfmAboutFunction(request, "-", "Hub1", request.FunctionContext);

            // Assert
            result.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(result.Body))
            {
                var resultJson = JObject.Parse(reader.ReadToEnd());

                Assert.AreEqual("MsSql", resultJson["provider"].Value<string>());
                Assert.AreEqual(expectedReadOnly, resultJson["readOnly"].Value<bool>());
                Assert.AreEqual(expectedDangerousOperations, resultJson["dangerousOperations"].Value<bool>());

                // Capabilities are independent of mode (Capabilities.Compute / CapabilitiesTests.CapabilitiesAreIndependentOfDfmMode);
                // spot-check a couple of always-on/always-off flags for this MsSql-like extension-points set.
                var capabilities = (JObject)resultJson["capabilities"];
                Assert.IsTrue(capabilities["spans"].Value<bool>());
                Assert.IsTrue(capabilities["batch"].Value<bool>());
                Assert.IsTrue(capabilities["conditionalGet"].Value<bool>());
                Assert.IsFalse(capabilities["stats"].Value<bool>());
                Assert.IsFalse(capabilities["purgeEntities"].Value<bool>());

                // templates is always present with its four contract fields, whatever custom templates
                // storage did or didn't have to offer (CustomTemplates never throws).
                var templates = (JObject)resultJson["templates"];
                Assert.IsNotNull(templates);
                Assert.IsTrue(templates.ContainsKey("functionMapAvailable"));
                Assert.IsInstanceOfType(templates["functionMapAvailable"].Value<bool>(), typeof(bool));
                Assert.IsTrue(templates.ContainsKey("functionCount"));
                Assert.IsTrue(templates["functionCount"].Type == JTokenType.Null || templates["functionCount"].Type == JTokenType.Integer);
                Assert.IsInstanceOfType(templates["liquidTabs"], typeof(JArray));
                Assert.IsTrue(templates.ContainsKey("customMetaTag"));
                Assert.IsInstanceOfType(templates["customMetaTag"].Value<bool>(), typeof(bool));
            }
        }
    }
}
