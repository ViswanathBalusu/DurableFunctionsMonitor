<script lang="ts">
  import { JSONEditor, type Content, type JSONEditorPropsOptional } from 'svelte-jsoneditor';
  import { parseMaybeJson } from '$lib/format/json';

  interface Props {
    value: unknown;
    /** The tree/text/table switch and the search box. On in a dialog, off in a panel. */
    mainMenuBar?: boolean;
    /** Defaults to "only when the document is big enough to get lost in". */
    navigationBar?: boolean;
    height?: string;
    ariaLabel?: string;
  }

  let { value, mainMenuBar = true, navigationBar, height = 'min(60vh, 520px)', ariaLabel }: Props = $props();

  const json = $derived(parseMaybeJson(value));

  /** Roughly how many nodes the document has - enough to decide whether a navigation bar helps. */
  const nodeCount = $derived(countNodes(json));

  const showNavigationBar = $derived(navigationBar ?? nodeCount > 200);

  let editor = $state<{ set: (content: Content) => void; expand: (path: string[], callback: () => boolean) => void }>();

  // Contracts §9 / decision D4: every JSON value is shown fully expanded, always. The editor collapses
  // large documents by default, so it is expanded again on every change.
  $effect(() => {
    const target = editor;
    const content = { json } as Content;

    if (!target) {
      return;
    }

    target.set(content);

    try {
      target.expand([], () => true);
    } catch {
      // The editor's own root is not mounted yet, or is already gone - a value that arrives while
      // the screen is still building it, or a screen being torn down. The next run expands it;
      // letting this throw would take the screen down over a cosmetic call.
    }
  });

  function countNodes(node: unknown): number {
    if (Array.isArray(node)) {
      return node.reduce<number>((total, item) => total + countNodes(item), 1);
    }

    if (node && typeof node === 'object') {
      return Object.values(node as Record<string, unknown>).reduce<number>(
        (total, item) => total + countNodes(item),
        1,
      );
    }

    return 1;
  }

  const editorProps: JSONEditorPropsOptional = $derived({
    mode: 'tree' as never,
    readOnly: true,
    mainMenuBar,
    navigationBar: showNavigationBar,
    statusBar: false,
    indentation: 2,
  });
</script>

<div class="jse-theme-dfm" style={`height:${height}`} aria-label={ariaLabel} role="group">
  <JSONEditor bind:this={editor} {...editorProps} content={{ json }} />
</div>
