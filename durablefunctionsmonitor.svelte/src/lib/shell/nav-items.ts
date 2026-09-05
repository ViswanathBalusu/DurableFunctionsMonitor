// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Capabilities } from '$lib/api/types';
import type { Host } from '$lib/host.svelte';
import type { NavIconName } from '$lib/components/icons/NavIcon.svelte';
import type { HubRouteName } from '$lib/router.svelte';

export interface NavItem {
  id: HubRouteName;
  label: string;
  icon: NavIconName;
  /**
   * Whether this screen exists at all for the backend we are talking to. A screen whose backing
   * capability is missing is hidden, never disabled: a disabled item invites a click that can only
   * disappoint (design system §3).
   */
  visible: (capabilities: Capabilities, host: Host) => boolean;
}

const always = () => true;

/** The order of DFM App.dc.html L28-L36, with Settings after the gap. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', visible: always },
  { id: 'instances', label: 'Instances', icon: 'instances', visible: always },
  { id: 'failures', label: 'Failures', icon: 'failures', visible: (capabilities) => capabilities.failures },

  // Entities are listed through the Durable client, which every provider has
  { id: 'entities', label: 'Entities', icon: 'entities', visible: always },

  // The Functions screen is the table (which needs /stats) or the graph (which needs the function map)
  {
    id: 'functions',
    label: 'Functions',
    icon: 'functions',
    visible: (capabilities, host) => capabilities.stats || host.functionGraphAvailable,
  },
  { id: 'storage', label: 'Storage', icon: 'storage', visible: (capabilities) => capabilities.storageHealth },
  { id: 'activity', label: 'Activity', icon: 'activity', visible: (capabilities) => capabilities.audit },
];

export const SETTINGS_ITEM: NavItem = {
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  visible: always,
};

/** The items to draw, in order, for this backend and host. */
export function visibleNavItems(capabilities: Capabilities, host: Host): NavItem[] {
  return NAV_ITEMS.filter((item) => item.visible(capabilities, host));
}

/**
 * Which nav item a route lights up. The workspace belongs to Instances (DFM App.dc.html L374): the
 * user got there from that list and expects the list to still be the place they are in.
 */
export function activeNavId(routeName: string): string {
  return routeName === 'instance' ? 'instances' : routeName;
}
