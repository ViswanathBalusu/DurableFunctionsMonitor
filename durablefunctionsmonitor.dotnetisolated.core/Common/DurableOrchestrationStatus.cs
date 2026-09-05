// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Newtonsoft.Json.Linq;
using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    class DurableOrchestrationStatus
    {
        public string Name { get; set; }
        public string InstanceId { get; set; }
        public DateTime CreatedTime { get; set; }
        public DateTime LastUpdatedTime { get; set; }
        public JToken Input { get; set; }
        public JToken Output { get; set; }
        public OrchestrationRuntimeStatus RuntimeStatus { get; set; }
        public JToken CustomStatus { get; set; }

        // Custom tags attached to this orchestration instance at start time, if any. Null when there are none.
        // Only ever populated from OrchestrationMetadata (i.e. for orchestrations, not entities), and only
        // copied onto DetailedOrchestrationStatus (the details response); ExpandedOrchestrationStatus (the
        // list response) intentionally does not copy it, to keep list payloads small.
        public IReadOnlyDictionary<string, string> Tags { get; set; }

        public DurableOrchestrationStatus() {}

        public DurableOrchestrationStatus(OrchestrationMetadata data)
        {
            this.InstanceId = data.InstanceId;
            this.Name = data.Name;
            this.CreatedTime = data.CreatedAt.UtcDateTime;
            this.LastUpdatedTime = data.LastUpdatedAt.UtcDateTime;
            this.Input = ToJToken(data.SerializedInput);
            this.Output = ToJToken(data.SerializedOutput);
            this.RuntimeStatus = data.RuntimeStatus;
            this.CustomStatus = ToJToken(data.SerializedCustomStatus);
            this.Tags = (data.Tags != null && data.Tags.Count > 0) ? data.Tags : null;
        }

        protected static JToken ToJToken(string str)
        {
            if (str == null)
            {
                return string.Empty;
            }

            if (str.StartsWith('{') || str.StartsWith('['))
            {
                return JToken.Parse(str);
            }

            return str;
        }
    }
}