// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text.RegularExpressions;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Turns an incoming request (method, absolute path and, when the route has one, the {action}
    /// route value) into a human-readable operation name for the audit trail, together with whether
    /// that operation is a Dangerous one and which instance (if any) it targets.
    ///
    /// Pure mapping, no storage access: consumed by the audit middleware hook (B5-S2-T2).
    /// </summary>
    public static class AuditOperations
    {
        /// <summary>
        /// PascalCase names of DfMon operations, keyed by the route segment that identifies them
        /// (the {action} route value for the single-instance endpoints, or the literal trailing
        /// path segment for everything else). The bool says whether the operation is Dangerous.
        /// </summary>
        private static readonly Dictionary<string, (string Name, bool Dangerous)> OperationsBySegment = new(StringComparer.Ordinal)
        {
            ["suspend"] = ("Suspend", false),
            ["resume"] = ("Resume", false),
            ["rewind"] = ("Rewind", false),
            ["terminate"] = ("Terminate", false),
            ["raise-event"] = ("Raise event", false),
            ["set-custom-status"] = ("Set customStatus", false),
            ["restart"] = ("Restart", false),
            ["purge"] = ("Purge", false),
            ["update-input-and-rewind"] = ("Update input and rewind", false),
            ["replay"] = ("Replay", true),
            ["restart-in-place"] = ("Restart in place", true),
            ["batch"] = ("Batch", false),
            ["purge-history"] = ("Purge history", false),
            ["clean-entity-storage"] = ("Clean entity storage", false),
            ["delete-task-hub"] = ("Delete task hub", false),
        };

        // Matches the OData-style instance id segment, e.g. orchestrations('my-instance-id').
        // The delimiting quotes are always literal (an actual quote inside the id is percent-encoded
        // as %27 by the caller), so this is unambiguous even when the id itself contains %27.
        private static readonly Regex InstanceIdPattern = new(@"orchestrations\('([^']*)'\)", RegexOptions.Compiled);

        /// <summary>
        /// Maps a request to (operation, dangerous, instanceId). <paramref name="action"/> is the
        /// {action} route value when the matched route has one (the single-instance endpoints:
        /// suspend, resume, rewind, terminate, raise-event, set-custom-status, restart, purge);
        /// pass null or empty otherwise.
        /// </summary>
        public static (string Operation, bool Dangerous, string InstanceId) FromRequest(string method, string absolutePath, string action)
        {
            string path = absolutePath ?? string.Empty;
            int queryIndex = path.IndexOf('?');
            if (queryIndex >= 0)
            {
                path = path[..queryIndex];
            }
            path = path.TrimEnd('/');

            string instanceId = null;
            var idMatch = InstanceIdPattern.Match(path);
            if (idMatch.Success)
            {
                instanceId = Uri.UnescapeDataString(idMatch.Groups[1].Value);
            }

            string segment = !string.IsNullOrEmpty(action) ? action : LastSegment(path);

            // POST /orchestrations (no instance id, no action) creates a new instance. The bare
            // "orchestrations" segment never occurs elsewhere: every other route either attaches the
            // instance id without a slash (orchestrations('id')/...) or is a completely different path.
            if (string.IsNullOrEmpty(action) && string.Equals(segment, "orchestrations", StringComparison.Ordinal)
                && string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
            {
                return ("Start new instance", false, instanceId);
            }

            if (segment != null && OperationsBySegment.TryGetValue(segment, out var mapped))
            {
                return (mapped.Name, mapped.Dangerous, instanceId);
            }

            // Anything else: the last path segment, verbatim.
            return (segment ?? string.Empty, false, instanceId);
        }

        private static string LastSegment(string path)
        {
            int slashIndex = path.LastIndexOf('/');
            string last = slashIndex >= 0 ? path[(slashIndex + 1)..] : path;
            return Uri.UnescapeDataString(last);
        }
    }
}
