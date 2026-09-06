// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Defines functional mode for DurableFunctionsMonitor endpoint.
    /// </summary>
    public enum DfmMode
    {
        Normal = 0,
        ReadOnly
    }

    /// <summary>
    /// DurableFunctionsMonitor configuration settings
    /// </summary>
    public class DfmSettings
    {
        /// <summary>
        /// Turns authentication off for DurableFunctionsMonitor endpoint.
        /// WARNING: this might not only expose DurableFunctionsMonitor to the public, but also
        /// expose all other HTTP-triggered endpoints in your project. Make sure you know what you're doing.
        /// </summary>
        public bool DisableAuthentication { get; set; }

        /// <summary>
        /// Functional mode for DurableFunctionsMonitor endpoint.
        /// Currently only Normal (default) and ReadOnly modes are supported.
        /// </summary>
        public DfmMode Mode { get; set; }

        /// <summary>
        /// List of App Roles, that are allowed to access DurableFunctionsMonitor endpoint. Users/Groups then need 
        /// to be assigned one of these roles via AAD Enterprise Applications->[your AAD app]->Users and Groups tab.
        /// Once set, the incoming access token is expected to contain one of these in its 'roles' claim.
        /// </summary>
        public IEnumerable<string> AllowedAppRoles { get; set; }

        /// <summary>
        /// List of App Roles, that are allowed to full access DurableFunctionsMonitor endpoint. Users/Groups then need
        /// to be assigned one of these roles via AAD Enterprise Applications->[your AAD app]->Users and Groups tab.
        /// Once set, the incoming access token is expected to contain one of these in its 'roles' claim.
        /// </summary>
        public IEnumerable<string> AllowedFullAccessAppRoles { get; set; }

        /// <summary>
        /// List of App Roles, that are allowed read only access to the DurableFunctionsMonitor endpoint. Users/Groups then need 
        /// to be assigned one of these roles via AAD Enterprise Applications->[your AAD app]->Users and Groups tab.
        /// Once set, the incoming access token is expected to contain one of these in its 'roles' claim.
        /// </summary>
        public IEnumerable<string> AllowedReadOnlyAppRoles { get; set; }

        /// <summary>
        /// List of users, that are allowed to access DurableFunctionsMonitor endpoint. You typically put emails into here.
        /// Once set, the incoming access token is expected to contain one of these names in its 'preferred_username' claim.
        /// </summary>
        public IEnumerable<string> AllowedUserNames { get; set; }

        /// <summary>
        /// Folder to load custom tab/html templates and Function Maps from, instead of Azure Storage.
        /// Either an absolute path, or a path relative to the folder your app runs from - typically a
        /// folder of your Functions project, adjacent to host.json, copied to the output directory.
        /// Just the folder name ("dfm-templates") is enough; do not prepend the bin folder to it.
        /// Can also be set by setting DFM_CUSTOM_TEMPLATES_FOLDER.
        /// </summary>
        public string CustomTemplatesFolderName { get; set; }

        /// <summary>
        /// Name of the claim (from ClaimsCredential) to be used as a user name.
        /// Defaults to "preferred_username"
        /// </summary>
        public string UserNameClaimName { get; set; }

        /// <summary>
        /// Name of the claim (from ClaimsCredential) to be used as a role name.
        /// Defaults to "roles"
        /// </summary>
        public string RolesClaimName { get; set; }

        /// <summary>
        /// Enables the operations marked as <see cref="OperationKind.Dangerous"/>: 'restart in place' and 'replay'.
        /// They rewrite Task Hub storage (purge and re-create an instance, delete part of an instance's history)
        /// and re-execute activities that already ran. Off by default.
        /// Can also be enabled by setting DFM_DANGEROUS_OPERATIONS_ENABLED to 'true'.
        /// </summary>
        public bool DangerousOperationsEnabled { get; set; }

        /// <summary>
        /// Turns on the audit trail: every Write and Dangerous operation performed through DfMon
        /// is recorded (who, what, which instance, outcome) in a per-hub DfmAudit table, readable
        /// via the /audit endpoint. Off by default.
        /// Can also be enabled by setting DFM_AUDIT_ENABLED to 'true'.
        /// </summary>
        public bool AuditEnabled { get; set; }

        /// <summary>
        /// For how many seconds the aggregation endpoints (/stats, /failures, /storage, ...) may serve a
        /// previously computed result for the same Task Hub and the same (normalized) query, instead of
        /// scanning storage again. Implements decision D10 of the rewrite plan: auto-refreshing clients and
        /// several simultaneous users never trigger concurrent full-hub scans against the same Task Hub.
        /// Defaults to 30 seconds; 0 turns caching off.
        /// Can also be set by setting DFM_AGGREGATION_CACHE_SECONDS to a number of seconds.
        /// </summary>
        public int AggregationCacheSeconds { get; set; }

        /// <summary>
        /// Maximum number of instance rows a single /stats scan is allowed to read. The scan stops there and
        /// the response says so (partial == true), so a huge Task Hub cannot turn one request into an
        /// unbounded table scan. Defaults to 50000.
        /// Can also be set by setting DFM_STATS_CAP to a number of rows.
        /// </summary>
        public int StatsScanCap { get; set; }

        /// <summary>
        /// Custom prefix for 'User-Agent' header for requests to Azure Storage.
        /// When specified, the final 'User-Agent' header will look like this: 
        /// "CustomUserAgentPrefix/{DfMon's Version}"
        /// </summary>
        public string CustomUserAgentPrefix { get; set; }

        /// <summary>
        /// Initializes settings with default values
        /// </summary>
        public DfmSettings()
        {
            this.UserNameClaimName = Auth.PreferredUserNameClaim;
            this.RolesClaimName = Auth.RolesClaim;

            string dfmNonce = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_NONCE);

            string dfmAllowedUserNames = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_USER_NAMES);
            string dfmAllowedAppRoles = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_APP_ROLES);
            string dfmAllowedFullAccessAppRoles = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES);
            string dfmAllowedReadOnlyAppRoles = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES);
            string dfmMode = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_MODE);
            string dfmUserNameClaimName = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_USERNAME_CLAIM_NAME);
            string dfmRolesClaimName = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_ROLES_CLAIM_NAME);
            string dfmDangerousOperationsEnabled = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_DANGEROUS_OPERATIONS_ENABLED);
            string dfmAuditEnabled = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_AUDIT_ENABLED);
            string dfmAggregationCacheSeconds = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_AGGREGATION_CACHE_SECONDS);
            string dfmStatsCap = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_STATS_CAP);
            string dfmCustomTemplatesFolder = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_CUSTOM_TEMPLATES_FOLDER);

            // NOTE: an unset setting and a setting explicitly set to an empty string both mean
            // "no restriction" and must map to null. Up to .NET 9 an empty value could only ever
            // arrive here as null, because Environment.SetEnvironmentVariable(name, "") deleted the
            // variable. As of .NET 10 it stores the empty string instead, so "" reaches us verbatim.
            // Splitting that would yield [""] - a single allowed role named empty-string, which
            // locks every user out - so the check has to be IsNullOrEmpty, not == null.
            var allowedAppRoles = SplitOrNull(dfmAllowedAppRoles);
            var allowedFullAccessAppRoles = SplitOrNull(dfmAllowedFullAccessAppRoles);
            var allowedReadOnlyAppRoles = SplitOrNull(dfmAllowedReadOnlyAppRoles);

            // Validating that same app role does not appear in multiple settings
            if (AreAppRoleListsIntersecting(allowedAppRoles, allowedFullAccessAppRoles, allowedReadOnlyAppRoles))
            {
                throw new NotSupportedException($"{EnvVariableNames.DFM_ALLOWED_APP_ROLES}, {EnvVariableNames.DFM_ALLOWED_FULL_ACCESS_APP_ROLES} and {EnvVariableNames.DFM_ALLOWED_READ_ONLY_APP_ROLES} should not intersect");
            }

            this.DisableAuthentication = dfmNonce == Auth.ISureKnowWhatIAmDoingNonce;
            this.Mode = dfmMode == DfmMode.ReadOnly.ToString() ? DfmMode.ReadOnly : DfmMode.Normal;
            this.AllowedUserNames = SplitOrNull(dfmAllowedUserNames);
            this.AllowedAppRoles = allowedAppRoles;
            this.AllowedFullAccessAppRoles = allowedFullAccessAppRoles;
            this.AllowedReadOnlyAppRoles = allowedReadOnlyAppRoles;
            this.UserNameClaimName = string.IsNullOrEmpty(dfmUserNameClaimName) ? Auth.PreferredUserNameClaim : dfmUserNameClaimName;
            this.RolesClaimName = string.IsNullOrEmpty(dfmRolesClaimName) ? Auth.RolesClaim : dfmRolesClaimName;

            // Only the literal 'true' (any casing) opts in. Unset, empty or anything else keeps dangerous operations off.
            this.DangerousOperationsEnabled = string.Equals(dfmDangerousOperationsEnabled?.Trim(), "true", StringComparison.OrdinalIgnoreCase);

            // Same "literal true, any casing" rule as DangerousOperationsEnabled: unset, empty or anything else keeps auditing off.
            this.AuditEnabled = string.Equals(dfmAuditEnabled?.Trim(), "true", StringComparison.OrdinalIgnoreCase);

            // Numeric counterpart of the same rule: unset, empty, not a number or outside the supported
            // range all mean "use the documented default" rather than failing startup.
            this.AggregationCacheSeconds = ParseIntOrDefault(dfmAggregationCacheSeconds, DefaultAggregationCacheSeconds, 0, MaxAggregationCacheSeconds);
            this.StatsScanCap = ParseIntOrDefault(dfmStatsCap, DefaultStatsScanCap, 1, int.MaxValue);

            // Unset, empty or whitespace all mean "no local folder configured", which is how the rest of
            // DfMon spells "load custom templates from Storage instead".
            this.CustomTemplatesFolderName = string.IsNullOrWhiteSpace(dfmCustomTemplatesFolder) ? null : dfmCustomTemplatesFolder.Trim();
        }

        /// <summary>
        /// Reads a numeric config value, mapping "not set", "set to an empty string", "not a number" and
        /// "outside the supported range" all to <paramref name="defaultValue"/>.
        /// </summary>
        private static int ParseIntOrDefault(string value, int defaultValue, int min, int max)
        {
            if (string.IsNullOrEmpty(value) || !int.TryParse(value.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int result))
            {
                return defaultValue;
            }

            return result < min || result > max ? defaultValue : result;
        }

        /// <summary>
        /// Splits a comma-separated config value, mapping both "not set" and "set to an empty
        /// string" to null, which is how the rest of DfMon spells "no restriction configured".
        /// </summary>
        private static string[] SplitOrNull(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value.Split(',');
        }

        /// <summary>Default value of <see cref="AggregationCacheSeconds"/>.</summary>
        private const int DefaultAggregationCacheSeconds = 30;

        /// <summary>Upper bound of <see cref="AggregationCacheSeconds"/> (one hour), so a typo cannot freeze the Overview screen for a day.</summary>
        private const int MaxAggregationCacheSeconds = 3600;

        /// <summary>Default value of <see cref="StatsScanCap"/>. Matches the cap the storage routines fall back to.</summary>
        private const int DefaultStatsScanCap = 50000;

        private static bool AreAppRoleListsIntersecting(params string[][] appRoleLists)
        {
            try
            {
                appRoleLists.Where(a => a != null).SelectMany(a => a).ToDictionary(a => a);
                return false;
            }
            catch (ArgumentException)
            {
                return true;
            }
        }
    }
}