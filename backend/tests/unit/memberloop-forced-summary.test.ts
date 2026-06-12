/**
 * Test runner for forced-summary tests, using node:test (built-in).
 * Includes a minimal `vi` shim since vitest is not installed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// vi shim (minimal vitest mock fn)
// ============================================================
interface MockFn {
  (...args: any[]): any;
  mock: { calls: any[][]; results: any[] };
  mockResolvedValueOnce: (v: any) => MockFn;
  mockRejectedValueOnce: (v: any) => MockFn;
  mockReturnValue: (v: any) => MockFn;
  mockClear: () => MockFn;
}
function viFn(): MockFn {
  const queue: any[] = [];
  const calls: any[][] = [];
  const results: any[] = [];
  const fn: any = (...args: any[]) => {
    calls.push(args);
    const next = queue.shift();
    if (next && next.rejected) { results.push({ type: 'throw', value: next.value }); return Promise.reject(next.value); }
    if (next && next.value !== undefined) { results.push({ type: 'return', value: next.value }); return Promise.resolve(next.value); }
    results.push({ type: 'return', value: undefined });
    return Promise.resolve(undefined);
  };
  fn.mock = { calls, results };
  fn.mockResolvedValueOnce = (v: any) => { queue.push({ value: v, rejected: false }); return fn; };
  fn.mockRejectedValueOnce = (v: any) => { queue.push({ value: v, rejected: true }); return fn; };
  fn.mockReturnValue = (v: any) => { queue.length = 0; queue.push({ value: v, rejected: false }); return fn; };
  fn.mockClear = () => { calls.length = 0; results.length = 0; queue.length = 0; return fn; };
  return fn;
}
const vi = viFn;

// ============================================================
// Verbatim copy of requestForcedSummary from ToolExecutor.ts
// (kept in sync — if you change the impl, change this too)
// ============================================================
async function requestForcedSummary(
  messages: any[],
  modelsToTry: any[],
  pickedModel: any | null,
  targetAgent: any,
  reply: any,
  sanitizeMessages: (msgs: any[]) => any[],
  fetchImpl: typeof fetch
): Promise<{ success: boolean; finalContent: string; error?: string; model?: string }> {
  const summaryMessages: any[] = [
    ...messages,
    {
      role: 'user',
      content: '【系统提示】你已经使用完了分配的迭代预算。现在必须停止调用任何工具，直接用中文文字汇报你已完成的工作（关键发现、改动、文件路径、剩余问题等）。不要再发起 tool_call。'
    }
  ];

  const tryOrder = pickedModel
    ? [pickedModel, ...modelsToTry.filter((m: any) => m.id !== pickedModel.id)]
    : modelsToTry;

  let lastError = '';
  for (const tryModel of tryOrder) {
    const apiUrl = `${tryModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const reqBody: any = {
      model: tryModel.modelId,
      messages: sanitizeMessages(summaryMessages),
      stream: false,
      max_tokens: tryModel.maxTokens || 4096,
      temperature: 0.3
    };

    try {
      const res = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tryModel.apiKey}`
        },
        body: JSON.stringify(reqBody)
      });

      if (res.ok) {
        const data: any = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (cleaned) {
          return { success: true, finalContent: cleaned, model: tryModel.name };
        }
        lastError = `Empty content from ${tryModel.name}`;
        continue;
      }
      const errText = await res.text();
      lastError = `HTTP ${res.status} from ${tryModel.name}: ${errText.slice(0, 200)}`;
    } catch (err: any) {
      lastError = `Exception on ${tryModel.name}: ${err.message}`;
    }
  }
  return { success: false, finalContent: '', error: lastError || 'No models available' };
}

// ============================================================
// Helpers
// ============================================================
const mockModel = (id: string, name: string = id) => ({
  id, name, baseUrl: 'http://test.api/v1', modelId: id, apiKey: 'test-key', maxTokens: 4096
});
const mockTargetAgent = { name: 'UX', id: 'agent-ux' };
const noopReply = { raw: { write: () => {} } };
const identitySanitize = (m: any[]) => m;

// ============================================================
// Tests
// ============================================================

test('first model responds with text → success: true with summary', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '我已完成分页组件修复。改动文件：ui/src/components/MetadataModule.tsx。' } }] }),
    text: async () => ''
  });

  const r = await requestForcedSummary(
    [{ role: 'user', content: 'task' }], [mockModel('m1')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, true);
  assert.match(r.finalContent, /分页组件修复/);
  assert.equal(r.model, 'm1');
});

test('first model fails → falls back to next model', async () => {
  const f = vi();
  f.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota', json: async () => ({}) });
  f.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'Backup' } }] }), text: async () => '' });

  const r = await requestForcedSummary(
    [{ role: 'user', content: 'task' }], [mockModel('m1'), mockModel('m2')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, true);
  assert.equal(r.model, 'm2');
  assert.equal(f.mock.calls.length, 2);
});

test('all models fail → success: false with last error', async () => {
  const f = vi();
  f.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 's', json: async () => ({}) });
  f.mockResolvedValueOnce({ ok: false, status: 502, text: async () => 's', json: async () => ({}) });
  f.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'q', json: async () => ({}) });

  const r = await requestForcedSummary(
    [], [mockModel('m1'), mockModel('m2'), mockModel('m3')], null,
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, false);
  assert.match(r.error!, /m3/);
  assert.match(r.error!, /429/);
});

test('first model returns empty content (think-only) → tries next', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '<think>thinking...</think>' } }] }),
    text: async () => ''
  });
  f.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'real' } }] }),
    text: async () => ''
  });

  const r = await requestForcedSummary(
    [], [mockModel('m1'), mockModel('m2')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, true);
  assert.equal(r.model, 'm2');
});

test('does NOT pass tools/tool_choice to LLM (物理禁用 tool_calls)', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }), text: async () => ''
  });
  await requestForcedSummary(
    [{ role: 'user', content: 'task' }], [mockModel('m1')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  const body = JSON.parse(f.mock.calls[0][1].body);
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
});

test('appends a "stop calling tools" user message at the END', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }), text: async () => ''
  });

  const input = [
    { role: 'system', content: 'you are UX' },
    { role: 'user', content: 'fix' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '...' }
  ];
  await requestForcedSummary(
    input, [mockModel('m1')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  const sent = JSON.parse(f.mock.calls[0][1].body).messages;
  assert.equal(sent.length, input.length + 1);
  const last = sent[sent.length - 1];
  assert.equal(last.role, 'user');
  assert.match(last.content, /停止调用任何工具/);
  assert.match(last.content, /直接用中文文字汇报/);
});

test('uses temperature 0.3 and capped max_tokens', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }), text: async () => ''
  });
  await requestForcedSummary(
    [], [mockModel('m1')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  const body = JSON.parse(f.mock.calls[0][1].body);
  assert.equal(body.temperature, 0.3);
  assert.ok(body.max_tokens <= 4096);
});

test('strips <think>...</think> from summary', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '<think>Let me think...</think>我已完成 X 修复。' } }] }),
    text: async () => ''
  });
  const r = await requestForcedSummary(
    [], [mockModel('m1')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, true);
  assert.ok(!r.finalContent.includes('<think>'));
  assert.match(r.finalContent, /我已完成 X 修复/);
});

test('pickedModel is tried first', async () => {
  const f = vi();
  f.mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'from picked' } }] }), text: async () => ''
  });
  await requestForcedSummary(
    [], [mockModel('m1'), mockModel('m2'), mockModel('m3')], mockModel('m2'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  const body = JSON.parse(f.mock.calls[0][1].body);
  assert.equal(body.model, 'm2');
});

test('fetch exception → try next model', async () => {
  const f = vi();
  f.mockRejectedValueOnce(new Error('network timeout'));
  f.mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'after exc' } }] }), text: async () => ''
  });
  const r = await requestForcedSummary(
    [], [mockModel('m1'), mockModel('m2')], mockModel('m1'),
    mockTargetAgent, noopReply, identitySanitize, f as any
  );
  assert.equal(r.success, true);
  assert.equal(r.model, 'm2');
});
