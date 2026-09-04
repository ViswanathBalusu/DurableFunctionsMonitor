// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Sockets;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// Connection details for the Azure Storage endpoint these tests run against.
    ///
    /// CI starts Azurite as a service container (see .github/workflows/build.yml). Locally you can
    /// get one with:
    ///
    ///     npm install -g azurite
    ///     azurite --silent --location ./.azurite
    ///
    /// With nothing listening the tests report themselves Inconclusive, so
    /// "dotnet test DurableFunctionsMonitor.slnx" still passes on a machine without an emulator.
    /// CI sets DFM_TEST_REQUIRE_STORAGE so that there the same situation is a failure instead -
    /// silently skipping the whole suite would hide a broken storage layer.
    /// </summary>
    static class StorageEmulator
    {
        /// <summary>
        /// The well-known Azurite development account. The AccountKey below is public and
        /// documented by Microsoft - it is not a secret.
        /// </summary>
        public const string DefaultConnectionString =
            "AccountName=devstoreaccount1;" +
            "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;" +
            "DefaultEndpointsProtocol=http;" +
            "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" +
            "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;" +
            "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

        public static string ConnectionString =>
            Environment.GetEnvironmentVariable(ConnectionStringVariableName) ?? DefaultConnectionString;

        /// <summary>
        /// Skips the calling test when nothing is listening - or fails it, if storage was declared
        /// mandatory.
        ///
        /// NOTE: this deliberately probes the endpoint itself rather than assuming a configured one
        /// is up. Letting the Storage SDK discover it instead means every test burns its way through
        /// the retry policy first, which turns "the emulator is not running" into a multi-minute
        /// hang rather than an immediate, obvious failure.
        /// </summary>
        public static void SkipIfUnavailable()
        {
            if (IsReachable.Value)
            {
                return;
            }

            string endpoints = string.Join(", ", Endpoints.Select(e => $"{e.Host}:{e.Port}"));

            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable(RequireStorageVariableName)))
            {
                Assert.Fail(
                    $"{RequireStorageVariableName} is set, so these tests are mandatory, but nothing is " +
                    $"listening on {endpoints}. Check that the Azurite service container started.");
            }

            Assert.Inconclusive(
                $"No Azure Storage endpoint is listening on {endpoints}. " +
                "Start Azurite (npm install -g azurite && azurite --silent) to run these tests, " +
                $"or point {ConnectionStringVariableName} at an account of your own.");
        }

        private static readonly Lazy<bool> IsReachable = new Lazy<bool>(() =>
        {
            var endpoints = Endpoints;

            // A connection string that names no explicit endpoints is a real Azure account. There
            // is nothing local to probe, so let the tests themselves surface any problem.
            return endpoints.Count == 0 || endpoints.All(e => CanConnect(e.Host, e.Port));
        });

        private static List<(string Host, int Port)> Endpoints => ParseEndpoints(ConnectionString);

        /// <summary>
        /// Pulls the Blob and Table endpoints out of a Storage connection string. Emulator-style
        /// connection strings spell these out; real ones leave them to be derived from the account
        /// name, in which case there is nothing here to probe.
        /// </summary>
        private static List<(string Host, int Port)> ParseEndpoints(string connectionString)
        {
            var result = new List<(string, int)>();

            foreach (string part in connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                int separatorIdx = part.IndexOf('=');
                if (separatorIdx < 0)
                {
                    continue;
                }

                string key = part.Substring(0, separatorIdx).Trim();
                if (key != "BlobEndpoint" && key != "TableEndpoint")
                {
                    continue;
                }

                if (Uri.TryCreate(part.Substring(separatorIdx + 1).Trim(), UriKind.Absolute, out var uri))
                {
                    result.Add((uri.Host, uri.Port));
                }
            }

            return result;
        }

        private static bool CanConnect(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    // Short timeout - this runs once, and a missing emulator should not stall the run
                    return client.ConnectAsync(host, port).Wait(TimeSpan.FromSeconds(5)) && client.Connected;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        private const string ConnectionStringVariableName = "DFM_TEST_STORAGE_CONNECTION_STRING";
        private const string RequireStorageVariableName = "DFM_TEST_REQUIRE_STORAGE";
    }
}
