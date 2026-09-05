<script lang="ts" module>
  /** Why `Restart in place` is off, in the words of the flag that turns it on (L130). */
  export const DANGER_OFF_TITLE =
    'Dangerous operations are disabled for this deployment (DFM_DANGEROUS_OPERATIONS_ENABLED)';

  /** ...and what it does when it is on. */
  export const DANGER_TITLE = 'Purge and restart with the initial input';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import type { FailureInstance } from '$lib/api/types';
  import Button from '$lib/components/Button.svelte';
  import LinkButton from '$lib/components/LinkButton.svelte';
  import { fmtDuration } from '$lib/format/duration';
  import { fmtTime } from '$lib/format/time';
  import { isRouterClick } from '$lib/router.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  interface Props {
    instance: FailureInstance;
    /** The orchestrator every instance of this group ran, which the row itself does not carry. */
    name: string;
    onRewind: (instanceId: string) => void;
    onPurge: (instanceId: string) => void;
  }

  let { instance, name, onRewind, onPurge }: Props = $props();

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const dangerDisabled = $derived(app.readOnly || !app.dangerous);

  const href = $derived(app.router.href({ name: 'instance', hub: app.hub, instanceId: instance.instanceId }));

  /**
   * The end of the run. `/failures` reports `completedTime` only when the provider wrote one, but it
   * always reports the duration it measured from the same clock (B3 falls back to `LastUpdatedTime`),
   * so the arithmetic is the backend's answer rather than a guess of this screen's.
   */
  const updated = $derived.by(() => {
    if (instance.completedTime) {
      return instance.completedTime;
    }

    if (instance.durationMs === null) {
      return instance.createdTime;
    }

    return new Date(new Date(instance.createdTime).getTime() + instance.durationMs).toISOString();
  });

  function open(event: MouseEvent): void {
    if (!isRouterClick(event)) {
      return;
    }

    event.preventDefault();
    go();
  }

  function go(query?: Record<string, string>): void {
    app.router.navigate({ name: 'instance', hub: app.hub, instanceId: instance.instanceId }, query ? { query } : {});
  }

  /**
   * The reason opens the row in the peek panel. Everything in it is what `/failures` said - the
   * status is what the endpoint is: these are the instances that failed. What the mockup shows as a
   * made-up `customStatus` is not here, because `/failures` does not report one (contracts §9).
   */
  function peek(): void {
    app.peek.open({
      id: instance.instanceId,
      name,
      kind: 'Orchestration',
      status: 'Failed',
      created: instance.createdTime,
      updated,
      duration: instance.durationMs,
    });
  }
</script>

<!-- ScreenFailures.dc.html L38-L50: spine, id, created, duration, reason, and the four actions. -->
<div class="frow">
  <span class="spine" aria-hidden="true"></span>

  <LinkButton mono {href} style="text-align:left;padding:8px 0" onclick={open}>
    {instance.instanceId}
  </LinkButton>

  <span class="mono t">{fmtTime(instance.createdTime, app.prefs.showTimeAs)}</span>
  <span class="mono d">{fmtDuration(instance.durationMs)}</span>

  <!-- One line of it, whatever its length; the whole message is the tooltip and the workspace -->
  <LinkButton
    mono
    muted
    class="reason"
    style="text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none"
    title={instance.reason}
    onclick={peek}
  >
    {instance.reason}
  </LinkButton>

  <span class="acts">
    <Button size="sm" disabled={app.readOnly} onclick={() => onRewind(instance.instanceId)}>Rewind</Button>

    <!-- Both of these open the instance: the payload has to be in front of the user to change it -->
    <Button size="sm" disabled={app.readOnly} onclick={() => go({ tab: 'inputs' })}>Update input</Button>

    <Button
      size="sm"
      variant="danger"
      disabled={dangerDisabled}
      title={app.dangerous ? DANGER_TITLE : DANGER_OFF_TITLE}
      onclick={() => go({ tab: 'inputs' })}
    >
      Restart in place
    </Button>

    <Button size="sm" variant="destructive" disabled={app.readOnly} onclick={() => onPurge(instance.instanceId)}>
      Purge
    </Button>
  </span>
</div>
