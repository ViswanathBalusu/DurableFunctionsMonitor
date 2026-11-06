<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Select from '$lib/components/Select.svelte';
  import TextInput from '$lib/components/TextInput.svelte';
  import { FILTER_OPERATORS, FILTER_OPERATOR_LABELS, type FilterOperator } from '$lib/filters/odata';
  import { FILTER_COLUMNS, type Instances } from '$lib/state/instances.svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Icon from '$lib/components/icons/Icon.svelte';

  interface Props {
    instances: Instances;
  }

  let { instances }: Props = $props();

  const columnOptions = FILTER_COLUMNS.map((column) => ({ value: column, label: column }));
  const operatorOptions = FILTER_OPERATORS.map((op) => ({ value: op, label: FILTER_OPERATOR_LABELS[op] }));

  function apply(): void {
    instances.applyFilter(instances.column, instances.op, instances.value);
  }

  /**
   * Changing the column or the operator while a value is in force re-applies at once (React parity):
   * the chip would otherwise say one thing and the list show another.
   */
  function setColumn(column: string): void {
    instances.column = column;

    if (instances.applied) {
      apply();
    }
  }

  function setOperator(op: FilterOperator): void {
    instances.op = op;

    if (instances.applied) {
      apply();
    }
  }
</script>

<!-- ScreenInstances.dc.html L54-L62. -->
<div class="row" style="align-items:flex-end">
  <Field label="Filtered column">
    <Select
      options={columnOptions}
      value={instances.column}
      ariaLabel="Filtered column"
      width="180px"
      onchange={setColumn}
    />
  </Field>

  <Field label="Filter operator">
    <Select
      options={operatorOptions}
      value={instances.op}
      ariaLabel="Filter operator"
      width="160px"
      onchange={(op) => setOperator(op as FilterOperator)}
    />
  </Field>

  <Field label="Filter value" class="grow" style="max-width:280px">
    <TextInput bind:value={instances.value} mono placeholder="order-2026-" aria-label="Filter value" onEnter={apply} />
  </Field>

  <Button onclick={apply}>Apply</Button>
  <!-- Not filled: on this screen the one filled button is Start new instance -->
  <Button onclick={() => void instances.reload()}><Icon icon={RefreshCw} size={16} />Refresh</Button>
  <!-- The mockup ends this row with "Density and columns in the table menu" (L61), but the screen has
       no table menu: density is in the theme menu and Settings, and hidden columns come back through
       the table's own "show all". A hint pointing at nothing was dropped in the studio revamp. -->
</div>
