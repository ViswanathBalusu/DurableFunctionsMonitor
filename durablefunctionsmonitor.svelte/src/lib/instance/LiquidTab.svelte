<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { InstanceState } from '$lib/state/instance.svelte';

  interface Props {
    instance: InstanceState;
    /** The template name, which is both the tab's label and the endpoint's argument. */
    name: string;
  }

  let { instance, name }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let markup = $state('');
  let loading = $state(false);

  /** React's CancelToken: a tab switched away from must not paint over the one switched to. */
  let requestId = 0;

  async function load(): Promise<void> {
    const current = ++requestId;

    loading = true;

    try {
      const html = await app.track(() => app.endpoints.customTabMarkup(instance.instanceId, name));

      if (current === requestId) {
        markup = html;
      }
    } catch (error) {
      if (current === requestId) {
        app.toast.fromError('Failed to load tab', error, () => void load());
      }
    } finally {
      if (current === requestId) {
        loading = false;
      }
    }
  }

  onMount(() => {
    void load();

    // The auto-refresh tick and the Refresh button reload the markup with everything else
    return instance.onReload(() => load());
  });
</script>

<!--
  ScreenInstance.dc.html L249-L252: one Liquid template, rendered by the backend and shown as it
  came back.

  The markup is inserted as HTML on purpose. These templates live in the hub's own storage account,
  are written by whoever administers that hub, and were rendered exactly this way by the React app -
  tables, definition lists and links are the point of them. Sanitizing would quietly delete the
  markup the template author wrote; anyone who can put a template in that container can already do
  far more than run script in this page.
-->
<Panel title={name} level={3}>
  {#snippet meta()}
    <span class="fine muted">Liquid template · custom-tab-markup('{name}')</span>
  {/snippet}

  {#if loading && !markup}
    <p class="meta">Loading…</p>
  {:else}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- the rendered template is the content -->
    {@html markup}
  {/if}
</Panel>
