<script lang="ts" module>
  import type { RuntimeStatus, StatsResponse } from '$lib/api/types';

  /** The five statuses the tiles show, in the mockup's order, with the fill each one carries. */
  export const TILE_STATUSES: readonly { status: RuntimeStatus; fill: string }[] = [
    { status: 'Running', fill: 'st-running' },
    { status: 'Pending', fill: 'st-pending' },
    { status: 'Failed', fill: 'st-failed' },
    { status: 'Completed', fill: 'st-completed' },
    { status: 'Suspended', fill: 'st-suspended' },
  ];

  /** How many instances of one status each bin of the range holds; a missing key is zero. */
  export function binCounts(stats: StatsResponse, status: RuntimeStatus): number[] {
    return stats.bins.map((bin) => bin.counts[status] ?? 0);
  }

  /**
   * The entities line. `/stats` counts entities as a total and not per bin - an entity has no
   * lifetime to fall into one - so the tile draws a flat line rather than a shape it made up.
   */
  export function entityLine(stats: StatsResponse): number[] {
    return stats.bins.map(() => stats.totals.entities);
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { toQuery } from '$lib/filters/time-range';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import StatTile from './StatTile.svelte';

  interface Props {
    stats: StatsResponse;
  }

  let { stats }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /** Every tile opens its list over the range that is on screen, so the numbers agree. */
  const rangeQuery = $derived(
    Object.fromEntries(Object.entries(toQuery(app.timeRange)).filter(([, value]) => value !== null)),
  );

  function goInstances(status: RuntimeStatus): void {
    app.router.navigate({ name: 'instances', hub: app.hub }, { query: { ...rangeQuery, status } });
  }

  /**
   * Failed opens the grouped view when the backend can group them, and the plain filtered list when
   * it cannot: the tile means "these are the failures", and both screens say that.
   */
  function goFailed(): void {
    if (app.capabilities.failures) {
      app.router.navigate({ name: 'failures', hub: app.hub }, { query: rangeQuery });
      return;
    }

    goInstances('Failed');
  }
</script>

<!-- ScreenOverview.dc.html L30-L37: six tiles, five statuses and the entities beside them. -->
<div class="tiles">
  {#each TILE_STATUSES as tile (tile.status)}
    <StatTile
      label={tile.status}
      count={stats.totals[tile.status] ?? 0}
      values={binCounts(stats, tile.status)}
      class={tile.fill}
      onclick={() => (tile.status === 'Failed' ? goFailed() : goInstances(tile.status))}
    />
  {/each}

  <StatTile
    label="Entities"
    count={stats.totals.entities}
    values={entityLine(stats)}
    class="kind-entity"
    onclick={() => app.router.navigate({ name: 'entities', hub: app.hub }, { query: rangeQuery })}
  />
</div>
