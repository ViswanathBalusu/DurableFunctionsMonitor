<script lang="ts">
  // Test-only wrapper: Button and LinkButton take their label as a snippet, which a test cannot pass
  // through render() props. Everything else is forwarded verbatim.
  import Button from '$lib/components/Button.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';

  let {
    which = 'button',
    label = 'Terminate',
    withIcon = false,
    onRowClick,
    ...rest
  }: {
    which?: 'button' | 'link';
    label?: string;
    withIcon?: boolean;
    onRowClick?: (event: MouseEvent) => void;
    [key: string]: unknown;
  } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div onclick={onRowClick}>
  {#if which === 'button'}
    <Button {...rest}>
      {#snippet icon()}
        {#if withIcon}
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z" /></svg>
        {/if}
      {/snippet}
      {label}
    </Button>
  {:else}
    <LinkButton {...rest}>{label}</LinkButton>
  {/if}
</div>
