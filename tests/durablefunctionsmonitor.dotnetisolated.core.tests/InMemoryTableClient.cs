// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// Tables in memory, behind ITableClient, for the tests of what is built on its queries.
    ///
    /// It answers a query the way Table Storage does, including the parts of it an emulator does not show:
    /// rows come back in key order, a page holds at most what was asked for, and a request looks at no more
    /// than <see cref="ScanLimit"/> rows before it answers - with fewer rows than asked for, or with none, and
    /// a token to continue from. That last one is the real service answering after five seconds of scanning,
    /// and it is exactly where code that takes an empty page for the end of a table goes wrong.
    ///
    /// Every request is recorded, so a test can say what a routine is allowed to cost.
    /// </summary>
    class InMemoryTableClient : ITableClient
    {
        /// <summary>One request to the "service".</summary>
        public class Request
        {
            public string Kind { get; set; }
            public string Table { get; set; }
            public string Filter { get; set; }
            public IReadOnlyList<string> Select { get; set; }
            public int RowsReturned { get; set; }
            public int RowsScanned { get; set; }
        }

        /// <summary>How many rows one request looks at before it answers. Unlimited by default.</summary>
        public int ScanLimit { get; set; } = int.MaxValue;

        /// <summary>The most rows the "service" puts into one page, whatever is asked for.</summary>
        public int ServerPageLimit { get; set; } = 1000;

        /// <summary>
        /// What a row says about a column that was asked for and that it does not have. Table Storage puts a
        /// null in its place; the storage emulator leaves the column out, which is the default here as well
        /// (false). No test against an emulator can tell the two apart, so the code that reads projected rows
        /// is run both ways here.
        /// </summary>
        public bool MissingColumnsComeBackAsNulls { get; set; }

        /// <summary>Called before every request is answered; a test can throw from it, or wait in it.</summary>
        public Func<Request, Task> OnRequest { get; set; }

        public IReadOnlyList<Request> Requests
        {
            get { lock (this._requests) { return this._requests.ToList(); } }
        }

        public int RowsReturned => this.Requests.Sum(r => r.RowsReturned);

        /// <summary>Everything a table holds, in key order. Not a request: a test looking at its own data.</summary>
        public IReadOnlyList<TableEntity> AllRows(string tableName) => this.Rows(tableName).ToList();

        public void ClearRequests()
        {
            lock (this._requests) { this._requests.Clear(); }
        }

        public InMemoryTableClient Add(string tableName, params TableEntity[] entities)
        {
            lock (this._tables)
            {
                if (!this._tables.TryGetValue(tableName, out var table))
                {
                    this._tables[tableName] = table = new List<TableEntity>();
                }

                table.AddRange(entities);

                // Table Storage keeps a table in the order of its keys, compared as they are written
                table.Sort(CompareKeys);
            }

            return this;
        }

        public Task<IEnumerable<string>> ListTableNamesAsync()
        {
            lock (this._tables) { return Task.FromResult<IEnumerable<string>>(this._tables.Keys.ToList()); }
        }

        public IEnumerable<TableEntity> GetAll(string tableName, string filter)
        {
            var request = this.Record("GetAll", tableName, filter, null);

            var rows = this.Rows(tableName).Where(ODataFilter.Parse(filter)).Select(row => this.Project(row, null)).ToList();

            request.RowsScanned = this.Rows(tableName).Count;
            request.RowsReturned = rows.Count;

            return rows;
        }

        public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter) => this.GetAllAsync(tableName, filter, CancellationToken.None);

        public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();

            return Task.FromResult(this.GetAll(tableName, filter));
        }

        public async Task<(IReadOnlyList<TableEntity> rows, bool truncated)> QueryAsync(string tableName, string filter, IEnumerable<string> select, int maxRows, CancellationToken ct)
        {
            if (maxRows < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(maxRows));
            }

            var result = new List<TableEntity>();
            string continuationToken = null;

            do
            {
                var page = await this.QueryPageAsync(tableName, filter, select, Math.Min(1000, maxRows + 1 - result.Count), continuationToken, ct);

                result.AddRange(page.Rows);
                continuationToken = page.ContinuationToken;
            }
            while (continuationToken != null && result.Count <= maxRows);

            return result.Count > maxRows ? (result.Take(maxRows).ToList(), true) : (result, false);
        }

        public async Task<TablePage> QueryPageAsync(string tableName, string filter, IEnumerable<string> select, int maxPerPage, string continuationToken, CancellationToken ct)
        {
            if (maxPerPage < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(maxPerPage));
            }

            ct.ThrowIfCancellationRequested();

            var selected = select?.ToList();
            var request = this.Record("QueryPage", tableName, filter, selected);

            if (this.OnRequest != null)
            {
                await this.OnRequest(request);
            }

            var rows = this.Rows(tableName);
            var matches = ODataFilter.Parse(filter);

            int pageSize = Math.Min(maxPerPage, this.ServerPageLimit);

            // The token is the place in the table to go on from
            int position = continuationToken == null ? 0 : int.Parse(continuationToken, CultureInfo.InvariantCulture);
            int scanned = 0;

            var page = new List<TableEntity>();

            while (position < rows.Count && page.Count < pageSize && scanned < this.ScanLimit)
            {
                var row = rows[position++];
                scanned++;

                if (matches(row))
                {
                    page.Add(this.Project(row, selected));
                }
            }

            request.RowsScanned = scanned;
            request.RowsReturned = page.Count;

            return new TablePage(page, position < rows.Count ? position.ToString(CultureInfo.InvariantCulture) : null);
        }

        public Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey) => this.GetEntityAsync(tableName, partitionKey, rowKey, null);

        public Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey, IEnumerable<string> select)
        {
            var selected = select?.ToList();
            var request = this.Record("GetEntity", tableName, $"{partitionKey}|{rowKey}", selected);

            var row = this.Rows(tableName).FirstOrDefault(r => r.PartitionKey == partitionKey && r.RowKey == rowKey);

            request.RowsReturned = row == null ? 0 : 1;

            return Task.FromResult(row == null ? null : this.Project(row, selected));
        }

        /// <summary>
        /// The most comparisons Table Storage takes in one $filter ("no more than 15 discrete comparisons are
        /// permitted within a $filter string"). The service answers a longer one with an error; nothing that
        /// runs locally does, this class included, so the filters DfMon sends are counted by its tests.
        /// </summary>
        public const int MaxComparisonsInAFilter = 15;

        /// <summary>How many comparisons a filter is made of.</summary>
        public static int CountComparisons(string filter)
        {
            if (string.IsNullOrEmpty(filter))
            {
                return 0;
            }

            // What is inside a quoted value is not part of the expression, whatever it looks like
            string withoutValues = System.Text.RegularExpressions.Regex.Replace(filter, "'(?:[^']|'')*'", "''");

            return System.Text.RegularExpressions.Regex.Matches(withoutValues, @"\s(eq|ne|gt|ge|lt|le)\s").Count;
        }

        public Task ReplaceEntityAsync(string tableName, TableEntity entity) => throw new NotSupportedException();

        public Task UpsertEntityAsync(string tableName, TableEntity entity) => throw new NotSupportedException();

        public Task DeleteEntitiesAsync(string tableName, IEnumerable<TableEntity> entities) => throw new NotSupportedException();

        private readonly Dictionary<string, List<TableEntity>> _tables = new Dictionary<string, List<TableEntity>>();
        private readonly List<Request> _requests = new List<Request>();

        private List<TableEntity> Rows(string tableName)
        {
            lock (this._tables)
            {
                return this._tables.TryGetValue(tableName, out var table) ? table : new List<TableEntity>();
            }
        }

        private Request Record(string kind, string tableName, string filter, IReadOnlyList<string> select)
        {
            var request = new Request { Kind = kind, Table = tableName, Filter = filter, Select = select };

            lock (this._requests) { this._requests.Add(request); }

            return request;
        }

        private static int CompareKeys(TableEntity a, TableEntity b)
        {
            int byPartition = string.CompareOrdinal(a.PartitionKey, b.PartitionKey);

            return byPartition != 0 ? byPartition : string.CompareOrdinal(a.RowKey, b.RowKey);
        }

        // A projected row holds the listed properties that the row has, and its keys - and, the way the real
        // service answers, a null for every listed property that the row does not have
        private TableEntity Project(TableEntity row, IReadOnlyList<string> select)
        {
            var result = new TableEntity(row.PartitionKey, row.RowKey);

            foreach (var pair in row)
            {
                if (pair.Key == "PartitionKey" || pair.Key == "RowKey")
                {
                    continue;
                }

                if (select == null || select.Contains(pair.Key))
                {
                    result[pair.Key] = pair.Value;
                }
            }

            if (select != null && this.MissingColumnsComeBackAsNulls)
            {
                foreach (string column in select)
                {
                    if (column != "PartitionKey" && column != "RowKey" && !result.ContainsKey(column))
                    {
                        result[column] = null;
                    }
                }
            }

            return result;
        }
    }

    /// <summary>
    /// The part of OData that Table Storage filters are written in: comparisons of a property with a literal,
    /// joined by 'and' and 'or', with brackets. Enough for every filter DfMon sends.
    /// A row that does not have the property of a comparison does not match it, whatever the operator.
    /// </summary>
    static class ODataFilter
    {
        public static Func<TableEntity, bool> Parse(string filter)
        {
            if (string.IsNullOrWhiteSpace(filter))
            {
                return _ => true;
            }

            var tokens = Tokenize(filter);
            int position = 0;

            var result = ParseOr(tokens, ref position);

            if (position != tokens.Count)
            {
                throw new FormatException($"Unexpected '{tokens[position]}' in filter: {filter}");
            }

            return result;
        }

        private static Func<TableEntity, bool> ParseOr(List<string> tokens, ref int position)
        {
            var left = ParseAnd(tokens, ref position);

            while (position < tokens.Count && tokens[position] == "or")
            {
                position++;
                var a = left;
                var b = ParseAnd(tokens, ref position);
                left = row => a(row) || b(row);
            }

            return left;
        }

        private static Func<TableEntity, bool> ParseAnd(List<string> tokens, ref int position)
        {
            var left = ParseTerm(tokens, ref position);

            while (position < tokens.Count && tokens[position] == "and")
            {
                position++;
                var a = left;
                var b = ParseTerm(tokens, ref position);
                left = row => a(row) && b(row);
            }

            return left;
        }

        private static Func<TableEntity, bool> ParseTerm(List<string> tokens, ref int position)
        {
            if (tokens[position] == "(")
            {
                position++;
                var inner = ParseOr(tokens, ref position);

                if (position >= tokens.Count || tokens[position] != ")")
                {
                    throw new FormatException("Missing ')' in filter");
                }
                position++;

                return inner;
            }

            string property = tokens[position++];
            string op = tokens[position++];
            object literal = ParseLiteral(tokens[position++]);

            return row =>
            {
                object value =
                    property == "PartitionKey" ? row.PartitionKey :
                    property == "RowKey" ? row.RowKey :
                    row.TryGetValue(property, out object found) ? found : null;

                if (value == null)
                {
                    return false;
                }

                int comparison = Compare(value, literal);

                return op switch
                {
                    "eq" => comparison == 0,
                    "ne" => comparison != 0,
                    "gt" => comparison > 0,
                    "ge" => comparison >= 0,
                    "lt" => comparison < 0,
                    "le" => comparison <= 0,
                    _ => throw new FormatException($"Unknown operator '{op}'")
                };
            };
        }

        private static int Compare(object value, object literal)
        {
            switch (value)
            {
                case string text when literal is string other:
                    return string.CompareOrdinal(text, other);
                case int or long when literal is long number:
                    return Convert.ToInt64(value, CultureInfo.InvariantCulture).CompareTo(number);
                case DateTimeOffset moment when literal is DateTimeOffset other:
                    return moment.CompareTo(other);
                case DateTime moment when literal is DateTimeOffset other:
                    return new DateTimeOffset(moment.ToUniversalTime()).CompareTo(other);
                case bool flag when literal is bool other:
                    return flag.CompareTo(other);
                default:
                    // Different types never match: one is unequal to the other, and neither is greater
                    return int.MinValue;
            }
        }

        private static object ParseLiteral(string token)
        {
            if (token.StartsWith('\''))
            {
                return token.Substring(1, token.Length - 2).Replace("''", "'");
            }

            if (token.StartsWith("datetime'", StringComparison.Ordinal))
            {
                return DateTimeOffset.Parse(token.Substring(9, token.Length - 10), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
            }

            if (token == "true" || token == "false")
            {
                return token == "true";
            }

            return long.Parse(token.TrimEnd('L'), CultureInfo.InvariantCulture);
        }

        private static List<string> Tokenize(string filter)
        {
            var tokens = new List<string>();
            int i = 0;

            while (i < filter.Length)
            {
                char c = filter[i];

                if (char.IsWhiteSpace(c))
                {
                    i++;
                }
                else if (c == '(' || c == ')')
                {
                    tokens.Add(c.ToString());
                    i++;
                }
                else
                {
                    int start = i;

                    // A word, which a quoted string may be glued to (datetime'...') or be all of ('...')
                    while (i < filter.Length && !char.IsWhiteSpace(filter[i]) && filter[i] != '(' && filter[i] != ')' && filter[i] != '\'')
                    {
                        i++;
                    }

                    if (i < filter.Length && filter[i] == '\'')
                    {
                        i++;

                        // A quote inside a string is written twice
                        while (i < filter.Length && (filter[i] != '\'' || (i + 1 < filter.Length && filter[i + 1] == '\'')))
                        {
                            i += filter[i] == '\'' ? 2 : 1;
                        }

                        i++;
                    }

                    tokens.Add(filter.Substring(start, i - start));
                }
            }

            return tokens;
        }
    }
}
