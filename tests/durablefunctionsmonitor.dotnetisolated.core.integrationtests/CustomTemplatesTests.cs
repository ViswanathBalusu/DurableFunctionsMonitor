// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Azure.Storage.Blobs;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Loads liquid tab templates and Function Maps out of Storage the way DfMon does at runtime.
    ///
    /// NOTE: CustomTemplates memoises each of these in a static Task, so everything it can load has
    /// to be in place before the very first call. That is why this is one test rather than several,
    /// and why it uses the real container name - CustomTemplates has no seam to point it elsewhere.
    /// </summary>
    [TestClass]
    public class CustomTemplatesTests
    {
        [TestMethod]
        public async Task LoadsTabTemplatesAndFunctionMapsFromStorage()
        {
            // Arrange

            StorageEmulator.SkipIfUnavailable();

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage, StorageEmulator.ConnectionString);

            var container = new BlobServiceClient(StorageEmulator.ConnectionString)
                .GetBlobContainerClient(Globals.TemplateContainerName);

            await container.CreateIfNotExistsAsync();

            // Start from a clean slate - this is the one shared container name DfMon looks in
            await foreach (var stale in container.GetBlobsAsync())
            {
                await container.GetBlobClient(stale.Name).DeleteIfExistsAsync();
            }

            // "[Tab Name].[EntityTypeName].liquid" and the entity-type-less "[Tab Name].liquid"
            await UploadAsync(container, $"{Globals.TabTemplateFolderName}/MyTab.MyEntity.liquid", "entity scoped");
            await UploadAsync(container, $"{Globals.TabTemplateFolderName}/Everything.liquid", "unscoped");
            // Not a liquid template - has to be ignored
            await UploadAsync(container, $"{Globals.TabTemplateFolderName}/notes.txt", "ignore me");

            // "dfm-func-map.[TaskHubName].json" and the hub-less "dfm-func-map.json"
            await UploadAsync(container, $"{Globals.FunctionMapFolderName}/{Globals.FunctionMapFilePrefix}.MyHub.json", "{\"hub\":1}");
            await UploadAsync(container, $"{Globals.FunctionMapFolderName}/{Globals.FunctionMapFilePrefix}.json", "{\"all\":1}");

            // Act

            var settings = new DfmSettings();
            var templates = await CustomTemplates.GetTabTemplatesAsync(settings);
            var functionMaps = await CustomTemplates.GetFunctionMapsAsync(settings);

            // Assert

            Assert.AreEqual("entity scoped", templates.GetTemplate("MyEntity", "MyTab"));
            Assert.AreEqual("unscoped", templates.GetTemplate(string.Empty, "Everything"));

            // An unscoped template is offered for every entity type, the scoped one only for its own
            CollectionAssert.AreEquivalent(new[] { "Everything", "MyTab" }, templates.GetTemplateNames("MyEntity"));
            CollectionAssert.AreEquivalent(new[] { "Everything" }, templates.GetTemplateNames("SomeOtherEntity"));

            Assert.AreEqual("{\"hub\":1}", functionMaps.GetFunctionMap("MyHub"));

            // No Function Map of its own, so it falls back to the one that covers all Task Hubs
            Assert.AreEqual("{\"all\":1}", functionMaps.GetFunctionMap("SomeOtherHub"));
        }

        private static Task UploadAsync(BlobContainerClient container, string blobName, string content)
        {
            return container.GetBlobClient(blobName)
                .UploadAsync(new MemoryStream(Encoding.UTF8.GetBytes(content)), overwrite: true);
        }
    }
}
