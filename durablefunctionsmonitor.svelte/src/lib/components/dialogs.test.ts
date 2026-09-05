// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog.svelte';
import IdsPreview from './IdsPreview.svelte';
import ReasonField from './ReasonField.svelte';
import DialogHarness from '../../../tests/unit/harnesses/DialogHarness.svelte';

describe('Dialog', () => {
  it('renders the mockups’ overlay/dialog/body/foot structure', async () => {
    render(DialogHarness, { props: { open: true } });

    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());

    expect(document.querySelector('.overlay')).not.toBeNull();
    expect(document.querySelector('.dialog .body')).not.toBeNull();
    expect(document.querySelector('.dialog .foot')).not.toBeNull();

    const heading = screen.getByText('Terminate 3 instances?');
    expect(heading).toHaveClass('display');
    expect(heading.tagName).toBe('H3');
  });

  it('renders the hazard band only when asked', async () => {
    const plain = render(DialogHarness, { props: { open: true } });
    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());
    expect(document.querySelector('.dialog .warn')).toBeNull();
    plain.unmount();

    render(DialogHarness, { props: { open: true, band: true } });
    await waitFor(() => expect(document.querySelector('.dialog .warn')).not.toBeNull());
  });

  it('takes the width the caller asks for', async () => {
    render(DialogHarness, { props: { open: true, width: 720 } });

    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());

    expect(document.querySelector('.dialog')?.getAttribute('style')?.replace(/\s/g, '')).toContain(
      'width:min(720px,100%)',
    );
  });

  it('closes on Escape', async () => {
    render(DialogHarness, { props: { open: true } });

    await waitFor(() => expect(document.querySelector('.dialog')).not.toBeNull());

    await fireEvent.keyDown(document.querySelector('.dialog') as Element, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
  });

  it('is a modal dialog, so the focus trap and the ARIA come with it', async () => {
    render(DialogHarness, { props: { open: true } });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });
});

describe('ConfirmDialog', () => {
  const base = {
    open: true,
    title: 'Terminate 3 instances?',
    body: 'They stop where they are. This cannot be undone.',
    confirmLabel: 'Terminate',
    confirmVariant: 'destructive' as const,
  };

  it('puts the buttons in the mockups’ order: cancel, secondary, confirm', async () => {
    render(ConfirmDialog, { props: { ...base, secondaryLabel: 'Terminate and replay' } });

    await waitFor(() => expect(document.querySelector('.foot')).not.toBeNull());

    const labels = Array.from(document.querySelectorAll('.foot button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Cancel', 'Terminate and replay', 'Terminate']);
  });

  it('colours the confirm button by variant', async () => {
    render(ConfirmDialog, { props: base });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Terminate' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Terminate' })).toHaveClass('destructive');
  });

  it('calls back on confirm, secondary and cancel', async () => {
    const onConfirm = vi.fn();
    const onSecondary = vi.fn();
    const onCancel = vi.fn();

    render(ConfirmDialog, { props: { ...base, secondaryLabel: 'Rewind', onConfirm, onSecondary, onCancel } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Terminate' })).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: 'Terminate' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Rewind' }));
    expect(onSecondary).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();

    // Cancel closes the dialog itself; confirm leaves that to the caller, which may need to wait
    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());
  });

  it('disables the confirm button when the caller says so', async () => {
    render(ConfirmDialog, { props: { ...base, confirmDisabled: true } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
  });

  it('shows the progress bar and disables everything while busy', async () => {
    render(ConfirmDialog, { props: { ...base, busy: true } });

    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveClass('progress'));

    expect(screen.getByRole('button', { name: 'Terminate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('renders the hint under the controls', async () => {
    render(ConfirmDialog, { props: { ...base, hint: 'Instances already completed are skipped.' } });

    await waitFor(() => expect(screen.getByText('Instances already completed are skipped.')).toHaveClass('meta'));
  });
});

describe('IdsPreview', () => {
  it('shows every id when there are few', () => {
    render(IdsPreview, { props: { ids: ['order-1', 'order-2'] } });

    const pre = document.querySelector('.ed.ro pre');
    expect(pre?.textContent).toBe('order-1\norder-2');
  });

  it('shows ten and counts the rest', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `order-${i + 1}`);

    render(IdsPreview, { props: { ids } });

    const text = document.querySelector('.ed.ro pre')?.textContent ?? '';
    expect(text.split('\n')).toHaveLength(11);
    expect(text).toContain('order-10');
    expect(text).not.toContain('order-11\n');
    expect(text.endsWith('… and 3 more')).toBe(true);
  });

  it('renders nothing but an empty block for no ids', () => {
    render(IdsPreview, { props: { ids: [] } });

    expect(document.querySelector('.ed.ro pre')?.textContent).toBe('');
  });
});

describe('ReasonField', () => {
  it('is a labelled input that says where the text goes', () => {
    render(ReasonField, { props: {} });

    const input = screen.getByLabelText('Reason (optional)');
    expect(input).toHaveClass('input');
    expect(input.getAttribute('placeholder')).toBe('Written to the audit log');
  });
});
