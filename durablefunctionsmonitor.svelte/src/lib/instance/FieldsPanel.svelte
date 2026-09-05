<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import JsonDialog from '$lib/components/json/JsonDialog.svelte';
  import JsonPre from '$lib/components/json/JsonPre.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import { entityKey, type ActionTarget } from './actions.svelte';

  interface Props {
    instance: InstanceState;
  }

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const details = $derived(instance.details);

  /** Which field the viewer has open, and which endpoint saves it (contracts §6). */
  const DOWNLOAD_FIELDS: Record<string, string> = {
    input: 'input',
    output: 'output',
    customStatus: 'custom-status',
    State: 'input',
  };

  let open = $state<{ title: string; value: unknown } | null>(null);

  const target = $derived<ActionTarget>({
    id: instance.instanceId,
    name: instance.functionName,
    status: instance.status ?? '',
    isEntity: instance.isEntity,
    key: entityKey(instance.instanceId),
    customStatus: details?.customStatus,
  });

  /**
   * The big fields are saved through the backend rather than out of the page: what is on screen may
   * be a blob URL, and only the backend can read what is behind it (React `downloadFieldValue`).
   */
  async function download(): Promise<void> {
    const field = open;

    if (!field) {
      return;
    }

    try {
      await app.track(() => app.endpoints.downloadField(instance.instanceId, DOWNLOAD_FIELDS[field.title]));
    } catch (error) {
      app.toast.fromError(`Could not download ${field.title}`, error);
    }
  }
</script>

<!--
  ScreenInstance.dc.html L67-L73: the three payload fields, each clipped to a preview that opens the
  whole thing (contracts §9). An entity has one field instead - its state.
-->
<div class="panel">
  {#if instance.isEntity}
    <div class="panel-h">
      <h3>State</h3>
      <Button
        variant="ghost"
        size="sm"
        style="margin-left:auto"
        onclick={() => (open = { title: 'State', value: details?.input })}
      >
        open
      </Button>
    </div>
    <JsonPre value={details?.input} transparent wrap maxHeight="96px" />
  {:else}
    <div class="panel-h">
      <h3>Input</h3>
      <Button
        variant="ghost"
        size="sm"
        style="margin-left:auto"
        onclick={() => (open = { title: 'input', value: details?.input })}
      >
        open
      </Button>
    </div>
    <JsonPre value={details?.input} transparent wrap maxHeight="96px" />

    <div class="panel-h" style="margin-top:12px">
      <h3>Output</h3>
      {#if details?.output === null || details?.output === undefined}
        <span class="meta" style="margin-left:auto">none yet</span>
      {:else}
        <Button
          variant="ghost"
          size="sm"
          style="margin-left:auto"
          onclick={() => (open = { title: 'output', value: details?.output })}
        >
          open
        </Button>
      {/if}
    </div>

    {#if details?.output !== null && details?.output !== undefined}
      <JsonPre value={details.output} transparent wrap maxHeight="96px" />
    {/if}

    <div class="panel-h" style="margin-top:12px">
      <h3>customStatus</h3>
      <Button
        variant="ghost"
        size="sm"
        style="margin-left:auto"
        disabled={app.readOnly}
        title={app.readOnly ? 'Read-only mode' : undefined}
        onclick={() => app.actions.open('custom', target)}
      >
        edit
      </Button>
    </div>
    <JsonPre value={details?.customStatus} transparent wrap />
  {/if}
</div>

{#if open}
  <JsonDialog
    bind:open={
      () => open !== null,
      (next) => {
        if (!next) {
          open = null;
        }
      }
    }
    title={open.title}
    subtitle={instance.instanceId}
    value={open.value}
    onDownload={() => void download()}
    onCopied={() => app.toast.ok(`Copied ${open?.title} to the clipboard`)}
  />
{/if}
