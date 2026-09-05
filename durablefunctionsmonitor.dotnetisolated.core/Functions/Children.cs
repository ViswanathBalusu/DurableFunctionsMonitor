// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// GET orchestrations('{id}')/children: the direct sub-orchestrations of an instance, as the workspace
    /// summary's children tree and the sub-orchestration navigation draw them.
    ///
    /// The answer comes from DfmExtensionPoints.GetChildrenRoutine, so each storage provider finds its
    /// children its own way (Azure Storage matches the generated child ids in the XXXInstances table,
    /// MSSQL reads the ParentInstanceID column, Netherite cannot do it at all and the routine is null).
    /// The response is exactly the ChildrenResponse of docs/plans/svelte-rewrite/00-shared-contracts.md
    /// section 6: 'complete' tells the UI whether the list is guaranteed to be exhaustive.
    /// </summary>
    public class Children : DfmFunctionBase
    {
        public Children(DfmSettings dfmSettings, DfmExtensionPoints extensionPoints, ILoggerFactory loggerFactory) : base(dfmSettings, extensionPoints)
        {
            this._logger = loggerFactory.CreateLogger<Children>();
        }

        // Returns the sub-orchestrations of an instance.
        // GET /a/p/i/{connName}-{hubName}/orchestrations('<id>')/children
        [Function(nameof(DfmGetOrchestrationChildrenFunction))]
        [OperationKind(Kind = OperationKind.Read)]
        public async Task<HttpResponseData> DfmGetOrchestrationChildrenFunction(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Globals.ApiRoutePrefix + "/orchestrations('{instanceId}')/children")] HttpRequestData req,
            [DurableClient(TaskHub = Globals.HubNameRouteParamName)] DurableTaskClient durableClient,
            string connName,
            string hubName,
            string instanceId)
        {
            try
            {
                // A null routine means 'this storage provider cannot list children' (Netherite). /about
                // reports capabilities.children == false for exactly the same reason, so the UI never asks.
                if (this.ExtensionPoints.GetChildrenRoutine == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, "Sub-orchestrations are not supported for this storage provider");
                }

                // A Durable Entity is not an orchestrator: it never starts a sub-orchestration.
                if (ExpandedOrchestrationStatus.TryGetEntityInstanceId(instanceId, out var _))
                {
                    return await req.ReturnStatus(HttpStatusCode.BadRequest, $"Instance {instanceId} is a Durable Entity and has no children");
                }

                // Cheap: nothing but the existence of the instance is needed here, so no inputs/outputs
                var metadata = await durableClient.GetInstanceAsync(instanceId, false);
                if (metadata == null)
                {
                    return await req.ReturnStatus(HttpStatusCode.NotFound, $"Instance {instanceId} doesn't exist");
                }

                string connEnvVariableName = Globals.GetFullConnectionStringEnvVariableName(connName);

                // A routine that returns null (a custom implementation might) means 'no children', not 'crash'
                var result = await this.ExtensionPoints.GetChildrenRoutine(durableClient, connEnvVariableName, hubName, instanceId)
                    ?? new ChildrenResult();

                // ChildrenResult is the contract shape itself: { children: [{ instanceId, name, runtimeStatus,
                // createdTime, lastUpdatedTime }], complete }
                return await req.ReturnJson(result);
            }
            catch (DfmBadRequestException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmNotSupportedException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);
            }
            catch (DfmNotFoundException ex)
            {
                return await req.ReturnStatus(HttpStatusCode.NotFound, ex.Message);
            }
            catch (DfmStorageException ex)
            {
                this._logger.LogError(ex, "Storage could not be read");
                return await req.ReturnStatus(HttpStatusCode.InternalServerError, ex.Message);
            }
        }

        private readonly ILogger _logger;
    }
}
