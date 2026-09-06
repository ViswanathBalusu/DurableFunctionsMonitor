// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ThemeName } from '$lib/host.svelte';

/**
 * The family a theme belongs to (README D12). The five papers are `brutal`; a family sheet under
 * `src/styles/families/` gives the other two their look, scoped to the theme's key.
 */
export type ThemeFamily = 'brutal' | 'glass' | 'neu';

/**
 * The themes, with the swatch colours the theme menu and the Settings screen show. The hex values
 * are the design system's own (DFM App.dc.html L232-L238, ScreenSettings.dc.html L124-L128) and
 * are the only place in the app that names a colour: everything else paints with the tokens. They
 * are needed here because a swatch has to show a theme that is not the one currently applied.
 */
export interface ThemeDescriptor {
  key: ThemeName;
  family: ThemeFamily;
  label: string;
  /** What the theme is going for, shown muted after the label. */
  idea: string;
  /**
   * Three numbers shown on the Settings screen; what they are depends on the family:
   * brutal `radius · line · shadow offset`, glass `radius · line · blur`, neu `radius · line · shadow blur`.
   */
  metrics: string;
  paper: string;
  ink: string;
  primary: string;
  /** The paper the dark mode of this theme uses. */
  dark: string;
}

export const THEMES: readonly ThemeDescriptor[] = [
  {
    key: 'poster',
    family: 'brutal',
    label: 'Poster',
    idea: 'bone, black, print',
    metrics: '0 px · 2 px · 4 px',
    paper: '#F8F6F1',
    ink: '#000000',
    primary: '#FFD400',
    dark: '#1B1930',
  },
  {
    key: 'riso',
    family: 'brutal',
    label: 'Riso',
    idea: 'newsprint, halftone',
    metrics: '2 px · 2 px · 4 px',
    paper: '#F2EEE6',
    ink: '#231F20',
    primary: '#FF48B0',
    dark: '#10203A',
  },
  {
    key: 'memphis',
    family: 'brutal',
    label: 'Memphis',
    idea: 'pastels, thick line',
    metrics: '10 px · 3 px · 5 px',
    paper: '#F6F3FA',
    ink: '#000000',
    primary: '#FF9ECF',
    dark: '#2A1F3D',
  },
  {
    key: 'blueprint',
    family: 'brutal',
    label: 'Blueprint',
    idea: 'cobalt line, grid',
    metrics: '0 px · 2 px · 4 px',
    paper: '#EEF2FF',
    ink: '#1636E0',
    primary: '#FF6A00',
    dark: '#08205F',
  },
  {
    key: 'hazard',
    family: 'brutal',
    label: 'Hazard',
    idea: 'signage, stripes',
    metrics: '0 px · 3 px · 4 px',
    paper: '#F4F4F1',
    ink: '#000000',
    primary: '#FFC800',
    dark: '#23262C',
  },
  // The soft families (E14, E15): `ink` is the colour of a mark, `--glyph`, which is what the swatch
  // shows - the line itself is a rim too faint to stand for the theme
  {
    key: 'glass',
    family: 'glass',
    label: 'Glass',
    idea: 'frosted panes over colour',
    metrics: '14 px · 1 px · blur 16',
    paper: '#EEF1F8',
    ink: '#101828',
    primary: '#4F46E5',
    dark: '#0B1020',
  },
  {
    key: 'neu',
    family: 'neu',
    label: 'Neu',
    idea: 'one soft material',
    metrics: '16 px · 1 px · 14 px',
    paper: '#E3E8F0',
    ink: '#1F2937',
    primary: '#5B5BD6',
    dark: '#2A2E37',
  },
];

export function theme(key: ThemeName): ThemeDescriptor {
  return THEMES.find((entry) => entry.key === key) ?? THEMES[0];
}

/** The family of a theme; an unknown key falls back with `theme()`, so it is the first theme's. */
export function family(key: ThemeName): ThemeFamily {
  return theme(key).family;
}
