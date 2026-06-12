// Test for handleJsonParseError — fixes for unterminated string in tool args
// Reproduces the exact failure from the user's bug report

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// We need to import the actual function. But it's not exported. So we test via
// a different route: re-read the file source and execute the function in a sandbox.
// OR: extract the function via TypeScript compilation.

// Easier: define a minimal replica matching the new logic, and test cases.
// Then once we verify the logic, do an integration test through the dev server.

// === REPLICA of fixed Strategy 1 ===
function fixUnterminatedString(rawArgs: string): { fixed: string; attempts: number } {
  let fixedArgs = rawArgs;
  let fixAttempts = 0;

  // Try to parse first
  try {
    JSON.parse(fixedArgs);
    return { fixed: fixedArgs, attempts: 0 };
  } catch (parseError: any) {
    if (!parseError.message.includes('Unterminated string')) {
      return { fixed: fixedArgs, attempts: 0 };
    }
  }

  fixAttempts++;
  const openBraces = (fixedArgs.match(/{/g) || []).length;
  const closeBraces = (fixedArgs.match(/}/g) || []).length;
  const contentMatch = fixedArgs.match(/"content"\s*:\s*"/);

  if (contentMatch) {
    fixedArgs = fixedArgs + '"';
    for (let n = 1; n <= 5; n++) {
      const candidate = fixedArgs + '}'.repeat(n);
      try {
        JSON.parse(candidate);
        fixedArgs = candidate;
        return { fixed: fixedArgs, attempts: n };
      } catch {}
    }
    return { fixed: fixedArgs, attempts: -1 };  // no n worked
  } else {
    const missingBraces = openBraces - closeBraces;
    fixedArgs = fixedArgs + '"';
    for (let n = 0; n <= missingBraces + 3; n++) {
      const candidate = fixedArgs + '}'.repeat(n);
      try {
        JSON.parse(candidate);
        fixedArgs = candidate;
        return { fixed: fixedArgs, attempts: n };
      } catch {}
    }
    return { fixed: fixedArgs, attempts: -1 };
  }
}

// === Test cases ===

test('reproduces user bug: 1236-char Java write_file with truncated content', () => {
  // Real args from the failed tool call (msg[387] in chat 1781246913500.json)
  // Length 1236, content ends mid-comment with literal " inside
  // Load as RAW string (the file IS the broken JSON, JSON.parse would fail)
  const realArgs = readFileSync('/tmp/broken-args.json', 'utf-8');
  assert.equal(realArgs.length, 1236);
  assert.match(realArgs, /"content": "package com\.onewindow\.aichart/);
  // The args (JS string) end with 匹配 \" (2 chars: \ + ") which is the
  // unterminated JSON escape \" that the LLM wrote inside a Java comment
  // (the LLM never wrote the closing " of the content string).
  assert.match(realArgs, /匹配 \\"$/);

  const result = fixUnterminatedString(realArgs);
  console.log(`  attempts: ${result.attempts}`);
  const parsed = JSON.parse(result.fixed);
  assert.equal(typeof parsed.path, 'string');
  assert.match(parsed.path, /HallDisambiguationService\.java$/);
  assert.equal(typeof parsed.content, 'string');
  assert.match(parsed.content, /匹配 "/);  // content preserved (with the literal ")
  console.log(`  ✅ path: ${parsed.path}`);
  console.log(`  ✅ content length: ${parsed.content.length}`);
  console.log(`  ✅ content last 50: ${JSON.stringify(parsed.content.slice(-50))}`);
});

test('typical case: write_file args truncated mid-content', () => {
  const broken = '{"path": "src/foo.ts", "content": "export const x = 1\\n// TODO: ';
  const result = fixUnterminatedString(broken);
  const parsed = JSON.parse(result.fixed);
  assert.equal(parsed.path, 'src/foo.ts');
  assert.match(parsed.content, /TODO: /);
});

test('Java class with unescaped { in content (the original bug scenario)', () => {
  // This is the key case: content contains Java code with literal { that the
  // brace counter would over-count
  const broken = '{"path": "Foo.java", "content": "class Foo {\\n  void bar() {\\n    // ';
  const result = fixUnterminatedString(broken);
  const parsed = JSON.parse(result.fixed);
  assert.equal(parsed.path, 'Foo.java');
  // The Java { } should be preserved as-is in content
  assert.match(parsed.content, /class Foo \{/);
  assert.match(parsed.content, /void bar\(\) \{/);
});

test('empty content', () => {
  const broken = '{"path": "x.txt", "content": "';
  const result = fixUnterminatedString(broken);
  const parsed = JSON.parse(result.fixed);
  assert.equal(parsed.path, 'x.txt');
  assert.equal(parsed.content, '');
});

test('no content field (path-only truncation, generic branch)', () => {
  const broken = '{"path": "src/foo';
  const result = fixUnterminatedString(broken);
  const parsed = JSON.parse(result.fixed);
  assert.equal(parsed.path, 'src/foo');
});

test('already valid JSON passes through unchanged', () => {
  const valid = '{"path": "foo.ts", "content": "x"}';
  const result = fixUnterminatedString(valid);
  assert.equal(result.attempts, 0);
  assert.equal(result.fixed, valid);
});

test('JSON with newlines and special chars in content', () => {
  const broken = '{"path": "x.md", "content": "# Title\\n\\nThis has \\"quotes\\" and \\n newlines';
  const result = fixUnterminatedString(broken);
  const parsed = JSON.parse(result.fixed);
  assert.equal(parsed.path, 'x.md');
  assert.match(parsed.content, /# Title/);
  assert.match(parsed.content, /"quotes"/);
});

test('non-Unterminated errors are not modified (e.g. syntax error)', () => {
  // Trailing comma, not unterminated
  const broken = '{"path": "x", "content": "y",}';
  const result = fixUnterminatedString(broken);
  // The fix should not have modified it (still broken)
  assert.equal(result.attempts, 0);
  assert.throws(() => JSON.parse(result.fixed));
});
