<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getContext } from 'svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { fmtDurationClock } from '$lib/format/duration';
  import { statusClass } from '$lib/format/status';
  import { fmtAgo, fmtDateTime } from '$lib/format/time';
  import { isRouterClick } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { isTerminal, type InstanceState } from '$lib/state/instance.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    instance: InstanceState;
    /** The action buttons (E5-S2-T2), which fill the third column of the hero grid. */
    actions?: Snippet;
    /**
     * How many children the instance has, once E8 has loaded them. Until it has, the line is not
     * drawn at all: "children: 0" and "we have not looked" are not the same thing.
     */
    childCount?: number | null;
    /**
     * How many rows the whole history has, as `/spans` counted them (E8). Until something has, the
     * header says how many the History tab has loaded - which is a page, and says so with a `+`.
     */
    historyRows?: number | null;
  }

  let { instance, actions, childCount = null, historyRows = null }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const details = $derived(instance.details);
  const status = $derived(details?.runtimeStatus ?? '');

  /** Entities are named by their entity name, orchestrations by their orchestrator. */
  const name = $derived(instance.functionName || details?.name || '');

  const showTimeAs = $derived(app.prefs.showTimeAs);

  /**
   * The clock, ticked once a second while the instance is still running. A terminal instance has a
   * duration that cannot change, so nothing ticks for it - and nothing ticks once this header is
   * gone, which is the point of driving `app.now` from here rather than from the app.
   */
  $effect(() => {
    if (isTerminal(details?.runtimeStatus)) {
      return;
    }

    const timer = setInterval(() => (app.now = Date.now()), 1000);

    return () => clearInterval(timer);
  });

  /** `31 rows` once the provider has counted them, `200+ rows` while a page is all there is. */
  const historyLabel = $derived(
    historyRows === null
      ? `${instance.history.rows.length}${instance.history.hasMore ? '+' : ''} rows`
      : `${historyRows} rows`,
  );

  function goInstances(event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instances', hub: app.hub });
  }

  function goInstance(instanceId: string, event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId });
  }

  function href(instanceId?: string): string {
    return instanceId
      ? app.router.href({ name: 'instance', hub: app.hub, instanceId })
      : app.router.href({ name: 'instances', hub: app.hub });
  }
</script>

<!-- ScreenInstance.dc.html L18-L41: the breadcrumb, then the hero - status tile, id, meta, actions. -->
<div class="row" style="gap:8px">
  <LinkButton class="meta" href={href()} onclick={goInstances}>Instances</LinkButton>
  <span class="meta">/</span>
  <span class="mono muted">{instance.instanceId}</span>
</div>

<header class="hero">
  <div class={cn('tile', statusClass(status))}>
    {status}<br /><span class="mono" style="font-weight:600">{fmtDurationClock(instance.liveDuration)}</span>
  </div>

  <div style="min-width:0">
    <h1>{instance.instanceId}</h1>

    <div class="hmeta">
      <span style="font-weight:700;color:var(--foreground)">{name}</span>
      <span class="mono">created {fmtDateTime(details?.createdTime, showTimeAs)} {showTimeAs}</span>
      <span class="mono">updated {fmtAgo(details?.lastUpdatedTime, new Date(app.now))}</span>

      {#if !instance.isEntity}
        <span>
          parent:
          {#if details?.parentInstanceId}
            <LinkButton
              mono
              href={href(details.parentInstanceId)}
              onclick={(event) => goInstance(details.parentInstanceId as string, event)}
            >
              {details.parentInstanceId}
            </LinkButton>
          {:else}
            <span class="mono">none</span>
          {/if}
        </span>
      {/if}

      {#if typeof childCount === 'number'}
        <span>
          children:
          <LinkButton mono onclick={() => instance.setTab('summary')}>{childCount}</LinkButton>
        </span>
      {/if}

      <span class="mono">history {historyLabel}</span>
    </div>
  </div>

  <div class="actions">
    {@render actions?.()}
  </div>
</header>
