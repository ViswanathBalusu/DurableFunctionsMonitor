<script lang="ts" module>
  /** Why the two switches cannot be moved: they are a reading, not a setting. */
  export const REPORTED_BY_BACKEND = 'Reported by the backend';

  /**
   * The capabilities this panel lists, in the order of the mockup (L71). The four hub-administration
   * flags are not here: the Hub administration panel is where they are visible, on the buttons they
   * govern.
   */
  export const LISTED_CAPABILITIES: readonly (keyof Capabilities)[] = [
    'stats',
    'children',
    'spans',
    'failures',
    'batch',
    'storageHealth',
    'audit',
    'entities',
    'conditionalGet',
  ];

  /** What the backend can do to a stored input, which is what the Inputs tab offers over. */
  export const STORAGE_SUPPORTS: readonly (keyof Capabilities)[] = ['updateInput', 'truncateHistory'];
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { Capabilities } from '$lib/api/types';
  import Chip from '$lib/components/Chip.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const supported = $derived(LISTED_CAPABILITIES.filter((capability) => app.capabilities[capability]));

  const rows: KvRow[] = [
    { k: 'storageSupports', v: storageSupportsCell },
    { k: 'capabilities', v: capabilitiesCell },
    { k: 'function graph', v: functionGraphCell },
  ];
</script>

{#snippet flag(on: boolean, text: string)}
  <!-- On is the design system's "this happened" green; off is the same chip, muted. -->
  <Chip size="sm" class={on ? 'st-completed' : 'muted'}>{text}</Chip>
{/snippet}

{#snippet storageSupportsCell()}
  <span class="row" style="gap:6px">
    {#each STORAGE_SUPPORTS as capability (capability)}
      {@render flag(app.capabilities[capability], capability)}
    {/each}
  </span>
{/snippet}

{#snippet capabilitiesCell()}
  <span class="row" style="gap:6px">
    {#each supported as capability (capability)}
      <Chip size="sm">{capability}</Chip>
    {/each}

    {#if supported.length === 0}
      <span class="meta">none</span>
    {/if}
  </span>
{/snippet}

{#snippet functionGraphCell()}
  <!-- Not a capability of the backend: the host publishes it, and the graph tabs read it from there -->
  {@render flag(app.host.functionGraphAvailable, app.host.functionGraphAvailable ? 'available' : 'not available')}
{/snippet}

<!--
  ScreenSettings.dc.html L63-L73, minus the mockup's toggles: these two are what /about answered, so
  they are shown as switches that cannot be moved rather than as switches that lie.
-->
<Panel title="Feature flags">
  {#snippet meta()}
    <span class="fine muted">from /about</span>
  {/snippet}

  <div class="stack" style="gap:8px">
    <Switch
      label="Read-only mode"
      hint="no ReadWrite permission"
      checked={app.readOnly}
      disabled
      aria-disabled="true"
      title={REPORTED_BY_BACKEND}
    />

    <Switch
      label="Dangerous operations"
      hint="DFM_DANGEROUS_OPERATIONS_ENABLED"
      checked={app.dangerous}
      disabled
      aria-disabled="true"
      title={REPORTED_BY_BACKEND}
    />
  </div>

  <Kv {rows} style="margin-top:14px" />
</Panel>
