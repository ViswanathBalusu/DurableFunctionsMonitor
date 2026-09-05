<script lang="ts">
  // Test-only wrapper for the surface components, which take snippets.
  import Banner from '$lib/components/Banner.svelte';
  import Card from '$lib/components/Card.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import Tabs from '$lib/components/Tabs.svelte';

  let { which, level = 2 }: { which: string; level?: 2 | 3 } = $props();

  let tab = $state('history');
</script>

{#if which === 'page'}
  <Page>
    <PageTitle title="Overview">
      <button class="btn ghost" type="button">Refresh</button>
    </PageTitle>
  </Page>
{:else if which === 'panel'}
  <Panel title="Needs attention" {level}>
    {#snippet meta()}
      <span class="meta">3 groups</span>
    {/snippet}
    Panel body
  </Panel>
{:else if which === 'panel-bare'}
  <Panel>Panel body</Panel>
{:else if which === 'card'}
  <Card>Card body</Card>
{:else if which === 'banner'}
  <Banner>
    {#snippet chip()}
      <span class="chip st-running sm">Partial results</span>
    {/snippet}
    {#snippet action()}
      <button class="btn sm" type="button">Narrow the range</button>
    {/snippet}
    Counted the first 50,000 instances of the range; narrow the range for exact numbers.
  </Banner>
{:else if which === 'empty'}
  <EmptyState title="No orchestrations" text="Nothing was created in the last 24 hours.">
    {#snippet actions()}
      <button class="btn primary" type="button">Start new instance</button>
    {/snippet}
  </EmptyState>
{:else if which === 'tabs'}
  <Tabs
    tabs={[
      { id: 'history', label: 'History' },
      { id: 'raw', label: 'Raw' },
    ]}
    bind:value={tab}
    ariaLabel="Instance views"
  >
    {#snippet controls()}
      <button class="btn ghost sm" type="button">Refresh</button>
    {/snippet}
  </Tabs>
{/if}
