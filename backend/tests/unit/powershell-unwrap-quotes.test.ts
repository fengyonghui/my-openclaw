/**
 * PowerShell shell_exec 引号/嵌套包装修复测试
 *
 * Bug: powershell -NoProfile -Command "Get-Content ... | Select-String -Pattern ''content': 'pkg'"
 * 被再次包成 -Command {powershell -NoProfile -Command "..."}，触发
 * "The string is missing the terminator"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  unwrapPowerShellWrappers,
  repairSelectStringPatternQuotes,
} from '../../src/routes/chats/ToolExecutor.ts';

test('unwrap: powershell -NoProfile -Command "..."', () => {
  const input =
    `powershell -NoProfile -Command "Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern 'foo'"`;
  const out = unwrapPowerShellWrappers(input);
  assert.equal(
    out,
    `Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern 'foo'`
  );
});

test('unwrap: nested powershell -NoProfile -Command {powershell -NoProfile -Command "..."}', () => {
  const input =
    `powershell -NoProfile -Command {powershell -NoProfile -Command "Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern 'foo'"}`;
  const out = unwrapPowerShellWrappers(input);
  assert.equal(
    out,
    `Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern 'foo'`
  );
});

test('unwrap: powershell -Command "..." without -NoProfile', () => {
  const input = `powershell -Command "Get-Location"`;
  assert.equal(unwrapPowerShellWrappers(input), 'Get-Location');
});

test('unwrap: already bare command is unchanged', () => {
  const input = `Get-ChildItem -Path "src"`;
  assert.equal(unwrapPowerShellWrappers(input), input);
});

test('repair: broken -Pattern \'\'content\': \'pkg\'', () => {
  const input =
    `Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern ''content': 'package com.example.ruleengine'`;
  const out = repairSelectStringPatternQuotes(input);
  assert.equal(
    out,
    `Get-Content -Path 'data\\chats\\1.json' | Select-String -Pattern "'content': 'package com.example.ruleengine'"`
  );
});

test('repair: legitimate -Pattern \'\'\'foo\'\'\' is left alone', () => {
  const input = `Select-String -Pattern '''foo'''`;
  assert.equal(repairSelectStringPatternQuotes(input), input);
});

test('repair: normal -Pattern "foo" unchanged', () => {
  const input = `Select-String -Path "a.json" -Pattern "package com.example"`;
  assert.equal(repairSelectStringPatternQuotes(input), input);
});

test('full pipeline: user-reported failing command becomes valid script', () => {
  const failing =
    `powershell -NoProfile -Command "Get-Content -Path 'data\\chats\\1784614330281.json' | Select-String -Pattern ''content': 'package com.example.ruleengine'"`;
  const unwrapped = unwrapPowerShellWrappers(failing);
  const repaired = repairSelectStringPatternQuotes(unwrapped);
  assert.equal(
    repaired,
    `Get-Content -Path 'data\\chats\\1784614330281.json' | Select-String -Pattern "'content': 'package com.example.ruleengine'"`
  );
  // 不应再含外层 powershell 包装
  assert.equal(/powershell\s+-NoProfile/i.test(repaired), false);
});
