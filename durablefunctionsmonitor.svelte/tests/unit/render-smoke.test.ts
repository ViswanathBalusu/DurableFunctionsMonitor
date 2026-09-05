// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Named test for E3-S1-T1 (docs/plans/svelte-rewrite/E3-test-harness.md).
//
// Before this task, vite.config.ts resolved the `svelte` package to its server/SSR
// build under Vitest, so @testing-library/svelte's render() threw
// `Svelte error: lifecycle_function_unavailable: mount(...) is not available on the
// server` for literally any component (see E1-S7-T1's wave note). Adding
// svelteTesting() from '@testing-library/svelte/vite' to vite.config.ts's plugins
// fixes it by putting `browser` ahead of `node` in resolve.conditions under Vitest.
// This test mounts a trivial throwaway component and asserts its rendered text,
// proving the fix for every future component test in the rewrite.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Greeting from './Greeting.svelte';

describe('@testing-library/svelte render() under Vitest', () => {
  it('mounts a Svelte 5 component in jsdom and reads its rendered text', () => {
    render(Greeting, { props: { name: 'Durable Functions Monitor' } });

    expect(screen.getByText('Hello, Durable Functions Monitor!')).toBeInTheDocument();
  });
});
