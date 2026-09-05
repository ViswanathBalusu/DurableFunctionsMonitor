<script lang="ts" module>
  /** How many lanes fit in a peek before it stops being a glance (DFM App.dc.html L172-L178). */
  export const PEEK_LANES = 4;
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { RuntimeStatus, SpansResponse } from '$lib/api/types';
  import Swimlane from '$lib/charts/Swimlane.svelte';
  import { placeSpan, type Swimlane as Lane, type TimeDomain } from '$lib/charts/swimlane';
  import { fmtDurationCompact } from '$lib/format/duration';
  import { fmtTime } from '$lib/format/time';
  import { buildTimeline } from '$lib/instance/timeline-lanes';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { isTerminal } from '$lib/state/instance.svelte';
  import type { PeekItem } from '$lib/state/peek.svelte';

  interface Props {
    item: PeekItem;
    /** `/spans` for this row, once the peek has it; null on a backend that does not serve it. */
    spans?: SpansResponse | null;
  }

  let { item, spans = null }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /** The whole run, for the one bar drawn when there are no spans to draw instead. */
  const rowDomain = $derived.by<TimeDomain>(() => {
    const from = new Date(item.created);
    const to = new Date(item.updated);

    // A row updated in the same millisecond it was created still needs a domain to sit in
    return { from, to: to.getTime() > from.getTime() ? to : new Date(from.getTime() + 1) };
  });

  /**
   * The first few lanes of the workspace's own timeline (E8-S2-T1). A peek is a glance: four lanes
   * says what kind of run this is, and the rest of it is one click away.
   */
  const timeline = $derived(
    spans
      ? buildTimeline({ spans, name: item.name, running: !isTerminal(item.status as RuntimeStatus) })
      : { lanes: rowLanes(), domain: rowDomain },
  );

  const lanes = $derived(timeline.lanes.slice(0, PEEK_LANES));

  /**
   * The row itself as one bar, which is all a backend without `/spans` can say: it created it, it
   * updated it, and that is the whole of what the list knows.
   */
  function rowLanes(): Lane[] {
    return [
      {
        key: item.id,
        label: item.name,
        bars: [
          {
            key: 'instance',
            cls: 'orch',
            ...placeSpan(item.created, item.updated, rowDomain),
            text: fmtDurationCompact(item.duration),
          },
        ],
      },
    ];
  }
</script>

<!-- DFM App.dc.html L172-L178: the same swimlane, at the size a side panel has room for. -->
<Swimlane
  {lanes}
  domain={timeline.domain}
  ticks={2}
  axisLabel=""
  minWidth={0}
  innerStyle="padding:10px"
  ariaLabel="Instance timeline"
  formatTick={(date) => fmtTime(date.toISOString(), app.prefs.showTimeAs)}
/>
