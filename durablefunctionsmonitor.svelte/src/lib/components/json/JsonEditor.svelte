<script lang="ts">
  import type { Snippet } from 'svelte';
  import { JSONEditor, type Content, type OnChangeStatus } from 'svelte-jsoneditor';
  import { cn } from '$lib/utils';

  interface Props {
    /** The text being edited. Bindable. */
    text?: string;
    readOnly?: boolean;
    ariaLabel: string;
    /** Minimum height, in rows of text; the mockups' input editors are 6. */
    rows?: number;
    /** The chips and the size meter under the editor (ScreenInstance.dc.html L176-L181). */
    footer?: Snippet;
    class?: string;
    onChange?: (text: string, isValid: boolean) => void;
  }

  let {
    text = $bindable(''),
    readOnly = false,
    ariaLabel,
    rows = 6,
    footer,
    class: className,
    onChange,
  }: Props = $props();

  function handleChange(content: Content, _previous: Content, status: OnChangeStatus): void {
    const next = 'text' in content ? content.text : JSON.stringify(content.json, null, 2);

    text = next;

    // parseError is what the editor reports for text that is not JSON (yet); the caller decides what
    // to do about it - the input dialogs disable their confirm button.
    onChange?.(next, !status.contentErrors || !('parseError' in status.contentErrors));
  }
</script>

<!-- `.ed` is the framed editor block, `.ed.ro` its read-only shade; the footer holds chips and the meter. -->
<div class={cn('ed', readOnly ? 'ro' : '', className)}>
  <div class="jse-theme-dfm" style={`min-height:${rows * 22}px;flex:1`} role="group" aria-label={ariaLabel}>
    <JSONEditor
      mode={'text' as never}
      content={{ text }}
      {readOnly}
      indentation={2}
      statusBar={true}
      mainMenuBar={false}
      onChange={handleChange}
    />
  </div>
  {#if footer}
    <div class="foot">
      {@render footer()}
    </div>
  {/if}
</div>
