<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import JsonViewer from '$lib/components/json/JsonViewer.svelte';
  import Kv from '$lib/components/Kv.svelte';
  import { formatJson } from '$lib/format/json';
  import { describeSource, identityDetails, identityRows, type AccountIdentity } from '$lib/state/identity';

  interface Props {
    /** Bindable. */
    open?: boolean;
    /** Null shows nothing at all: there is no person to describe. */
    identity: AccountIdentity | null;
    title?: string;
    /** True when the backend records the changes made, so the note at the bottom is true. */
    audited?: boolean;
    /** Told after a successful copy, so the owner can toast it. */
    onCopied?: () => void;
  }

  let { open = $bindable(false), identity, title = 'Account', audited = false, onCopied }: Props = $props();

  const rows = $derived(identity ? identityRows(identity) : []);

  async function copy(): Promise<void> {
    if (!identity) {
      return;
    }

    await navigator.clipboard.writeText(formatJson(identityDetails(identity)));
    onCopied?.();
  }
</script>

<Dialog bind:open {title} width={640}>
  {#if identity}
    <p class="meta">{describeSource(identity.source)}</p>

    <Kv {rows} aria-label="Account details" />

    {#if identity.claims}
      <!-- Contracts §9: JSON is shown fully expanded and pretty-printed, here too -->
      <p class="meta" style="margin-top:14px">ID token claims, as Microsoft Entra ID issued them</p>
      <JsonViewer value={identity.claims} mainMenuBar={false} height="min(34vh, 280px)" ariaLabel="ID token claims" />
    {/if}

    {#if audited && identity.source !== 'audit'}
      <p class="meta" style="margin-top:14px">
        Changes you make are recorded in the audit log under the identity the backend validates for you, which is what
        the Activity screen shows.
      </p>
    {/if}
  {/if}

  {#snippet footer()}
    <Button onclick={copy} disabled={!identity}>Copy details</Button>
    <Button variant="primary" onclick={() => (open = false)}>Close</Button>
  {/snippet}
</Dialog>
