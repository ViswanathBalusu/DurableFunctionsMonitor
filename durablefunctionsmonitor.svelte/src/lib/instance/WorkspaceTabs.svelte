<script lang="ts" module>
  /** What each built-in tab is called on the strip; a custom tab is called by its template name. */
  const LABELS: Record<string, string> = {
    summary: 'Summary',
    timeline: 'Timeline',
    history: 'History',
    inputs: 'Inputs',
    sequence: 'Sequence',
    graph: 'Graph',
    raw: 'Raw',
  };

  /** The intervals of ScreenInstance.dc.html L52, and the seconds each of them means. */
  export const AUTO_REFRESH_OPTIONS = [
    { value: '0', label: 'Never' },
    { value: '1', label: 'Every 1 sec.' },
    { value: '5', label: 'Every 5 sec.' },
    { value: '10', label: 'Every 10 sec.' },
  ];
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Select from '$lib/components/Select.svelte';
  import Tabs, { type TabDefinition } from '$lib/components/Tabs.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { customTabName, type InstanceState } from '$lib/state/instance.svelte';

  interface Props {
    instance: InstanceState;
    /**
     * How many input events the Inputs tab found, once it has looked (E5-S4). Before that the tab
     * is called plain `Inputs`: a count nobody has counted is not a count.
     */
    inputsCount?: number | null;
  }

  let { instance, inputsCount = null }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const tabs = $derived<TabDefinition[]>([
    // Summary is the column beside every tab, and a tab of its own only below 1100px (by CSS)
    { id: 'summary', label: 'Summary', summaryTab: true },
    ...instance.tabs.map((id) => ({ id, label: label(id) })),
  ]);

  function label(id: string): string {
    const custom = customTabName(id);

    if (custom) {
      return custom;
    }

    if (id === 'inputs' && typeof inputsCount === 'number') {
      return `Inputs (${inputsCount})`;
    }

    return LABELS[id] ?? id;
  }
</script>

<!-- ScreenInstance.dc.html L43-L53: the tabs, then the auto-refresh select and Refresh. -->
<Tabs {tabs} bind:value={() => instance.tab, (next) => instance.setTab(next)} ariaLabel="Instance">
  {#snippet controls()}
    <div style="align-self:center;margin-bottom:4px">
      <Select
        options={AUTO_REFRESH_OPTIONS}
        bind:value={
          () => String(app.prefs.autoRefresh.instance),
          (next) => {
            app.setAutoRefresh('instance', Number(next));
            instance.startAutoRefresh();
          }
        }
        ariaLabel="Auto-refresh"
        size="sm"
        width="auto"
      />
    </div>

    <Button variant="ghost" size="sm" style="align-self:center;margin:0 0 4px 6px" onclick={() => app.refresh()}>
      Refresh
    </Button>
  {/snippet}
</Tabs>
