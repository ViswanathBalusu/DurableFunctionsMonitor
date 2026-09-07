<script lang="ts" module>
  /** What the header's `children: n` link scrolls to (E8-S3-T2). */
  export const CHILDREN_PANEL_ID = 'dfm-children';

  /** Said in place of the rows when the backend looked and found none. */
  export const NO_CHILDREN = 'No sub-orchestrations found';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { ChildrenResponse } from '$lib/api/types';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { isRouterClick } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    response: ChildrenResponse;
  }

  let { response }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /**
   * `complete` or `partial`: Azure Storage finds children by the ids the runtime generates for them,
   * which is a guess about a naming convention, so a hub whose children were started with ids of
   * their own has children this list cannot see. Saying which is the difference between "none" and
   * "none that I could find".
   */
  const found = $derived(response.complete ? 'complete' : 'partial');

  function href(instanceId: string): string {
    return app.router.href({ name: 'instance', hub: app.hub, instanceId });
  }

  function go(instanceId: string, event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId });
  }
</script>

<!--
  ScreenInstance.dc.html L74-L76: the sub-orchestrations this instance started, above the Execution
  rows and inside the same panel - which is why this is not a `.panel` of its own.
-->
<div class="panel-h" id={CHILDREN_PANEL_ID}>
  <h3>Children</h3>
  <span class="fine muted" style="margin-left:auto">/children · {found}</span>
</div>

{#each response.children as child (child.instanceId)}
  <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
    <!--
      The name is what is read; the id is where the link goes, and what its tooltip says. It
      truncates: a long orchestrator name used to run past the panel and push the status chip out
      with it, and the tooltip already carries the whole of the id it links to.
    -->
    <LinkButton
      mono
      class="trunc-name"
      href={href(child.instanceId)}
      title={`${child.name} · ${child.instanceId}`}
      onclick={(event) => go(child.instanceId, event)}
    >
      {child.name}
    </LinkButton>

    <StatusChip status={child.runtimeStatus} size="sm" />
  </div>
{:else}
  <span class="meta">{NO_CHILDREN}</span>
{/each}
