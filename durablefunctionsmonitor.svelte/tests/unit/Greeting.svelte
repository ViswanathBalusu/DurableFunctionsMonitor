<!--
  Throwaway component for E3-S1-T1's named test only (docs/plans/svelte-rewrite/E3-test-harness.md).
  It proves @testing-library/svelte's render() can mount a real Svelte 5 component under
  Vitest/jsdom - it is not part of the app, so it lives under tests/unit/, not src/.
-->
<script lang="ts">
  interface Props {
    name: string;
  }
  let { name }: Props = $props();
</script>

<p>Hello, {name}!</p>
