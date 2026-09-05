// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Turns a finished DfMon invocation into an audit record and hands it to
    /// <see cref="DfmExtensionPoints.WriteAuditRecordRoutine"/>.
    ///
    /// Two rules govern everything here: auditing never changes a response, and auditing never fails a
    /// request. So the record is built from what the invocation already produced (no extra storage reads,
    /// no re-parsing of the response body beyond copying it) and the write is fire-and-forget, with every
    /// failure logged rather than thrown.
    /// </summary>
    static class AuditWriter
    {
        /// <summary>
        /// Records one Write or Dangerous operation, if auditing is on and the provider can store it.
        /// Read operations are never audited: the log is about what was changed, and every screen refresh
        /// would otherwise drown it.
        /// </summary>
        /// <param name="context">The invocation, for the route values and the Items bag</param>
        /// <param name="request">The incoming request</param>
        /// <param name="operationKind">Kind of the DfMon function that ran</param>
        /// <param name="settings">DfMon settings (AuditEnabled decides whether anything happens at all)</param>
        /// <param name="extensionPoints">Where the writer routine comes from</param>
        /// <param name="status">The status the caller is about to receive</param>
        /// <param name="log">Logger for failures of the writer itself</param>
        public static void Record(
            FunctionContext context,
            HttpRequestData request,
            OperationKind operationKind,
            DfmSettings settings,
            DfmExtensionPoints extensionPoints,
            HttpStatusCode status,
            ILogger log)
        {
            if (!settings.AuditEnabled || extensionPoints.WriteAuditRecordRoutine == null)
            {
                return;
            }

            if (operationKind != OperationKind.Write && operationKind != OperationKind.Dangerous)
            {
                return;
            }

            AuditRecord record;
            string connEnvVariableName;
            string hubName;

            try
            {
                if (!Globals.TryGetConnAndHubNames(request.Url.AbsolutePath, out string connName, out hubName))
                {
                    // A DfMon write always addresses a Task Hub; if the path does not name one there is
                    // nothing to write the record to.
                    return;
                }

                connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // The body is read here, on the request thread, while the response object is still
                // untouched - not inside the fire-and-forget task below.
                record = BuildRecord(context, request, operationKind, status, TryReadBody(context));
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "DFM failed to build an audit record");
                return;
            }

            var writeRoutine = extensionPoints.WriteAuditRecordRoutine;

            // Fire and forget: the response is already on its way, and a slow or broken audit store must
            // not hold it up or fail it.
            _ = Task.Run(async () =>
            {
                try
                {
                    await writeRoutine(connEnvVariableName, hubName, record);
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "DFM failed to write an audit record");
                }
            });
        }

        /// <summary>
        /// The status a finished invocation is about to answer with. Anything that is not an
        /// HttpResponseData (a function that threw before producing one) counts as a 500.
        /// </summary>
        public static HttpStatusCode GetStatus(FunctionContext context)
        {
            try
            {
                return context.GetInvocationResult()?.Value is HttpResponseData response
                    ? response.StatusCode
                    : HttpStatusCode.InternalServerError;
            }
            catch (Exception)
            {
                return HttpStatusCode.InternalServerError;
            }
        }

        /// <summary>
        /// Builds the record of one finished invocation. Takes the response body rather than reading it,
        /// so the whole mapping is testable without a worker host.
        /// </summary>
        internal static AuditRecord BuildRecord(
            FunctionContext context,
            HttpRequestData request,
            OperationKind operationKind,
            HttpStatusCode status,
            string responseBody)
        {
            string action = GetRouteValue(context, ActionRouteParamName);

            var (operation, _, instanceId) = AuditOperations.FromRequest(request.Method, request.Url.AbsolutePath, action);

            // A function may refine its own name - the batch endpoint appends the action it ran
            if (context.Items.TryGetValue(Globals.DfmAuditOperationContextValue, out var refined) && refined is string refinedOperation && !string.IsNullOrEmpty(refinedOperation))
            {
                operation = refinedOperation;
            }

            int statusCode = (int)status;

            return new AuditRecord
            {
                At = DateTimeOffset.UtcNow,

                // Auth put the name there when it validated the call; the fallback is the same value it
                // would have used, so a record never claims more than DfMon actually knows.
                User = context.Items.TryGetValue(Globals.DfmUserNameContextValue, out var user) && user is string userName
                    ? userName
                    : Globals.AnonymousUserName,

                Operation = operation,

                // The kind the function declared, which is what the operator's policy is written against
                Kind = operationKind.ToString(),
                InstanceId = instanceId,
                Outcome = statusCode < 400 ? OutcomeOk : OutcomeFailed,
                Status = statusCode,
                Message = GetMessage(context, status, responseBody),
                Route = request.Url.AbsolutePath
            };
        }

        /// <summary>
        /// What the record says happened: whatever the function put into
        /// <see cref="Globals.DfmAuditMessageContextValue"/> (the batch endpoint stores its counts there,
        /// replay the number of deleted rows), or, for a failure, the response body the caller received.
        /// </summary>
        private static string GetMessage(FunctionContext context, HttpStatusCode status, string responseBody)
        {
            if (context.Items.TryGetValue(Globals.DfmAuditMessageContextValue, out var custom) && custom is string customMessage)
            {
                return Truncate(customMessage);
            }

            if ((int)status < 400)
            {
                // A successful call is fully described by its operation and status
                return null;
            }

            return Truncate(responseBody);
        }

        /// <summary>
        /// Reads a copy of the response body. DfMon's error responses are short strings written by
        /// ReturnStatus; the stream is left exactly as it was found, so reading it here cannot affect
        /// what the caller receives.
        /// </summary>
        private static string TryReadBody(FunctionContext context)
        {
            try
            {
                if (context.GetInvocationResult()?.Value is not HttpResponseData response || response.Body == null || !response.Body.CanSeek)
                {
                    return null;
                }

                long position = response.Body.Position;

                try
                {
                    response.Body.Position = 0;

                    using var reader = new StreamReader(response.Body, leaveOpen: true);

                    return reader.ReadToEnd();
                }
                finally
                {
                    response.Body.Position = position;
                }
            }
            catch (Exception)
            {
                // The body is a nice-to-have; never let reading it break the record
                return null;
            }
        }

        private static string GetRouteValue(FunctionContext context, string name)
        {
            try
            {
                var bindingData = context.BindingContext?.BindingData;

                return bindingData != null && bindingData.TryGetValue(name, out var value) ? value as string : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string Truncate(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return null;
            }

            return text.Length <= AuditStore.MaxMessageChars ? text : text.Substring(0, AuditStore.MaxMessageChars);
        }

        // The {action} route value of the single-instance endpoints (suspend, terminate, purge, ...)
        private const string ActionRouteParamName = "action";

        internal const string OutcomeOk = "ok";
        internal const string OutcomeFailed = "failed";
    }
}
