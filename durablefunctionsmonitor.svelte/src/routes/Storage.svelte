<script lang="ts" module>
  /** What the two tables below it are, in one paragraph (ScreenStorage.dc.html L23). */
  export const STORAGE_EXPLANATION =
    'Queue depth is the backlog your workers have not picked up yet; partition ownership shows which ' +
    'worker is draining which control queue. Both come straight from the storage account, not from ' +
    'the Durable Task Framework.';

  /** What the screen is instead of itself on a backend that cannot read its own storage. */
  export const NO_STORAGE_TITLE = 'Storage details are not available for this provider';
  export const NO_STORAGE_TEXT =
    'This backend does not report the queues, partitions and tables of its task hub. Everything else ' +
    'about the hub is on the other screens.';
</script>

<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { providerName } from '$lib/settings/ConnectionPanel.svelte';
  import PartitionsTable from '$lib/storage/PartitionsTable.svelte';
  import QueuesTable from '$lib/storage/QueuesTable.svelte';
  import { fmtBytes } from '$lib/format/bytes';
  import { fmtInt } from '$lib/format/number';
  import { fmtDateTime } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { Storage } from '$lib/state/storage.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const storage = new Storage({ app });

  const showTimeAs = $derived(app.prefs.showTimeAs);

  const provider = $derived(providerName(storage.response?.provider ?? app.about?.provider ?? ''));

  /** `dfmstorage001 · DurableFunctionsHub`, or the hub alone where the account has no name (L20). */
  const where = $derived([storage.accountName, storage.taskHub?.name ?? app.hub].filter(Boolean).join(' · '));

  const counts = $derived(storage.counts);

  /** `12,408 rows`, `12,408 rows (partial)`, or an em dash until something has counted them. */
  function rowCount(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }

    return `${fmtInt(value)} rows${counts?.partial ? ' (partial)' : ''}`;
  }

  const hubRows = $derived<KvRow[]>([
    { k: 'name', v: storage.taskHub?.name ?? '—', mono: true },
    { k: 'partitions', v: storage.taskHub?.partitionCount?.toString() ?? '—', mono: true },
    {
      k: 'created',
      v: storage.taskHub?.createdAt ? fmtDateTime(storage.taskHub.createdAt, showTimeAs) : '—',
      mono: true,
    },
    { k: 'instances', v: instancesCell },
    { k: 'history', v: rowCount(counts?.historyRows), mono: true },
    { k: 'large messages', v: largeMessagesCell },
    { k: 'blobs', v: blobsCell, mono: true },
  ]);

  const tableRows = $derived<KvRow[]>([
    { k: 'Instances', v: storage.tables?.instances ?? '—', mono: true },
    { k: 'History', v: storage.tables?.history ?? '—', mono: true },
    { k: 'Partitions', v: storage.tables?.partitions ?? '—', mono: true },
    { k: 'Audit', v: storage.tables?.audit ?? '—', mono: true },
  ]);

  onMount(() => {
    // `refreshed 4 s ago` counts up while the screen is open, as it does on the Overview
    const clock = setInterval(() => (app.now = Date.now()), 1000);

    storage.startAutoRefresh();

    const stopRefresh = app.onRefresh(() => void storage.load());

    return () => {
      clearInterval(clock);
      storage.stopAutoRefresh();
      stopRefresh();
    };
  });

  /** The capabilities arrive after the first render, so the load waits until they are known. */
  let loadedKey = '';

  $effect(() => {
    const key = JSON.stringify([app.hub, storage.supported]);

    if (key === loadedKey) {
      return;
    }

    loadedKey = key;

    queueMicrotask(() => void storage.load());
  });
</script>

{#snippet instancesCell()}
  <span class="mono">{rowCount(counts?.instancesRows)}</span>
  <!-- Counting is a scan of both tables, so it happens when it is asked for and not on a timer -->
  <LinkButton class="fine" onclick={() => void storage.countRows()} disabled={storage.counting}>
    {storage.counting ? 'Counting…' : 'Count rows'}
  </LinkButton>
{/snippet}

{#snippet largeMessagesCell()}
  <span class="mono">{storage.largeMessages?.container ?? '—'}</span>
  {#if storage.largeMessages?.exists}
    <Chip size="sm" class="st-completed" style="margin-left:6px">exists</Chip>
  {:else if storage.largeMessages}
    <span class="muted" style="margin-left:6px">missing</span>
  {/if}
{/snippet}

{#snippet blobsCell()}
  {#if storage.largeMessages?.blobCount === null || storage.largeMessages === null}
    <!-- The container holds the payloads of the whole hub; B4 counts them per instance only -->
    —
  {:else}
    {fmtInt(storage.largeMessages.blobCount)} · {fmtBytes(storage.largeMessages.totalBytes ?? 0)}
  {/if}
{/snippet}

<!--
  ScreenStorage.dc.html L16-L70: what the task hub is made of on the left, what is moving through it
  on the right.
-->
<Page data-screen-label="Storage">
  <PageTitle title="Storage">
    <Chip size="sm">{provider}</Chip>
    <span class="mono muted">{where}</span>

    <div class="row" style="margin-left:auto;gap:10px">
      <span class="fine muted">refreshed {storage.refreshedAgo}</span>
      <Button variant="primary" onclick={() => void storage.load()} disabled={storage.loading}>Refresh</Button>
    </div>
  </PageTitle>

  {#if !storage.supported}
    <EmptyState title={NO_STORAGE_TITLE} text={NO_STORAGE_TEXT} />
  {:else}
    <p style="max-width:80ch">{STORAGE_EXPLANATION}</p>

    <div class="two storage">
      <Panel title="Task hub">
        {#snippet meta()}
          <span class="fine muted">{storage.taskHub?.source ?? 'taskhub.json'}</span>
        {/snippet}

        <Kv rows={hubRows} />

        <div class="panel-h" style="margin-top:16px"><h2>Tables</h2></div>

        <Kv rows={tableRows} />
      </Panel>

      <div class="stack" style="gap:16px">
        <QueuesTable {storage} />
        <PartitionsTable {storage} />
      </div>
    </div>
  {/if}
</Page>
