// The bits-ui RangeCalendar, re-exported so the rest of the app keeps importing from `ui/` only.
// The mockups have no calendar, so there is nothing to restyle it to: DateRangeCalendar.svelte puts
// the `.cal*` classes of dfm-ext.css on these elements, and the day's state comes from the data
// attributes bits-ui already sets (`data-selected`, `data-selection-start`, `data-disabled`, …).
import { RangeCalendar as RangeCalendarPrimitive, type DateRange } from 'bits-ui';

const Root = RangeCalendarPrimitive.Root;
const Cell = RangeCalendarPrimitive.Cell;
const Day = RangeCalendarPrimitive.Day;
const Grid = RangeCalendarPrimitive.Grid;
const GridBody = RangeCalendarPrimitive.GridBody;
const GridHead = RangeCalendarPrimitive.GridHead;
const GridRow = RangeCalendarPrimitive.GridRow;
const HeadCell = RangeCalendarPrimitive.HeadCell;
const Header = RangeCalendarPrimitive.Header;
const Heading = RangeCalendarPrimitive.Heading;
const NextButton = RangeCalendarPrimitive.NextButton;
const PrevButton = RangeCalendarPrimitive.PrevButton;

export {
  Root,
  Cell,
  Day,
  Grid,
  GridBody,
  GridHead,
  GridRow,
  HeadCell,
  Header,
  Heading,
  NextButton,
  PrevButton,
  //
  Root as RangeCalendar,
};

/** The two ends of the picked window, either of which is undefined while it is being picked. */
export type { DateRange };
