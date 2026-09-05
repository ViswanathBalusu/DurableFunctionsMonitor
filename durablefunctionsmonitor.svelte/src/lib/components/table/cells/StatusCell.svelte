<script lang="ts">
  import StatusChip from '$lib/components/StatusChip.svelte';

  interface Props {
    status: string;
  }

  let { status }: Props = $props();
</script>

<StatusChip {status} />
