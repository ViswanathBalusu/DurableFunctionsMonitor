// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Linq;
using System.Security.Claims;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// What DfMon reads about the caller out of a principal that was already validated: shown in the
    /// account menu of the UI and written into every audit record.
    /// </summary>
    [TestClass]
    public class DfmIdentityTests
    {
        private const string ObjectIdUri = "http://schemas.microsoft.com/identity/claims/objectidentifier";
        private const string TenantIdUri = "http://schemas.microsoft.com/identity/claims/tenantid";

        private static ClaimsPrincipal Principal(params Claim[] claims)
        {
            return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
        }

        [TestMethod]
        public void ReadsEveryClaimFromATokenDfMonParsedItself()
        {
            // Arrange: the short claim names of a JWT

            var principal = Principal(
                new Claim("preferred_username", "alice@contoso.com"),
                new Claim("name", "Alice Smith"),
                new Claim("email", "alice.smith@contoso.com"),
                new Claim("oid", "11111111-2222-3333-4444-555555555555"),
                new Claim("tid", "66666666-7777-8888-9999-000000000000"),
                new Claim("roles", "Operator"),
                new Claim("roles", "Reader"));

            // Act

            var identity = DfmIdentity.FromPrincipal(principal, new DfmSettings(), DfmIdentity.Bearer);

            // Assert

            Assert.AreEqual("alice@contoso.com", identity.UserName);
            Assert.AreEqual("Alice Smith", identity.Name);
            Assert.AreEqual("alice.smith@contoso.com", identity.Email);
            Assert.AreEqual("11111111-2222-3333-4444-555555555555", identity.ObjectId);
            Assert.AreEqual("66666666-7777-8888-9999-000000000000", identity.TenantId);
            CollectionAssert.AreEqual(new[] { "Operator", "Reader" }, identity.Roles.ToArray());
            Assert.AreEqual("bearer", identity.AuthMethod);
        }

        [TestMethod]
        public void UnderstandsTheLongClaimNamesEasyAuthSends()
        {
            // Arrange: Easy Auth spells the object id and the tenant id as schema URIs

            var principal = Principal(
                new Claim("preferred_username", "alice@contoso.com"),
                new Claim(ObjectIdUri, "11111111-2222-3333-4444-555555555555"),
                new Claim(TenantIdUri, "66666666-7777-8888-9999-000000000000"),
                new Claim(ClaimTypes.Role, "Operator"));

            // Act

            var identity = DfmIdentity.FromPrincipal(principal, new DfmSettings(), DfmIdentity.EasyAuth);

            // Assert

            Assert.AreEqual("11111111-2222-3333-4444-555555555555", identity.ObjectId);
            Assert.AreEqual("66666666-7777-8888-9999-000000000000", identity.TenantId);
            CollectionAssert.AreEqual(new[] { "Operator" }, identity.Roles.ToArray());
            Assert.AreEqual("easyauth", identity.AuthMethod);
        }

        [TestMethod]
        public void LeavesWhatTheTokenDoesNotSayNull()
        {
            // Arrange: a token with nothing but the user name

            var principal = Principal(new Claim("preferred_username", "alice@contoso.com"));

            // Act

            var identity = DfmIdentity.FromPrincipal(principal, new DfmSettings(), DfmIdentity.EasyAuth);

            // Assert: no name made up from the user name, no empty strings

            Assert.AreEqual("alice@contoso.com", identity.UserName);
            Assert.IsNull(identity.Name);
            Assert.IsNull(identity.Email);
            Assert.IsNull(identity.ObjectId);
            Assert.IsNull(identity.TenantId);
            Assert.AreEqual(0, identity.Roles.Count);
        }

        [TestMethod]
        public void ListsARoleOnceEvenWhenTheTokenSpellsItTwice()
        {
            var principal = Principal(
                new Claim("preferred_username", "alice@contoso.com"),
                new Claim("roles", "Operator"),
                new Claim(ClaimTypes.Role, "Operator"));

            var identity = DfmIdentity.FromPrincipal(principal, new DfmSettings(), DfmIdentity.Bearer);

            CollectionAssert.AreEqual(new[] { "Operator" }, identity.Roles.ToArray());
        }

        [TestMethod]
        public void HonoursTheConfiguredUserNameAndRolesClaims()
        {
            // Arrange: a deployment that identifies users by 'upn' and keeps its roles in 'groups'

            var settings = new DfmSettings { UserNameClaimName = "upn", RolesClaimName = "groups" };

            var principal = Principal(
                new Claim("upn", "alice@contoso.com"),
                new Claim("preferred_username", "somebody-else@contoso.com"),
                new Claim("groups", "g1"));

            // Act

            var identity = DfmIdentity.FromPrincipal(principal, settings, DfmIdentity.Bearer);

            // Assert

            Assert.AreEqual("alice@contoso.com", identity.UserName);
            CollectionAssert.AreEqual(new[] { "g1" }, identity.Roles.ToArray());
        }

        [TestMethod]
        public void TheCallersWithoutAnAccountAreNamedForWhatTheyAre()
        {
            var anonymous = DfmIdentity.ForAnonymous();
            Assert.AreEqual(Globals.AnonymousUserName, anonymous.UserName);
            Assert.AreEqual("anonymous", anonymous.AuthMethod);

            var vsCode = DfmIdentity.ForVsCode();
            Assert.AreEqual(Globals.VsCodeUserName, vsCode.UserName);
            Assert.AreEqual("vscode", vsCode.AuthMethod);
        }
    }
}
