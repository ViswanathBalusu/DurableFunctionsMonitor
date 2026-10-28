// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Security.Claims;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Who is calling, as far as DfMon could validate it: the claims of the identity that Easy Auth (or the
    /// bearer token DfMon checked itself) vouched for. The same record is shown to the user (the account
    /// menu of the UI) and written into every audit record, so the two never disagree.
    ///
    /// It is built from the validated principal on the server, never from anything the browser reports about
    /// itself: whatever the UI's own MSAL session says is for display only.
    /// </summary>
    public class DfmIdentity
    {
        /// <summary>The value of the configured user-name claim (preferred_username by default): the name allow-lists are checked against.</summary>
        public string UserName { get; set; }

        /// <summary>The display name ('name' claim). Null when the identity has none.</summary>
        public string Name { get; set; }

        /// <summary>The 'email' claim. Null when there is none, which is common: the user name is usually the address.</summary>
        public string Email { get; set; }

        /// <summary>The user's object id in the directory ('oid' claim): the one value that never changes when a user is renamed.</summary>
        public string ObjectId { get; set; }

        /// <summary>The directory the user signed in to ('tid' claim).</summary>
        public string TenantId { get; set; }

        /// <summary>App roles of the user (the configured roles claim). Empty when there are none.</summary>
        public IReadOnlyList<string> Roles { get; set; } = Array.Empty<string>();

        /// <summary>How the call was authenticated: one of <see cref="EasyAuth"/>, <see cref="Bearer"/>, <see cref="VsCode"/>, <see cref="Anonymous"/>.</summary>
        public string AuthMethod { get; set; }

        /// <summary>Easy Auth (the App Service authentication layer) authenticated the call.</summary>
        public const string EasyAuth = "easyauth";

        /// <summary>DfMon validated the bearer token of the call itself.</summary>
        public const string Bearer = "bearer";

        /// <summary>The nonce of the VS Code extension authenticated the call.</summary>
        public const string VsCode = "vscode";

        /// <summary>Authentication is disabled, so nobody was identified.</summary>
        public const string Anonymous = "anonymous";

        /// <summary>The caller of a deployment that has authentication turned off.</summary>
        public static DfmIdentity ForAnonymous()
        {
            return new DfmIdentity { UserName = Globals.AnonymousUserName, AuthMethod = Anonymous };
        }

        /// <summary>The caller that came through the VS Code extension.</summary>
        public static DfmIdentity ForVsCode()
        {
            return new DfmIdentity { UserName = Globals.VsCodeUserName, AuthMethod = VsCode };
        }

        /// <summary>
        /// Reads an identity from a principal that was already validated. Claims come in two spellings
        /// ('oid' from a token DfMon parsed, a long schema URI from the Easy Auth header), and both are understood.
        /// </summary>
        internal static DfmIdentity FromPrincipal(ClaimsPrincipal principal, DfmSettings settings, string authMethod)
        {
            var roleTypes = new[] { settings.RolesClaimName, ClaimTypes.Role, "roles" };

            return new DfmIdentity
            {
                UserName = FirstValue(principal, settings.UserNameClaimName),
                Name = FirstValue(principal, "name", ClaimTypes.Name),
                Email = FirstValue(principal, "email", ClaimTypes.Email),
                ObjectId = FirstValue(principal, "oid", ObjectIdClaimType),
                TenantId = FirstValue(principal, "tid", TenantIdClaimType),
                Roles = principal.Claims
                    .Where(claim => roleTypes.Contains(claim.Type) && !string.IsNullOrEmpty(claim.Value))
                    .Select(claim => claim.Value)
                    .Distinct()
                    .ToList(),
                AuthMethod = authMethod
            };
        }

        /// <summary>The claims DfMon reads out of the Easy Auth header besides the user name and the roles.</summary>
        internal static readonly string[] DescriptiveClaimTypes = new[]
        {
            "name", ClaimTypes.Name, "email", ClaimTypes.Email, "oid", ObjectIdClaimType, "tid", TenantIdClaimType
        };

        private static string FirstValue(ClaimsPrincipal principal, params string[] claimTypes)
        {
            foreach (var claimType in claimTypes)
            {
                string value = principal.FindFirst(claimType)?.Value;

                if (!string.IsNullOrEmpty(value))
                {
                    return value;
                }
            }

            return null;
        }

        private const string ObjectIdClaimType = "http://schemas.microsoft.com/identity/claims/objectidentifier";
        private const string TenantIdClaimType = "http://schemas.microsoft.com/identity/claims/tenantid";
    }
}
