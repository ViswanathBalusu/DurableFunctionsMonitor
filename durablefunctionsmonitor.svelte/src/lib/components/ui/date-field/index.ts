// The bits-ui DateField, re-exported so the rest of the app keeps importing from `ui/` only.
// It needs no restyling of its own: the DFM classes go on the elements DateTimeField renders.
import { DateField as DateFieldPrimitive } from 'bits-ui';

const Root = DateFieldPrimitive.Root;
const Input = DateFieldPrimitive.Input;
const Segment = DateFieldPrimitive.Segment;
const Label = DateFieldPrimitive.Label;

export {
  Root,
  Input,
  Segment,
  Label,
  //
  Root as DateField,
  Input as DateFieldInput,
  Segment as DateFieldSegment,
  Label as DateFieldLabel,
};
