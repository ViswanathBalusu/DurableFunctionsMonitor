// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.Azure.Functions.Worker;
using Microsoft.DurableTask.Client;
using Microsoft.Azure.Functions.Worker.Http;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    public class IdSuggestions : DfmFunctionBase
    {
        public IdSuggestions(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints) : base(dfmSettings, extensionPoints) { }

        /// <summary>
        /// The most ids one answer holds: one page of the query, the first ones in the order of the ids.
        ///
        /// The Find instance field asks on every pause in the typing and shows the first six. Without a limit
        /// a short prefix on a large Task Hub is every instance that starts with it - two characters of a GUID
        /// are one instance in 256 - read fifty to a request, each request waiting for the one before it, and
        /// then sent to a browser that drops all but six of them.
        /// </summary>
        internal const int MaxSuggestions = 50;

        // Returns a list of orchestration/entity IDs, that start with some prefix: the first MaxSuggestions of them
        // GET /a/p/i/{connName}-{hubName}/id-suggestions(prefix='{prefix}')
        [Function(nameof(DfmGetIdSuggestionsFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetIdSuggestionsFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/id-suggestions(prefix='{prefix}')")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string prefix)
        {
            var instances = durableClient.GetAllInstancesAsync(new OrchestrationQuery
                {
                    InstanceIdPrefix = prefix,
                    PageSize = MaxSuggestions,
                    FetchInputsAndOutputs = false
                })
                .ToBlockingEnumerable()
                // One page, and the query ends there: nothing asks for the page after it
                .Take(MaxSuggestions);

            var orchestrationIds = instances.Select((s) => s.InstanceId);

            return await req.ReturnJson(orchestrationIds, Globals.FixUndefinedsInJson);
        }
    }
}
