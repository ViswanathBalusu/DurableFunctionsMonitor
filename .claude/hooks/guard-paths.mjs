#!/usr/bin/env node
// PreToolUse hook: refuses edits to paths that are frozen during the Svelte rewrite.
// Receives the tool call as JSON on stdin; answers with a permission decision on stdout.
// See CLAUDE.md "Frozen paths".
import fs from 'node:fs';
import path from 'node:path';

const FROZEN = [
  { test: (p) => /(^|[\\/])docs[\\/]ui-plans-artifacts([\\/]|$)/.test(p), why: 'docs/ui-plans-artifacts is the design source of truth and is read-only.' },
  { test: (p) => /(^|[\\/])DfmStatics([\\/]|$)/.test(p), why: 'DfmStatics is build output; run npm run build-and-copy instead of editing it.' },
  {
    test: (p) => /(^|[\\/])durablefunctionsmonitor\.svelte[\\/]src[\\/]styles[\\/]dfm-(ui|tokens)\.css$/.test(p),
    why: 'dfm-ui.css and dfm-tokens.css are verbatim copies of the design artifacts; put additions in src/styles/dfm-ext.css.',
    unlessMissing: true,
  },
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    // Unknown input format: allow, but say so, rather than blocking every edit.
    process.stderr.write('guard-paths: could not parse hook input, allowing the call\n');
    process.exit(0);
  }
  const tool = input.tool_name ?? '';
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) process.exit(0);
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
  if (!file) process.exit(0);
  const abs = path.resolve(input.cwd ?? process.cwd(), file);
  for (const rule of FROZEN) {
    if (!rule.test(abs)) continue;
    if (rule.unlessMissing && !fs.existsSync(abs)) continue; // the initial verbatim copy is allowed
    if (process.env.DFM_UNFREEZE === '1') continue; // escape hatch for E12 cleanup work
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${rule.why} (path: ${file}). Set DFM_UNFREEZE=1 only for the E12 cleanup tasks.`,
      },
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  process.exit(0);
});
