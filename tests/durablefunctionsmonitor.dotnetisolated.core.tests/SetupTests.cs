// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Extensions.Logging;
using DurableFunctionsMonitor.DotNetIsolated;
using System.Threading.Tasks;
using Moq;
using System;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class SetupTests
    {
        [TestMethod]
        public void ThrowErrorIfAppRolesOverlapInConfiguration()
        {
            // Arrange
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_USER_NAMES, "");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES, "role1,role2");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES, "role2");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, "");

            // Act & Assert
            Assert.ThrowsExactly<System.NotSupportedException>(() => {
                new DfmSettings();
            });
        }

        [TestMethod]
        [DataRow(null, false)]
        [DataRow("", false)]
        [DataRow("true", true)]
        [DataRow("TRUE", true)]
        [DataRow("false", false)]
        public void AuditEnabledIsParsedFromTheEnvironment(string value, bool expected)
        {
            // Arrange

            // Isolate from ThrowErrorIfAppRolesOverlapInConfiguration above, which intentionally
            // leaves overlapping app role env variables set and does not clean up after itself.
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_AUDIT_ENABLED, value);

            // Act
            var settings = new DfmSettings();

            // Assert
            Assert.AreEqual(expected, settings.AuditEnabled);

            // Cleanup
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_AUDIT_ENABLED, string.Empty);
        }
    }
}
