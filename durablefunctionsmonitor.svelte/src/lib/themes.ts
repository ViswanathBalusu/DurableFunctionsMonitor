// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ThemeName } from '$lib/host.svelte';

/**
 * The five papers, with the swatch colours the theme menu and the Settings screen show. The hex
 * values are the design system's own (DFM App.dc.html L232-L238, ScreenSettings.dc.html L124-L128)
 * and are the only place in the app that names a colour: everything else paints with the tokens.
 * They are needed here because a swatch has to show a theme that is not the one currently applied.
 */
export interface ThemeDescriptor {
  key: ThemeName;
  label: string;
  /** What the theme is going for, shown muted after the label. */
  idea: string;
  /** Border radius · border width · shadow offset, shown on the Settings screen. */
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
    label: 'Hazard',
    idea: 'signage, stripes',
    metrics: '0 px · 3 px · 4 px',
    paper: '#F4F4F1',
    ink: '#000000',
    primary: '#FFC800',
    dark: '#23262C',
  },
];

export function theme(key: ThemeName): ThemeDescriptor {
  return THEMES.find((entry) => entry.key === key) ?? THEMES[0];
}
