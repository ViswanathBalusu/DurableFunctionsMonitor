// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;
using System.Threading.Tasks;
using System;
using System.Threading;
using Azure.Core;
using Azure.Identity;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{

    class MockedTokenCredential : TokenCredential
    {
        public bool ShouldThrow = false;
        public readonly string ExceptionText = "Exception from MockedTableCredential";

        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            throw new NotImplementedException();
        }

        public override async ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        {
            if (this.ShouldThrow)
            {
                throw new Exception(ExceptionText);
            }

            // Making a token that expires 12 seconds from now
            const int expiresIn = 12;
            return new AccessToken(this._rnd.Next().ToString(), DateTimeOffset.UtcNow + TimeSpan.FromSeconds(expiresIn));
        }

        private readonly Random _rnd = new Random();
    }

    [TestClass]
    public class IdentityBasedTokenSourceTests
    {

        // NOTE: there used to be a test here for hand-rolled bearer token caching. That caching
        // existed only because the legacy WindowsAzure.Storage SDK took a raw token string.
        // Azure.Data.Tables and Azure.Storage.Blobs take the TokenCredential itself and do their
        // own fetching, caching and refreshing, so all that is left to cover is which credential
        // gets handed to them.

        [TestMethod]
        public void HandsOutTheMockedCredentialWhenOneIsSet()
        {
            // Arrange

            var mockedTokenCredential = new MockedTokenCredential();

            try
            {
                IdentityBasedTokenSource.MockedTokenCredential = mockedTokenCredential;

                // Act

                var credential = IdentityBasedTokenSource.GetCredential();

                // Assert

                Assert.AreSame(mockedTokenCredential, credential);
            }
            finally
            {
                IdentityBasedTokenSource.MockedTokenCredential = null;
            }

            // And falls back to the real credential chain once the mock is removed
            Assert.IsInstanceOfType(IdentityBasedTokenSource.GetCredential(), typeof(DefaultAzureCredential));
        }

        [TestMethod]
        public void ReturnsDefaultAzureCredential()
        {
            var tokenCredential = IdentityBasedTokenSource.GetTokenCredential();

            // This is the only thing we can check
            Assert.IsNotNull(tokenCredential);

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage + Globals.IdentityBasedConnectionSettingCredentialSuffix, Globals.IdentityBasedConnectionSettingCredentialValue);
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsStorage + Globals.IdentityBasedConnectionSettingClientIdSuffix, "10000000-0000-0000-0000-000000000001");

            var tokenCredential2 = IdentityBasedTokenSource.GetTokenCredential();

            // This is the only thing we can check
            Assert.IsNotNull(tokenCredential2);
        }
    }
}
