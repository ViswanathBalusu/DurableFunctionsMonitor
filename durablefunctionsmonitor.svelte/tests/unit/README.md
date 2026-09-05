# Unit and component tests

This is the Vitest layer of the three test levels in `docs/plans/svelte-rewrite/E3-test-harness.md`
(unit/component here, Playwright end-to-end under `tests/e2e/`, CI wires both together).

Run with `npm test` (one-shot, `vitest run --coverage`) or `npm run test:watch` (interactive,
no coverage instrumentation, reruns on save).

## Where tests live

- **Pure logic** (`src/lib/format`, `src/lib/filters`, `src/lib/api`, `src/lib/router.svelte.ts`,
  model builders) gets a `*.test.ts` next to the module it tests, e.g. `src/lib/format/json.ts` /
  `src/lib/format/json.test.ts`. Test these exhaustively - they carry the only enforced coverage
  thresholds (`vite.config.ts` `test.coverage.thresholds`, currently `lines: 70` for those four
  paths; no threshold elsewhere yet).
- **Components** (`.svelte` files under `src/lib/**`) get a `*.test.ts` next to the component.
  Cover the render plus the one interaction the component owns; do not try to re-test the whole
  screen here (that is what `tests/e2e/` is for).
- **Fixtures for tests only** (fake DTOs, a fake app context, throwaway components used to prove
  test infrastructure) live under this folder (`tests/unit/`), never under `src/`, so they never
  ship in the production bundle.

## Writing a component test

Use `render`/`screen`/`fireEvent` from `@testing-library/svelte` (already wired: `vite.config.ts`
adds `svelteTesting()` from `@testing-library/svelte/vite` to Vite's plugin list, which - only
while `VITEST` is set - puts `browser` ahead of `node` in `resolve.conditions` so Vite resolves the
`svelte` package to its browser build under Vitest instead of its SSR build, and registers DOM
auto-cleanup after every test).

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import MyComponent from './MyComponent.svelte';

it('renders and responds to a click', async () => {
  render(MyComponent, { props: { title: 'Instances' } });

  expect(screen.getByText('Instances')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  // assert the effect of the click
});
```

`render-smoke.test.ts` in this folder is the proof that this pipeline actually mounts a Svelte 5
component in jsdom (its own subject, `Greeting.svelte`, is a throwaway used only by that test).

## Faking the app context

Most components read `getContext<AppState>('dfm')` (see the `dfm-svelte-ui` skill). Pass a fake
through `render`'s `context` option:

```ts
render(MyComponent, {
  context: new Map([['dfm', app]]),
  props: { ... },
});
```

`tests/unit/fake-app.ts` (added by whichever task first needs it) exports
`createFakeApp(overrides)`: a minimal `AppState` stand-in whose `endpoints` object records every
call it receives (so a test can assert which endpoint was hit with which query) and whose router
runs in memory mode (no real `history`/`location`, just an in-memory current route + `navigate`
recorder) so components that call `app.router.navigate(...)` or read `app.router.current` can be
tested without a browser. Pass `overrides` to replace individual endpoints, prefs or capabilities
for a single test; anything not overridden falls back to a reasonable default.

## Setup (`setup.ts`)

Loaded once per test file via `vite.config.ts`'s `test.setupFiles`. It:

- Loads `@testing-library/jest-dom/vitest` matchers (`toBeInTheDocument()`, etc.).
- Polyfills `window.matchMedia`, `ResizeObserver`, `IntersectionObserver`, `window.scrollTo` and
  `navigator.clipboard`, none of which jsdom implements.
- Pins `process.env.TZ = 'Etc/GMT-2'` (UTC+2; POSIX `Etc/GMT` signs are inverted from common usage)
  so date/time formatting tests (`fmtDateTime`, `fmtAgo`, `fmtDurationClock`, ...) are deterministic
  regardless of the machine or CI runner's local timezone, and deliberately not UTC or a real-world
  DST zone so a test that assumes either fails loudly.
- Exports `resetGlobals()`, which deletes the seven globals `index.html` injects (contracts §2/§3:
  `DfmRoutePrefix`, `DfmApiRoutePrefix`, `DfmClientConfig`, `DfmViewMode`,
  `IsFunctionGraphAvailable`, `OrchestrationIdFromVsCode`, `StateFromVsCode`) and runs it in an
  `afterEach`, so a test that sets one of them to simulate a host (see `src/lib/host.test.ts`)
  never leaks it into the next test.

## Coverage

`npm test` passes `--coverage` (provider `v8`, reporters `text` + `html`, report written to
`coverage/`). Thresholds are enforced only for `src/lib/format`, `src/lib/filters`, `src/lib/api`
and `src/lib/router.svelte.ts` (`lines: 70`) - the pure-logic layer. Everything else is reported
but not gated yet. `npm run test:watch` does not pass `--coverage`, so the interactive loop stays
fast.
