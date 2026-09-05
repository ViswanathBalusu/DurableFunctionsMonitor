// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Claims;
using System.Threading.Tasks;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.Azure.Functions.Worker;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Newtonsoft.Json;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The opt-in for OperationKind.Dangerous: the setting, the authorization check and the /about permission
    /// </summary>
    [TestClass]
    public class DangerousOperationsTests
    {
        [TestInitialize]
        public void TestInit()
        {
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_NONCE, string.Empty);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_MODE, string.Empty);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, string.Empty);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED, string.Empty);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_USER_NAMES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES, null);
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, null);
        }

        [TestMethod]
        [DataRow(null, false)]
        [DataRow("", false)]
        [DataRow("true", true)]
        [DataRow("TRUE", true)]
        [DataRow(" true ", true)]
        [DataRow("false", false)]
        [DataRow("1", false)]
        [DataRow("yes", false)]
        public void SettingsReadTheFlagFromTheEnvironment(string value, bool expected)
        {
            // Arrange

            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED, value);

            // Act

            var settings = new DfmSettings();

            // Assert

            Assert.AreEqual(expected, settings.DangerousOperationsEnabled);
        }

        [TestMethod]
        public async Task DangerousOperationIsRejectedWhenDisabled()
        {
            // Arrange

            var request = new FakeHttpRequestData(new Uri("http://localhost"));
            var settings = new DfmSettings { DisableAuthentication = true, DangerousOperationsEnabled = false };

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmAccessViolationException>(
                () => Auth.ValidateIdentityAsync(request, OperationKind.Dangerous, settings));

            // Assert

            StringAssert.Contains(ex.Message, EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED);

            // The same request is fine for an ordinary write
            Assert.AreEqual(DfmMode.Normal, await Auth.ValidateIdentityAsync(request, OperationKind.Write, settings));
        }

        [TestMethod]
        public async Task DangerousOperationIsAllowedWhenEnabled()
        {
            // Arrange

            var request = new FakeHttpRequestData(new Uri("http://localhost"));
            var settings = new DfmSettings { DisableAuthentication = true, DangerousOperationsEnabled = true };

            // Act

            var mode = await Auth.ValidateIdentityAsync(request, OperationKind.Dangerous, settings);

            // Assert

            Assert.AreEqual(DfmMode.Normal, mode);
        }

        [TestMethod]
        public async Task DangerousOperationIsRejectedInReadOnlyModeEvenWhenEnabled()
        {
            // Arrange

            var request = new FakeHttpRequestData(new Uri("http://localhost"));
            var settings = new DfmSettings { DisableAuthentication = true, DangerousOperationsEnabled = true, Mode = DfmMode.ReadOnly };

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmAccessViolationException>(
                () => Auth.ValidateIdentityAsync(request, OperationKind.Dangerous, settings));

            // Assert

            Assert.AreEqual("Endpoint is in ReadOnly mode", ex.Message);
        }

        [TestMethod]
        public async Task DangerousOperationIsRejectedForAReadOnlyRoleEvenWhenEnabled()
        {
            // Arrange

            var request = new FakeHttpRequestData(new Uri("http://localhost/a/p/i/--TestHub/about"));

            string xsrfToken = $"xsrf-token-{DateTime.Now.Ticks}";
            request.AddCookie(Globals.XsrfTokenCookieAndHeaderName, xsrfToken);
            request.Headers.Add(Globals.XsrfTokenCookieAndHeaderName, xsrfToken);

            request.AddIdentity(new ClaimsIdentity(new Claim[]
            {
                new Claim("preferred_username", "tino@contoso.com"),
                new Claim("roles", "readers")
            }, "tino-test-auth-type"));

            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES, "readers");

            var settings = new DfmSettings { DangerousOperationsEnabled = true };

            // Act

            var ex = await Assert.ThrowsExactlyAsync<DfmAccessViolationException>(
                () => Auth.ValidateIdentityAsync(request, OperationKind.Dangerous, settings));

            // Assert

            StringAssert.Contains(ex.Message, "read-only mode");
        }

        [TestMethod]
        [DataRow(true, DfmMode.Normal, new[] { Globals.ReadWritePermission, Globals.DangerousOperationsPermission })]
        [DataRow(false, DfmMode.Normal, new[] { Globals.ReadWritePermission })]
        [DataRow(true, DfmMode.ReadOnly, new string[0])]
        public async Task AboutReportsTheDangerousOperationsPermission(bool enabled, DfmMode mode, string[] expectedPermissions)
        {
            // Arrange

            var request = new FakeHttpRequestData(new Uri("http://localhost"));
            request.FunctionContext.Items[Globals.DfmModeContextValue] = mode;

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage, "AccountName=Tino;");
            Environment.SetEnvironmentVariable(EnvVariableNames.DFM_HUB_NAME, "Hub1");

            var settings = new DfmSettings { DangerousOperationsEnabled = enabled };

            // Act

            var result = await new About(settings, new DfmExtensionPoints())
                .DfmAboutFunction(request, "-", "Hub1", request.FunctionContext);

            // Assert

            result.Body.Seek(0, SeekOrigin.Begin);
            using (var reader = new StreamReader(result.Body))
            {
                dynamic resultJson = JsonConvert.DeserializeObject(reader.ReadToEnd());

                string[] permissions = ((Newtonsoft.Json.Linq.JArray)resultJson.permissions).Select(p => p.ToString()).ToArray();

                CollectionAssert.AreEquivalent(expectedPermissions, permissions);
            }
        }

        [TestMethod]
        public void InputEventFunctionsCarryTheExpectedOperationKinds()
        {
            // Restart in place and replay rewrite storage and re-run side effects; editing one input and rewinding does not
            Assert.AreEqual(OperationKind.Read, KindOf(nameof(InputEvents.DfmGetInputEventsFunction)));
            Assert.AreEqual(OperationKind.Dangerous, KindOf(nameof(InputEvents.DfmRestartInPlaceFunction)));
            Assert.AreEqual(OperationKind.Write, KindOf(nameof(InputEvents.DfmUpdateInputAndRewindFunction)));
            Assert.AreEqual(OperationKind.Dangerous, KindOf(nameof(InputEvents.DfmReplayFunction)));

            static OperationKind KindOf(string functionName)
            {
                var method = typeof(InputEvents).GetMethod(functionName);

                Assert.IsNotNull(method.GetCustomAttribute<FunctionAttribute>(), $"{functionName} should be a Function");

                return method.GetCustomAttribute<OperationKindAttribute>().Kind;
            }
        }

        [TestMethod]
        public void OnlyTheDangerousFunctionsAreMarkedDangerous()
        {
            // Arrange

            var dangerousFunctions = typeof(DfmSettings).Assembly.DefinedTypes
                .Where(t => t.IsClass)
                .SelectMany(t => t.GetMethods())
                .Where(m => m.GetCustomAttribute<OperationKindAttribute>()?.Kind == OperationKind.Dangerous)
                .Select(m => m.Name)
                .ToArray();

            // Assert

            // Anything added here needs the same scrutiny as these two: it rewrites Task Hub storage
            CollectionAssert.AreEquivalent(
                new[] { nameof(InputEvents.DfmRestartInPlaceFunction), nameof(InputEvents.DfmReplayFunction) },
                dangerousFunctions);
        }
    }
}
