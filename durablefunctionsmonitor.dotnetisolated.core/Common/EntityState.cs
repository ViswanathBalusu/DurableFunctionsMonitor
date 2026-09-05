// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Parses the raw JSON a Durable Entity's state is stored as (Microsoft.DurableTask.Client.SerializedData.Value,
    /// as returned by DurableTaskClient.Entities.GetEntityAsync) into a JToken, and renders the one-line
    /// 'stateSummary' the /entities endpoint's EntityRow carries (docs/plans/svelte-rewrite/00-shared-contracts.md
    /// section 6). This is pure - no storage access - so it is unit-tested on its own.
    /// </summary>
    internal static class EntityState
    {
        /// <summary>
        /// The longest a stateSummary is allowed to be (contracts section 6, EntityRow.stateSummary).
        /// </summary>
        public const int MaxSummaryLength = 120;

        /// <summary>
        /// Parses a raw serialized entity state string into a JToken, unwrapping the
        /// { "exists": .., "state": "..." } envelope when present - the same envelope and the same rule
        /// DetailedOrchestrationStatus.ConvertInput applies to an entity's Input, so the two code paths
        /// never drift. Returns null for a missing (null/empty) state. Malformed JSON is returned as a
        /// plain string token rather than thrown - the caller always has something to show.
        /// </summary>
        public static JToken Parse(string serialized)
        {
            if (string.IsNullOrEmpty(serialized))
            {
                return null;
            }

            JToken token;
            try
            {
                token = JsonConvert.DeserializeObject<JToken>(serialized, ParseSettings);
            }
            catch (JsonException)
            {
                return new JValue(serialized);
            }

            return Unwrap(token);
        }

        /// <summary>
        /// Renders a parsed state as compact (single-line, no indentation) JSON, truncated to at most
        /// <see cref="MaxSummaryLength"/> characters (the last character becomes an ellipsis when truncated,
        /// so the cap is never exceeded). Returns null when there is no state to summarize.
        /// </summary>
        public static string Summarize(JToken state)
        {
            if (state == null)
            {
                return null;
            }

            string json = state.ToString(Formatting.None);
            if (json.Length <= MaxSummaryLength)
            {
                return json;
            }

            return json.Substring(0, MaxSummaryLength - 1) + "…";
        }

        // Same unwrap rule as DetailedOrchestrationStatus.ConvertInput: a top-level "state" property that is
        // itself a serialized JSON object gets parsed into a nested object, instead of staying a doubly-escaped
        // string. Anything else (no "state" property, or "state" is not an object-shaped string) is untouched.
        private static JToken Unwrap(JToken input)
        {
            if (input == null || input.Type != JTokenType.Object)
            {
                return input;
            }

            var stateToken = input["state"];
            if (stateToken == null || stateToken.Type != JTokenType.String)
            {
                return input;
            }

            string stateString = stateToken.Value<string>();
            if (!(stateString.StartsWith('{') && stateString.EndsWith('}')))
            {
                return input;
            }

            try
            {
                input["state"] = (JToken)JsonConvert.DeserializeObject(stateString, ParseSettings);
            }
            catch (JsonException)
            {
                // Leave the inner value as the raw string - the outer token is still valid JSON.
            }

            return input;
        }

        private static readonly JsonSerializerSettings ParseSettings = new JsonSerializerSettings
        {
            DateParseHandling = DateParseHandling.None
        };
    }
}
