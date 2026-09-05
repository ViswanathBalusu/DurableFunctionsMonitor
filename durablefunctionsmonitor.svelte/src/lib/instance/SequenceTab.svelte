<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import SequenceDiagram from '$lib/charts/SequenceDiagram.svelte';
  import { saveSvg } from '$lib/charts/svg-export';
  import { fmtTimeMs } from '$lib/format/time';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';
  import { buildSequence, toMermaid, type SequenceModel } from './sequence-model';

  interface Props {
    instance: InstanceState;
  }

  /** How many pages past the first the diagram pulls in before it draws what it has. */
  const MAX_PAGES = 10;

  let { instance }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const showTimeAs = $derived(app.prefs.showTimeAs);

  let model = $state<SequenceModel>({ participants: [], messages: [] });
  let diagram = $state<SequenceDiagram | null>(null);
  let building = $state(false);

  /** The history this diagram was built from; rebuilding it unchanged would be work for nothing. */
  let builtFrom = '';

  /** How many extra pages of history this tab has asked for. */
  let pages = 0;

  /**
   * The diagram is built from the history the History tab loaded, plus one request per
   * sub-orchestration it finds. The whole history is asked for rather than the first page: a
   * diagram of the first 200 rows of a long orchestration would be a diagram of nothing.
   */
  async function build(): Promise<void> {
    const name = instance.functionName;

    if (!name) {
      return;
    }

    building = true;

    try {
      model = await buildSequence({
        orchestratorName: name,
        history: instance.history.rows,
        isFailed: instance.status === 'Failed',
        loadHistory: async (instanceId) => {
          const response = await app.track(() => app.endpoints.getHistory(instanceId, { top: 1000, skip: 0 }));

          return response.history ?? [];
        },
      });
    } finally {
      building = false;
    }
  }

  /** Rebuilt whenever the history under it changed - a Load more, an action, an auto-refresh tick. */
  $effect(() => {
    const key = `${instance.functionName}:${instance.history.rows.length}:${instance.status}`;

    if (key === builtFrom || instance.history.loading) {
      return;
    }

    builtFrom = key;

    queueMicrotask(() => void build());
  });

  /**
   * A diagram of the first page is a diagram of the wrong thing, so the rest of the history is
   * pulled in as it arrives - bounded, because a hub can hold an orchestration whose history is
   * longer than anything worth drawing, and ten pages of it is already 2000 rows.
   */
  $effect(() => {
    if (!instance.history.hasMore || instance.history.loading || pages >= MAX_PAGES) {
      return;
    }

    pages += 1;

    queueMicrotask(() => void instance.history.loadMore());
  });

  async function copyCode(): Promise<void> {
    await navigator.clipboard.writeText(toMermaid(model));

    app.toast.ok('Copied the sequence diagram source');
  }

  async function save(): Promise<void> {
    const svg = diagram?.toSvg();

    if (svg) {
      await saveSvg(app.client, svg, `${instance.instanceId}-sequence.svg`);
    }
  }
</script>

<!-- ScreenInstance.dc.html L192-L199: the diagram, then the two things that can be done with it. -->
{#if model.messages.length === 0 && !building}
  <p class="meta">Nothing to draw yet: this execution has recorded no calls.</p>
{:else}
  <SequenceDiagram
    bind:this={diagram}
    {model}
    orchestrator={instance.functionName}
    formatTime={(iso) => fmtTimeMs(iso, showTimeAs)}
  />
{/if}

<div class="row" style="justify-content:flex-end">
  <Button variant="ghost" onclick={() => void copyCode()}>Copy diagram code to clipboard</Button>
  <Button variant="ghost" onclick={() => void save()}>Save as SVG</Button>
</div>
