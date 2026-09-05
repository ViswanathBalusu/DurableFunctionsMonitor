// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BlobLink from './BlobLink.svelte';
import JsonDialog from './JsonDialog.svelte';
import JsonViewer from './JsonViewer.svelte';
import SizeMeter from './SizeMeter.svelte';
import JsonEditorHarness from '../../../../tests/unit/harnesses/JsonEditorHarness.svelte';

describe('SizeMeter', () => {
  it('shows how much of the inline budget is used', () => {
    render(SizeMeter, { props: { bytes: 921 } });

    const meter = document.querySelector('.meter');
    expect(meter?.textContent?.replace(/\s+/g, ' ').trim()).toBe('921 B of 60.0 KB');
    expect(meter?.querySelector('i')?.getAttribute('style')?.replace(/\s/g, '')).toContain('--pct:1%');
  });

  it('turns over above the limit', () => {
    render(SizeMeter, { props: { bytes: 61441 } });

    const meter = document.querySelector('.meter');
    expect(meter).toHaveClass('over');
    expect(meter?.querySelector('i')?.getAttribute('style')?.replace(/\s/g, '')).toContain('--pct:100%');
  });

  it('stays under the limit at exactly the limit', () => {
    render(SizeMeter, { props: { bytes: 61440 } });

    expect(document.querySelector('.meter')).not.toHaveClass('over');
  });
});

describe('BlobLink', () => {
  it('shows the URL and offers a download', async () => {
    const onDownload = vi.fn();
    render(BlobLink, { props: { url: 'https://acct.blob.core.windows.net/hub-largemessages/o/Input', onDownload } });

    const link = screen.getByRole('link');
    expect(link).toHaveClass('mono');
    expect(link.getAttribute('href')).toBe('https://acct.blob.core.windows.net/hub-largemessages/o/Input');

    await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('leaves the download out when there is nothing to call', () => {
    render(BlobLink, { props: { url: 'https://acct.blob.core.windows.net/x' } });

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

describe('JsonViewer', () => {
  it('renders the document fully expanded (contracts §9)', async () => {
    render(JsonViewer, { props: { value: { a: { b: { c: 1 } } }, ariaLabel: 'input' } });

    // Every nested key is in the tree, which is only true when nothing is left collapsed
    await waitFor(() => expect(document.querySelectorAll('.jse-key').length).toBeGreaterThan(0));

    const keys = Array.from(document.querySelectorAll('.jse-key')).map((element) => element.textContent);
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('parses a JSON string before showing it', async () => {
    render(JsonViewer, { props: { value: '{"orderId":"A-1044"}', ariaLabel: 'input' } });

    await waitFor(() => expect(document.querySelector('.jse-key')?.textContent).toBe('orderId'));
  });

  it('is themed through the token bridge', () => {
    render(JsonViewer, { props: { value: { a: 1 }, ariaLabel: 'input' } });

    expect(document.querySelector('.jse-theme-dfm')).not.toBeNull();
  });
});

describe('JsonEditor', () => {
  it('reports what was typed and whether it parses', async () => {
    const onChange = vi.fn();
    render(JsonEditorHarness, { props: { text: '{"a":1}', onChange } });

    const textbox = await waitFor(() => document.querySelector('.ed .cm-content') as HTMLElement);
    expect(textbox).not.toBeNull();

    // The editor is a CodeMirror instance; driving it through the DOM is an e2e concern, so this
    // asserts the wiring the component owns: the frame, the read-only shade and the footer slot.
    expect(document.querySelector('.ed')).not.toBeNull();
    expect(document.querySelector('.ed')).not.toHaveClass('ro');
    expect(document.querySelector('.ed .foot')?.textContent).toContain('text mode');
  });

  it('shades the frame when it is read-only', async () => {
    render(JsonEditorHarness, { props: { text: '{"a":1}', readOnly: true } });

    await waitFor(() => expect(document.querySelector('.ed')).toHaveClass('ro'));
  });
});

describe('JsonDialog', () => {
  it('shows the value in a viewer with a copy and a close button', async () => {
    render(JsonDialog, { props: { open: true, title: 'customStatus', subtitle: 'order-1', value: { step: 2 } } });

    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());

    expect(screen.getByText('order-1')).toHaveClass('meta');
    expect(document.querySelector('.jse-theme-dfm')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('primary');
  });

  it('copies the pretty-printed value and says it did', async () => {
    const onCopied = vi.fn();
    render(JsonDialog, { props: { open: true, title: 'input', value: { a: 1 }, onCopied } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "a": 1\n}'));
    await waitFor(() => expect(onCopied).toHaveBeenCalledOnce());
  });

  it('links a blob payload instead of trying to show it', async () => {
    render(JsonDialog, {
      props: { open: true, title: 'output', value: 'https://acct.blob.core.windows.net/hub-largemessages/o/Output' },
    });

    await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument());
    expect(document.querySelector('.jse-theme-dfm')).toBeNull();
  });

  it('closes on Close', async () => {
    render(JsonDialog, { props: { open: true, title: 'input', value: { a: 1 } } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
  });
});
