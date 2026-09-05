// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Endpoints } from '$lib/api/endpoints';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../../tests/unit/harnesses/ScreenHarness.svelte';
import Instance from '../../routes/Instance.svelte';
import { details as detailsFixture } from '../../../tests/unit/fixtures/details';

const INSTANCE_ID = 'order-2026-09-04-000913';

const MARKUP =
  '<dl class="kv"><dt>Order</dt><dd class="mono">A-1043</dd><dt>Customer</dt><dd class="mono">88214</dd></dl>';

function mount(
  options: {
    markup?: string | (() => string);
    fail?: boolean;
    onLoad?: (template: string) => void;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Instance,
      path: `/DurableFunctionsHub/instances/${INSTANCE_ID}?tab=${encodeURIComponent('custom:Order summary')}`,
      endpoints: {
        getOrchestration: async () => detailsFixture(),
        getHistory: async () => ({ history: [] }),
        customTabMarkup: async (_id: string, template: string) => {
          options.onLoad?.(template);

          if (options.fail) {
            throw new Error('404 Not Found');
          }

          const markup = options.markup ?? MARKUP;

          return typeof markup === 'function' ? markup() : markup;
        },
      } as unknown as Endpoints,
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function panel(): HTMLElement {
  return document.querySelector('.tabbody .panel') as HTMLElement;
}

beforeEach(() => {
  window.history.replaceState({}, '', `/DurableFunctionsHub/instances/${INSTANCE_ID}`);
});

describe('LiquidTab', () => {
  it('renders the markup the backend produced, inside a panel named after the template', async () => {
    const templates: string[] = [];
    mount({ onLoad: (template) => templates.push(template) });

    await waitFor(() => expect(panel()).not.toBeNull());
    await waitFor(() => expect(panel().querySelector('dl.kv')).not.toBeNull());

    expect(templates).toEqual(['Order summary']);
    expect(screen.getByRole('heading', { name: 'Order summary', level: 3 })).toBeInTheDocument();
    expect(panel().textContent).toContain("Liquid template · custom-tab-markup('Order summary')");

    // The markup is the content: a definition list stays a definition list
    expect(panel().querySelectorAll('dd')).toHaveLength(2);
    expect(panel().textContent).toContain('A-1043');
  });

  it('says it could not load the tab, and offers to try again', async () => {
    const { app } = mount({ fail: true });

    await waitFor(() => expect(app.toast.current?.message).toBe('Failed to load tab. 404 Not Found'));
    expect(app.toast.current?.retry).toBeTypeOf('function');
  });

  it('reloads with the workspace', async () => {
    let loads = 0;
    const { app } = mount({ markup: () => `<p>load ${++loads}</p>` });

    await waitFor(() => expect(panel().textContent).toContain('load 1'));

    app.refresh();

    await waitFor(() => expect(panel().textContent).toContain('load 2'));
  });

  it('loads the tab that was switched to', async () => {
    const templates: string[] = [];
    mount({ onLoad: (template) => templates.push(template) });

    await waitFor(() => expect(templates).toEqual(['Order summary']));

    // Away and back: the tab loads again rather than showing what the last one left behind
    await fireEvent.click(screen.getByRole('tab', { name: 'Raw' }));
    await waitFor(() => expect(document.querySelector('.tabbody .panel')).toBeNull());

    await fireEvent.click(screen.getByRole('tab', { name: 'Order summary' }));

    await waitFor(() => expect(templates).toEqual(['Order summary', 'Order summary']));
  });
});
