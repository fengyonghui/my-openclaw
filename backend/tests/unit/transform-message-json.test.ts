/**
 * transformMessage JSON 还原行为测试
 *
 * Bug (2026-09-18)：用户消息含 JSON 文本时（如 `{"question":"..."}`），
 * transformMessage 把它反序列化为 object，导致请求体里 content 是 object
 * —— OpenAI 兼容 API 不接受，LLM 响应被截断。
 *
 * 修复：JSON 反序列化只对 role === 'tool' 生效。
 *  - tool result：保留 commit 392e65e 的还原行为（safeToolContent 存盘后被双重编码）
 *  - user / assistant：保持字符串不变
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformMessage } from '../../src/routes/chats/ChatMessageBuilder.ts';

// ============================================================
// 1. user 消息：保持字符串，绝不反序列化
// ============================================================

test('user: 普通文本 → 保持字符串', () => {
  const msg = { role: 'user', content: 'application.properties 怎么配置？' };
  const out = transformMessage(msg);
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, 'application.properties 怎么配置？');
});

test('user: JSON 对象字符串 → 保持字符串（不解析）', () => {
  // 这是 bug 报告里的核心场景：用户输入完整 JSON 作为消息
  const jsonText = '{"question":"application.properties 怎么配置？"}';
  const out = transformMessage({ role: 'user', content: jsonText });
  assert.equal(typeof out.content, 'string', 'content 必须是 string，不能是 object');
  assert.equal(out.content, jsonText);
});

test('user: JSON 数组字符串 → 保持字符串（不解析）', () => {
  const jsonText = '[1,2,3,{"foo":"bar"}]';
  const out = transformMessage({ role: 'user', content: jsonText });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, jsonText);
});

test('user: 含 JSON 配置示例的纯 JSON → 保持字符串', () => {
  const jsonText = '{"datasource":{"url":"jdbc:mysql://localhost:3306/test","username":"root"}}';
  const out = transformMessage({ role: 'user', content: jsonText });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, jsonText);
});

test('user: 空字符串 → 保持空字符串', () => {
  const out = transformMessage({ role: 'user', content: '' });
  assert.equal(out.content, '');
});

test('user: undefined content → 保持 undefined（不强制 fallback）', () => {
  // 当前实现不强制把 undefined 转成 ''，下游 estimateMessageTokens 已能处理
  // 这里只验证不会因为 transformMessage 反序列化引发 object
  const out = transformMessage({ role: 'user', content: undefined });
  assert.ok(out.content === undefined || out.content === '');
  assert.notEqual(typeof out.content, 'object');
});

test('user: 含前后空白的 JSON 字符串 → 保持字符串（不解析）', () => {
  const jsonText = '   {"a":1}   ';
  const out = transformMessage({ role: 'user', content: jsonText });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, jsonText);
});

test('user: 含花括号但非 JSON 的文本 → 保持字符串', () => {
  // 比如 {not really json  ← 缺少结束 }，原代码也不会解析
  const text = '{not really json';
  const out = transformMessage({ role: 'user', content: text });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, text);
});

test('user: 含 JSON 代码块的 Markdown 文本 → 保持字符串', () => {
  // 即使整条消息看起来像 JSON，但 Markdown 包裹下不应解析
  const text = '```json\n{"foo":"bar"}\n```';
  const out = transformMessage({ role: 'user', content: text });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, text);
});

// ============================================================
// 2. assistant 消息：保持字符串
// ============================================================

test('assistant: 普通文本 → 保持字符串', () => {
  const msg = { role: 'assistant', content: '建议使用 @ConfigurationProperties' };
  const out = transformMessage(msg);
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, '建议使用 @ConfigurationProperties');
});

test('assistant: JSON 字符串 → 保持字符串', () => {
  const jsonText = '{"answer":"在 Spring Boot 中..."}';
  const out = transformMessage({ role: 'assistant', content: jsonText });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, jsonText);
});

// ============================================================
// 3. tool 消息：保留 commit 392e65e 的还原行为
// ============================================================

test('tool: JSON 对象字符串 → 还原为 object（防双重编码）', () => {
  const jsonText = '{"success":true,"message":"已保存","path":"foo.txt"}';
  const out = transformMessage({ role: 'tool', tool_call_id: 'call_1', content: jsonText });
  assert.equal(typeof out.content, 'object');
  assert.equal((out.content as any).success, true);
  assert.equal((out.content as any).path, 'foo.txt');
});

test('tool: JSON 数组字符串 → 还原为 array', () => {
  const jsonText = '["a","b","c"]';
  const out = transformMessage({ role: 'tool', tool_call_id: 'call_2', content: jsonText });
  assert.ok(Array.isArray(out.content));
  assert.deepEqual(out.content, ['a', 'b', 'c']);
});

test('tool: 非 JSON 文本（如错误信息）→ 保持字符串', () => {
  const errText = 'Tool failed: file not found';
  const out = transformMessage({ role: 'tool', tool_call_id: 'call_3', content: errText });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, errText);
});

test('tool: 看起来像 JSON 但实际损坏 → 保持字符串', () => {
  const broken = '{broken json';
  const out = transformMessage({ role: 'tool', tool_call_id: 'call_4', content: broken });
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, broken);
});

// ============================================================
// 4. 其他行为不应受影响
// ============================================================

test('user: 带 attachments 多模态 → content 转为 multimodal array', () => {
  // 多模态 content 是 array，JSON 还原检测在 array 形态之前完成
  const msg = {
    role: 'user',
    content: '看看这张图',
    attachments: [{ name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,xxx' }],
  };
  const out = transformMessage(msg);
  assert.ok(Array.isArray(out.content), '多模态 content 应为 array');
  assert.equal((out.content as any[])[0].type, 'text');
  assert.equal((out.content as any[])[0].text, '看看这张图');
  assert.equal((out.content as any[])[1].type, 'image_url');
});

test('user: 已有 object content（运行时构造） → 保持 object', () => {
  // 如果上游已经传 object（不是字符串），原代码不会再 parse
  // 修复后这条路径不变（typeof 检查过滤掉非字符串）
  const obj = { foo: 'bar' };
  const out = transformMessage({ role: 'user', content: obj });
  // 修复后：m.role !== 'tool' 直接跳过 JSON 还原，所以原 object 保留
  assert.deepEqual(out.content, obj);
});

// ============================================================
// 5. 附件处理（bug fix 2026-09-21）
//    背景：/send 端点解析附件后把文本合并进 m.content，
//    transformMessage 只负责把图片嵌入 image_url，非图片附件不再生成占位符。
// ============================================================

test('user: 非图片附件（pdf/doc/txt）→ 不输出 [附件: name] 占位符', () => {
  // m.content 已由 /send 用 buildMessageWithAttachments 合并附件文本，
  // transformMessage 不应再重复添加 "[附件: xxx]" 占位符
  const msg = {
    role: 'user',
    content: '看看这份文档\n\n【PDF 文件 - report.pdf】\n第一章节内容...',
    attachments: [
      { name: 'report.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,xxx' },
    ],
  };
  const out = transformMessage(msg);
  // 没有图片 → 直接返回 base（content 是合并后的字符串）
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, msg.content);
  assert.ok(!out.content.includes('[附件:'), '不应包含 [附件: ...] 占位符');
});

test('user: 图片附件 → 生成 multimodal array（image_url + text）', () => {
  const msg = {
    role: 'user',
    content: '看看这张图',
    attachments: [
      { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,xxx' },
    ],
  };
  const out = transformMessage(msg);
  assert.ok(Array.isArray(out.content));
  const arr = out.content as any[];
  assert.equal(arr[0].type, 'text');
  assert.equal(arr[0].text, '看看这张图');
  assert.equal(arr[1].type, 'image_url');
  assert.equal(arr[1].image_url.url, 'data:image/png;base64,xxx');
});

test('user: 图片+非图片混合 → 图片走 image_url，非图片不再占位', () => {
  const msg = {
    role: 'user',
    content: '分析这张图和这份文档\n\n【PDF 文件 - spec.pdf】\n规格说明内容...',
    attachments: [
      { name: 'chart.png', type: 'image/png', dataUrl: 'data:image/png;base64,abc' },
      { name: 'spec.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,xyz' },
    ],
  };
  const out = transformMessage(msg);
  assert.ok(Array.isArray(out.content));
  const arr = out.content as any[];
  // 第一段是 text（含文档内容），第二段是 image_url
  assert.equal(arr[0].type, 'text');
  assert.ok(arr[0].text.includes('规格说明内容'), 'text 应包含文档解析内容');
  assert.equal(arr[1].type, 'image_url');
  // 不应该有 [附件: ...] 占位符
  for (const part of arr) {
    if (part.type === 'text') {
      assert.ok(!part.text.includes('[附件:'), 'text 不应含占位符');
    }
  }
});

test('user: 附件但无 image 类型 + 旧消息（未解析）→ content 是字符串，无占位符', () => {
  // 旧消息（修复前存的）：m.content 不含附件文本，attachments 有 dataUrl。
  // 当前修复：transformMessage 不再尝试补救（解析代价高），LLM 只能看到用户原文本。
  // 这是预期的妥协 — 旧数据 LLM 看不到附件内容；新消息 /send 已自动合并。
  const msg = {
    role: 'user',
    content: '请看附件',
    attachments: [
      { name: 'old.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,old' },
    ],
  };
  const out = transformMessage(msg);
  assert.equal(typeof out.content, 'string');
  assert.equal(out.content, '请看附件');
  assert.ok(!out.content.includes('[附件:'));
});

test('user: 图片附件但无 dataUrl → text-only fallback（image 跳过）', () => {
  const msg = {
    role: 'user',
    content: '看图',
    attachments: [{ name: 'a.png', type: 'image/png' /* no dataUrl */ }],
  };
  const out = transformMessage(msg);
  // 没有 dataUrl 的图片被跳过，hasImage=true 但循环里 if (att.dataUrl) 失败
  // 结果：返回 multimodal array 仅含 text
  assert.ok(Array.isArray(out.content));
  const arr = out.content as any[];
  assert.equal(arr.length, 1);
  assert.equal(arr[0].type, 'text');
});

