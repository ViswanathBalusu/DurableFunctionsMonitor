<script lang="ts" module>
  /** What the backend calls its providers, and what a person calls them (contracts §6). */
  const PROVIDER_NAMES: Readonly<Record<string, string>> = {
    AzureStorage: 'Azure Storage',
    MsSql: 'MSSQL',
    Netherite: 'Netherite',
  };

  /**
   * The readable provider name. A backend older than B0 does not report one at all and
   * `normalizeAbout` fills in 'unknown', which is what the panel then says; any other name the
   * backend sends is shown verbatim rather than flattened to 'unknown', because a provider this
   * build has not heard of is still a provider, and its name is the useful thing.
   */
  export function providerName(provider: string): string {
    return PROVIDER_NAMES[provider] ?? (provider || 'unknown');
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import DangerBadge from '$lib/components/DangerBadge.svelte';
  import JsonDialog from '$lib/components/json/JsonDialog.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import ConnectionDialog from './ConnectionDialog.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let connectionOpen = $state(false);
  let aboutOpen = $state(false);

  const about = $derived(app.about);

  /** Which shell the app is running in, and where it is served from (mockup L27). */
  const hostLine = $derived(
    `${app.host.kind === 'vscode' ? 'VS Code' : 'standalone'} · ${globalThis.location?.host ?? ''}`,
  );

  const rows = $derived<KvRow[]>([
    { k: 'account', v: about?.accountName || '—', mono: true },
    { k: 'task hub', v: about?.hubName || '—', mono: true },
    { k: 'backend', v: about?.version || '—', mono: true },
    { k: 'provider', v: providerCell },
    { k: 'permissions', v: permissionsCell },
    { k: 'host', v: hostLine },
  ]);
</script>

{#snippet providerCell()}
  <Chip size="sm">{providerName(about?.provider ?? '')}</Chip>
{/snippet}

{#snippet permissionsCell()}
  <!--
    What this browser may do, as /about answered it. `readOnly` rather than the permission list:
    a backend with authentication switched off sends no permissions at all and is still writable,
    and it is `readOnly` that every screen actually gates on (contracts §6).
  -->
  <span class="row" style="gap:6px">
    <Chip size="sm">{app.readOnly ? 'Read only' : 'ReadWrite'}</Chip>
    {#if app.dangerous}
      <DangerBadge size="sm" text="DangerousOperations" />
    {/if}
  </span>
{/snippet}

<!-- ScreenSettings.dc.html L19-L30: what the backend answered about itself, and nothing this app made up. -->
<Panel title="Connection">
  {#snippet meta()}
    <span class="fine muted">GET /about</span>
  {/snippet}

  <Kv {rows} />

  <div class="row" style="margin-top:14px">
    <Button onclick={() => (connectionOpen = true)}>Manage connection</Button>
    <Button variant="ghost" onclick={() => (aboutOpen = true)}>View /about JSON</Button>
  </div>
</Panel>

<ConnectionDialog bind:open={connectionOpen} />

<JsonDialog
  bind:open={aboutOpen}
  title="/about"
  value={about}
  onCopied={() => app.toast.ok('Copied /about to the clipboard')}
/>
