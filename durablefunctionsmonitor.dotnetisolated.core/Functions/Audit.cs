// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// One row of the /audit response: an AuditRecord without the fields only the store needs.
    /// Exactly the AuditRow of docs/plans/svelte-rewrite/00-shared-contracts.md section 6.
    /// </summary>
    public class AuditRow
    {
        /// <summary>When the call happened. UTC.</summary>
        public DateTimeOffset At { get; set; }

        /// <summary>Who made the call ('anonymous' when authentication is disabled).</summary>
        public string User { get; set; }

        /// <summary>Human readable operation name, e.g. 'Terminate'.</summary>
        public string Operation { get; set; }

        /// <summary>'Write' or 'Dangerous'.</summary>
        public string Kind { get; set; }

        /// <summary>The instance the call was about. Null for hub-wide operations.</summary>
        public string InstanceId { get; set; }

        /// <summary>'ok' or 'failed'.</summary>
        public string Outcome { get; set; }

        /// <summary>HTTP status code the call returned.</summary>
        public int Status { get; set; }

        /// <summary>Error text or operation summary. Null when there is nothing to say.</summary>
        public string Message { get; set; }
    }

    /// <summary>
    /// Response of the /audit endpoint: one page of rows, newest first, plus whether auditing is on at
    /// all - an installation that never enabled it gets an empty page and the 'auditing is off' empty
    /// state, not an error.
    /// </summary>
    public class AuditResponse
    {
        /// <summary>The rows, newest first.</summary>
        public IReadOnlyList<AuditRow> Rows { get; set; } = new List<AuditRow>();

        /// <summary>True when there are more records past this page.</summary>
        public bool HasMore { get; set; }

        /// <summary>
        /// False when DFM_AUDIT_ENABLED is off or the storage provider cannot serve audit records. The
        /// rows are then empty because nothing is being recorded, not because nothing happened.
        /// </summary>
        public bool Enabled { get; set; }
    }

    /// <summary>
    /// The /audit endpoint: what the Activity screen and the Overview's recent-activity panel read.
    /// </summary>
    public class Audit : DfmFunctionBase
    {
        public Audit(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Audit>();
        }

        // Returns one page of audit records, newest first.
        // GET /a/p/i/{connName}-{hubName}/audit?from&to&operation&$top&$skip
        [Function(nameof(DfmGetAuditFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetAuditFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/audit")] HttpRequestData req,
            string connName,
            string hubName)
        {
            try
            {
                // Auditing off, or a provider that cannot serve records (MSSQL): an empty page that says
                // so, rather than a 400. The UI shows its 'auditing is off' empty state on exactly this.
                if (!this.Settings.AuditEnabled || this.ExtensionPoints.ReadAuditRecordsRoutine == null)
                {
                    return await req.ReturnJson(new AuditResponse { Enabled = false });
                }

                var query = ParseQuery(req);

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // Not cached: the audit log is what a user goes to the Activity screen to watch changing,
                // and its reads are bounded by $top rather than by the size of the hub.
                var page = await this.ExtensionPoints.ReadAuditRecordsRoutine(connEnvVariableName, hubName, query)
                    ?? new AuditPage();

                return await req.ReturnJson(new AuditResponse
                {
                    Rows = page.Rows.Select(ToRow).ToList(),
                    HasMore = page.HasMore,
                    Enabled = true
                });
            }
            catch (DfmBadRequestException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmStorageException ex)
            {
                this._logger.LogError(ex, "Failed to read the audit log");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        /// <summary>
        /// Parses and validates the query string. Unlike /stats and /failures, the range is optional here:
        /// the Activity screen opens on "what happened recently", which is the last 24 hours.
        /// </summary>
        internal static AuditQuery ParseQuery(HttpRequestData req)
        {
            string fromText = req.Query["from"];
            string toText = req.Query["to"];

            DateTimeOffset from;
            DateTimeOffset to;

            if (string.IsNullOrEmpty(fromText) && string.IsNullOrEmpty(toText))
            {
                to = DateTimeOffset.UtcNow;
                from = to.AddHours(-DefaultRangeHours);
            }
            else
            {
                // One of them given means both are: a half-specified range is a mistake, not a default
                (from, to) = RangeQuery.Parse(req);
            }

            string operation = req.Query["operation"];

            return new AuditQuery
            {
                From = from,
                To = to,
                Operation = string.IsNullOrEmpty(operation) ? null : operation,
                Top = RangeQuery.ParseBoundedInt(req.Query["$top"], "$top", DefaultTop, 1, MaxTop),
                Skip = RangeQuery.ParseBoundedInt(req.Query["$skip"], "$skip", 0, 0, MaxSkip)
            };
        }

        /// <summary>
        /// An AuditRecord as the response reports it: without Route, which is kept in the store for
        /// troubleshooting and is not part of the contract.
        /// </summary>
        private static AuditRow ToRow(AuditRecord record)
        {
            return new AuditRow
            {
                At = record.At,
                User = record.User,
                Operation = record.Operation,
                Kind = record.Kind,
                InstanceId = record.InstanceId,
                Outcome = record.Outcome,
                Status = record.Status,
                Message = record.Message
            };
        }

        // Contracts section 6: $top defaults to 100 and is capped at 500.
        private const int DefaultTop = 100;
        private const int MaxTop = 500;

        // Paging past this many rows is not what the Activity screen is for; narrow the range instead.
        private const int MaxSkip = 100000;

        /// <summary>How far back the endpoint looks when the caller does not say.</summary>
        internal const int DefaultRangeHours = 24;

        private readonly ILogger _logger;
    }
}
