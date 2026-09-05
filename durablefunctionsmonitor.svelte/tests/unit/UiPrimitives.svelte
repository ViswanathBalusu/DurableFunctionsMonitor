<script lang="ts">
  // Test-only harness for ui-primitives.test.ts: renders one restyled primitive, already open, so the
  // test can assert the dfm-ui.css class that ended up on each element. Not part of the app.
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';

  let { which }: { which: string } = $props();

  let checked = $state(false);
  let on = $state(false);
</script>

{#if which === 'dialog'}
  <Dialog.Root open>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Terminate 3 instances?</Dialog.Title>
      </Dialog.Header>
      <Dialog.Footer>
        <button class="btn">Cancel</button>
        <button class="btn destructive">Terminate</button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{:else if which === 'alert-dialog'}
  <AlertDialog.Root open>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Delete task hub?</AlertDialog.Title>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action>Delete</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{:else if which === 'menu'}
  <DropdownMenu.Root open>
    <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Item>Suspend</DropdownMenu.Item>
      <DropdownMenu.Item>Resume</DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="destructive">Purge</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else if which === 'popover'}
  <Popover.Root open>
    <Popover.Trigger>Columns</Popover.Trigger>
    <Popover.Content>Column chooser</Popover.Content>
  </Popover.Root>
{:else if which === 'select'}
  <Select.Root type="single" open value="24h">
    <div class="sel">
      <Select.Trigger>Last 24 hours</Select.Trigger>
    </div>
    <Select.Content>
      <Select.Item value="1h" label="Last hour" />
      <Select.Item value="24h" label="Last 24 hours" />
    </Select.Content>
  </Select.Root>
{:else if which === 'command'}
  <Command.Dialog open>
    <Command.Input placeholder="Type a command" />
    <Command.List>
      <Command.Group heading="Go to">
        <Command.Item>
          Instances
          <Command.Shortcut>g i</Command.Shortcut>
        </Command.Item>
      </Command.Group>
    </Command.List>
  </Command.Dialog>
{:else if which === 'checkbox'}
  <label class="check">
    <Checkbox bind:checked />
    Include entities
  </label>
{:else if which === 'switch'}
  <label class="check">
    <Switch bind:checked={on} />
    Auto refresh
  </label>
{:else if which === 'tabs'}
  <Tabs.Root value="history">
    <Tabs.List>
      <Tabs.Trigger value="history">History</Tabs.Trigger>
      <Tabs.Trigger value="raw">Raw</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="history">History rows</Tabs.Content>
  </Tabs.Root>
{:else if which === 'peek'}
  <Sheet.Root open>
    <Sheet.Content side="right">
      <Sheet.Header><Sheet.Title>order-1</Sheet.Title></Sheet.Header>
    </Sheet.Content>
  </Sheet.Root>
{:else if which === 'sheet'}
  <Sheet.Root open>
    <Sheet.Content side="bottom">
      <Sheet.Header><Sheet.Title>More</Sheet.Title></Sheet.Header>
    </Sheet.Content>
  </Sheet.Root>
{:else if which === 'table'}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head class="spine"></Table.Head>
        <Table.Head>Instance</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      <Table.Row>
        <Table.Cell class="spine"></Table.Cell>
        <Table.Cell>order-1</Table.Cell>
      </Table.Row>
    </Table.Body>
  </Table.Root>
{:else if which === 'tooltip'}
  <Tooltip.Provider>
    <Tooltip.Root open delayDuration={0}>
      <Tooltip.Trigger>Partial</Tooltip.Trigger>
      <Tooltip.Content>Scan hit the 50,000 row cap</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
