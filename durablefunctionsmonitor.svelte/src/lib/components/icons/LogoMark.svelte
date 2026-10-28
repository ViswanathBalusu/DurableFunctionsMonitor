<!--
  The mark of the logo, for the `.logo` box (dfm-ui.css) that the sidebar, the top bar and the login screen draw:
  the bolt in ink, and behind it its echo in the accent colour. The tile around it - the colour, the border, the
  hard shadow - is the box's own, so the mark follows every theme and mode. `public/logo.svg` is the same
  drawing with a tile of its own, for the places that cannot read the theme (the tab, the extension): the
  view box here is the inside of that tile, so the two share their coordinates.
-->
<svg viewBox="8 8 96 96" width="100%" height="100%" aria-hidden="true" focusable="false" style="display:block">
  <polygon
    transform="translate(4 5.5)"
    points="70,14 30,62 49,62 41,94 82,46 64,46"
    style="fill:var(--accent);stroke:var(--ink);stroke-width:3"
  />
  <polygon transform="translate(-3 -1.5)" points="70,14 30,62 49,62 41,94 82,46 64,46" style="fill:var(--ink)" />
</svg>
