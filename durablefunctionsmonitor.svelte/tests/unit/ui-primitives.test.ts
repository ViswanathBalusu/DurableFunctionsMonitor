/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import UiPrimitives from './UiPrimitives.svelte';

/**
 * The restyled shadcn-svelte primitives (E1-S1-T2). Two things are checked, both of which break
 * silently otherwise: that each primitive renders with its dfm-ui.css class, and that no Tailwind
 * utility class has come back (regenerating a component with the CLI overwrites the restyling).
 */

const UI_DIR = 'src/lib/components/ui';

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? svelteFiles(path) : path.endsWith('.svelte') ? [path] : [];
  });
}

describe('no Tailwind utilities survive in the generated primitives', () => {
  // The shapes the generator reaches for: rounded corners, shadows, rings, colour utilities, spacing.
  const forbidden = [
    'rounded-',
    'shadow-',
    'bg-white',
    'bg-popover',
    'bg-muted',
    'ring-',
    'text-muted-foreground',
    'p-4',
    'px-2',
    'gap-4',
    'size-4',
  ];

  for (const file of svelteFiles(UI_DIR)) {
    it(`${file.replace(/\\/g, '/')} uses DFM classes only`, () => {
      const source = readFileSync(file, 'utf8');

      for (const utility of forbidden) {
        expect(source, `${file} still contains the Tailwind utility "${utility}"`).not.toContain(utility);
      }
    });
  }

  it('does not depend on tailwind-variants any more', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect({ ...pkg.dependencies, ...pkg.devDependencies }['tailwind-variants']).toBeUndefined();
  });
});

describe('the primitives render with their dfm-ui.css classes', () => {
  it('dialog: an overlay and a .dialog with a .body and a .foot', async () => {
    render(UiPrimitives, { props: { which: 'dialog' } });

    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());

    expect(document.querySelector('.overlay')).not.toBeNull();
    expect(document.querySelector('.dialog .body')).not.toBeNull();
    expect(document.querySelector('.dialog .foot')).not.toBeNull();

    // No floating close button was generated back in
    expect(document.querySelector('.dialog button[data-slot="dialog-close"]')).toBeNull();
  });

  it('dropdown menu: a .pop of .mi items with a .sep', async () => {
    render(UiPrimitives, { props: { which: 'menu' } });

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());

    expect(document.querySelectorAll('.pop .mi').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.pop .sep')).not.toBeNull();
    expect(document.querySelector('.mi.destructive')).not.toBeNull();
  });

  it('popover: a .pop', async () => {
    render(UiPrimitives, { props: { which: 'popover' } });

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
  });

  it('select: an .input trigger and a .pop of .mi options', async () => {
    render(UiPrimitives, { props: { which: 'select' } });

    expect(document.querySelector('.sel > .input')).not.toBeNull();

    await waitFor(() => expect(document.querySelector('.pop')).not.toBeNull());
    expect(document.querySelectorAll('.pop .mi').length).toBe(2);
  });

  it('command palette: .palette > input + .plist with .prow rows and a .kbd', async () => {
    render(UiPrimitives, { props: { which: 'command' } });

    await waitFor(() => expect(document.querySelector('.palette')).not.toBeNull());

    expect(document.querySelector('.palette > input')).not.toBeNull();
    expect(document.querySelector('.plist')).not.toBeNull();
    expect(document.querySelectorAll('.prow').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.kbd')).not.toBeNull();
  });

  it('checkbox: .box, and .box.on once checked', async () => {
    render(UiPrimitives, { props: { which: 'checkbox' } });

    const box = document.querySelector('.box');
    expect(box).not.toBeNull();
    expect(box?.classList.contains('on')).toBe(false);

    (box as HTMLElement).click();

    await waitFor(() => expect(document.querySelector('.box')?.classList.contains('on')).toBe(true));
  });

  it('switch: .switch, and .switch.on once on', async () => {
    render(UiPrimitives, { props: { which: 'switch' } });

    const toggle = document.querySelector('.switch');
    expect(toggle).not.toBeNull();
    expect(toggle?.classList.contains('on')).toBe(false);

    (toggle as HTMLElement).click();

    await waitFor(() => expect(document.querySelector('.switch')?.classList.contains('on')).toBe(true));
  });

  it('tabs: a .tabs list of .tab triggers, the selected one marked with aria-selected', () => {
    render(UiPrimitives, { props: { which: 'tabs' } });

    expect(document.querySelector('.tabs')).not.toBeNull();
    expect(document.querySelectorAll('.tab').length).toBe(2);
    expect(document.querySelector('.tab[aria-selected="true"]')?.textContent?.trim()).toBe('History');
  });

  it('sheet: .peek on the right and .sheet at the bottom', async () => {
    const peek = render(UiPrimitives, { props: { which: 'peek' } });
    await waitFor(() => expect(document.querySelector('.peek')).not.toBeNull());
    peek.unmount();

    render(UiPrimitives, { props: { which: 'sheet' } });
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());
  });

  it('table: a .tbl-wrap around a .tbl, and the spine cell the caller writes', () => {
    render(UiPrimitives, { props: { which: 'table' } });

    expect(document.querySelector('.tbl-wrap > .tbl')).not.toBeNull();
    expect(document.querySelector('.tbl td.spine')).not.toBeNull();
    expect(screen.getByText('order-1')).toBeInTheDocument();
  });

  it('tooltip: a .pop with the meta text size', async () => {
    render(UiPrimitives, { props: { which: 'tooltip' } });

    await waitFor(() => expect(document.querySelector('.pop.meta')).not.toBeNull());
  });
});
