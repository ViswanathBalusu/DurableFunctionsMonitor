<script lang="ts" module>
  import type { StorageResponse } from '$lib/api/types';

  /** The meta of the panel header: where the numbers behind these rows are set. */
  export const THRESHOLDS_META = 'thresholds in Settings';

  /** How deep the work-item queue is, or null when this backend does not report queues. */
  export function workItemsQueued(storage: StorageResponse | null): number | null {
    const queue = storage?.queues.find((candidate) => candidate.kind === 'workitems');

    return queue?.approximateMessageCount ?? null;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { RuntimeStatus, StatsResponse } from '$lib/api/types';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { toQuery } from '$lib/filters/time-range';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtInt } from '$lib/format/number';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    stats: StatsResponse;
    /** Null without the storageHealth capability, which is what hides the queue row. */
    storage?: StorageResponse | null;
  }

  let { stats, storage = null }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  interface AttentionRow {
    key: string;
    count: number;
    text: string;
    link: string;
    go: () => void;
    /** Shown even when the count is zero: no failures in the range is worth saying. */
    always?: boolean;
  }

  const thresholds = $derived(app.prefs.thresholds);

  const queued = $derived(workItemsQueued(storage));

  /** How long the oldest suspended instance has been sitting there, on the ticking clock. */
  const suspendedFor = $derived(
    stats.suspended.oldestLastUpdatedAt ? app.now - Date.parse(stats.suspended.oldestLastUpdatedAt) : null,
  );

  const rows = $derived(
    [
      {
        key: 'stuck',
        count: stats.stuck.count,
        text: `running longer than ${fmtDuration(thresholds.stuckMinutes * 60_000)}`,
        link: 'Instances',
        // `stuck=1` marks where the link came from; the ordering beside it is what actually puts
        // the oldest first, which is the whole point of following this row
        go: () => goInstances('Running', { stuck: '1', orderby: 'lastUpdatedTime', dir: 'asc' }),
      },
      {
        key: 'failed',
        count: stats.totals.Failed ?? 0,
        text: 'failed in range',
        link: app.capabilities.failures ? 'Failures' : 'Instances',
        go: goFailed,
        always: true,
      },
      {
        key: 'pending',
        count: stats.oldestPending.count,
        text: `pending older than ${fmtDuration(thresholds.pendingMinutes * 60_000)}`,
        link: 'Instances',
        go: () => goInstances('Pending'),
      },
      ...(queued !== null && queued > thresholds.queueDepth
        ? [
            {
              key: 'queue',
              count: queued,
              text: 'work items queued',
              link: 'Storage',
              go: () => app.router.navigate({ name: 'storage', hub: app.hub }),
            },
          ]
        : []),
      {
        key: 'suspended',
        count: stats.suspended.count,
        text: `suspended for ${fmtDuration(suspendedFor)}`,
        link: 'Instances',
        go: () => goInstances('Suspended'),
      },
    ].filter((row: AttentionRow) => row.always || row.count > 0),
  );

  const rangeQuery = $derived(
    Object.fromEntries(Object.entries(toQuery(app.timeRange)).filter(([, value]) => value !== null)),
  );

  function goInstances(status: RuntimeStatus, extra: Record<string, string> = {}): void {
    app.router.navigate({ name: 'instances', hub: app.hub }, { query: { ...rangeQuery, status, ...extra } });
  }

  function goFailed(): void {
    if (app.capabilities.failures) {
      app.router.navigate({ name: 'failures', hub: app.hub }, { query: rangeQuery });
      return;
    }

    goInstances('Failed');
  }
</script>

<!--
  ScreenOverview.dc.html L64-L73: the four or five things the range is asking someone to look at.
  A row with nothing in it is not a row - except the failures, because "0 failed in range" is an
  answer somebody came here for.
-->
<Panel title="Needs attention">
  {#snippet meta()}
    <span class="fine muted">{THRESHOLDS_META}</span>
  {/snippet}

  <div class="attn">
    {#each rows as row (row.key)}
      <div>
        <span class="n">{fmtInt(row.count)}</span>
        <span>{row.text}</span>
        <LinkButton onclick={row.go}>{row.link}</LinkButton>
      </div>
    {/each}
  </div>
</Panel>
