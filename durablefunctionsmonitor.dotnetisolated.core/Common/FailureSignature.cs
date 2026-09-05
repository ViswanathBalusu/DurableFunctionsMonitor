// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Turns a failed instance's Output into a short, stable signature, so that the /failures endpoint
    /// (B3) can group instances that failed for the same underlying reason. Pure: no storage access,
    /// so every normalisation rule is unit tested here rather than through the endpoint.
    /// </summary>
    public static class FailureSignature
    {
        /// <summary>
        /// Reasons longer than this (after taking the first line) are cut off.
        /// </summary>
        private const int MaxLength = 300;

        /// <summary>
        /// What an empty/whitespace-only reason normalises to.
        /// </summary>
        public const string NoMessage = "(no message)";

        /// <summary>
        /// Picks the human-readable error text out of a failed instance's Output:
        /// a JSON object with an <c>ErrorMessage</c> or <c>message</c> property (case-insensitive; falling back
        /// to <c>InnerFailure.ErrorMessage</c> when the outer one is empty) uses that property's value; a JSON
        /// string is unwrapped; anything else is used as-is. The result is then reduced to its first line,
        /// trimmed, and capped at <see cref="MaxLength"/> characters.
        /// </summary>
        public static string Extract(string output)
        {
            if (string.IsNullOrWhiteSpace(output))
            {
                return string.Empty;
            }

            string text = output;

            JToken token = TryParseJson(output);
            if (token != null)
            {
                if (token is JObject obj)
                {
                    string fromProperty = GetErrorMessage(obj);
                    if (fromProperty != null)
                    {
                        text = fromProperty;
                    }
                }
                else if (token.Type == JTokenType.String)
                {
                    text = token.Value<string>() ?? string.Empty;
                }
            }

            return FirstLine(text);
        }

        /// <summary>
        /// Replaces the volatile parts of an error message (GUIDs, numbers - including ones embedded in
        /// identifiers, quoted values, long hex runs such as hashes) with <c>*</c>, then collapses repeated
        /// <c>*</c> and whitespace, so that instances which failed for the same reason but with different
        /// ids/amounts/timestamps end up with the same signature.
        /// </summary>
        public static string Normalize(string reason)
        {
            string text = reason ?? string.Empty;

            text = GuidPattern.Replace(text, "*");
            text = NumberPattern.Replace(text, "*");
            text = QuotedValuePattern.Replace(text, "*");
            text = HexRunPattern.Replace(text, "*");

            text = RepeatedStarsPattern.Replace(text, "*");
            text = WhitespacePattern.Replace(text, " ").Trim();

            return text.Length == 0 ? NoMessage : text;
        }

        /// <summary>
        /// The key failure instances are grouped by on the Failures screen.
        /// </summary>
        public static string GroupKey(string name, string signature)
        {
            return $"{name}|{signature}";
        }

        private static string FirstLine(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return string.Empty;
            }

            int newlineIndex = text.IndexOfAny(NewlineChars);
            string line = (newlineIndex < 0 ? text : text.Substring(0, newlineIndex)).Trim();

            return line.Length > MaxLength ? line.Substring(0, MaxLength) : line;
        }

        private static JToken TryParseJson(string text)
        {
            try
            {
                return JToken.Parse(text);
            }
            catch (JsonReaderException)
            {
                return null;
            }
        }

        // Returns the outer ErrorMessage/message property when non-empty, else InnerFailure.ErrorMessage
        // when that is non-empty, else null (caller then keeps the raw JSON text).
        private static string GetErrorMessage(JObject obj)
        {
            string direct = FindNonEmptyStringProperty(obj, "ErrorMessage") ?? FindNonEmptyStringProperty(obj, "message");
            if (direct != null)
            {
                return direct;
            }

            JProperty innerFailureProperty = obj.Properties().FirstOrDefault(p => string.Equals(p.Name, "InnerFailure", StringComparison.OrdinalIgnoreCase));
            if (innerFailureProperty?.Value is JObject innerObj)
            {
                string inner = FindNonEmptyStringProperty(innerObj, "ErrorMessage");
                if (inner != null)
                {
                    return inner;
                }
            }

            return null;
        }

        private static string FindNonEmptyStringProperty(JObject obj, string name)
        {
            JProperty property = obj.Properties().FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
            if (property?.Value?.Type != JTokenType.String)
            {
                return null;
            }

            string value = property.Value.Value<string>();
            return string.IsNullOrEmpty(value) ? null : value;
        }

        private static readonly char[] NewlineChars = new[] { '\r', '\n' };

        // 8-4-4-4-12 hex groups, e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6
        private static readonly Regex GuidPattern = new Regex(
            @"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
            RegexOptions.Compiled);

        // Integers and decimals. Word-boundary anchored, so a run of digits attached to letters with no
        // separator (e.g. inside a hash such as "8f3a1c9d") is left alone for HexRunPattern below, while a run
        // reachable through a non-word separator (e.g. "SKU-4471", "warehouse-07") is still matched.
        private static readonly Regex NumberPattern = new Regex(@"\b\d+(?:\.\d+)?\b", RegexOptions.Compiled);

        // A whole single- or double-quoted value, quotes included.
        private static readonly Regex QuotedValuePattern = new Regex("\"[^\"\r\n]*\"|'[^'\r\n]*'", RegexOptions.Compiled);

        // Long hex runs (hashes, checksums). Runs after NumberPattern, so pure-digit runs are already gone.
        private static readonly Regex HexRunPattern = new Regex(@"\b[0-9a-fA-F]{8,}\b", RegexOptions.Compiled);

        private static readonly Regex RepeatedStarsPattern = new Regex(@"\*{2,}", RegexOptions.Compiled);

        private static readonly Regex WhitespacePattern = new Regex(@"\s+", RegexOptions.Compiled);
    }
}
