<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import ExecutionPanel from './ExecutionPanel.svelte';
  import FieldsPanel from './FieldsPanel.svelte';

  interface Props {
    instance: InstanceState;
    /** "Where the time went" (E8): drawn from /spans, and not drawn at all until there are spans. */
    timeSpent?: Snippet;
    /** The children this instance started (E8), rendered above the Execution rows. */
    childrenPanel?: Snippet;
  }

  let { instance, timeSpent, childrenPanel }: Props = $props();
</script>

<!--
  ScreenInstance.dc.html L56-L86. The column beside every tab on a wide screen, and the Summary tab
  itself below 1100px - which is CSS, not a second component. The two panels E8 owns are snippets:
  a panel that would only ever say "—" is worse than no panel.
-->
<aside class="summary" aria-label="Summary">
  {@render timeSpent?.()}

  <FieldsPanel {instance} />

  <ExecutionPanel {instance} children={childrenPanel} />
</aside>
