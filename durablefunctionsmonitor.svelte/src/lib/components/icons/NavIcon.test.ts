import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import NavIcon, { type NavIconName } from './NavIcon.svelte';

const names: NavIconName[] = [
  'overview',
  'instances',
  'failures',
  'entities',
  'functions',
  'storage',
  'activity',
  'settings',
  'collapse',
  'expand',
];

describe('NavIcon', () => {
  for (const name of names) {
    it(`renders "${name}" without throwing and snapshots its markup`, () => {
      const { container } = render(NavIcon, { props: { name } });
      const svg = container.querySelector('svg.ico');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(container.innerHTML).toMatchSnapshot();
    });
  }

  it('renders opposite chevron glyphs for collapse and expand (App L37 / L373)', () => {
    const collapse = render(NavIcon, { props: { name: 'collapse' } });
    const expand = render(NavIcon, { props: { name: 'expand' } });

    expect(collapse.container.querySelector('polyline')?.getAttribute('points')).toBe('15 6 9 12 15 18');
    expect(expand.container.querySelector('polyline')?.getAttribute('points')).toBe('9 6 15 12 9 18');
  });

  it('passes the class prop through alongside the ico class', () => {
    const { container } = render(NavIcon, { props: { name: 'overview', class: 'extra' } });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toBe('ico extra');
  });
});
