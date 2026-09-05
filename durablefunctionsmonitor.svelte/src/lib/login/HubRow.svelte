<script lang="ts">
  import Chip from '$lib/components/Chip.svelte';
  import type { HubOption } from '$lib/state/login.svelte';

  interface Props {
    hub: HubOption;
    /** The Overview of this hub: a real link, so middle-click and copy-link work. */
    href: string;
    onpick?: (name: string) => void;
  }

  let { hub, href, onpick }: Props = $props();
</script>

<!-- ScreenLogin.dc.html L35-L42. The meta column is empty: the backend reports nothing per hub. -->
<a
  class="hubrow"
  {href}
  onclick={(event) => {
    if (!event.ctrlKey && !event.metaKey && event.button === 0) {
      event.preventDefault();
      onpick?.(hub.name);
    }
  }}
>
  <span class="swq" style="background:var(--primary);width:16px;height:16px" aria-hidden="true"></span>
  <span class="mono" style="font-weight:600;font-size:15px">{hub.name}</span>
  <span class="meta grow"></span>

  {#if hub.badge}
    <!-- Read only is the muted status colour; a hub whose /about failed carries no badge at all -->
    <Chip size="sm" class={hub.badge === 'Read only' ? 'st-terminated' : ''}>{hub.badge}</Chip>
  {/if}

  <span class="tri" aria-hidden="true"></span>
</a>
