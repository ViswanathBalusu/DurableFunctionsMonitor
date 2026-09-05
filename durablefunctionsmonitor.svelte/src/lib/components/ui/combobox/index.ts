// The bits-ui Combobox, re-exported so the rest of the app keeps importing from `ui/` only.
// Its parts take the DFM classes from the component that composes them (Combobox.svelte).
import { Combobox as ComboboxPrimitive } from 'bits-ui';

const Root = ComboboxPrimitive.Root;
const Input = ComboboxPrimitive.Input;
const Content = ComboboxPrimitive.Content;
const Item = ComboboxPrimitive.Item;
const Portal = ComboboxPrimitive.Portal;

export {
  Root,
  Input,
  Content,
  Item,
  Portal,
  //
  Root as Combobox,
  Input as ComboboxInput,
  Content as ComboboxContent,
  Item as ComboboxItem,
};
