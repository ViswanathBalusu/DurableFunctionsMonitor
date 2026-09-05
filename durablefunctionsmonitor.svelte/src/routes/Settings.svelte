<script lang="ts">
  import { getContext } from 'svelte';
  import Page from '$lib/components/Page.svelte';
  import PageTitle from '$lib/components/PageTitle.svelte';
  import ConnectionPanel from '$lib/settings/ConnectionPanel.svelte';
  import { APP_CONTEXT_KEY, type AppState } from '$lib/state/app.svelte';

  const app = getContext<AppState>(APP_CONTEXT_KEY);

  /** The hub is known from the route before `/about` answers; the account only from `/about`. */
  const subtitle = $derived([app.about?.hubName || app.hub, app.about?.accountName].filter(Boolean).join(' · '));
</script>

<!-- ScreenSettings.dc.html L16-L92, minus the "Mockup states" panel, which is not part of the product. -->
<Page data-screen-label="Settings">
  <PageTitle title="Settings">
    <span class="meta">{subtitle}</span>
  </PageTitle>

  <div class="two">
    <ConnectionPanel />
    <!-- Hub administration: E6-S2-T1 -->
  </div>

  <div class="two wide-left">
    <!-- Appearance: E6-S3-T1 -->
    <div class="stack" style="gap:16px">
      <!-- Feature flags: E6-S4-T1 · Templates: E6-S4-T2 -->
    </div>
  </div>
</Page>
