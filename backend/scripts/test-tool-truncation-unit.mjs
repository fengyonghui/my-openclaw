/**
 * tool 内容存储侧截断 —— 单元测试（2026-11-11）
 *
 * 直接测 truncateStoredToolContent，验证：
 *   1. 超长 JSON 内容被截断，且结果仍是合法 JSON（MiniMax 严格校验）
 *   2. 超长纯文本内容被截断
 *   3. 短内容不被改动
 *   4. 非 tool 角色不被改动
 */
import { truncateStoredToolContent } from '../src/services/ProjectDataService.ts';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('=== tool 内容截断单元测试 ===');

// 1. 超长 JSON content
const longJson = JSON.stringify({ stdout: 'X'.repeat(50000), exitCode: 0 });
const r1 = truncateStoredToolContent({ role: 'tool', content: longJson });
check('超长 JSON 被截断', r1.content.length < longJson.length,
  `len=${r1.content.length}`);
check('截断后仍是合法 JSON', (() => {
  try { JSON.parse(r1.content); return true; } catch { return false; }
})(), r1.content.slice(0, 80));
check('保留 _truncated 标记', (() => {
  try { return JSON.parse(r1.content)._truncated === true; } catch { return false; }
})());
check('保留原始长度信息', (() => {
  try { return JSON.parse(r1.content)._originalLength === longJson.length; } catch { return false; }
})());

// 2. 超长纯文本 content
const longText = 'plain text output '.repeat(5000);
const r2 = truncateStoredToolContent({ role: 'tool', content: longText });
check('超长纯文本被截断', r2.content.length < longText.length, `len=${r2.content.length}`);
check('纯文本截断后带标记', r2.content.includes('[内容过长，已截断]'));

// 3. 短内容不变
const shortContent = JSON.stringify({ ok: true });
const r3 = truncateStoredToolContent({ role: 'tool', content: shortContent });
check('短内容不被改动', r3.content === shortContent);

// 4. 非 tool 角色不变
const userMsg = { role: 'user', content: 'X'.repeat(50000) };
const r4 = truncateStoredToolContent(userMsg);
check('非 tool 角色不被改动', r4.content.length === 50000);

// 5. 边界：正好等于上限
const exact = 'a'.repeat(8000);
const r5 = truncateStoredToolContent({ role: 'tool', content: exact });
check('正好 8000 字符不被截断', r5.content === exact);

// 6. 其他字段保留
const r6 = truncateStoredToolContent({ role: 'tool', tool_call_id: 'tc_1', content: longJson });
check('tool_call_id 等其他字段保留', r6.tool_call_id === 'tc_1');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
