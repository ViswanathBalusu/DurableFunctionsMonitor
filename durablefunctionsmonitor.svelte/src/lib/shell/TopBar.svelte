<script lang="ts">
  import { getContext } from 'svelte';
  import Chip from '$lib/components/Chip.svelte';
  import DangerBadge from '$lib/components/DangerBadge.svelte';
  import Segmented from '$lib/components/Segmented.svelte';
  import Select from '$lib/components/Select.svelte';
  import { timeZoneLabel } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import HubSwitcher from './HubSwitcher.svelte';
  import InstanceJump from './InstanceJump.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let jump = $state<InstanceJump | null>(null);

  /** The `/` shortcut reaches the jump field through here (contracts §13). */
  export function focusJump(): void {
    jump?.focus();
  }

  /** The intervals of DFM App.dc.html L72; 0 is "Never". */
  const refreshOptions = [
    { value: '0', label: 'Never' },
    { value: '1', label: 'Every 1 sec.' },
    { value: '5', label: 'Every 5 sec.' },
    { value: '10', label: 'Every 10 sec.' },
  ];

  const timeOptions = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Local', label: 'Local' },
  ];

  /** Which screen's auto-refresh the top bar is showing: the workspace has its own. */
  const refreshScreen = $derived(app.router.current.name === 'instance' ? 'instance' : 'instances');

  let refresh = $derived(String(app.prefs.autoRefresh[refreshScreen]));
  let showTimeAs = $derived(app.prefs.showTimeAs);

  function setRefresh(value: string): void {
    app.prefs.setAutoRefresh(refreshScreen, Number(value));
  }

  function setShowTimeAs(value: string): void {
    app.prefs.setShowTimeAs(value as 'UTC' | 'Local');
  }
</script>

<!-- DFM App.dc.html L40-L95, in the order the mockup lays it out. -->
<header class="topbar">
  <div class="logo" aria-hidden="true"></div>
  <span class="display hide-m" style="font-size:16px;white-space:nowrap">Durable Functions Monitor</span>
  <span class="muted hide-m" aria-hidden="true">/</span>

  <HubSwitcher />

  <InstanceJump bind:this={jump} />

  {#if app.readOnly}
    <Chip size="sm" title="/about does not list DurableFunctionsMonitor.ReadWrite" style="background:var(--muted)">
      Read only
    </Chip>
  {/if}

  {#if app.dangerous}
    <DangerBadge size="sm" class="hide-m" />
  {/if}

  <span class="grow hide-m"></span>

  <Select
    options={refreshOptions}
    value={refresh}
    ariaLabel="Auto-refresh"
    size="sm"
    width="auto"
    onchange={setRefresh}
  />

  <Segmented
    options={timeOptions}
    value={showTimeAs}
    ariaLabel="Show time as"
    size="sm"
    onchange={setShowTimeAs}
    class="hide-m"
    title={timeZoneLabel()}
  />
</header>
