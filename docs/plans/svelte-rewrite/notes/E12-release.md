# E12 · release notes and manual checks

What was checked by hand, and what a machine checked for us. One section per task; a line that says
**pending** is a check nobody has run yet, not one that failed.

## E12-S3-T1 · Self-hosted fonts (2026-09-05)

`@fontsource-variable/archivo@5.3.0` and `@fontsource-variable/jetbrains-mono@5.3.0`, imported from
`src/app.css` (`wdth.css` for Archivo, because the display and condensed utilities set the `wdth`
axis themselves; `index.css` for JetBrains Mono, which has only `wght`). The Google Fonts links are
gone from `index.html`.

Nothing in the frozen stylesheets had to change: `--font-sans` and `--font-mono` already name
`"Archivo Variable"` and `"JetBrains Mono Variable"` as their second family (dfm-tokens.css
L934-L935), which is exactly what fontsource calls the variable faces.

- **Build** — eight `.woff2` in `static/media/`, `name.<hex>.woff2`, 295 kB in total (Archivo latin,
  latin-ext and vietnamese; JetBrains Mono latin, latin-ext, cyrillic, cyrillic-ext, greek,
  vietnamese). The CSS references them as `../media/…`, which is what the VS Code webview needs.
- **Verify script** — two new rules: `index.html` may not link to another host at all (it used to be
  allowed to, for the font host), and every `url()` in the CSS must resolve to a file that is in the
  build. It also asserts that at least one woff2 is there, so a future build that quietly loses the
  fonts fails instead of falling back.
- **Browser host** — checked against the standalone host on the built statics: no request leaves the
  origin (`performance.getEntriesByType('resource')` has nothing off-origin), `Archivo Variable` and
  `JetBrains Mono Variable` load from `/static/media/`, and the machine's own Archivo - which this
  box happens to have installed - is what `--font-sans` picks first, as the token file intends.
- **VS Code webview** — **pending**: it needs an interactive extension host (the same thing that
  blocks E0-S5-T2). What can be said without one: the webview only rewrites `href`/`src` in
  `index.html`, and the fonts are reached from the CSS by relative url, so they resolve next to the
  stylesheet's own `vscode-webview-resource:` URI. The build contract now enforces exactly that.
