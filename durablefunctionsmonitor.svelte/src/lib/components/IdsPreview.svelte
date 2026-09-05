<script lang="ts">
  interface Props {
    ids: string[];
    /** How many to show before summarising the rest (ScreenInstances.dc.html L148). */
    max?: number;
  }

  let { ids, max = 10 }: Props = $props();

  const shown = $derived(ids.slice(0, max));
  const rest = $derived(Math.max(0, ids.length - max));
</script>

<!-- The read-only editor block the bulk confirms show the affected ids in. -->
<div class="ed ro" style="min-height:0">
  <pre>{shown.join('\n')}{rest > 0 ? `\n… and ${rest} more` : ''}</pre>
</div>
