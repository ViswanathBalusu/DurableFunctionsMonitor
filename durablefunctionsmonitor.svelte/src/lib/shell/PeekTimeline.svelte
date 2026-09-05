<script lang="ts">
  import { getContext } from 'svelte';
  import Swimlane from '$lib/charts/Swimlane.svelte';
  import { placeSpan, type Swimlane as Lane, type TimeDomain } from '$lib/charts/swimlane';
  import { fmtDurationCompact } from '$lib/format/duration';
  import { fmtTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { PeekItem } from '$lib/state/peek.svelte';

  interface Props {
    item: PeekItem;
  }

  let { item }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /**
   * One lane, the instance itself, from created to last updated (DFM App.dc.html L167-L173 draws
   * four; the other three are the activity spans, which only E8's `/spans` call knows about, and
   * this panel does not invent them).
   */
  const domain = $derived.by<TimeDomain>(() => {
    const from = new Date(item.created);
    const to = new Date(item.updated);

    // A row updated in the same millisecond it was created still needs a domain to sit in
    return { from, to: to.getTime() > from.getTime() ? to : new Date(from.getTime() + 1) };
  });

  const lanes = $derived<Lane[]>([
    {
      key: item.id,
      label: item.name,
      bars: [
        {
          key: 'instance',
          cls: 'orch',
          ...placeSpan(item.created, item.updated, domain),
          text: fmtDurationCompact(item.duration),
        },
      ],
    },
  ]);
</script>

<Swimlane
  {lanes}
  {domain}
  ticks={2}
  axisLabel=""
  minWidth={0}
  ariaLabel="Instance timeline"
  formatTick={(date) => fmtTime(date.toISOString(), app.prefs.showTimeAs)}
/>
