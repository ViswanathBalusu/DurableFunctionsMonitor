<script lang="ts" module>
  import type { Templates } from '$lib/api/types';

  /** The blob the function graph is drawn from, and how many functions it holds. */
  export function functionMapLine(templates: Templates): string {
    if (!templates.functionMapAvailable) {
      return 'none';
    }

    return templates.functionCount === null
      ? 'function-map.json'
      : `function-map.json · ${templates.functionCount} functions`;
  }

  /** The custom tabs this hub's storage holds, in the order the backend lists them. */
  export function liquidTabsLine(templates: Templates): string {
    return templates.liquidTabs.length > 0 ? templates.liquidTabs.join(' · ') : 'none';
  }

  /** Whether the hub replaced the meta tag the page is served with, or kept the default CSP one. */
  export function customMetaLine(templates: Templates): string {
    return `durable-functions-monitor-meta · ${templates.customMetaTag ? 'custom' : 'CSP default'}`;
  }
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Kv, { type KvRow } from '$lib/components/Kv.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  // Em dashes until /about has answered: what this hub's storage holds is the backend's to say, and
  // "none" is an answer, not the absence of one.
  const rows = $derived<KvRow[]>(
    app.about
      ? [
          { k: 'function map', v: functionMapLine(app.about.templates), mono: true },
          { k: 'Liquid tabs', v: liquidTabsLine(app.about.templates), mono: true },
          { k: 'custom meta', v: customMetaLine(app.about.templates), mono: true },
        ]
      : [
          { k: 'function map', v: '—', mono: true },
          { k: 'Liquid tabs', v: '—', mono: true },
          { k: 'custom meta', v: '—', mono: true },
        ],
  );
</script>

<!-- ScreenSettings.dc.html L75-L82: what this task hub's own storage account adds to the app. -->
<Panel title="Templates">
  <Kv {rows} />
</Panel>
