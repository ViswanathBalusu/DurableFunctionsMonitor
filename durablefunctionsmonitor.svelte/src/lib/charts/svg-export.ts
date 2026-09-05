// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { BackendClient } from '$lib/api/client';

/** The presentation properties a standalone SVG has to carry, because no stylesheet travels with it. */
const INLINED_PROPERTIES = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
] as const;

/**
 * A standalone SVG string: the element cloned, every computed presentation property written onto the
 * clone, and the namespace declared. No `var(--x)` survives - a saved file has no document to resolve
 * them against - and no script does either: the VS Code extension refuses an SVG that contains one
 * (MonitorView.looksLikeSvg), and a chart has no business carrying code.
 */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const sources = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const targets = [clone, ...Array.from(clone.querySelectorAll('*'))];

  for (let i = 0; i < sources.length; i += 1) {
    const computed = getComputedStyle(sources[i] as Element);
    const target = targets[i] as SVGElement;

    for (const property of INLINED_PROPERTIES) {
      const value = computed.getPropertyValue(property);

      if (value && value !== 'none' && !value.includes('var(')) {
        target.style.setProperty(property, value);
      }
    }

    // Whatever is left pointing at a variable would render as nothing
    for (const attribute of ['fill', 'stroke']) {
      if (target.getAttribute(attribute)?.includes('var(')) {
        target.setAttribute(attribute, computed.getPropertyValue(attribute) || 'none');
      }
    }
  }

  for (const script of Array.from(clone.querySelectorAll('script'))) {
    script.remove();
  }

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  return clone.outerHTML;
}

/**
 * Saves a chart. In VS Code the webview cannot write a file, so the string goes over the bridge;
 * in the browser it is an ordinary download.
 */
export async function saveSvg(client: BackendClient, svg: SVGSVGElement, fileName: string): Promise<void> {
  const text = serializeSvg(svg);

  if (client.isVsCode) {
    await client.host.saveAs(text, fileName);
    return;
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
