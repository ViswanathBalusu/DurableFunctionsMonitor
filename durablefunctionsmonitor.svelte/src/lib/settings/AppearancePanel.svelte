<script lang="ts" module>
  /** The three modes the webview offers, where "system" means the editor's own theme. */
  export const VSCODE_MODE_OPTIONS: SegmentedOption<ModePreference>[] = [
    { value: 'system', label: 'Follow VS Code' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  export const SHOW_TIME_OPTIONS: SegmentedOption<ShowTimeAs>[] = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Local', label: 'Local' },
  ];

  export const THRESHOLDS_SAVED = 'Saved thresholds for Needs attention';
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import Segmented, { type SegmentedOption } from '$lib/components/Segmented.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import type { ThemeName } from '$lib/host.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import type { ModePreference, ShowTimeAs } from '$lib/state/prefs.svelte';
  import { THEMES } from '$lib/themes';
  import { cn } from '$lib/utils';
  import { formatCount, formatDuration, parseCount, parseDuration } from './thresholds';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  const prefs = app.prefs;

  const inVsCode = $derived(app.host.kind === 'vscode');

  // What is on screen now, which is not the same as what was asked for: 'system' resolves to one of
  // the two, and the switch can only show one of the two.
  const dark = $derived(prefs.resolvedMode === 'dark');

  // The fields start from the saved thresholds and are only written back by Save, so a half-typed
  // value never becomes the threshold the Overview highlights with.
  let stuck = $state(formatDuration(prefs.thresholds.stuckMinutes));
  let pending = $state(formatDuration(prefs.thresholds.pendingMinutes));
  let queue = $state(formatCount(prefs.thresholds.queueDepth));

  const stuckMinutes = $derived(parseDuration(stuck));
  const pendingMinutes = $derived(parseDuration(pending));
  const queueDepth = $derived(parseCount(queue));

  const thresholdsValid = $derived(stuckMinutes !== null && pendingMinutes !== null && queueDepth !== null);

  function pick(theme: ThemeName): void {
    prefs.setTheme(theme);
  }

  function save(): void {
    if (!thresholdsValid) {
      return;
    }

    prefs.setThresholds({
      stuckMinutes: stuckMinutes as number,
      pendingMinutes: pendingMinutes as number,
      queueDepth: queueDepth as number,
    });

    // Written back formatted, so `120` becomes the `2 h` it now means
    stuck = formatDuration(stuckMinutes as number);
    pending = formatDuration(pendingMinutes as number);
    queue = formatCount(queueDepth as number);

    app.toast.ok(THRESHOLDS_SAVED);
  }
</script>

<!-- ScreenSettings.dc.html L41-L60. Everything here applies instantly and is stored per user. -->
<Panel title="Appearance">
  {#snippet meta()}
    <span class="fine muted">dfm.theme · dfm.mode · dfm.density</span>
  {/snippet}

  <div class="meta" style="margin-bottom:6px">Theme</div>

  <div
    style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px"
    role="radiogroup"
    aria-label="Theme"
  >
    {#each THEMES as entry (entry.key)}
      <button
        type="button"
        class={cn('ttile', entry.key === prefs.theme ? 'active' : '')}
        style="border-color:var(--ink);height:48px"
        role="radio"
        aria-checked={entry.key === prefs.theme}
        onclick={() => pick(entry.key)}
      >
        <span class="sw" aria-hidden="true">
          <i style={`background:${entry.paper}`}></i>
          <i style={`background:${entry.ink}`}></i>
          <i style={`background:${entry.primary}`}></i>
          <i style={`background:${entry.dark}`}></i>
        </span>
        <span>{entry.label}</span>
        <span class="meta" style="margin-left:auto;font-weight:400">{entry.metrics}</span>
      </button>
    {/each}
  </div>

  <div class="stack" style="margin-top:16px;gap:8px">
    {#if inVsCode}
      <!-- The webview has a third honest answer: whatever the editor is doing (contracts §3). -->
      <div class="row" style="justify-content:space-between;min-height:36px">
        <span>Dark mode</span>
        <Segmented
          options={VSCODE_MODE_OPTIONS}
          value={prefs.mode}
          ariaLabel="Dark mode"
          size="sm"
          onchange={(mode) => prefs.setMode(mode)}
        />
      </div>
    {:else}
      <Switch
        label="Dark mode"
        hint="paper becomes the line; shadows change color per theme"
        checked={dark}
        onchange={(next) => prefs.setMode(next ? 'dark' : 'light')}
      />
    {/if}

    <Switch
      label="Comfortable density"
      hint="rows 44 px, controls 40 px"
      checked={prefs.density === 'comfortable'}
      onchange={(next) => prefs.setDensity(next ? 'comfortable' : 'compact')}
    />

    <div class="row" style="justify-content:space-between;min-height:36px">
      <span>Show time as</span>
      <Segmented
        options={SHOW_TIME_OPTIONS}
        value={prefs.showTimeAs}
        ariaLabel="Show time as"
        size="sm"
        onchange={(value) => prefs.setShowTimeAs(value)}
      />
    </div>
  </div>

  <div class="meta" style="margin:16px 0 6px">Needs attention thresholds</div>

  <div class="row">
    <Field label="Running longer than" for="dfm-threshold-stuck">
      <TextInput
        id="dfm-threshold-stuck"
        mono
        style="width:120px"
        bind:value={stuck}
        aria-invalid={stuckMinutes === null}
      />
    </Field>

    <Field label="Pending older than" for="dfm-threshold-pending">
      <TextInput
        id="dfm-threshold-pending"
        mono
        style="width:120px"
        bind:value={pending}
        aria-invalid={pendingMinutes === null}
      />
    </Field>

    <Field label="Queue deeper than" for="dfm-threshold-queue">
      <TextInput
        id="dfm-threshold-queue"
        mono
        style="width:120px"
        bind:value={queue}
        aria-invalid={queueDepth === null}
      />
    </Field>

    <Button style="align-self:flex-end" disabled={!thresholdsValid} onclick={save}>Save</Button>
  </div>
</Panel>
