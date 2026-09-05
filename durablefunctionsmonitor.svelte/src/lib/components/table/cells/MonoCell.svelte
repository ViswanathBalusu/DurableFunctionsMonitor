<script lang="ts">
  interface Props {
    value: string | number | null | undefined;
  }

  let { value }: Props = $props();
</script>

<!-- The em dash is the app's "nothing here", never an empty cell that reads as a bug. -->
{value === null || value === undefined || value === '' ? '—' : value}
