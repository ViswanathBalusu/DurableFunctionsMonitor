<script lang="ts">
  import LinkButton from '$lib/components/LinkButton.svelte';

  interface Props {
    text: string;
    href?: string;
    onclick?: (event: MouseEvent) => void;
  }

  let { text, href, onclick }: Props = $props();
</script>

<!-- The row itself opens the workspace, so a link inside it keeps its click (LinkButton stopPropagation). -->
<LinkButton mono stopPropagation {href} {onclick}>{text}</LinkButton>
