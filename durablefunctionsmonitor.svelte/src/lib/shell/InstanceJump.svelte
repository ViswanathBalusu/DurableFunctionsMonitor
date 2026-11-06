<script lang="ts">
  import { getContext } from 'svelte';
  import Combobox from '$lib/components/Combobox.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { MIN_PREFIX, Suggestions } from '$lib/state/suggestions.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const suggestions = new Suggestions(app.endpoints);

  let value = $state('');
  let input = $state<HTMLInputElement | null>(null);

  /** The `/` shortcut focuses this field (contracts §13). */
  export function focus(): void {
    input?.focus();
  }

  function open(instanceId: string, event?: MouseEvent | KeyboardEvent): void {
    const id = instanceId.trim();

    if (!id) {
      return;
    }

    value = '';
    suggestions.clear();

    // Ctrl/⌘ opens a second window, which is how the mockups let you compare two instances
    if (event && (event.ctrlKey || event.metaKey)) {
      app.client.host.openInNewWindow(id);
      return;
    }

    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: id });
  }
</script>

<!-- DFM App.dc.html L57-L67: the find-instance field, its suggestions coming from /id-suggestions. -->
<!--
  The narrowest the field gets in a crowded top bar is its whole placeholder, measured in the input's
  own font (dfm-ext.css `.tb-find .input`): a fixed 156 px held "Find instance" in the studio face and
  cut it to "Find instanc" in the papers' monospace. The magnifier and the `/` key hint are drawn
  beside the text rather than written into the placeholder, so a phone can drop the hint without
  clipping it.
-->
<div class="anchor grow tb-find" style="max-width:340px">
  <svg class="tb-find-ico" viewBox="0 0 24 24" aria-hidden="true"
    ><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg
  >
  <kbd class="tb-find-key hide-m" aria-hidden="true">/</kbd>
  <Combobox
    bind:value
    bind:ref={input}
    items={suggestions.items}
    minChars={MIN_PREFIX}
    placeholder="Find instance"
    ariaLabel="Find instance"
    emptyText="No instance id starts with that."
    oninput={(next) => suggestions.query(next)}
    onSelect={(id) => open(id)}
    onEnter={(typed) => open(suggestions.items[0] ?? typed)}
  />
</div>
