<script lang="ts" module>
  /** What a peek can start. The confirm dialogs behind these belong to E5, which wires `onAction`. */
  export type PeekAction = 'suspend' | 'resume' | 'raiseEvent' | 'terminate' | 'sendSignal' | 'purge';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import JsonPre from '$lib/components/json/JsonPre.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { fmtDuration } from '$lib/format/duration';
  import { formatJson, previewJson } from '$lib/format/json';
  import { statusClass } from '$lib/format/status';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { PeekItem } from '$lib/state/peek.svelte';
  import { cn } from '$lib/utils';
  import PeekTimeline from './PeekTimeline.svelte';

  interface Props {
    /**
     * Runs one of the panel's actions. E5 passes `app.actions` here, which opens the same confirm
     * dialogs the Instance screen uses; until then the row is not drawn at all, because a button
     * that cannot do what it says is worse than no button.
     */
    onAction?: (action: PeekAction, item: PeekItem) => void;
  }

  let { onAction }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);
  const peek = app.peek;

  const item = $derived(peek.item);
  const isEntity = $derived(item?.kind === 'DurableEntity');

  const rows = $derived.by<KvRow[]>(() => {
    if (!item) {
      return [];
    }

    const showTimeAs = app.prefs.showTimeAs;

    return [
      { k: 'created', v: fmtDateTime(item.created, showTimeAs), mono: true },
      { k: 'last updated', v: fmtDateTime(item.updated, showTimeAs), mono: true },
      { k: 'duration', v: fmtDuration(item.duration), mono: true },
      // A one-line preview; the full value is on the instance screen, which `Open` goes to
      { k: 'customStatus', v: item.customStatus == null ? 'none' : previewJson(item.customStatus), mono: true },
      // E8 counts the history rows and their size; until it has, this panel does not guess
      { k: 'history', v: item.history ?? '—', mono: true },
    ];
  });

  function openInstance(): void {
    const current = item;
    peek.close();

    if (current) {
      app.router.navigate({ name: 'instance', hub: app.hub, instanceId: current.id });
    }
  }

  function run(action: PeekAction): void {
    const current = item;

    if (current) {
      onAction?.(action, current);
    }
  }

  async function copyState(): Promise<void> {
    await navigator.clipboard.writeText(formatJson(item?.state));
  }
</script>

<!--
  DFM App.dc.html L149-L197: `.overlay.clear > aside.peek`. The overlay is transparent - the list
  behind stays readable, and the panel is an overlay only so that opening it costs the list nothing:
  no scroll reset, no reload, no change to the selection.
-->
<Sheet.Root open={peek.isOpen} onOpenChange={(next) => !next && peek.close()}>
  {#if item}
    <Sheet.Content side="right" overlayClass="clear" aria-label="Instance peek">
      <div class="phead">
        <div class={cn('tile', statusClass(item.status))} style="width:72px;height:72px">{item.status}</div>

        <div class="grow">
          <div class="mono" style="font-size:20px;font-weight:600;overflow-wrap:anywhere;line-height:1.2">
            {item.id}
          </div>
          <div class="meta" style="margin-top:4px">{item.name} · {item.kind}</div>
        </div>

        <Button variant="primary" onclick={openInstance}>Open</Button>
        <Button variant="ghost" aria-label="Close" style="padding:0 10px" onclick={() => peek.close()}>×</Button>
      </div>

      <div class="pbody">
        <div>
          <h3 class="section-h">Summary</h3>
          <Kv {rows} />
        </div>

        {#if isEntity}
          <div>
            <h3 class="section-h">State</h3>
            <div class="brutal-flat" style="overflow:hidden">
              <div class="jse-bar">
                <span class="on">state</span>
                <button type="button" style="margin-left:auto" onclick={copyState}>copy</button>
              </div>
              <!-- Contracts §9: pretty-printed and fully expanded, here as everywhere else -->
              <JsonPre value={item.state} wrap />
            </div>
          </div>

          {#if onAction}
            <div class="row">
              <Button size="sm" disabled={app.readOnly} onclick={() => run('sendSignal')}>Send signal</Button>
              <Button size="sm" variant="destructive" disabled={app.readOnly} onclick={() => run('purge')}>
                Purge
              </Button>
            </div>
          {/if}
        {:else}
          <div>
            <h3 class="section-h">Timeline</h3>
            <PeekTimeline {item} />
          </div>

          {#if onAction}
            <div class="row">
              {#if item.status === 'Suspended'}
                <Button size="sm" disabled={app.readOnly} onclick={() => run('resume')}>Resume</Button>
              {:else}
                <Button size="sm" disabled={app.readOnly} onclick={() => run('suspend')}>Suspend</Button>
              {/if}
              <Button size="sm" disabled={app.readOnly} onclick={() => run('raiseEvent')}>Raise event</Button>
              <Button size="sm" variant="destructive" disabled={app.readOnly} onclick={() => run('terminate')}>
                Terminate
              </Button>
            </div>
          {/if}
        {/if}

        <p class="meta">Esc or click outside to close. The list keeps its scroll position and selection.</p>
      </div>
    </Sheet.Content>
  {/if}
</Sheet.Root>
