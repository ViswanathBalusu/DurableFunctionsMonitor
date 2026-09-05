// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;
using Microsoft.Azure.Functions.Worker.Http;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The 'from', 'to' and bounded-integer query parameters shared by the aggregation endpoints
    /// (/stats, /failures, /audit). One place, so that all of them accept exactly the same date formats,
    /// enforce the same maximum range and answer the same 400s - a client that can call one can call the
    /// others.
    /// </summary>
    internal static class RangeQuery
    {
        /// <summary>
        /// Reads the required 'from' and 'to' parameters. Both are ISO 8601 read with the invariant
        /// culture; a value without an offset is taken as UTC and one with an offset is converted to it,
        /// so everything downstream (table filters, bins) works in UTC.
        /// </summary>
        /// <exception cref="DfmBadRequestException">
        /// A parameter is missing or unparsable, 'to' is not later than 'from', or the range is longer
        /// than <see cref="MaxRangeDays"/> days.
        /// </exception>
        public static (DateTimeOffset From, DateTimeOffset To) Parse(HttpRequestData req)
        {
            var from = ParseRequiredDate(req.Query["from"], "from");
            var to = ParseRequiredDate(req.Query["to"], "to");

            if (to <= from)
            {
                throw new DfmBadRequestException($"'to' ({to:o}) must be later than 'from' ({from:o})");
            }

            if (to - from > MaxRange)
            {
                throw new DfmBadRequestException($"The requested range is longer than the maximum of {MaxRange.TotalDays:0} days");
            }

            return (from, to);
        }

        /// <summary>
        /// Reads an optional integer parameter with a default and inclusive bounds.
        /// Out of range is rejected rather than clamped: a chart drawn with 1000 bins when 1000 were asked
        /// for and 366 were used would be silently wrong.
        /// </summary>
        /// <exception cref="DfmBadRequestException">The value is not an integer, or outside [min, max].</exception>
        public static int ParseBoundedInt(string raw, string paramName, int defaultValue, int min, int max)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return defaultValue;
            }

            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value))
            {
                throw new DfmBadRequestException($"Invalid '{paramName}' value: '{raw}'");
            }

            if (value < min || value > max)
            {
                throw new DfmBadRequestException($"Parameter '{paramName}' must be between {min} and {max}, was {value}");
            }

            return value;
        }

        private static DateTimeOffset ParseRequiredDate(string raw, string paramName)
        {
            if (string.IsNullOrEmpty(raw))
            {
                throw new DfmBadRequestException($"Parameter '{paramName}' is required");
            }

            if (!DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
            {
                throw new DfmBadRequestException($"Invalid '{paramName}' value: '{raw}'");
            }

            return value;
        }

        /// <summary>
        /// The longest range one request may aggregate. Longer ranges belong to several requests, so that a
        /// single scan stays bounded in time as well as in rows.
        /// </summary>
        internal const int MaxRangeDays = 92;

        private static readonly TimeSpan MaxRange = TimeSpan.FromDays(MaxRangeDays);
    }
}
