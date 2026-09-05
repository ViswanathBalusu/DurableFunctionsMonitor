// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { chartSeriesColor, inkColor, mutedColor, statusColor, tokenColor } from './chart-tokens';
import { saveSvg, serializeSvg } from './svg-export';

function svgWith(inner: string): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = `<svg viewBox="0 0 100 26">${inner}</svg>`;
  document.body.appendChild(host);
  return host.querySelector('svg') as SVGSVGElement;
}

function fakeClient(isVsCode: boolean, saveAs = vi.fn()): BackendClient {
  return {
    isVsCode,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    download: vi.fn(),
    host: {
      openInNewWindow: vi.fn(),
      saveAs,
      gotoFunctionCode: vi.fn(),
      gotoBinding: vi.fn(),
      saveFunctionGraphAsJson: vi.fn(),
      persistState: vi.fn(),
    },
  } as unknown as BackendClient;
}

describe('chart tokens', () => {
  it('reads a token off the document element', () => {
    document.documentElement.style.setProperty('--chart-1', '#ff0000');

    expect(tokenColor('chart-1')).toBe('#ff0000');

    document.documentElement.style.removeProperty('--chart-1');
  });

  it('answers empty for a token the theme does not define', () => {
    expect(tokenColor('not-a-token')).toBe('');
  });

  it('cycles the five series colours', () => {
    for (let i = 1; i <= 5; i += 1) {
      document.documentElement.style.setProperty(`--chart-${i}`, `#00000${i}`);
    }

    expect(chartSeriesColor(0)).toBe('#000001');
    expect(chartSeriesColor(4)).toBe('#000005');
    expect(chartSeriesColor(5)).toBe('#000001');

    for (let i = 1; i <= 5; i += 1) {
      document.documentElement.style.removeProperty(`--chart-${i}`);
    }
  });

  it('takes a status colour from the same token as the chip', () => {
    document.documentElement.style.setProperty('--status-failed', '#c00');

    expect(statusColor('Failed')).toBe('#c00');

    document.documentElement.style.removeProperty('--status-failed');
  });

  it('has an ink and a muted colour', () => {
    document.documentElement.style.setProperty('--ink', '#111');
    document.documentElement.style.setProperty('--muted-foreground', '#777');

    expect(inkColor()).toBe('#111');
    expect(mutedColor()).toBe('#777');

    document.documentElement.style.removeProperty('--ink');
    document.documentElement.style.removeProperty('--muted-foreground');
  });
});

describe('serializeSvg', () => {
  it('returns a standalone document', () => {
    const text = serializeSvg(svgWith('<rect width="10" height="10" />'));

    expect(text.startsWith('<svg')).toBe(true);
    expect(text.trim().endsWith('</svg>')).toBe(true);
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('leaves no CSS variable behind', () => {
    const svg = svgWith('<rect width="10" height="10" fill="var(--chart-1)" stroke="var(--ink)" />');

    expect(serializeSvg(svg)).not.toContain('var(');
  });

  it('inlines the computed presentation properties', () => {
    const svg = svgWith('<rect width="10" height="10" style="fill:#abcdef;stroke-width:2px" />');

    const text = serializeSvg(svg);

    expect(text).toContain('fill: rgb(171, 205, 239)');
    expect(text).toContain('stroke-width: 2px');
  });

  it('drops any script, which is what VS Code refuses to open', () => {
    const svg = svgWith('<script>alert(1)</script><rect width="10" height="10" />');

    expect(serializeSvg(svg)).not.toContain('<script');
  });

  it('does not touch the original element', () => {
    const svg = svgWith('<rect width="10" height="10" fill="var(--chart-1)" />');

    serializeSvg(svg);

    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('var(--chart-1)');
  });
});

describe('saveSvg', () => {
  it('hands the string to the host inside VS Code', async () => {
    const saveAs = vi.fn();
    const svg = svgWith('<rect width="10" height="10" />');

    await saveSvg(fakeClient(true, saveAs), svg, 'timeline.svg');

    expect(saveAs).toHaveBeenCalledOnce();
    expect(saveAs.mock.calls[0][0].startsWith('<svg')).toBe(true);
    expect(saveAs.mock.calls[0][1]).toBe('timeline.svg');
  });

  it('downloads it in the browser', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clicked = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === 'a') {
        element.click = clicked;
      }
      return element;
    });

    const svg = svgWith('<rect width="10" height="10" />');
    await saveSvg(fakeClient(false), svg, 'timeline.svg');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();

    // The object URL is released, so a long session does not leak every chart it exported
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
