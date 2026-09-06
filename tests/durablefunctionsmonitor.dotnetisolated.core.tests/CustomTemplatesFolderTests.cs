// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.IO;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// How DfmSettings.CustomTemplatesFolderName is turned into a folder on disk.
    ///
    /// The point of these is that a plain folder name ("dfm-templates") has to be enough: an isolated
    /// app runs from its own app root, so callers must never have to prepend the bin folder themselves.
    /// </summary>
    [TestClass]
    public class CustomTemplatesFolderTests
    {
        [TestMethod]
        public void AnAbsolutePathIsUsedAsIs()
        {
            string absolutePath = Path.Combine(Path.GetTempPath(), "dfm-templates-" + Guid.NewGuid().ToString("N"));

            Assert.AreEqual(absolutePath, CustomTemplates.ResolveCustomTemplatesFolder(absolutePath));
        }

        [TestMethod]
        public void AFolderNameIsResolvedNextToTheAppItself()
        {
            // Arrange

            // The isolated layout: the templates folder sits next to the assembly, in the app root
            string folderName = "dfm-templates-" + Guid.NewGuid().ToString("N");
            string expected = Path.Combine(AppContext.BaseDirectory, folderName);

            Directory.CreateDirectory(expected);
            try
            {
                // Act
                string result = CustomTemplates.ResolveCustomTemplatesFolder(folderName);

                // Assert
                Assert.AreEqual(Path.GetFullPath(expected), result);
            }
            finally
            {
                Directory.Delete(expected);
            }
        }

        [TestMethod]
        public void AFolderNameFallsBackToTheParentFolderForTheLegacyBinLayout()
        {
            // Arrange

            // The in-process layout: the assembly in '<app root>/bin', the templates folder one level up
            string folderName = "dfm-templates-" + Guid.NewGuid().ToString("N");
            string legacyFolder = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", folderName));

            Directory.CreateDirectory(legacyFolder);
            try
            {
                // Act
                string result = CustomTemplates.ResolveCustomTemplatesFolder(folderName);

                // Assert
                Assert.AreEqual(legacyFolder, result);
            }
            finally
            {
                Directory.Delete(legacyFolder);
            }
        }

        [TestMethod]
        public void AMissingFolderResolvesNextToTheAppRatherThanToTheParent()
        {
            // A folder that exists nowhere still has to produce a sane path - the callers just find
            // nothing there and fall back to an empty templates map
            string folderName = "dfm-templates-" + Guid.NewGuid().ToString("N");

            Assert.AreEqual(
                Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, folderName)),
                CustomTemplates.ResolveCustomTemplatesFolder(folderName));
        }

        [TestMethod]
        [DataRow(null, null)]
        [DataRow("", null)]
        [DataRow("   ", null)]
        [DataRow("dfm-templates", "dfm-templates")]
        [DataRow("  dfm-templates  ", "dfm-templates")]
        public void CustomTemplatesFolderNameIsReadFromTheEnvironment(string value, string expected)
        {
            // Arrange

            // Isolate from SetupTests.ThrowErrorIfAppRolesOverlapInConfiguration, which intentionally
            // leaves overlapping app role env variables set and does not clean up after itself.
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_CUSTOM_TEMPLATES_FOLDER, value);

            try
            {
                // Act
                var settings = new DfmSettings();

                // Assert
                Assert.AreEqual(expected, settings.CustomTemplatesFolderName);
            }
            finally
            {
                // Cleanup
                Environment.SetEnvironmentVariable(EnvVariableNames.DFM_CUSTOM_TEMPLATES_FOLDER, null);
            }
        }
    }
}
