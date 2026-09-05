/// <reference types="svelte" />
/// <reference types="vite/client" />

// The seven globals injected verbatim into index.html (contracts §2, §3).
// Only src/lib/host.svelte.ts reads these; declared here so their shape is documented once.
declare global {
  var OrchestrationIdFromVsCode: string | undefined;
  var StateFromVsCode: Record<string, unknown> | undefined;
  var DfmRoutePrefix: string | undefined;
  var DfmApiRoutePrefix: string | undefined;
  var DfmClientConfig: Record<string, unknown> | undefined;
  var DfmViewMode: 0 | 1 | undefined;
  var IsFunctionGraphAvailable: boolean | undefined;
  function acquireVsCodeApi(): unknown;
}

export {};
