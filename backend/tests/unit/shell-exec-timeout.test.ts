// Test for shell_exec timeout handling — fixes for v0.3.32
// Bug: executor hardcoded 60s, ignored LLM's args.timeout. Start-Sleep -Seconds 100
// was SIGTERM'd at 60s, reported [exit=?]. Tool definition promised timeout param.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// === REPLICA of fixed timeout parser from executeShellCommand ===
const MIN_TIMEOUT_S = 5;
const MAX_TIMEOUT_S = 300;
const DEFAULT_TIMEOUT_S = 60;

function resolveTimeoutMs(args: any): number {
  const parsedTimeout = Number(args.timeout);
  let timeoutSec: number;
  if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
    timeoutSec = DEFAULT_TIMEOUT_S;
  } else if (parsedTimeout < MIN_TIMEOUT_S) {
    timeoutSec = MIN_TIMEOUT_S;
  } else if (parsedTimeout > MAX_TIMEOUT_S) {
    timeoutSec = MAX_TIMEOUT_S;
  } else {
    timeoutSec = Math.floor(parsedTimeout);
  }
  return timeoutSec * 1000;
}

// === REPLICA of fixed timeout detection from normalizeExecError ===
function classifyTimeout(err: any, exitCode: number | undefined) {
  const wasKilled = err?.killed === true
    || (typeof err?.signal === 'string' && err.signal.length > 0);
  const isTimeout = wasKilled && (exitCode === undefined || exitCode === null)
                    || /timeout|timed out|超时/i.test(err?.message || '');
  if (isTimeout) {
    return {
      error: `命令执行超时被中止 [exit=?]`,
      _exitCode: null,
      _killed: true,
      _signal: err?.signal || 'SIGTERM',
    };
  }
  return null;
}

// ============================================================
// 1) resolveTimeoutMs — argument parsing/validation
// ============================================================
test('timeout: missing arg → default 60s (60000ms)', () => {
  assert.equal(resolveTimeoutMs({}), 60000);
  assert.equal(resolveTimeoutMs({ command: 'ls' }), 60000);
  assert.equal(resolveTimeoutMs({ command: 'ls', timeout: undefined }), 60000);
});

test('timeout: null/undefined/empty → default', () => {
  assert.equal(resolveTimeoutMs({ timeout: null }), 60000);
  assert.equal(resolveTimeoutMs({ timeout: 0 }), 60000);
  assert.equal(resolveTimeoutMs({ timeout: '' }), 60000);
  assert.equal(resolveTimeoutMs({ timeout: 'abc' }), 60000);
});

test('timeout: negative → default (defensive, 0/negative falls into default bucket)', () => {
  // parsedTimeout = -10, Number.isFinite=true, -10 <= 0 → DEFAULT
  assert.equal(resolveTimeoutMs({ timeout: -10 }), 60000);
});

test('timeout: less than minimum (5s) → clamped to 5s', () => {
  assert.equal(resolveTimeoutMs({ timeout: 1 }), 5000);
  assert.equal(resolveTimeoutMs({ timeout: 4 }), 5000);
  assert.equal(resolveTimeoutMs({ timeout: 4.9 }), 5000);
});

test('timeout: exactly minimum/maximum → no clamp', () => {
  assert.equal(resolveTimeoutMs({ timeout: 5 }), 5000);
  assert.equal(resolveTimeoutMs({ timeout: 300 }), 300000);
});

test('timeout: in range → preserved as integer', () => {
  assert.equal(resolveTimeoutMs({ timeout: 60 }), 60000);
  assert.equal(resolveTimeoutMs({ timeout: 120 }), 120000);   // the actual case from bug report
  assert.equal(resolveTimeoutMs({ timeout: 90 }), 90000);
});

test('timeout: greater than max (300s) → clamped to 300s', () => {
  assert.equal(resolveTimeoutMs({ timeout: 301 }), 300000);
  assert.equal(resolveTimeoutMs({ timeout: 9999 }), 300000);
  assert.equal(resolveTimeoutMs({ timeout: 3600 }), 300000);
});

test('timeout: fractional → floored to integer seconds', () => {
  assert.equal(resolveTimeoutMs({ timeout: 90.7 }), 90000);
  assert.equal(resolveTimeoutMs({ timeout: 5.99 }), 5000);
});

test('timeout: string numeric → coerced by Number()', () => {
  assert.equal(resolveTimeoutMs({ timeout: '120' }), 120000);
  assert.equal(resolveTimeoutMs({ timeout: '5' }), 5000);
});

test('timeout: very small positive fraction → clamped to min', () => {
  // 0.5 is finite and > 0, so NOT default; < MIN → clamp to 5
  assert.equal(resolveTimeoutMs({ timeout: 0.5 }), 5000);
});

// ============================================================
// 2) classifyTimeout — error reporting
// ============================================================
test('timeout detection: err.killed=true, err.signal=SIGTERM, exitCode=null → classified as timeout', () => {
  // The exact shape Node.js child_process.exec produces on timeout-kill
  const err = Object.assign(new Error('Command failed: powershell ...'), {
    killed: true,
    signal: 'SIGTERM',
    code: null,
    cmd: 'powershell ...',
  });
  const result = classifyTimeout(err, null);
  assert.ok(result, 'should classify as timeout');
  assert.equal(result!._killed, true);
  assert.equal(result!._signal, 'SIGTERM');
  assert.match(result!.error, /超时/);
  assert.match(result!.error, /exit=\?/);
});

test('timeout detection: err.killed=true, exitCode=undefined → classified as timeout', () => {
  const err = Object.assign(new Error('whatever'), { killed: true, signal: 'SIGTERM' });
  const result = classifyTimeout(err, undefined);
  assert.ok(result, 'should classify as timeout');
});

test('timeout detection: err.message contains "timeout" → classified as timeout (defensive)', () => {
  // Some node versions or wrappers throw Error with text but no killed flag
  const err = new Error('Operation timeout after 60000ms');
  const result = classifyTimeout(err, 1); // exit code is set, but message says timeout
  assert.ok(result, 'message-based detection should still fire');
});

test('timeout detection: err.message in Chinese "超时" → classified as timeout (defensive)', () => {
  const err = new Error('操作超时');
  const result = classifyTimeout(err, 1);
  assert.ok(result, 'Chinese "超时" keyword should fire');
});

test('timeout detection: normal exit error (exitCode=1) → NOT classified as timeout', () => {
  const err = Object.assign(new Error('Command failed: ls'), {
    killed: false,
    code: 1,
    cmd: 'ls',
  });
  const result = classifyTimeout(err, 1);
  assert.equal(result, null, 'normal exitCode=1 should not be classified as timeout');
});

test('timeout detection: spawn ENOENT (command not found) → NOT classified as timeout', () => {
  const err = Object.assign(new Error('spawn powershell ENOENT'), {
    errno: -2,
    code: 'ENOENT',
    syscall: 'spawn powershell',
  });
  const result = classifyTimeout(err, undefined);
  assert.equal(result, null, 'ENOENT should not be classified as timeout');
});

// ============================================================
// 3) End-to-end: 90s sleep would have failed under old hardcoded 60s
//    but now passes when args.timeout=120
// ============================================================
test('e2e: args.timeout=120 (from the real bug report) → resolved to 120000ms', () => {
  // Real dev.log line 19104: {"command":"powershell -NoProfile -Command \"Start-Sleep -Seconds 100\"","timeout":120}
  const args = { command: 'powershell -NoProfile -Command "Start-Sleep -Seconds 100"', timeout: 120 };
  const resolved = resolveTimeoutMs(args);
  assert.equal(resolved, 120000);
  // 120000ms > 100s sleep → the command would have completed before the timeout fires.
  // Under the old code (hardcoded 60000), 100s > 60s → SIGTERM at 60s → "exit=?" error.
});
