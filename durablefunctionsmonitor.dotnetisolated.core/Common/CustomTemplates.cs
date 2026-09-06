// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text;
using System.Collections.Concurrent;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    // Contains all logic of loading custom tab/html templates
    // TODO: respect alternative connection strings
    class CustomTemplates
    {
        internal static Task<LiquidTemplatesMap> GetTabTemplatesAsync(DfmSettings settings)
        {
            if (TabTemplatesTask == null)
            {
                TabTemplatesTask = string.IsNullOrEmpty(settings.CustomTemplatesFolderName) ?
                    GetTabTemplatesFromStorageAsync() : GetTabTemplatesFromFolderAsync(settings.CustomTemplatesFolderName);
            }

            return TabTemplatesTask;
        }

        internal static Task<string> GetCustomMetaTagCodeAsync(DfmSettings settings)
        {
            if (CustomMetaTagCodeTask == null)
            {
                CustomMetaTagCodeTask = string.IsNullOrEmpty(settings.CustomTemplatesFolderName) ?
                    GetCustomMetaTagCodeFromStorageAsync() : GetCustomMetaTagCodeFromFolderAsync(settings.CustomTemplatesFolderName);
            }

            return CustomMetaTagCodeTask;
        }

        internal static Task<FunctionMapsMap> GetFunctionMapsAsync(DfmSettings settings)
        {
            if (FunctionMapsTask == null)
            {
                FunctionMapsTask = string.IsNullOrEmpty(settings.CustomTemplatesFolderName) ?
                    GetFunctionMapsFromStorageAsync() : GetFunctionMapsFromFolderAsync(settings.CustomTemplatesFolderName);
            }

            return FunctionMapsTask;
        }

        // Summarizes the state of custom tab templates / function map / meta tag for /about, for the given
        // hub. Never throws: every one of the three underlying cached Tasks already swallows its own errors.
        internal static async Task<TemplateSummary> GetTemplateSummaryAsync(DfmSettings settings, string hubName)
        {
            var functionMapsMap = await GetFunctionMapsAsync(settings);
            string functionMapJson = functionMapsMap.GetFunctionMap(hubName);
            bool functionMapAvailable = !string.IsNullOrEmpty(functionMapJson);

            int? functionCount = null;
            if (functionMapAvailable)
            {
                try
                {
                    // The function map JSON's shape is { "functions": { ... }, "proxies": { ... } }.
                    // functionCount is the number of top-level keys in "functions", null when that key
                    // is missing or the JSON itself is malformed.
                    functionCount = (JObject.Parse(functionMapJson)["functions"] as JObject)?.Count;
                }
                catch (Exception)
                {
                    // Malformed function map JSON: report no count, but keep functionMapAvailable as-is
                    // (the map itself is still there, just not something we can summarize).
                    functionCount = null;
                }
            }

            var templatesMap = await GetTabTemplatesAsync(settings);
            var liquidTabs = templatesMap.GetAllTemplateNames();

            string customMetaTagCode = await GetCustomMetaTagCodeAsync(settings);

            return new TemplateSummary
            {
                FunctionMapAvailable = functionMapAvailable,
                FunctionCount = functionCount,
                LiquidTabs = liquidTabs,
                CustomMetaTag = !string.IsNullOrEmpty(customMetaTagCode),
            };
        }

        // Turns DfmSettings.CustomTemplatesFolderName into an absolute folder path.
        //
        // An absolute path is used as is. A relative one is resolved against the folder the app actually
        // runs from (AppContext.BaseDirectory) - for an isolated Functions app that is the app root, the
        // folder holding host.json - and, only if nothing is there, against its parent folder, which is
        // where the in-process host kept the app root (the assembly then sat in '<app root>/bin').
        // That legacy fallback is why callers must never have to spell the bin folder out themselves.
        //
        // Returns the base-directory candidate when neither exists; every caller checks for existence anyway.
        internal static string ResolveCustomTemplatesFolder(string folderName)
        {
            if (Path.IsPathRooted(folderName))
            {
                return folderName;
            }

            string baseFolder = AppContext.BaseDirectory;

            string folder = Path.GetFullPath(Path.Combine(baseFolder, folderName));
            if (Directory.Exists(folder))
            {
                return folder;
            }

            string legacyFolder = Path.GetFullPath(Path.Combine(baseFolder, "..", folderName));

            return Directory.Exists(legacyFolder) ? legacyFolder : folder;
        }

        // Yes, it is OK to use Task in this way.
        // The Task code will only be executed once. All subsequent/parallel awaits will get the same returned value.
        // Tasks do have the same behavior as Lazy<T>.
        private static Task<LiquidTemplatesMap> TabTemplatesTask;

        private static Task<string> CustomMetaTagCodeTask;

        private static Task<FunctionMapsMap> FunctionMapsTask;

        // Tries to load liquid templates from underlying Azure Storage
        private static async Task<LiquidTemplatesMap> GetTabTemplatesFromStorageAsync()
        {
            var result = new LiquidTemplatesMap();
            try
            {
                var blobClient = Globals.GetBlobServiceClient(EnvVariableNames.AzureWebJobsStorage);

                // Listing all blobs in durable-functions-monitor/tab-templates folder
                var container = blobClient.GetBlobContainerClient(Globals.TemplateContainerName);

                string templateFolderName = Globals.TabTemplateFolderName + "/";
                var blobNames = await container.ListBlobNamesAsync(templateFolderName);

                // Loading blobs in parallel
                await Task.WhenAll(blobNames.Select(async blobName =>
                {
                    // Expecting the blob name to be like "[Tab Name].[EntityTypeName].liquid" or just "[Tab Name].liquid"
                    var nameParts = blobName.Substring(templateFolderName.Length).Split('.');
                    if (nameParts.Length < 2 || nameParts.Last() != "liquid")
                    {
                        return;
                    }

                    string tabName = nameParts[0];
                    string entityTypeName = nameParts.Length > 2 ? nameParts[1] : string.Empty;

                    using (var stream = new MemoryStream())
                    {
                        await container.GetBlobClient(blobName).DownloadToAsync(stream);
                        string templateText = Encoding.UTF8.GetString(stream.ToArray());

                        result.GetOrAdd(entityTypeName, new ConcurrentDictionary<string, string>())[tabName] = templateText;
                    }
                }));
            } 
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
            }
            return result;
        }

        // Tries to load liquid templates from local folder
        private static async Task<LiquidTemplatesMap> GetTabTemplatesFromFolderAsync(string folderName)
        {
            var result = new LiquidTemplatesMap();

            try 
            {
                string templatesFolder = Path.Combine(ResolveCustomTemplatesFolder(folderName), Globals.TabTemplateFolderName);

                if (!Directory.Exists(templatesFolder))
                {
                    return result;
                }

                foreach (var templateFilePath in Directory.EnumerateFiles(templatesFolder, "*.liquid"))
                {
                    var nameParts = Path.GetFileName(templateFilePath).Split('.');
                    if (nameParts.Length < 2)
                    {
                        continue;
                    }

                    string tabName = nameParts[0];
                    string entityTypeName = nameParts.Length > 2 ? nameParts[1] : string.Empty;
                    string templateText = await File.ReadAllTextAsync(templateFilePath);

                    result.GetOrAdd(entityTypeName, new ConcurrentDictionary<string, string>())[tabName] = templateText;
                }
            }
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
            }

            return result;
        }

        // Tries to load code for our meta tag from Storage
        private static async Task<string> GetCustomMetaTagCodeFromStorageAsync()
        {
            try
            {
                var blobClient = Globals.GetBlobServiceClient(EnvVariableNames.AzureWebJobsStorage);
                var container = blobClient.GetBlobContainerClient(Globals.TemplateContainerName);
                var blob = container.GetBlobClient(Globals.CustomMetaTagBlobName);

                if (!(await blob.ExistsAsync()))
                {
                    return null;
                }

                using (var stream = new MemoryStream())
                {
                    await blob.DownloadToAsync(stream);
                    return Encoding.UTF8.GetString(stream.ToArray());
                }
            } 
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
                return null;
            }
        }

        // Tries to load code for our meta tag from local folder
        private static async Task<string> GetCustomMetaTagCodeFromFolderAsync(string folderName)
        {
            try
            {
                string filePath = Path.Combine(ResolveCustomTemplatesFolder(folderName), Globals.CustomMetaTagBlobName);

                if (!File.Exists(filePath))
                {
                    return null;
                }

                return await File.ReadAllTextAsync(filePath);
            }
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
                return null;
            }
        }

        // Tries to load Function Maps from underlying Azure Storage
        private static async Task<FunctionMapsMap> GetFunctionMapsFromStorageAsync()
        {
            var result = new FunctionMapsMap();
            try
            {
                var blobClient = Globals.GetBlobServiceClient(EnvVariableNames.AzureWebJobsStorage);

                // Listing all blobs in durable-functions-monitor/function-maps folder
                var container = blobClient.GetBlobContainerClient(Globals.TemplateContainerName);

                string functionMapFolderName = Globals.FunctionMapFolderName + "/";
                var blobNames = await container.ListBlobNamesAsync(functionMapFolderName);

                // Loading blobs in parallel
                await Task.WhenAll(blobNames.Select(async blobName =>
                {
                    // Expecting the blob name to be like "dfm-function-map.[TaskHubName].json" or just "dfm-function-map.json"
                    var nameParts = blobName.Substring(functionMapFolderName.Length).Split('.');
                    if (nameParts.Length < 2 || nameParts.First() != Globals.FunctionMapFilePrefix || nameParts.Last() != "json")
                    {
                        return;
                    }

                    string taskHubName = nameParts.Length > 2 ? nameParts[1] : string.Empty;

                    using (var stream = new MemoryStream())
                    {
                        await container.GetBlobClient(blobName).DownloadToAsync(stream);
                        string templateText = Encoding.UTF8.GetString(stream.ToArray());

                        result.TryAdd(taskHubName, templateText);
                    }
                }));
            } 
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
            }
            return result;
        }

        // Tries to load Function Maps from local folder
        private static async Task<FunctionMapsMap> GetFunctionMapsFromFolderAsync(string folderName)
        {
            var result = new FunctionMapsMap();
            try
            {
                string functionMapsFolder = Path.Combine(ResolveCustomTemplatesFolder(folderName), Globals.FunctionMapFolderName);

                if (!Directory.Exists(functionMapsFolder))
                {
                    return result;
                }

                foreach (var filePath in Directory.EnumerateFiles(functionMapsFolder, $"{Globals.FunctionMapFilePrefix}*.json"))
                {
                    var nameParts = Path.GetFileName(filePath).Split('.');
                    if (nameParts.Length < 2)
                    {
                        continue;
                    }

                    string taskHubName = nameParts.Length > 2 ? nameParts[1] : string.Empty;
                    string json = await File.ReadAllTextAsync(filePath);

                    result.TryAdd(taskHubName, json);
                }
            }
            catch (Exception)
            {
                // Intentionally swallowing all exceptions here
            }
            return result;
        }
    }

    // Represents the liquid template map
    class LiquidTemplatesMap: ConcurrentDictionary<string, IDictionary<string, string>>
    {
        public List<string> GetTemplateNames(string entityTypeName)
        {
            var result = new List<string>();
            IDictionary<string, string> templates;

            // Getting template names for all entity types
            if (this.TryGetValue(string.Empty, out templates))
            {
                result.AddRange(templates.Keys);
            }

            // Getting template names for this particular entity type
            if (this.TryGetValue(entityTypeName, out templates))
            {
                result.AddRange(templates.Keys);
            }

            result.Sort();

            return result;
        }

        // Template names for entity type "" (generic) plus every entity-type-specific name, across the
        // whole map, sorted and distinct. Unlike GetTemplateNames(), this is not scoped to a single
        // entity type: /about has no notion of "the current instance's entity type".
        public List<string> GetAllTemplateNames()
        {
            var result = new SortedSet<string>(StringComparer.Ordinal);

            foreach (var templates in this.Values)
            {
                foreach (string name in templates.Keys)
                {
                    result.Add(name);
                }
            }

            return result.ToList();
        }

        public string GetTemplate(string entityTypeName, string templateName)
        {
            string result = null;
            IDictionary<string, string> templates;

            // Getting template names for all entity types
            if (this.TryGetValue(string.Empty, out templates))
            {
                if(templates.TryGetValue(templateName, out result)){
                    return result;
                }
            }

            // Getting template names for this particular entity type
            if (this.TryGetValue(entityTypeName, out templates))
            {
                if (templates.TryGetValue(templateName, out result))
                {
                    return result;
                }
            }

            return result;
        }
    }

    // Represents the map of Function Maps
    class FunctionMapsMap : ConcurrentDictionary<string, string>
    {
        public string GetFunctionMap(string taskHubName)
        {
            string result = null;

            // Getting Function Map for this particular Task Hub
            if (!this.TryGetValue(taskHubName, out result))
            {
                // Getting Function Map for all Task Hubs
                this.TryGetValue(string.Empty, out result);
            }

            return result;
        }
    }

    // The 'templates' field of /about (docs/plans/svelte-rewrite/00-shared-contracts.md section 6).
    // Property names are PascalCase here and camelCased on the way out by Globals.SerializerSettings.
    class TemplateSummary
    {
        public bool FunctionMapAvailable { get; set; }
        public int? FunctionCount { get; set; }
        public List<string> LiquidTabs { get; set; }
        public bool CustomMetaTag { get; set; }
    }
}