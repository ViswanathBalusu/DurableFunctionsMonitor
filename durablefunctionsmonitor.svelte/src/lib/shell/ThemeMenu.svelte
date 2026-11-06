<script lang="ts">
  import { getContext } from 'svelte';
  import MenuItem from '$lib/components/MenuItem.svelte';
  import Pop from '$lib/components/Pop.svelte';
  import Switch from '$lib/components/Switch.svelte';
  import type { ThemeName } from '$lib/host.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';
  import { THEMES, theme } from '$lib/themes';
  import { cn } from '$lib/utils';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  let open = $state(false);

  const current = $derived(theme(app.prefs.theme));
  const dark = $derived(app.prefs.resolvedMode === 'dark');
  const inVsCode = $derived(app.host.kind === 'vscode');

  function pick(key: ThemeName): void {
    app.prefs.setTheme(key);
  }
</script>

<!-- DFM App.dc.html L74-L86. Everything here applies instantly: no transition, by design (§6). -->
<div class="hide-m">
  <Pop bind:open align="end" ariaLabel="Theme" minWidth="270px" padding="8px">
    <!-- The theme's swatch, with its name in the tooltip and the accessible name: spelled out, it pushed
         the top bar onto a second row (TopBar.svelte). A family may paint the swatch (`--swatch`). -->
    {#snippet anchor({ props })}
      <button
        class="btn tb-theme"
        type="button"
        aria-label={`Theme: ${current.label} · ${dark ? 'Dark' : 'Light'}`}
        title={`Theme: ${current.label} · ${dark ? 'Dark' : 'Light'}`}
        {...props}
      >
        <span class="swq" style="background:var(--swatch, var(--primary))" aria-hidden="true"></span>
      </button>
    {/snippet}

    <div class="meta" style="padding:4px 10px 6px">Theme · data-theme</div>

    {#each THEMES as entry (entry.key)}
      <button
        class={cn('ttile', entry.key === app.prefs.theme ? 'active' : '')}
        type="button"
        role="menuitemradio"
        aria-checked={entry.key === app.prefs.theme}
        onclick={() => pick(entry.key)}
      >
        <span class="sw" aria-hidden="true">
          <i style={`background:${entry.paper}`}></i>
          <i style={`background:${entry.ink}`}></i>
          <i style={`background:${entry.primary}`}></i>
        </span>
        {entry.label}
        <span class="grow"></span>
        <!-- ...and on the picked one it inherits that tile's foreground instead (E12-S3-T2) -->
        <span class="meta" style={entry.key === app.prefs.theme ? 'color:inherit' : undefined}>{entry.idea}</span>
      </button>
    {/each}

    <div class="sep"></div>
    <div class="meta" style="padding:4px 10px 6px">Mode · .dark</div>

    {#if inVsCode}
      <!-- Inside the webview the honest third option is "whatever the editor is doing" (contracts §3). -->
      <MenuItem role="menuitemradio" checked={app.prefs.mode === 'system'} onclick={() => app.prefs.setMode('system')}>
        Follow VS Code
      </MenuItem>
      <MenuItem role="menuitemradio" checked={app.prefs.mode === 'light'} onclick={() => app.prefs.setMode('light')}>
        Light
      </MenuItem>
      <MenuItem role="menuitemradio" checked={app.prefs.mode === 'dark'} onclick={() => app.prefs.setMode('dark')}>
        Dark
      </MenuItem>
    {:else}
      <Switch
        label="Dark mode"
        checked={dark}
        onchange={(next) => app.prefs.setMode(next ? 'dark' : 'light')}
        style="width:100%;justify-content:space-between;height:36px;padding:0 10px"
      />
    {/if}

    <Switch
      label="Comfortable density"
      checked={app.prefs.density === 'comfortable'}
      onchange={(next) => app.prefs.setDensity(next ? 'comfortable' : 'compact')}
      style="width:100%;justify-content:space-between;height:36px;padding:0 10px"
    />
  </Pop>
</div>
