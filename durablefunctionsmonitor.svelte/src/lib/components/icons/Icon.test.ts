import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Settings from '@lucide/svelte/icons/settings';
import Icon from './Icon.svelte';

describe('Icon', () => {
  it('renders the wrapped lucide icon at size 20 by default with aria-hidden set', () => {
    const { container } = render(Icon, { props: { icon: Settings } });
    const svg = container.querySelector('svg');

    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shrinks to 16px when size=16 is passed for use inside a button', () => {
    const { container } = render(Icon, { props: { icon: Settings, size: 16 } });
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
  });

  it('keeps the visual stroke weight constant across sizes (absoluteStrokeWidth)', () => {
    // lucide computes stroke-width = strokeWidth * 24 / size when absoluteStrokeWidth is set,
    // so the rendered (visual) line weight stays at the fixed 2.5px regardless of icon size.
    const at20 = render(Icon, { props: { icon: Settings, size: 20 } }).container.querySelector('svg');
    const at16 = render(Icon, { props: { icon: Settings, size: 16 } }).container.querySelector('svg');

    const visualAt20 = Number(at20?.getAttribute('stroke-width')) * (20 / 24);
    const visualAt16 = Number(at16?.getAttribute('stroke-width')) * (16 / 24);

    expect(visualAt20).toBeCloseTo(2.5, 5);
    expect(visualAt16).toBeCloseTo(2.5, 5);
    expect(visualAt20).toBeCloseTo(visualAt16, 5);
  });

  it('passes the class prop through to the root svg', () => {
    const { container } = render(Icon, { props: { icon: Settings, class: 'extra' } });
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('class')).toContain('extra');
  });
});
