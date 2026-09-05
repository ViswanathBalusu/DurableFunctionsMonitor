<script lang="ts">
  import Banner from '$lib/components/Banner.svelte';
  import Button from '$lib/components/Button.svelte';
  import Card from '$lib/components/Card.svelte';
  import Chip from '$lib/components/Chip.svelte';
  import HubRow from '$lib/login/HubRow.svelte';
  import type { Login } from '$lib/state/login.svelte';

  interface Props {
    login: Login;
    /** Where a picked hub goes: the app navigates and then loads /about for it. */
    onPick?: (hub: string) => void;
  }

  let { login, onPick }: Props = $props();

  const host = $derived(globalThis.location?.host ?? '');
</script>

<!--
  ScreenLogin.dc.html L15-L60, without the connection-string card: the backend has no endpoint
  behind it (decision D11). Browser and Docker hosts only - the VS Code webview is handed its hub.
-->
<section class="login" data-screen-label="Login">
  <div style="width:min(560px,100%);display:grid;gap:24px">
    <div style="display:flex;align-items:center;gap:14px">
      <div class="logo" style="width:56px;height:56px;box-shadow:var(--shadow-brutal)" aria-hidden="true"></div>
      <div>
        <h1 class="display" style="font-size:32px">Durable Functions Monitor</h1>
        {#if login.version || host}
          <!-- The version comes from the first /about that answered; before that there is none -->
          <p class="meta" style="margin-top:4px">{[login.version, host].filter(Boolean).join(' · ')}</p>
        {/if}
      </div>
    </div>

    {#if login.error}
      <Banner class="st-failed">{login.error}</Banner>
    {/if}

    {#if login.needsSignIn}
      <Card style="padding:20px;display:grid;gap:14px">
        <h2 style="font-size:20px;font-weight:700">Sign in</h2>
        <p style="max-width:60ch">
          This deployment uses Easy Auth. Sign in with your work account to list the task hubs you can see.
        </p>
        <div class="row">
          <Button variant="primary" onclick={() => void login.signIn()}>Sign in with Microsoft</Button>
        </div>
      </Card>
    {:else if login.hubs.length > 0}
      <Card>
        <div
          style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:var(--border-width) solid var(--ink);flex-wrap:wrap"
        >
          <h2 style="font-size:16px;font-weight:700">Task hubs</h2>
          {#if !login.isAnonymous}
            <span class="meta">signed in as {login.userName}</span>
          {/if}
          {#if login.accountName}
            <Chip size="sm" style="margin-left:auto">
              <span class="mono" style="font-size:11px">{login.accountName}</span>
            </Chip>
          {/if}
        </div>

        {#each login.hubs as hub (hub.name)}
          <HubRow {hub} href={login.hubHref(hub.name)} onpick={(name) => onPick?.(name)} />
        {/each}

        <div
          style="display:flex;gap:10px;padding:12px 16px;border-top:var(--border-width) solid var(--ink);flex-wrap:wrap;align-items:center"
        >
          <span class="meta grow">Hubs come from GET ../task-hub-names for this storage account.</span>
          <Button variant="ghost" onclick={() => void login.signOut()}>Sign out</Button>
        </div>
      </Card>
    {:else if login.loading}
      <p class="meta">Loading…</p>
    {/if}

    <p class="meta" style="text-align:center">
      Read-only deployments show a Read only badge after sign in. Dangerous operations need
      DFM_DANGEROUS_OPERATIONS_ENABLED=true on the backend.
    </p>
  </div>
</section>
