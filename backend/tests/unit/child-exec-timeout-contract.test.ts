// Cross-platform safe proof that child_process.exec timeout-kill produces
// the err shape our normalizeExecError relies on (killed=true, signal=SIGTERM).
// This validates the underlying Node.js contract — the wrapper logic is
// independently tested in shell-exec-timeout.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(exec);

test('proof: exec timeout fires and produces killed+SIGTERM err shape', async () => {
  // 3s sleep, 1s timeout → should be killed at 1s
  const start = Date.now();
  let err: any;
  let stdout = '';
  let stderr = '';
  try {
    await pexec('sleep 3', { timeout: 1000 });
  } catch (e: any) {
    err = e;
    stdout = e.stdout || '';
    stderr = e.stderr || '';
  }
  const elapsed = Date.now() - start;

  // Killed in ~1s (not full 3s)
  assert.ok(elapsed < 2000, `expected <2s elapsed, got ${elapsed}ms`);
  assert.ok(elapsed >= 900,  `expected ≥1s elapsed, got ${elapsed}ms`);

  // The err shape we rely on
  assert.equal(err.killed, true, 'err.killed should be true');
  assert.equal(err.signal, 'SIGTERM', 'err.signal should be SIGTERM');
  assert.equal(err.code, null, 'err.code should be null on timeout-kill');

  console.log(`    ✓ exec killed in ${elapsed}ms with killed=${err.killed} signal=${err.signal} code=${err.code}`);
});
