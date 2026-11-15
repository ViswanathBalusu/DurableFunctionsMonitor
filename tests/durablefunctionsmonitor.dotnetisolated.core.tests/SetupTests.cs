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

        [TestMethod]
        [DataRow(null, TableScan.DefaultParallelism)]
        [DataRow("", TableScan.DefaultParallelism)]
        [DataRow("1", 1)]
        [DataRow(" 8 ", 8)]
        [DataRow("16", 16)]
        // Not a number, or not a number of ranges that can be read at once: the default, not a failure to start
        [DataRow("many", TableScan.DefaultParallelism)]
        [DataRow("0", TableScan.DefaultParallelism)]
        [DataRow("-4", TableScan.DefaultParallelism)]
        [DataRow("17", TableScan.DefaultParallelism)]
        public void TableScanParallelismIsParsedFromTheEnvironment(string value, int expected)
        {
            // Arrange

            // Isolate from ThrowErrorIfAppRolesOverlapInConfiguration above, as the test before this one does
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_TABLE_SCAN_PARALLELISM, value);

            try
            {
                // Act
                var settings = new DfmSettings();

                // Assert
                Assert.AreEqual(expected, settings.TableScanParallelism);
            }
            finally
            {
                Environment.SetEnvironmentVariable(EnvVariableNames.DFM_TABLE_SCAN_PARALLELISM, null);
            }
        }

        [TestMethod]
        public void TheDefaultParallelismOfATableScanIsModest()
        {
            // The storage account a Task Hub lives in is the one its Function App runs on. Reading a table
            // faster must not mean taking the account away from the app.
            Assert.AreEqual(4, TableScan.DefaultParallelism);
            Assert.AreEqual(16, TableScan.MaxParallelism);
            Assert.AreEqual(TableScan.MaxParallelism, TableScan.RangeBoundaries.Length + 1);
        }
    }
}
