// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Net;
using System.Reflection;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// Extension methods for configuring DfMon
    /// </summary>
    public static class ExtensionMethods
    {
        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IFunctionsWorkerApplicationBuilder UseDurableFunctionsMonitor(
            this IFunctionsWorkerApplicationBuilder builder,
            Action<DfmSettings, DfmExtensionPoints> optionsBuilder = null
        )
        {
            // Initializing settings and placing them into DI container
            var settings = new DfmSettings();
            var extensionPoints = new DfmExtensionPoints();

            // Allowing to override settings
            if (optionsBuilder != null)
            {
                optionsBuilder(settings, extensionPoints);
            }

            // Also initializing CustomUserAgent value based on input parameters
            string dfmNonce = Environment.GetEnvironmentVariable(EnvVariableNames.DFM_NONCE);
            if (!string.IsNullOrEmpty(dfmNonce) && (dfmNonce != Auth.ISureKnowWhatIAmDoingNonce))
            {
                TableClient.CustomUserAgent = $"DurableFunctionsMonitorIsolated-VsCodeExt/{Globals.GetVersion()}";
            }
            else if (!string.IsNullOrEmpty(settings.CustomUserAgentPrefix)) 
            {
                TableClient.CustomUserAgent = $"{settings.CustomUserAgentPrefix}/{Globals.GetVersion()}";
            }
            else
            {
                TableClient.CustomUserAgent = $"DurableFunctionsMonitorIsolated-Injected/{Globals.GetVersion()}";
            }

            // Placing settings and extension points into DI container
            builder.Services.AddSingleton(settings);
            builder.Services.AddSingleton(extensionPoints);

            // Checking host.json for a custom dedicated Storage account
            string hostJsonFileName = Globals.GetHostJsonPath();
            if (File.Exists(hostJsonFileName))
            {
                dynamic hostJson = JObject.Parse(File.ReadAllText(hostJsonFileName));

                string connStringNameFromHostJson = 
                    hostJson?.extensions?.durableTask?.storageProvider?.azureStorageConnectionStringName ??
                    hostJson?.extensions?.durableTask?.storageProvider?.connectionStringName ??
                    hostJson?.extensions?.durableTask?.storageProvider?.connectionName;

                if (!string.IsNullOrEmpty(connStringNameFromHostJson))
                {
                    Globals.StorageConnStringEnvVarName = connStringNameFromHostJson;
                }
            }

            // Adding middleware
            builder.UseWhen
            (
                (FunctionContext context) =>
                {
                    // This middleware is only for http trigger invocations.
                    return context
                        .FunctionDefinition
                        .InputBindings
                        .Values
                        .First(a => a.Type.EndsWith("Trigger"))
                        .Type == "httpTrigger";
                },

                async (FunctionContext context, Func<Task> next) =>
                {
                    var log = context.InstanceServices.GetRequiredService<ILogger<object>>();
                    var request = await context.GetHttpRequestDataAsync() ?? throw new ArgumentNullException("HTTP Request is null");

                    OperationKind? operationKind = null;
                    try
                    {
                        // Checking that it is DfMon's Function
                        operationKind = TryGetDfmOperationKind(context, log);

                        if (operationKind.HasValue)
                        {
                            // If so, invoking DfMon's auth logic
                            var (dfmMode, userName) = await Auth.ValidateIdentityAndGetUserAsync(request, operationKind.Value, settings);

                            // Also validating task hub name (if it is a part of the request).
                            // But only after validating user identity (because validating task hub name involves querying the Storage).
                            await Auth.ThrowIfUriTaskHubNameIsInvalid(request.Url.AbsolutePath, extensionPoints);

                            // Propagating DfmMode to Functions
                            context.Items.Add(Globals.DfmModeContextValue, dfmMode);

                            // And who the caller is, so that Functions (and the audit record below) do not
                            // have to look the identity up again
                            context.Items[Globals.DfmUserNameContextValue] = userName;
                        }

                        await next();

                        if (operationKind.HasValue)
                        {
                            // B5-S2-T2: recording the Write/Dangerous call that just finished. Never throws,
                            // never touches the response - see AuditWriter.
                            AuditWriter.Record(context, request, operationKind.Value, settings, extensionPoints, AuditWriter.GetStatus(context), log);
                        }
                    }
                    catch (DfmUnauthorizedException ex)
                    {
                        log.LogError(ex, "DFM failed to authenticate request");
                        context.GetInvocationResult().Value = await request.ReturnStatus(HttpStatusCode.Unauthorized);

                        if (operationKind.HasValue)
                        {
                            // A rejected attempt to change something belongs in the audit log as much as a
                            // successful one does
                            AuditWriter.Record(context, request, operationKind.Value, settings, extensionPoints, HttpStatusCode.Unauthorized, log);
                        }
                    }
                    catch (DfmAccessViolationException ex)
                    {
                        log.LogError(ex, "DFM failed to authorize request");
                        context.GetInvocationResult().Value = await request.ReturnStatus(HttpStatusCode.Forbidden);

                        if (operationKind.HasValue)
                        {
                            AuditWriter.Record(context, request, operationKind.Value, settings, extensionPoints, HttpStatusCode.Forbidden, log);
                        }
                    }
                    catch (Exception ex)
                    {
                        if (operationKind.HasValue)
                        {
                            // Only handling DfMon's exceptions
                            log.LogError(ex, "DFM failed");
                            context.GetInvocationResult().Value = await request.ReturnStatus(HttpStatusCode.BadRequest, ex.Message);

                            // A failed operation is exactly what an audit log is for
                            AuditWriter.Record(context, request, operationKind.Value, settings, extensionPoints, HttpStatusCode.BadRequest, log);
                        }
                        else
                        {
                            throw;
                        }
                    }
                }
             );

            return builder;
        }

        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IHostBuilder UseDurableFunctionsMonitor(this IHostBuilder hostBuilder, Action<DfmSettings, DfmExtensionPoints> optionsBuilder = null)
        {
            return hostBuilder.ConfigureFunctionsWorkerDefaults((HostBuilderContext builderContext, IFunctionsWorkerApplicationBuilder builder) =>
            {
                builder.UseDurableFunctionsMonitor(optionsBuilder);
            });
        }

        private static OperationKind? TryGetDfmOperationKind(FunctionContext context, ILogger log)
        {
            try
            {
                var funcAssembly = Assembly.LoadFrom(context.FunctionDefinition.PathToAssembly);

                var funcMethodNameParts = context.FunctionDefinition.EntryPoint.Split('.');
                var funcMethodName = funcMethodNameParts.Last();
                var funcMethodTypeName = string.Join('.', funcMethodNameParts.Take(funcMethodNameParts.Length - 1));

                var funcType = funcAssembly.GetType(funcMethodTypeName);
                var funcMethodInfo = funcType.GetMethod(funcMethodName);

                var attr = funcMethodInfo.GetCustomAttribute<OperationKindAttribute>();
                if (attr != null)
                {
                    return attr.Kind;
                }
            }
            catch(Exception ex)
            {
                log.LogWarning(ex, "DFM failed to load Function's MethodInfo");
            }

            return null;
        }
    }
}