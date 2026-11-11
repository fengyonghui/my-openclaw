/**
 * Phase 6 回归验证脚本（2026-11-11）
 *
 * 覆盖场景：
 *   1. 新建项目 → 列会话 → 新建会话（Bug #13 场景）
 *   2. 发送消息 → LLM 流式响应 → 消息落库（Bug #13 核心：LLM 能否收到用户问题）
 *   3. 附件 base64 上传（Bug #14 场景：fastify bodyLimit 413）
 *   4. db.json 瘦身验证：新会话在 db.json 里应是索引条目而非全文
 *
 * 用法：node backend/scripts/regress-phase6.mjs
 */
import http from 'node:http';
import fs from 'node:fs';

const HOST = 'localhost';
const PORT = 3001;
const DB_PATH = 'backend/data/db.json';

// 回归测试用的模型：MiniMax 通道额度耗尽时（429/402）换用其他可用模型
const REGRESS_MODEL = process.env.REGRESS_MODEL || 'qwen3.5-plus';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: HOST, port: PORT, path, method, timeout: 120000,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (resp) => {
      let b = '';
      resp.on('data', (d) => (b += d));
      resp.on('end', () => resolve({ status: resp.statusCode, body: b }));
    });
    r.on('error', reject);
    r.on('timeout', function () { this.destroy(new Error('timeout')); });
    if (data) r.write(data);
    r.end();
  });
}

/** 发起 SSE 请求并收集 chunk */
function sendSse(chatId, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const r = http.request({
      host: HOST, port: PORT, path: `/api/v1/chats/${chatId}/send`, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (resp) => {
      let acc = '';
      resp.on('data', (d) => (acc += d));
      resp.on('end', () => resolve({ status: resp.statusCode, acc }));
    });
    r.on('error', reject);
    r.on('timeout', function () { this.destroy(new Error('timeout')); });
    r.write(data);
    r.end();
  });
}

function parseChunks(acc) {
  const out = [];
  for (const line of acc.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') continue;
    try {
      const obj = JSON.parse(raw);
      if (typeof obj.chunk === 'string') out.push(obj.chunk);
      if (obj.type === 'tool_result') out.push(`[TOOL:${obj.toolName}]`);
      if (obj.error) out.push(`[ERROR:${obj.error}]`);
    } catch { /* 非 JSON 行忽略 */ }
  }
  return out;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const run = async () => {
  const dbBefore = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const sizeBefore = fs.statSync(DB_PATH).size;

  // ---------- 场景 1: 新建项目 / 会话 ----------
  console.log('\n=== 场景 1: 新建项目 → 列表 → 新建会话 (Bug #13) ===');
  const projName = `regress-p6-${Date.now()}`;
  const p = await req('POST', '/api/v1/projects', {
    name: projName, description: 'phase6 regression', parentDir: 'd:/workspace',
  });
  check('创建项目返回 200', p.status === 200, `status=${p.status}`);
  const proj = JSON.parse(p.body);
  const pid = proj.id;

  const list = await req('GET', `/api/v1/chats?projectId=${pid}`);
  const listArr = JSON.parse(list.body);
  check('新项目会话列表可读且为空', list.status === 200 && listArr.length === 0,
    `status=${list.status} count=${listArr.length}`);

  const chat = JSON.parse((await req('POST', '/api/v1/chats', {
    projectId: pid, title: '回归测试会话', modelId: REGRESS_MODEL,
  })).body);
  check('创建会话返回 id', !!chat.id, `id=${chat.id}`);

  const projFile = `${proj.workspace}/data/chats/${chat.id}.json`;
  check('项目文件已创建（真相源）', fs.existsSync(projFile), projFile);

  // ---------- 场景 4: db.json 瘦身 ----------
  console.log('\n=== 场景 4: db.json 瘦身验证 ===');
  await new Promise((r) => setTimeout(r, 1500)); // 等 fire-and-forget 异步写盘
  const dbAfter = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const entry = dbAfter.chats.find((c) => String(c.id) === String(chat.id));
  check('db.json 中该会话为索引条目', entry && entry._indexOnly === true,
    entry ? `indexOnly=${entry._indexOnly} hasBody=${Array.isArray(entry.messages)}` : 'entry 缺失');
  const sizeAfter = fs.statSync(DB_PATH).size;
  check('db.json 体积保持精简', sizeAfter < 5 * 1024 * 1024,
    `${(sizeBefore / 1024 / 1024).toFixed(2)}MB → ${(sizeAfter / 1024 / 1024).toFixed(2)}MB`);

  // ---------- 场景 2: LLM 流式响应 ----------
  console.log('\n=== 场景 2: 发送消息 → LLM 流式响应 (Bug #13 核心) ===');
  const marker = `REGRESS_${Date.now()}`;
  const t0 = Date.now();
  const sse = await sendSse(chat.id, {
    content: `请只回复这一串字符，不要做任何别的事：${marker}`,
    projectId: pid,
  });
  const took = Date.now() - t0;
  const chunks = parseChunks(sse.acc);
  const text = chunks.join('');
  check('SSE 返回 200', sse.status === 200, `status=${sse.status} took=${took}ms`);
  check('LLM 收到并回应了用户消息', text.includes(marker),
    `回复长度=${text.length} 含标记=${text.includes(marker)}`);
  console.log('    回复内容:', text.replace(/\s+/g, ' ').slice(0, 200));

  // 消息落库检查（项目文件 = 真相源）
  const saved = JSON.parse(fs.readFileSync(projFile, 'utf-8'));
  const roles = (saved.messages || []).map((m) => m.role);
  check('用户消息已落库', roles.includes('user'), `roles=[${roles.join(',')}]`);
  check('LLM 回复已落库', roles.includes('assistant'), `roles=[${roles.join(',')}]`);
  const userMsg = (saved.messages || []).find((m) => m.role === 'user');
  check('用户消息内容完整', userMsg && String(userMsg.content).includes(marker),
    userMsg ? String(userMsg.content).slice(0, 80) : 'none');

  // ---------- 场景 3: 附件上传（Bug #14: 413） ----------
  console.log('\n=== 场景 3: 附件上传 >1MB (Bug #14: bodyLimit 413) ===');
  const bigText = 'A'.repeat(1024 * 1024 + 500 * 1024); // ~1.5MB
  const b64 = Buffer.from(bigText, 'utf-8').toString('base64'); // ~2MB
  const chat2 = JSON.parse((await req('POST', '/api/v1/chats', {
    projectId: pid, title: '附件测试', modelId: REGRESS_MODEL,
  })).body);
  // 附件随 /send 一起提交（attachments[] 字段）
  const up = await sendSse(chat2.id, {
    content: '这是一个附件测试，请回复 OK',
    projectId: pid,
    attachments: [{
      name: 'big.txt', type: 'text/plain', size: bigText.length,
      content: `data:text/plain;base64,${b64}`,
    }],
  });
  check('1.5MB 附件未被 413 拒绝', up.status !== 413,
    `status=${up.status}`);
  check('附件上传返回成功', up.status === 200,
    `status=${up.status}`);
  const upChunks = parseChunks(up.acc);
  check('带附件的请求收到 LLM 响应', upChunks.join('').length > 0,
    `回复长度=${upChunks.join('').length}`);

  // ---------- 汇总 ----------
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(56));
  console.log(`回归结果: ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('失败项:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail || ''}`));
  }
  console.log('='.repeat(56));

  // 清理测试项目
  const del = await req('DELETE', `/api/v1/projects/${pid}`);
  console.log(`清理测试项目 ${pid}: status=${del.status}`);
  if (fs.existsSync(proj.workspace)) {
    fs.rmSync(proj.workspace, { recursive: true, force: true });
    console.log(`已删除测试目录 ${proj.workspace}`);
  }

  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(2); });
