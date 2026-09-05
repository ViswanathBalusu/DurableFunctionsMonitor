// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Conditional GET (ETag / If-None-Match) support for the orchestration details and history endpoints.
    /// </summary>
    internal static class ConditionalGet
    {
        /// <summary>
        /// Computes a weak ETag from the parts of an orchestration's metadata that change whenever its
        /// details or history could have changed: the last-updated timestamp and the runtime status.
        /// </summary>
        public static string ComputeETag(OrchestrationMetadata metadata)
        {
            return $"W/\"{metadata.LastUpdatedAt.UtcTicks}:{metadata.RuntimeStatus}\"";
        }

        /// <summary>
        /// When the request's If-None-Match header equals <paramref name="etag"/> exactly, sets
        /// <paramref name="response"/> to a ready-to-send 304 (with the ETag header, no body) and
        /// returns true. Otherwise <paramref name="response"/> is null and this returns false; the
        /// caller then goes on to build its normal 200 response (and should still add the ETag header).
        /// </summary>
        public static bool TryNotModified(HttpRequestData req, string etag, out HttpResponseData response)
        {
            if (req.Headers.TryGetValues("If-None-Match", out var values))
            {
                foreach (string value in values)
                {
                    if (value == etag)
                    {
                        response = req.CreateResponse(HttpStatusCode.NotModified);
                        response.Headers.Add("ETag", etag);
                        return true;
                    }
                }
            }

            response = null;
            return false;
        }
    }
}
