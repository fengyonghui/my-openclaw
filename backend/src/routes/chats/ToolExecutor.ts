/**
 * ToolExecutor - 工具调用执行器
 *
 * 处理各种工具调用的执行逻辑
 * 使用 Hermes 的跨平台方案：
 *   - getSystemInfo() 获取平台/shell 信息
 *   - toWSLPath() 将 Windows 路径转为 /mnt/d/...
 *   - SystemCommands 中的命令映射
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec, execFile } from 'child_process';
import { FileToolService } from '../../services/FileToolService.js';
import { getBuiltinShellSkill, getBuiltinFileIOSkill } from '../../services/BuiltinSkills.js';
import { DbService } from '../../services/DbService.js';
import { getSystemInfo } from '../../services/SystemCommands.js';
import { toWSLPath, toWindowsPath, getProjectWorkspacePath } from '../../services/PathService.js';
import { extractToolCalls } from './ModelRequestor.js';
import { buildToolList, buildToolListForAgent } from '../../services/ToolDefinitions.js';

/**
 * 安全地将工具结果序列化为 JSON 字符串
 * 逻辑：多层降级策略确保结果总是可以被 LLM 处理
 * 
 * 策略 1: 直接 stringify + parse 验证
 * 策略 2: 剥离控制字符后重试
 * 策略 3: 移除函数和 undefined 值后重试
 * 策略 4: 限制字符串长度（防止超长输出）
 * 策略 5: 最终降级到纯文本
 */
function safeToolContent(result: any): string {
  // 策略 1: 正常序列化
  try {
    const str = JSON.stringify(result);
    JSON.parse(str); // 验证双向转换
    return str;
  } catch (e1) {
    console.warn(`[SafeTool] Direct stringify failed: ${(e1 as Error).message}`);
  }

  // 策略 2: 剥离控制字符
  try {
    const cleaned = JSON.stringify(result).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    JSON.parse(cleaned);
    return cleaned;
  } catch (e2) {
    console.warn(`[SafeTool] Control char removal failed: ${(e2 as Error).message}`);
  }

  // 策略 3: 清理不可序列化的值（函数、undefined、symbol）
  try {
    const cleaned = JSON.stringify(result, (key, value) => {
      if (typeof value === 'function' || typeof value === 'undefined') {
        return '[omitted]';
      }
      if (typeof value === 'symbol') {
        return value.toString();
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
    JSON.parse(cleaned);
    return cleaned;
  } catch (e3) {
    console.warn(`[SafeTool] Value cleanup failed: ${(e3 as Error).message}`);
  }

  // 策略 4: 限制字符串长度（防止超长输出导致 LLM 处理失败）
  try {
    const str = JSON.stringify(result);
    const MAX_LENGTH = 50000; // 50KB 限制
    let truncated = false;
    let content = str;
    if (str.length > MAX_LENGTH) {
      content = str.slice(0, MAX_LENGTH);
      truncated = true;
    }
    JSON.parse(content);
    if (truncated) {
      return JSON.stringify({
        _truncated: true,
        _originalLength: str.length,
        _preview: str.slice(0, 2000),
        message: `[输出被截断] 原始长度 ${str.length} 字符，超过 ${MAX_LENGTH} 字符限制`
      });
    }
    return content;
  } catch (e4) {
    console.warn(`[SafeTool] Length truncation failed: ${(e4 as Error).message}`);
  }

  // 策略 5: 最终降级 - 转为纯文本
  try {
    const safe = JSON.stringify(String(result));
    JSON.parse(safe);
    return safe;
  } catch {
    // 最坏情况：返回占位符
    return JSON.stringify({
      error: '工具结果序列化失败',
      type: typeof result,
      preview: String(result).slice(0, 500)
    });
  }
}

/**
 * 剥离 messages 中所有可能损坏上游 LLM 的不可序列化/损坏字段。
 * 实施策略：深拷贝 + 移除控制字符 + 验证 JSON 双向。失败则降级到 String()。
 */
function sanitizeMessages(messages: any[]): any[] {
  return messages.map((m: any) => {
    const copy: any = { ...m };
    if (typeof copy.content === 'string') {
      copy.content = copy.content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }
    if (copy.tool_calls && Array.isArray(copy.tool_calls)) {
      copy.tool_calls = copy.tool_calls.map((tc: any) => {
        const tcCopy: any = { ...tc };
        if (tcCopy.function && typeof tcCopy.function.arguments === 'string') {
          try {
            // 验证 arguments JSON 有效
            JSON.parse(tcCopy.function.arguments);
          } catch {
            // 损坏的 arguments → 替换为空对象
            console.warn(`[Sanitize] Broken tool_call arguments, replacing with {}: ${tcCopy.function.arguments.slice(0, 80)}`);
            tcCopy.function.arguments = '{}';
          }
        }
        return tcCopy;
      });
    }
    return copy;
  });
}

export type ToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

export interface ToolResult {
  success?: boolean;
  error?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  [key: string]: any;
}

/**
 * 带重试 + 超时的 fetch。
 *
 * - 5xx 且非 auth 错误：重试（默认 3 次，1s/2s/4s 退避）
 * - 503 auth_unavailable：立即返回（重试无意义）
 * - 4xx：立即返回（客户端错误，重试也是同样错）
 * - 网络错误 / 超时：重试
 */
async function fetchWithRetry(
  url: string,
  options: any,
  config: { maxAttempts?: number; timeoutMs?: number; contextLabel?: string } = {}
): Promise<{ response: Response; attempt: number; totalAttempts: number }> {
  const maxAttempts = config.maxAttempts ?? 3;
  const timeoutMs = config.timeoutMs ?? 60000;
  const label = config.contextLabel ?? 'fetch';
  const delays = [1000, 2000, 4000];
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        if (attempt > 1) {
          console.log(`[${label}] ✅ Succeeded on attempt ${attempt}/${maxAttempts}`);
        }
        return { response: res, attempt, totalAttempts: attempt };
      }

      // 4xx 客户端错误：不重试
      if (res.status >= 400 && res.status < 500) {
        return { response: res, attempt, totalAttempts: attempt };
      }

      // 5xx：先看 body 判定是否是永久错误
      const errText = await res.text();
      const isAuthError = /auth_unavailable|invalid_api_key|unauthorized|authentication/i.test(errText);

      if (isAuthError) {
        console.error(`[${label}] ❌ Auth error on attempt ${attempt}, skip retry: ${errText.slice(0, 150)}`);
        // 把 body 重新放回（res.text() 只能消费一次）
        return {
          response: new Response(errText, { status: res.status, statusText: res.statusText, headers: res.headers }),
          attempt,
          totalAttempts: attempt
        };
      }

      // 瞬时 5xx：还有重试机会就重试
      if (attempt < maxAttempts) {
        console.warn(`[${label}] ⚠️  HTTP ${res.status} on attempt ${attempt}/${maxAttempts}, retrying in ${delays[attempt - 1]}ms`);
        lastError = { status: res.status, errText };
        await new Promise(r => setTimeout(r, delays[attempt - 1]));
        continue;
      }
      // 重试用尽
      return {
        response: new Response(errText, { status: res.status, statusText: res.statusText, headers: res.headers }),
        attempt,
        totalAttempts: attempt
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      // 网络错误 / 超时
      const isLast = attempt >= maxAttempts;
      const reason = err.name === 'AbortError' ? `timeout (${timeoutMs}ms)` : err.message;
      if (isLast) {
        throw new Error(`[${label}] Network error after ${attempt}/${maxAttempts} attempts: ${reason}`);
      }
      console.warn(`[${label}] ⚠️  ${reason} on attempt ${attempt}/${maxAttempts}, retrying in ${delays[attempt - 1]}ms`);
      lastError = err;
      await new Promise(r => setTimeout(r, delays[attempt - 1]));
    }
  }
  throw lastError;
}

/**
 * 规范化 child_process.exec 错误。
 *
 * Node.js 默认对"进程退出码非 0"产生 err.message 形如
 *   "Command failed: <cmd>\n  stderr: ...\n  stdout: ..."
 * 这种纯文本对 LLM 不友好，且会把"grep/findstr 无匹配"误报为失败。
 *
 * 改进点：
 * 1. 错误消息显式带上退出码与原始命令（截断 200 字符）
 * 2. exit=1 且 stdout/stderr 都为空 → 通常是 grep/findstr/Select-String 的"无匹配"，
 *    改写为信息性错误，并附 _note 提示 LLM 改用 PowerShell Select-String 或加 /R 标志
 */
function sanitizeArgsForLog(args: any, sensitiveKeys: string[]): any {
  if (!args || typeof args !== 'object') return args;
  const sanitized: any = {};
  for (const [key, value] of Object.entries(args)) {
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
    if (isSensitive && typeof value === 'string') {
      // 截断长内容，显示前 100 字符 + "..."
      sanitized[key] = value.length > 100 ? value.slice(0, 100) + '...' : value;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeArgsForLog(value, sensitiveKeys);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function normalizeExecError(
  err: any,
  stdout: string,
  stderr: string,
  originalCommand: string,
): ToolResult {
  const exitCode = typeof err?.code === 'number' ? err.code : undefined;
  const trimmedOut = (stdout || '').trim();
  const trimmedErr = (stderr || '').trim();
  const cmdPreview = originalCommand.length > 200
    ? originalCommand.slice(0, 200) + '...'
    : originalCommand;
  const sys = getSystemInfo();

  // 检测 Windows 下执行 Linux 命令的错误
  const linuxCmdPatterns = [
    { linux: 'grep', win: 'findstr 或 Select-String' },
    { linux: 'cat', win: 'Get-Content 或 type' },
    { linux: 'ls', win: 'dir 或 Get-ChildItem' },
    { linux: 'cd', win: 'Set-Location 或 cd' },
    { linux: 'mkdir', win: 'New-Item -ItemType Directory' },
    { linux: 'rm', win: 'Remove-Item' },
    { linux: 'cp', win: 'Copy-Item' },
    { linux: 'mv', win: 'Move-Item' },
    { linux: 'touch', win: 'New-Item -ItemType File' },
    { linux: 'chmod', win: 'icacls (权限)' },
    { linux: 'find', win: 'Get-ChildItem -Recurse' },
    { linux: 'head', win: 'Get-Content -TotalCount' },
    { linux: 'tail', win: 'Get-Content -Tail' },
    { linux: 'wc', win: '(Get-Content).Length' },
    { linux: 'sed', win: '-replace 或 Select-String -Replace' },
    { linux: 'awk', win: 'PowerShell 表达式' },
    { linux: 'echo', win: 'Write-Output 或 echo' },
    { linux: 'which', win: 'Get-Command' },
    { linux: 'pwd', win: 'Get-Location' },
    { linux: 'ps', win: 'Get-Process' },
    { linux: 'kill', win: 'Stop-Process' },
    { linux: 'curl', win: 'Invoke-WebRequest 或 curl (已安装)' },
    { linux: 'wget', win: 'Invoke-WebRequest' },
    { linux: 'zip', win: 'Compress-Archive' },
    { linux: 'unzip', win: 'Expand-Archive' },
  ];

  const errMsg = (err?.message || '').toLowerCase();
  const isLinuxCmdNotFound = errMsg.includes('not found') || errMsg.includes('不是内部或外部命令') || errMsg.includes('无法识别');

  if (isLinuxCmdNotFound && sys.isWindows) {
    // 尝试找出使用了哪个 Linux 命令
    const firstWord = originalCommand.trim().split(/\s+/)[0].toLowerCase();
    let suggestedCmd = '';
    for (const pattern of linuxCmdPatterns) {
      if (firstWord === pattern.linux) {
        suggestedCmd = pattern.win;
        break;
      }
    }
    
    const suggestion = suggestedCmd 
      ? `命令 "${firstWord}" 在 Windows 上不存在。请使用: ${suggestedCmd}`
      : '该命令在 Windows 上不可用。请使用 PowerShell 等效命令。';

    return {
      error: `命令不存在: ${cmdPreview}`,
      _exitCode: exitCode,
      _note: suggestion,
      _windowsTip: 'Windows 提示: grep→findstr, cat→Get-Content, ls→dir, mkdir→New-Item, rm→Remove-Item, cp→Copy-Item'
    };
  }

  // 经典 grep/findstr "无匹配" 模式：exit=1 且输出全空
  // 仅对 grep/findstr/Select-String 类命令适用，对其他命令（如 mvn、java）应报告真实错误
  const likelySearchCmd = /\bgrep\b|\bfindstr\b|\bSelect-String\b/i.test(originalCommand);
  if (exitCode === 1 && !trimmedOut && !trimmedErr && likelySearchCmd) {
    return {
      success: false,
      stdout,
      stderr,
      error: `Command exited with code 1 (可能无匹配或文件不存在): ${cmdPreview}`,
      _exitCode: 1,
      _note: 'exit=1 + 空输出通常是 grep/findstr/Select-String 的"无匹配"结果。'
           + 'Windows 上查找代码建议优先用 PowerShell Select-String（支持 Unicode），'
           + '若用 findstr 必须加 /R 标志支持 \\| 语法。',
    };
  }

  // 超时杀死：child_process.exec 命中 timeoutMs 时给子进程发 SIGTERM，err.code 为 null，
  // err.killed=true, err.signal='SIGTERM'。如果不专门识别，上层只能看到 "exit=?" 干瞪眼。
  // 修复：明确告诉 LLM 这是被 timeout 杀掉的，并指引它用 timeout 参数或拆分任务。
  const wasKilled = err?.killed === true || (typeof err?.signal === 'string' && err.signal.length > 0);
  const isTimeout = wasKilled && (exitCode === undefined || exitCode === null)
                    || /timeout|timed out|超时/i.test(err?.message || '');
  if (isTimeout) {
    return {
      error: `命令执行超时被中止 [exit=?]: ${cmdPreview}`,
      stdout,
      stderr,
      _exitCode: null,
      _killed: true,
      _signal: err?.signal || 'SIGTERM',
      _note: 'child_process.exec 命中 timeout 阈值后 SIGTERM 了子进程。'
           + '可通过 shell_exec 工具的 timeout 参数（秒，默认 60，最大 300）拉长，'
           + '或把任务拆成可中断的多步短任务，或在后台轮询状态。',
    };
  }

  // 输出过大：maxBuffer 溢出。通常发生在命令产生大量输出时（如递归列出大目录）。
  // 提示 LLM 缩小输出范围（加 -maxdepth、-name 过滤、或 head/tail 限制行数）。
  if (/maxBuffer|output.*exceed|buffer.*exceed/i.test(err?.message || '')) {
    return {
      error: `命令输出过大，超出缓冲区限制 [exit=?]: ${cmdPreview}`,
      stdout: trimmedOut || '(输出被截断，超过 500KB)',
      stderr: trimmedErr || '',
      _exitCode: null,
      _note: '命令产生了大量输出（超过 500KB）。请缩小输出范围：\n'
           + '1. 添加 -maxdepth 限制递归深度\n'
           + '2. 使用 search_files 工具替代 find（支持 -name 过滤）\n'
           + '3. 用 head/tail 限制输出行数\n'
           + '4. 缩小搜索目录范围',
    };
  }

  // 其他错误：保留原始 err.message（通常含 stderr），并附上退出码
  // 但先清理 PowerShell CLIXML 格式的错误输出（<S S="Error">...</S> 标签）
  let cleanError = err?.message || 'Unknown exec error';

  // ── Python traceback 精简：提取关键错误行 ────────────────────────
  // LLM 生成的 Python 脚本出错时，traceback 可能长达数百行，
  // 真正有用的是最后一行 KeyError/IndexError/NameError 等和对应的文件+行号。
  // 提取模式：File "xxx", line N → 错误类型 → 具体键/属性
  const pythonTraceback = cleanError.match(/Traceback \(most recent call last\):([\s\S]*)$/);
  if (pythonTraceback) {
    const tb = pythonTraceback[1];
    // 提取最后一行错误: 错误类型: 具体错误信息
    const lastErrorMatch = tb.match(/(KeyError|IndexError|AttributeError|TypeError|ValueError|NameError|FileNotFoundError|ModuleNotFoundError|ImportError|SyntaxError|AttributeError):\s*(.+)$/m);
    if (lastErrorMatch) {
      const errorType = lastErrorMatch[1];
      let errorMsg = lastErrorMatch[2].trim();
      // 提取出错的文件和行号
      const fileLineMatch = tb.match(/File\s+"([^"]+)",\s*line\s*(\d+)/g);
      const lastFileLine = fileLineMatch ? fileLineMatch[fileLineMatch.length - 1] : '';
      // 如果是 NameError 带 "Did you mean" 建议，直接使用该建议作为修复指引
      const suggestMatch = errorMsg.match(/Did you mean:\s*['"]([^'"]+)['"]/);
      if (suggestMatch) {
        errorMsg = `Undefined '${errorType.toLowerCase() === 'nameerror' ? 'name' : 'attribute'}: ${errorMsg.split(':')[0]} — use '${suggestMatch[1]}' instead`;
      }
      cleanError = `${errorType}: ${errorMsg} (${lastFileLine})`;
    }
  }

  // 去除 CLIXML 标签：<S S="Error">text</S>_x000D__x000A_
  cleanError = cleanError.replace(/<S S="Error">\s*([\s\S]*?)<\/S>/gi, '$1');
  // 去除 CLIXML 控制字符 (_x000D_ = CR, _x000A_ = LF)
  cleanError = cleanError.replace(/_x000[DA]_/g, '');
  // 去除 CLIXML 头部声明
  cleanError = cleanError.replace(/^#< CLIXML[\s\S]*?<Objs[\s\S]*?>\s*/, '');
  // 去除剩余 XML 标签
  cleanError = cleanError.replace(/<[^>]+>/g, '');

  return {
    error: `${cleanError} [exit=${exitCode ?? '?'}]`,
    stdout,
    stderr,
    _exitCode: exitCode,
  };
}

/**
 * 执行工具调用
 */
export async function executeToolCall(
  project: any,
  toolCall: ToolCall,
  allProjectAgents: any[],
  allEnabledSkills: any[],
  reply?: any
): Promise<ToolResult> {
  const fn = toolCall.function?.name;
  const rawArgs = toolCall.function?.arguments || '{}';

  // 尝试解析 JSON
  let args: any = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch (parseError: any) {
    console.error(`[JSON Parse Error] Failed to parse tool arguments: ${parseError.message}`);
    return handleJsonParseError(rawArgs, parseError);
  }

  // 工具调用日志（隐藏敏感参数）
  console.log('');
  console.log('═'.repeat(60));
  console.log('🔧 TOOL CALL: ' + fn);
  console.log('═'.repeat(60));
  // 隐藏敏感参数内容
  const sensitiveKeys = ['oldText', 'newText', 'content', 'old_text', 'new_text', 'code', 'script', 'data'];
  const sanitizedArgs = sanitizeArgsForLog(args, sensitiveKeys);
  console.log(' Args: ' + JSON.stringify(sanitizedArgs).slice(0, 500));
  console.log(' Workspace: ' + project.workspace);
  console.log('═'.repeat(60));
  console.log('');

  // 工作目录验证：确保 workspace 存在且有效
  if (!project.workspace) {
    console.error('[ERROR] Project workspace is undefined or null');
    return {
      error: '工作目录未设置',
      _projectId: project.id,
      suggestion: '项目的工作目录未配置。请检查项目设置。'
    };
  }

  // 尝试访问 workspace，如果不存在则创建
  try {
    if (!fs.existsSync(project.workspace)) {
      console.log(`[WARN] Workspace does not exist, creating: ${project.workspace}`);
      fs.mkdirSync(project.workspace, { recursive: true });
    }
  } catch (fsError: any) {
    console.error(`[ERROR] Cannot access workspace ${project.workspace}: ${fsError.message}`);
    return {
      error: `无法访问工作目录: ${fsError.message}`,
      _workspace: project.workspace,
      _projectId: project.id,
      suggestion: `工作目录 "${project.workspace}" 不存在或无法访问。请检查项目路径是否正确。`
    };
  }

  switch (fn) {
    case 'list_files':
      return await FileToolService.listFiles(project.workspace, args.path || '.', Number(args.depth) || 3);
    case 'read_file':
      return await FileToolService.readFile(project.workspace, args.path, Number(args.offset) || 1, Number(args.limit) || 200);
    case 'search_files':
      return await executeSearchFiles(project, args);
    case 'write_file':
      return await handleWriteFile(project, args);
    case 'edit_file':
      return await FileToolService.editFile(project.workspace, args.path, args.oldText || '', args.newText || '');
    case 'delegate_to_agent':
      return await executeAgentDelegation(project, args, allProjectAgents, allEnabledSkills, reply);
    case 'shell_exec':
    case 'shell-cmd':
      return await executeShellCommand(project, args);
    case 'inline-python-edit':
      return await executePythonCommand(project, args);
    case 'file-io':
      return await executeFileIO(project, args, allProjectAgents, allEnabledSkills, reply);
    default:
      // 尝试从项目技能中查找
      const skill = allEnabledSkills.find((s: any) => s.name === fn);
      if (skill) {
        return { info: `技能 "${fn}" 已收到参数`, skillContent: skill.rawContent || skill.description };
      }
      // 未知工具名 - 返回结构化错误而不是抛出异常
      const knownTools = ['list_files', 'read_file', 'write_file', 'edit_file', 'delegate_to_agent', 'shell_exec', 'shell-cmd', 'inline-python-edit', 'file-io'];
      return {
        error: `未知工具: ${fn}`,
        _toolName: fn,
        _availableTools: knownTools,
        suggestion: `可用的工具: ${knownTools.join(', ')}。请使用这些工具之一，或检查工具名拼写是否正确。`
      };
  }
}

/**
 * 增强的 JSON 解析错误修复
 * 支持多种错误类型的自动修复
 */
function handleJsonParseError(rawArgs: string, parseError: Error): ToolResult {
  console.error(`[JSON Parse Error] Failed to parse tool arguments: ${parseError.message}`);
  console.error(`[JSON Parse Error] Raw args length: ${rawArgs.length}, preview: ${JSON.stringify(rawArgs.slice(0, 200))}`);

  let fixedArgs = rawArgs;
  let fixAttempts = 0;
  const MAX_FIX_ATTEMPTS = 5;

  // ── 策略 1: Unterminated string ──────────────────────────────────
  // 核心思路：找到截断点，截断 content 值到截断点，然后正确闭合 JSON。
  // 旧实现只是盲目追加 '"' + '}'，但 content 内部可能含未转义的 " 字符，
  // 导致追加的 '"' 反而嵌入了字符串中间，无法真正闭合。
  if (parseError.message.includes('Unterminated string')) {
    fixAttempts++;

    // 提取错误位置
    const posMatch = parseError.message.match(/position\s+(\d+)/);
    const errorPos = posMatch ? parseInt(posMatch[1]) : -1;

    // 从截断点往前找，确定我们在哪个字段里
    // 倒查最近的 "content" 或 "oldText" 或 "newText" 字段
    // 使用正则而非 indexOf，因为 LLM 输出可能带或不带冒号后的空格
    let lastFieldMatch: RegExpMatchArray | null = null;
    let lastFieldValStart = -1;
    if (errorPos >= 0 && errorPos <= fixedArgs.length) {
      const beforeCut = fixedArgs.slice(0, errorPos);
      // 匹配 "fieldName" 后跟可选空格、冒号、可选空格、开引号
      const fieldPattern = /"(content|oldText|newText|script|code|data|path|command|cmd|code)"\s*:\s*"/;
      // 找最后一个匹配（最近的字段）
      let bestIdx = -1;
      let bestName = '';
      let m;
      const re = new RegExp(fieldPattern.source, 'g');
      while ((m = re.exec(beforeCut)) !== null) {
        if (m.index > bestIdx) {
          bestIdx = m.index;
          bestName = m[1];
        }
      }
      if (bestIdx >= 0) {
        // 计算字段值开始位置：匹配串末尾的 " 之后
        const snippet = beforeCut.slice(bestIdx);
        const colonQuoteMatch = snippet.match(/"\s*:\s*"/);
        if (colonQuoteMatch) {
          lastFieldValStart = bestIdx + colonQuoteMatch.index! + colonQuoteMatch[0].length;
          lastFieldMatch = { index: bestIdx, 0: snippet } as any;
        }
      }

      if (lastFieldMatch) {
        // 找到了被截断的字段
        //
        // 问题：content 内部可能含未转义的 " 字符（LLM 生成代码/HTML 时常见），
        // 简单追加 '"' 会关闭到错误的引号位置。
        //
        // 解决方案：定位到字段值开始的位置，
        // 把从那里到 errorPos 的内容替换为一个安全的截断标记字符串，
        // 然后正确闭合 JSON。
        //
        // 构建安全版本：保留字段名，截断值替换为标记，丢弃 errorPos 之后的残片
        const prefix = fixedArgs.slice(0, lastFieldValStart);
        const safeContent = '[文件内容过长，已截断至 ' + errorPos + ' 字符]';
        const rebuilt = prefix + safeContent + '"';

        // 补齐缺少的 }
        const openBraces = (rebuilt.match(/{/g) || []).length;
        const closeBraces = (rebuilt.match(/}/g) || []).length;
        const missing = openBraces - closeBraces;
        const withBraces = rebuilt + '}'.repeat(Math.max(0, missing));

        try {
          JSON.parse(withBraces);
          fixedArgs = withBraces;
          console.log(`[JSON Fix #${fixAttempts}] Replaced truncated field "${bestName}" at pos ${errorPos}, added ${missing} closing brace(s)`);
        } catch {
          // 如果重建失败，尝试 ±1 个括号
          // 额外尝试：原始 JSON 可能以 } 结尾但被截断了，尝试补 1 个 }
          for (let n = Math.max(0, missing - 1); n <= missing + 2; n++) {
            const alt = rebuilt + '}'.repeat(n);
            try {
              JSON.parse(alt);
              fixedArgs = alt;
              console.log(`[JSON Fix #${fixAttempts}] Replaced truncated field "${bestName}" at pos ${errorPos}, ${n} closing brace(s)`);
              break;
            } catch {}
          }
          // 最后尝试：如果 prefix 以 { 开头但没有匹配的 }，直接补一个
          if (fixedArgs === rawArgs && rebuilt.startsWith('{')) {
            const alt2 = rebuilt + '}';
            try {
              JSON.parse(alt2);
              fixedArgs = alt2;
              console.log(`[JSON Fix #${fixAttempts}] Replaced truncated field "${bestName}", added 1 closing brace (fallback)`);
            } catch {}
          }
        }
      }
    }

    // 兜底：只在智能截断没找到匹配字段时才用旧逻辑
    const smartTruncateSucceeded = (errorPos >= 0 && lastFieldMatch && fixedArgs !== rawArgs);
    if (!smartTruncateSucceeded) {
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
            console.log(`[JSON Fix #${fixAttempts}] Closed unterminated string + ${n} brace(s) (content branch)`);
            break;
          } catch {}
        }
      } else {
        const missingBraces = openBraces - closeBraces;
        fixedArgs = fixedArgs + '"';
        for (let n = 0; n <= missingBraces + 3; n++) {
          const candidate = fixedArgs + '}'.repeat(n);
          try {
            JSON.parse(candidate);
            fixedArgs = candidate;
            console.log(`[JSON Fix #${fixAttempts}] Closed string + ${n} brace(s) (generic branch)`);
            break;
          } catch {}
        }
      }
    }
  }

  // 策略 2: Unexpected end of JSON - 补全结尾
  if (parseError.message.includes('Unexpected end of JSON')) {
    fixAttempts++;
    let missing = 0;
    // 统计括号不平衡
    const opens = (fixedArgs.match(/{/g) || []).length + (fixedArgs.match(/\[/g) || []).length;
    const closes = (fixedArgs.match(/}/g) || []).length + (fixedArgs.match(/\]/g) || []).length;
    missing = opens - closes;
    for (let i = 0; i < missing; i++) fixedArgs += '}';
    console.log(`[JSON Fix #${fixAttempts}] Added ${missing} closing brackets`);
  }

  // 策略 3: 移除控制字符和非法字符
  if (fixAttempts === 0) {
    fixAttempts++;
    const cleaned = fixedArgs.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    if (cleaned !== fixedArgs) {
      fixedArgs = cleaned;
      console.log(`[JSON Fix #${fixAttempts}] Removed control characters`);
    }
  }

  // 策略 4: 修复常见的引号问题
  if (fixAttempts === 0 || fixAttempts === 1) {
    fixAttempts++;
    // 修复单引号被误用为双引号
    const singleToDouble = fixedArgs.replace(/'/g, '"');
    if (singleToDouble !== fixedArgs) {
      // 验证是否有效
      try {
        JSON.parse(singleToDouble);
        fixedArgs = singleToDouble;
        console.log(`[JSON Fix #${fixAttempts}] Fixed single quotes to double quotes`);
      } catch {
        // 单引号修复后仍失败，回退
      }
    }
  }

  // 策略 5: 尝试提取有效的 JSON 片段
  if (fixAttempts <= MAX_FIX_ATTEMPTS) {
    fixAttempts++;
    // 尝试找到 { ... } 包裹的有效内容
    const jsonMatch = fixedArgs.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const candidate = jsonMatch[0];
      try {
        JSON.parse(candidate);
        fixedArgs = candidate;
        console.log(`[JSON Fix #${fixAttempts}] Extracted valid JSON fragment (${candidate.length} chars)`);
      } catch {
        // 回退
      }
    }
  }

  // 最终验证
  try {
    const args = JSON.parse(fixedArgs);
    console.log(`[JSON Parse] ✅ Successfully parsed after ${fixAttempts} fix attempt(s)`);
    return { success: true, args, _fixed: true, _fixAttempts: fixAttempts };
  } catch (retryError: any) {
    // 所有修复都失败，返回结构化错误（隐藏原始内容以保护日志）
    console.error(`[JSON Parse] ❌ All ${fixAttempts} fix attempt(s) failed`);
    
    // 提取错误位置信息
    const posMatch = parseError.message.match(/position\s+(\d+)/);
    const errorPos = posMatch ? parseInt(posMatch[1]) : 0;
    
    return {
      error: `JSON 解析失败: ${parseError.message}`,
      _rawError: parseError.message,
      _rawLength: rawArgs.length,
      _errorPosition: errorPos,
      _fixAttempts: fixAttempts,
      // 显示错误位置前后的上下文（不超过 100 字符）
      _contextBefore: rawArgs.slice(Math.max(0, errorPos - 50), errorPos),
      _contextAfter: rawArgs.slice(errorPos, Math.min(rawArgs.length, errorPos + 50)),
      suggestion: 'JSON 参数格式错误，请检查：1. 引号是否成对 2. 括号是否匹配 3. 是否有未转义的特殊字符'
    };
  }
}

/**
 * 处理文件写入
 */
async function handleWriteFile(project: any, args: any): Promise<ToolResult> {
  // 检测内容是否被截断
  if (args._contentTruncated) {
    return {
      error: '⚠️ 文件内容被截断，无法完整写入。',
      suggestion: '请尝试以下方法：\n1. 将文件分成多个小块，分多次写入\n2. 先创建文件骨架，再用 edit_file 分批添加内容'
    };
  }

  const contentLength = (args.content || '').length;
  if (contentLength > 50000) {
    console.log(`[WARN] Large file write: ${args.path}, ${contentLength} chars.`);
  }

  const result = await FileToolService.writeFile(project.workspace, args.path, args.content || '');

  // 关键：返回绝对路径 + 用户的相对路径 + workspace 根
  // 防止 LLM 看到 success 就自顾自总结"写到了 ue/xxx.txt" 而不告诉用户实际位置
  const absPath = path.resolve(project.workspace, result.path);
  return {
    success: true,
    message: `✅ 文件已成功写入`,
    workspace: project.workspace,
    relativePath: result.path,
    absolutePath: absPath.replace(/\\/g, '/'),
    bytes: result.bytes,
    updatedAt: result.updatedAt,
    // 强制让 LLM 在最终回复中报出实际位置
    _must_report: `请在回复中告知用户文件实际写入的完整绝对路径: ${absPath.replace(/\\/g, '/')}`
  };
}

/**
 * 执行文件搜索（替代 shell "find" 命令）
 * 在 workspace 中递归搜索匹配 glob pattern 的文件
 */
async function executeSearchFiles(project: any, args: any): Promise<ToolResult> {
  const searchPath = args.path || '.';
  const pattern = args.pattern || '*';
  const maxDepth = Math.min(Number(args.max_depth) || 5, 10);

  try {
    const { absolutePath } = FileToolService.resolveWorkspacePath(project.workspace, searchPath);
    const results: any[] = [];

    function walk(dir: string, depth: number) {
      return new Promise<void>((resolve) => {
        if (depth > maxDepth) { resolve(); return; }
        fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
          if (err) { resolve(); return; }
          (entries || []).forEach((entry) => {
            if (entry.isFile() && globMatch(entry.name, pattern)) {
              fs.stat(path.join(dir, entry.name), (err, stat) => {
                if (!err) {
                  results.push({
                    path: path.relative(absolutePath, path.join(dir, entry.name)).replace(/\\/g, '/'),
                    name: entry.name,
                    size: stat.size,
                    updatedAt: stat.mtime.toISOString()
                  });
                }
              });
            }
            if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
          });
          resolve();
        });
      });
    }

    await walk(absolutePath, 0);
    return { success: true, count: results.length, results, searchPath, pattern };
  } catch (err: any) {
    return { success: false, error: `文件搜索失败: ${err.message}` };
  }
}

/**
 * 简易 glob 匹配：支持 * 和 ?
 */
function globMatch(filename: string, pattern: string): boolean {
  // 将 glob pattern 转为正则
  const regex = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regex).test(filename);
}

/**
 * 执行 Shell 命令
 *
 * 三系统统一路由：
 * 1. Windows (win32)     → 原生 cmd.exe/powershell，路径保持 Windows 格式 (D:\...)
 * 2. WSL                → wsl.exe 执行，路径转换为 /mnt/d/... 格式
 * 3. Linux (原生)       → 原生执行，路径保持 Linux 格式
 */
export async function executeShellCommand(project: any, args: any): Promise<ToolResult> {
  const command = args.command || args.cmd || args.exec;
  let cwdArg = args.cwd || args.dir || args.workdir;  // 允许模型指定子目录 (相对 workspace) — 修复 cwd 被忽略的 bug
  if (!command) {
    return { error: '缺少参数: command/cmd/exec' };
  }

  // 解析 LLM 提供的 timeout（秒）。ToolDefinitions 承诺 default=60, max=300。
  // 历史 bug：忽略 args.timeout 硬编码 60s，Start-Sleep -Seconds 100 等长任务被 SIGTERM
  // 杀掉后 err.code=null 上报 "exit=?"。这里把 LLM 的合法 timeout 真正应用到 exec()。
  const MIN_TIMEOUT_S = 5;
  const MAX_TIMEOUT_S = 300;
  const DEFAULT_TIMEOUT_S = 60;
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
  const timeoutMs = timeoutSec * 1000;
  console.log(`[Shell] timeout: ${timeoutSec}s (raw args.timeout=${args.timeout})`);

  const sys = getSystemInfo();

  // 验证 cwdArg 是否是有效路径（防止 LLM 生成无效的 cwd 参数）
  if (cwdArg) {
    // 检查是否包含非法字符或过长（可能是 LLM 生成的错误参数）
    const isValidPath = /^[A-Za-z]:[\\\/]|^[\/\.]|^\w:/.test(cwdArg) && 
                        !/[\r\n<>|]/.test(cwdArg) && 
                        cwdArg.length < 500;
    if (!isValidPath) {
      console.log(`[Shell] Invalid cwdArg detected, ignoring: "${cwdArg.slice(0, 100)}..."`);
      cwdArg = undefined;
    }
  }

  // 调试：输出平台检测结果
  console.log(`[Shell] Detected: platform=${sys.platform}, isWSL=${sys.isWSL}, isWindows=${sys.isWindows}, isLinux=${sys.isLinux}, wslDistro=${sys.wslDistro}`);
  console.log(`[Shell] Workspace (raw): ${project.workspace}`);
  console.log(`[Shell] cwd arg: "${cwdArg || '(none)'}"`);

  // ── 预处理：剥离命令开头的 cd xxx && ──────────────────────
  // 后端已通过 cwd 参数设置了正确的工作目录，模型生成的 cd 是多余的。
  // 如果 cd 指向的目录不存在会导致整个命令失败。剥离它让核心命令正常执行。
  let effectiveCommand = command.trim();
  console.log(`[Shell] effectiveCommand: "${effectiveCommand.slice(0, 200)}"`);
  console.log(`[Shell] effectiveCommand bytes: ${JSON.stringify(effectiveCommand).slice(0, 200)}`);
  // 匹配: cd [drive:]\\path [&& 后面的内容]
  // Windows: cd D:\\xxx && ..., cd "D:\\xxx" && ..., cd /d D:\\xxx && ...
  // Linux/WSL: cd /path && ...
  // 使用 [^] 替代 . 来匹配任意字符（含换行），避免需要 es2018 的 s 标志
  const cdAndPattern = /^cd\s+(['"]?)([^'"\n]+)\1\s*&&?\s*([\s\S]*)$/;
  const cdMatch = effectiveCommand.match(cdAndPattern);
  console.log(`[Shell] cdMatch: ${cdMatch ? 'MATCHED' : 'NO MATCH'}`);
  if (cdMatch) {
    console.log(`[Shell] cdMatch[0]: "${cdMatch[0].slice(0, 100)}"`);
    console.log(`[Shell] cdMatch[1]: "${cdMatch[1]}"`);
    console.log(`[Shell] cdMatch[2]: "${cdMatch[2]}"`);
    console.log(`[Shell] cdMatch[3]: "${cdMatch[3]?.slice(0, 100)}"`);
    console.log(`[Shell] cdMatch[3] trimmed: "${cdMatch[3]?.trim().slice(0, 100)}"`);
  }
  if (cdMatch && cdMatch[3].trim()) {
    const stripped = cdMatch[3].trim();
    console.log(`[Shell] Stripped redundant cd prefix: "${cdMatch[0].slice(0, 80)}${cdMatch[0].length > 80 ? '...' : ''}"`);
    console.log(`[Shell] Effective command: "${stripped.slice(0, 80)}${stripped.length > 80 ? '...' : ''}"`);
    effectiveCommand = stripped;
  } else if (cdMatch && !cdMatch[3].trim()) {
    // cd xxx 是唯一命令（没有后续内容），直接返回成功（cwd 已经设置）
    console.log(`[Shell] Command is only "cd ..." — skipping (cwd already set to "${project.workspace}")`);
    return { success: true, stdout: '', stderr: '', _note: 'cd skipped: cwd already set to ' + project.workspace };
  }

  // 安全检查：禁止不带路径的目录操作命令
  const trimmedCmd = effectiveCommand.trim();
  const dangerousCmds = ['mkdir', 'md', 'rmdir', 'rm', 'del', 'rm -rf', 'del /f /s /q'];
  for (const dangerous of dangerousCmds) {
    if (trimmedCmd === dangerous || trimmedCmd.startsWith(dangerous + ' ')) {
      const parts = trimmedCmd.split(/\s+/);
      if (parts.length < 2 || parts[1].startsWith('-')) {
        return {
          error: `命令 "${dangerous}" 缺少路径参数。请提供完整命令，如 "${dangerous} src/utils"`,
          suggestion: '如果要创建目录，请使用完整路径参数'
        };
      }
    }
  }

  // ============================================================
  // 统一路由：根据检测到的系统类型决定执行方式
  // ============================================================

  if (sys.isWindows) {
    // ── Windows 原生执行 ──
    // 将 workspace 路径转为 Windows 格式，确保命令能正确访问
    const windowsWorkspace = sys.isWSL
      ? toWindowsPath(project.workspace)  // WSL 后端访问 Windows 文件
      : project.workspace;                 // 原生 Windows
    // cwd 解析: 如果模型提供 cwdArg (相对路径), 拼接到 workspace
    const cwd = cwdArg
      ? path.win32.isAbsolute(cwdArg)
        ? cwdArg
        : path.posix.join(windowsWorkspace.replace(/\\/g, '/'), cwdArg).replace(/\//g, '\\')
      : windowsWorkspace;
    console.log(`[Shell] Resolved cwd: ${cwd} (cwdArg=${cwdArg || 'none'})`);

    // 统一通过 convertCmdToPowerShell 归一化所有命令（bash/cmd/PowerShell 混合）
    // 不再区分 isPowerShellCmd — 所有命令经过同一套转换管道，避免 LLM 利用路由差异
    const normalized = convertCmdToPowerShell(effectiveCommand);
    return executePowerShellCommand(normalized, cwd, timeoutMs);
  }

  if (sys.isWSL) {
    // ── WSL 环境执行 ──
    // 所有路径统一转为 /mnt/d/... 格式，通过 wsl.exe 执行
    const wslWorkspace = toWSLPath(project.workspace);
    const cwd = cwdArg
      ? path.posix.isAbsolute(cwdArg) || cwdArg.startsWith('/mnt/')
        ? cwdArg
        : path.posix.join(wslWorkspace, cwdArg)
      : wslWorkspace;
    console.log(`[Shell] Resolved cwd: ${cwd} (cwdArg=${cwdArg || 'none'})`);
    return executeLinuxCommand(`wsl.exe ${effectiveCommand}`, cwd, timeoutMs);
  }

  // ── 原生 Linux/macOS 执行 ──
  const localWorkspace = getProjectWorkspacePath(project.workspace);
  const cwd = cwdArg
    ? path.posix.isAbsolute(cwdArg) || cwdArg.startsWith('/')
      ? cwdArg
      : path.posix.join(localWorkspace, cwdArg)
    : localWorkspace;
  console.log(`[Shell] Resolved cwd: ${cwd} (cwdArg=${cwdArg || 'none'})`);
  return executeLinuxCommand(effectiveCommand, cwd, timeoutMs);
}

/**
 * 执行 PowerShell 命令
 *
 * 问题修复：
 * 1. 末尾反斜杠（如 C:\）：PowerShell -Command "..." 中 \ 在闭合 " 前被当作转义符 → 替换为 /
 * 2. shell 重定向（2>&1）：PowerShell 不识别 → 直接剥离
 * 3. 引号嵌套：改用 -Command {block} 语法，避免引号解析问题
 * 4. LLM 把 bash 习惯带过来：\$ → $（PowerShell 用 ` 反引号作转义，\ 是字面字符，
 *    \$ 会被解析为字面 \$ + 后续 token，导致 "Unexpected token '\$_.Exception.Message'"）
 */
async function executePowerShellCommand(command: string, cwd: string, timeoutMs: number = 60000): Promise<ToolResult> {
  return new Promise((resolve) => {
    const MAX_OUTPUT = 500 * 1024;

    // ── 特殊处理：python3/python -c "..." 多行脚本 ────────────────
    // LLM 经常生成多行 Python 代码，如:
    //   python3 -c "
    //   import akshare as ak
    //   ...
    //   "
    // 这种代码包含换行符和引号，直接放进 PowerShell {block} 会解析失败。
    // 解决方案：将 Python 代码写入临时文件，用 python script.py 执行。
    const pythonCMatch = command.match(/^(python3?|py)\s+-c\s+"([\s\S]+)"\s*$/i);
    if (pythonCMatch) {
      const pythonBin = pythonCMatch[1];
      const script = pythonCMatch[2];
      const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-py-'));
      const scriptPath = path.join(tmpPath, 'script.py');
      fs.writeFileSync(scriptPath, script, 'utf-8');
      execFile(pythonBin, [scriptPath], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT
      }, (err, stdout, stderr) => {
        // 清理临时文件
        try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch {}
        if (err) {
          resolve(normalizeExecError(err, stdout, stderr, command));
        } else {
          resolve({ success: true, stdout, stderr });
        }
      });
      return;
    }
    // 处理 python3 -c '...'（单引号包裹）
    const pythonCMatchSingle = command.match(/^(python3?|py)\s+-c\s+'([\s\S]+)'\s*$/i);
    if (pythonCMatchSingle) {
      const pythonBin = pythonCMatchSingle[1];
      const script = pythonCMatchSingle[2];
      const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-py-'));
      const scriptPath = path.join(tmpPath, 'script.py');
      fs.writeFileSync(scriptPath, script, 'utf-8');
      execFile(pythonBin, [scriptPath], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT
      }, (err, stdout, stderr) => {
        try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch {}
        if (err) {
          resolve(normalizeExecError(err, stdout, stderr, command));
        } else {
          resolve({ success: true, stdout, stderr });
        }
      });
      return;
    }

    // 特殊处理：-File 参数（执行 .ps1 脚本文件），不能包装在 -Command {} 中
    // 注意：LLM 有时会写成 -File "script.ps1;Get-Content ..." 其中 ; 被错误吸收进文件名。
    // 修复：先匹配 -File 后的路径（到第一个 ; 或空白为止），再把剩余部分当作后续命令。
    const fileMatch = command.match(/^(powershell\s+[^\s]*\s+)?-File\s+"?([^";\s]+)"?(.*)$/i);
    if (fileMatch) {
      const psPrefix = fileMatch[1]?.trim() || 'powershell -NoProfile -ExecutionPolicy Bypass';
      const scriptPath = fileMatch[2].trim();
      const restArgs = fileMatch[3]?.trim() || '';
      // 如果 restArgs 以 " 开头（如 "Get-Content ...），说明 LLM 把后续命令写在引号里了
      // 剥离外层引号并拼接为 -Command 执行
      let additionalCmd = '';
      if (restArgs) {
        const cleaned = restArgs.replace(/^"|"$/g, '').trim();
        if (cleaned) {
          additionalCmd = ` ; ${cleaned}`;
        }
      }
      const psCmd = `${psPrefix} -File "${scriptPath}"${additionalCmd}`;
      exec(psCmd, {
        cwd,
        shell: 'powershell.exe',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT
      }, (err, stdout, stderr) => {
        if (err) {
          resolve(normalizeExecError(err, stdout, stderr, command));
        } else {
          resolve({ success: true, stdout, stderr });
        }
      });
      return;
    }

  // 清理命令中的 shell/bash 特有语法（PowerShell 不识别）
  // 注意：不在这里剥离 ; 命令链，因为 LLM 经常生成 "pwd ; ls -la" 这样的复合命令，
  // 每个分段都需要独立转换。只剥离 2>/dev/null 和 2>&1。
  let cleanCmd = command;

  // ── 修复 Issue 5：剥离嵌套的 PowerShell 调用 ──
  // LLM 有时会生成 powershell -NoProfile -Command {powershell -NoProfile -Command "..."}
  // 外层已经被 convertCmdToPowerShell 处理过，内层是冗余的二次包装。
  // 检测并提取最内层的实际命令块。
  const nestedPsRegex = /powershell\s+-NoProfile\s+-Command\s+\{((?:[^{}]|\{[^{}]*\})+)\}/i;
  const nestedMatch = cleanCmd.match(nestedPsRegex);
  if (nestedMatch) {
    const innerBlock = nestedMatch[1];
    // 如果内部已经是纯 PowerShell 命令（不含外层 powershell 关键字），直接使用
    if (!/^powershell\s/i.test(innerBlock.trim())) {
      cleanCmd = innerBlock;
    }
  }

  // 处理 powershell -Command "..."（双引号包裹的版本）
  // LLM 有时生成: powershell -Command "(Get-Content 'file' -Encoding Byte -TotalCount 20) -join ','"
  // 外层 {block} 会把它变成: powershell -NoProfile -Command {powershell -Command "(...)"}
  // 需要提取内部的 "..." 内容
  const nestedPsQuoteRegex = /powershell\s+-Command\s+"([^"]+)"/i;
  const nestedQuoteMatch = cleanCmd.match(nestedPsQuoteRegex);
  if (nestedQuoteMatch) {
    const innerCmd = nestedQuoteMatch[1];
    // 如果内部不包含 powershell 关键字，直接使用内部命令
    if (!/powershell\s/i.test(innerCmd)) {
      cleanCmd = innerCmd;
    }
  }

  cleanCmd = cleanCmd
    // 修复 npx tsc 解析错误包的问题
    .replace(/^npx\s+tsc\b/i, `node '${cwd}\\node_modules\\typescript\\lib\\tsc.js'`)
    .replace(/^npx\s+typescript\b/i, `node '${cwd}\\node_modules\\typescript\\lib\\tsc.js'`)
    // 剥离 2>&1 等必须在 npx 替换之后（否则 npx tsc 2>&1 中的 2>&1 会把 tsc 命令吞掉）
    .replace(/\s*2>\/dev\/null\s*;?\s*/g, ' ')           // 剥离 2>/dev/null（含前后分号）
    .replace(/\s*2>\s*&1\s*(\||;|$)/g, '$1')             // 剥离 2>&1（末尾、管道前、分号前）
    .replace(/\s*>\s*&\d\s*$/g, '')                      // 剥离 >&2 等
    .replace(/\s*\|\s*tee\s+[^\s]*/gi, '')               // 剥离 | tee
    .replace(/\s*;\s*exit\s*\$?\w+/gi, '');              // 剥离 ; exit $?

    // 剥离 PowerShell 参数 -Raw / -Encoding 等（LLM 有时会混用 type/file -Raw 语法）
    cleanCmd = cleanCmd.replace(/\s+(?:-Raw|-Encoding|-Width)\s*\S*\s*$/g, '');

    // 修复 Windows 路径末尾的反斜杠（PowerShell -Command 中会转义闭合引号）
    // 将 D:\ 末尾反斜杠改为正斜杠，PowerShell 兼容
    cleanCmd = cleanCmd.replace(/([A-Za-z]):\\(?=\s*(['"]|\s*[-&|]|$))/g, '$1:/');

    // ── 修复 Windows 路径中的前向斜杠 ──
    // PowerShell 路径可以使用 /，但某些情况下（如 -Path "src/main/java"）会被 PowerShell 解释为
    // 相对路径，而 cwd 是 D:\... 时可能找不到。统一将 / 替换为 \ 以确保路径正确。
    cleanCmd = cleanCmd.replace(/-Path\s+'([^']+)'/g, (m, p) => `-Path '${p.replace(/\//g, '\\')}'`);
    cleanCmd = cleanCmd.replace(/-Path\s+"([^"]+)"/g, (m, p) => `-Path "${p.replace(/\//g, '\\')}"`);
    cleanCmd = cleanCmd.replace(/-Filter\s+"([^"]+)"/g, (m, p) => `-Filter "${p.replace(/\//g, '\\')}"`);

    // 修复 bash 风格 && 为 PowerShell 风格 ;（PowerShell 不支持 && 作为命令分隔符）
    cleanCmd = cleanCmd.replace(/\s*&\s*&\s*/g, '; ');
    cleanCmd = cleanCmd.replace(/([a-zA-Z0-9_-])\|/g, '$1 |');

    // 修复 LLM 常见的 pip install + python3 -c 连写问题
    // LLM 有时会生成: pip install akshare -q python3 -c "..."
    // 中间缺少分号或 &&，应拆分为两条命令
    cleanCmd = cleanCmd.replace(/(pip\s+install\s+.+?)(python3?\s+-c)/gi, '$1 ; $2');

    // 把 \$ 替换为 $（LLM 常见错误：把 bash 的 \$variable 习惯带进 PowerShell）
    // PowerShell 的转义符是反引号 `，\ 是字面字符
    // 典型 bug 场景: catch 块里写 \$_.Exception.Message → PowerShell 报 "Unexpected token"
    // 极少数情况: LLM 想用 \$ 作为正则字面 $ (如 '[regex]"$foo"'），破坏可接受，
    // 因为 LLM 不会写复杂正则，且这种场景可改用 [regex]::Escape('$') 规避
    cleanCmd = cleanCmd.replace(/\\\$/g, '$');

    // 使用 {block} 语法避免引号嵌套问题
    // 注意：双大括号 {{ }} 在模板字符串中是单大括号 {}
    //
    // 关键修复：LLM 的命令中可能包含 \"（转义的双引号），在 {block} 中
    // PowerShell 会正确解释，但 child_process.exec 经过 Windows API 层时，
    // \" 可能被错误解析为字符串终止符，导致后续命令碎片化。
    // 解决方案：先清理所有 \" 为 PowerShell 原生的 "" 或单引号包裹，
    // 同时清理 \$ 为原生的 $。
    cleanCmd = cleanCmd.replace(/\\"/g, "'");  // \" → '（用单引号替代转义双引号）
    cleanCmd = cleanCmd.replace(/\$\$/g, '$');  // $$ → $（防止 $$ 被解释为上一个命令的输出）

    const psCmd = `powershell -NoProfile -Command {${cleanCmd}}`;

    // 关键: 必须显式指定 shell: 'powershell.exe'。
    // child_process.exec 不传 shell 时, Windows 默认走 cmd.exe,
    // cmd.exe 会把 -Command { ... | Select-String ... } 中的 | 当作管道运算符,
    // 错误地把 Select-String 当成独立命令执行, 抛出
    //   'Select-String' is not recognized as an internal or external command
    // (即使用户写的是 PowerShell 风格命令, 错误信息仍是 cmd.exe 风格的)
    exec(psCmd, {
      cwd,
      shell: 'powershell.exe',
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT
    }, (err, stdout, stderr) => {
      if (err) {
        resolve(normalizeExecError(err, stdout, stderr, command));
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

/**
 * 将 grep 参数部分转换为 PowerShell Select-String
 * 供 grep | head / grep | tail 管道转换复用
 */
function convertGrepToPowerShell(grepRest: string): string | null {
  const flagsMatch = grepRest.match(/^(-[a-zA-Z]+)?\s+("(?:[^"\\]|\\.)*"|'[^']*'|(\S+))\s+(.+)$/);
  if (!flagsMatch) return null;

  const flags = flagsMatch[1] || '';
  const pattern = (flagsMatch[2] || flagsMatch[3] || '').replace(/^["']|["']$/g, '');
  const remainder = flagsMatch[4]?.trim() || '';

  const includeMatch = remainder.match(/--include="([^"]+)"/);
  const parts = remainder.split(/\s+/);
  // 收集所有非 --option 的 token 作为目标路径（支持 grep pattern file1 file2 file3）
  const targets: string[] = [];
  for (const part of parts) {
    if (!part.startsWith('--')) { targets.push(part); }
  }
  const target = targets.length > 0 ? targets.join(',') : '.';
  // 规范化路径分隔符（convertGrepToPowerShell helper）
  const normalizedTarget = target.replace(/\//g, '\\');

  const isRecursive = /r/.test(flags);
  const isCaseInsensitive = /i/.test(flags);

  if (isRecursive) {
    let ps = `Get-ChildItem -Recurse -File`;
    if (includeMatch) ps += ` -Filter "*${includeMatch[1]}"`;
    ps += ` | Select-String -Pattern "${pattern}"`;
    if (isCaseInsensitive) ps += ' -CaseSensitive:$false';
    return ps;
  }
  return `Select-String -Path "${normalizedTarget}" -Pattern "${pattern}"${isCaseInsensitive ? ' -CaseSensitive:$false' : ''}`;
}

/**
 * 将 CMD 命令转换为 PowerShell 等效命令
 */
function convertCmdToPowerShell(cmd: string): string {
  const trimmed = cmd.trim();

  // 统一剥离 bash 特有的重定向和管道后缀（在所有命令匹配之前）
  // 避免 2>&1、2>/dev/null 等被误认为是路径参数
  // 同时剥离 | findstr ... 管道后缀（LLM 常用 type/file | findstr 搜索文件内容）
  // 注意：顺序很重要 — 先剥离 | findstr 等管道后缀，再剥离 2>&1（因为 2>&1 可能在管道前）
  const preCleaned = trimmed
    .replace(/\s*2>\/dev\/null\s*(\||$)/g, '$1')       // 剥离 2>/dev/null（含末尾管道）
    .replace(/\s*\|\s*findstr\s+(?:\/R\s+)?(?:"[^"]*"|\S+)\s*$/gi, '')  // 剥离 | findstr ... 管道
    .replace(/\s*2>\s*&1\s*(\||$)/g, '$1')             // 剥离 2>&1（末尾或管道前）
    .replace(/\s*>\s*&\d\s*$/g, '')                     // 剥离 >&2 等
    .replace(/\s*\|\s*tee\s+[^\s]*\s*$/g, '')           // 剥离 | tee
    .replace(/\s*;\s*exit\s*\$?\w+\s*$/g, '');          // 剥离 ; exit $?

  // ── Bash/Unix 命令转换（LLM 经常生成的跨平台命令）───────────────

  // ── 通用管道：| grep ... | head / | tail 等复合管道 ──────────────
  // 处理 "cmd | grep pattern | head N" 等长管道（LLM 常用）
  // 注意：这必须在所有单命令匹配之前处理，因为管道是最高优先级
  // 使用非贪婪匹配但精确捕获 grep 的参数部分和 head/tail 的数字
  const multiPipeMatch = trimmed.match(/^(.+?)\s*\|\s*grep\s+(.+?)\s*\|\s*(head|tail)\s+(-n\s+)?(\d+)\s*$/i);
  if (multiPipeMatch) {
    const leftSide = multiPipeMatch[1].trim();
    const grepPattern = multiPipeMatch[2].trim();
    const tailHead = multiPipeMatch[3].toLowerCase();
    const headTailNum = multiPipeMatch[5];
    // 转换左边的命令（可能是 curl 或其他）
    const convertedLeft = convertCmdToPowerShell(leftSide);
    // 转换 grep pattern 为 Select-String
    const grepConverted = convertGrepToPowerShell(grepPattern);
    const headTailPS = tailHead === 'head'
      ? `Select-Object -First ${headTailNum}`
      : `Select-Object -Last ${headTailNum}`;
    if (grepConverted) {
      return `${convertedLeft} | ${grepConverted} | ${headTailPS}`;
    }
    // 如果 grep 转换失败，至少处理 head/tail
    return `${convertedLeft} | ${headTailPS}`;
  }

  // ── 通用管道：| grep pattern | head / | tail（无左侧管道）────────
  // 处理 "grep pattern file | head N"
  const grepPipeHeadMatch = preCleaned.match(/^grep\s+(.+?)\s*\|\s*head\s+-?n?\s*(\d+)\s*$/);
  if (grepPipeHeadMatch) {
    const rest = grepPipeHeadMatch[1];
    const count = grepPipeHeadMatch[2];
    const grepConverted = convertGrepToPowerShell(rest);
    if (grepConverted) {
      return `${grepConverted} | Select-Object -First ${count}`;
    }
  }
  const grepPipeTailMatch = preCleaned.match(/^grep\s+(.+?)\s*\|\s*tail\s+-?n?\s*(\d+)\s*$/);
  if (grepPipeTailMatch) {
    const rest = grepPipeTailMatch[1];
    const count = grepPipeTailMatch[2];
    const grepConverted = convertGrepToPowerShell(rest);
    if (grepConverted) {
      return `${grepConverted} | Select-Object -Last ${count}`;
    }
  }

  // ls -la / ls -l / ls -a / ls -la path / ls -l path 等
  // 先剥离 2>&1、2>/dev/null、| head、| tail 等 bash 特有后缀
  const lsClean = trimmed.replace(/\s*2>\/dev\/null\s*;?\s*$/g, '')
                         .replace(/\s*2>\s*&1\s*;?\s*$/g, '')
                         .replace(/\s*\|\s*head\s+(-n\s+)?\d+\s*$/g, '')
                         .replace(/\s*\|\s*tail\s+(-n\s+)?\d+\s*$/g, '');
  const lsMatch = lsClean.match(/^ls\s*(-[a-zA-Z]+)?\s*(.+?)\s*$/);
  if (lsMatch) {
    const flags = lsMatch[1] || '';
    let rawPaths = lsMatch[2]?.trim() || '';
    // 修复路径中的引号不匹配（如 "images' → "images"）
    rawPaths = rawPaths.replace(/["']/g, '"').replace(/^"|"$/g, '');
    // Linux ls 接受空格分隔的多个路径，PowerShell 的 Get-ChildItem 不接受。
    // 将空格分隔的路径拆分为数组，用逗号传入 -Path（PowerShell 接受数组）
    const paths = rawPaths.split(/\s+/).filter(Boolean);
    const hasLongFormat = /l/.test(flags);
    const hasAll = /a/.test(flags);
    const hasRecurse = /R/.test(flags);

    // 对每个路径单独构建 Get-ChildItem，避免逗号分隔路径时出现非法字符
    if (paths.length === 1) {
      let ps = 'Get-ChildItem';
      if (hasRecurse) ps += ' -Recurse';
      if (hasAll) ps += ' -Force';
      if (paths[0] && paths[0] !== '.') ps += ` -Path "${paths[0].replace(/\//g, '\\')}"`;

      if (hasLongFormat) {
        ps += ' | Format-Table Name,Length,LastWriteTime,Mode -AutoSize';
      } else if (hasRecurse) {
        ps += ' | Select-Object FullName,Length,LastWriteTime';
      }
      return ps;
    }

    // 多路径：分别执行 Get-ChildItem 后用管道合并
    let ps = '(';
    ps += paths.map(p => {
      let cmd = 'Get-ChildItem';
      if (hasRecurse) cmd += ' -Recurse';
      if (hasAll) cmd += ' -Force';
      if (p && p !== '.') cmd += ` -Path "${p.replace(/\//g, '\\')}"`;
      return cmd;
    }).join(' ; ');
    ps += ')';

    if (hasLongFormat) {
      ps += ' | Format-Table Name,Length,LastWriteTime,Mode -AutoSize';
    } else if (hasRecurse) {
      ps += ' | Select-Object FullName,Length,LastWriteTime';
    }
    return ps;
  }

  // type file — Windows CMD 内置命令，等价于 cat
  // 剥离 trailing -Raw / -Encoding utf8 等 PowerShell 参数
  const typeMatch = preCleaned.match(/^type\s+(.+?)(?:\s+(?:-Raw|-Encoding|-Width)(?:\s+\S+)?)?(?:\s*2>&1|\s*\||\s*$)/);
  if (typeMatch) {
    let file = typeMatch[1]?.trim() || '.';
    // 修复路径中的引号不匹配
    file = file.replace(/["']/g, '"').replace(/^"|"$/g, '');
    return `Get-Content "${file.replace(/\//g, '\\')}"`;
  }

  // cat file / cat file1 file2
  const catMatch = preCleaned.match(/^cat\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (catMatch) {
    let files = catMatch[1]?.trim() || '.';
    // 修复路径中的引号不匹配
    files = files.replace(/["']/g, '"').replace(/^"|"$/g, '');
    return `Get-Content "${files.replace(/\//g, '\\')}"`;
  }

  // grep pattern file / grep -r pattern dir / grep -rn "pattern" dir --include="*.ts"
  // 注意：| head / | tail 后缀必须在 preCleaned 阶段剥离，否则会吞掉它们
  const grepMatch = preCleaned.match(/^grep\s+(-[a-zA-Z]+)?\s+("(?:[^"\\]|\\.)*"|'[^']*'|(\S+))\s+(.+)$/);
  if (grepMatch) {
    const flags = grepMatch[1] || '';
    const pattern = (grepMatch[2] || grepMatch[3] || '').replace(/^["']|["']$/g, '');
    const remainder = grepMatch[4]?.trim() || '';

    const includeMatch = remainder.match(/--include="([^"]+)"/);
    const parts = remainder.split(/\s+/);
    // 收集所有非 --option 的 token 作为目标路径（支持 grep pattern file1 file2 file3）
    const targets: string[] = [];
    for (const part of parts) {
      if (!part.startsWith('--')) { targets.push(part); }
    }
    const target = targets.length > 0 ? targets.join(',') : '.';
    // 规范化路径分隔符（LLM 常生成 Linux 风格的 forward-slash 路径）
    const normalizedTarget = target.replace(/\//g, '\\');

    const isRecursive = /r/.test(flags);
    const isCaseInsensitive = /i/.test(flags);

    if (isRecursive) {
      let ps = `Get-ChildItem -Recurse -File`;
      if (includeMatch) ps += ` -Filter "*${includeMatch[1]}"`;
      ps += ` | Select-String -Pattern "${pattern}"`;
      if (isCaseInsensitive) ps += ' -CaseSensitive:$false';
      return ps;
    }
    return `Select-String -Path "${normalizedTarget}" -Pattern "${pattern}"${isCaseInsensitive ? ' -CaseSensitive:$false' : ''}`;
  }

  // grep pattern file | head N / grep pattern file | tail N — 剥离管道后缀后由 grep 处理，
  // 已由上方的 grepPipeHeadMatch/grepPipeTailMatch 统一处理

  // find dir -name "*.ext" / find . -name "*.ext"
  // 注意: pattern 后可能跟 2>&1 / 2>/dev/null / | head 等，需要用负向前瞻排除
  const findMatch = preCleaned.match(/^find\s+(\S+)\s+(-[a-zA-Z]+\s+)?(-name|"[^"]+")\s+((?:(?!2>[&/]|\|\s*(?:head|tail|grep|findstr)).)+)(?:\s*2>&1\s*(?:\||$)|\s*2>\/dev\/null\s*(?:\||$)|\s*\||\s*$)/);
  if (findMatch) {
    // 清理目录路径和 pattern 中可能残留的引号，并规范化 Windows 路径分隔符
    const dir = (findMatch[1]?.replace(/^["']|["']$/g, '') || '.').replace(/\//g, '\\');
    const pattern = (findMatch[4]?.trim().replace(/^["']|["']$/g, '') || '').replace(/\//g, '\\');
    return `Get-ChildItem -Path "${dir}" -Recurse -Filter "${pattern}" | Select-Object -ExpandProperty FullName`;
  }

  // find dir -type f / find dir -type d / find dir -type f -name "*.ext"
  const findTypeMatch = preCleaned.match(/^find\s+(\S+)\s+-type\s+(f|d)\s+((?:(?!2>[&/]|\|\s*(?:head|tail|grep|findstr)).)+)(?:\s*2>&1\s*(?:\||$)|\s*2>\/dev\/null\s*(?:\||$)|\s*\||\s*$)/);
  if (findTypeMatch) {
    const dir = (findTypeMatch[1]?.replace(/^["']|["']$/g, '') || '.').replace(/\//g, '\\');
    const type = findTypeMatch[2];
    const rest = findTypeMatch[3]?.trim() || '';
    let ps = `Get-ChildItem -Path "${dir}" -Recurse`;
    if (type === 'd') {
      ps += ' | Where-Object { $_.PSIsContainer }';
    } else {
      ps += ' | Where-Object { -not $_.PSIsContainer }';
    }
    // 如果有额外的 -name "*.ext" 条件，进一步过滤
    const nameMatch = rest.match(/-name\s+"([^"]+)"/);
    if (nameMatch) {
      ps += ` | Where-Object { $_.Name -like "${nameMatch[1]}" }`;
    }
    ps += ' | Select-Object -ExpandProperty FullName';
    return ps;
  }

  // find dir -path "pattern" [-print] / find dir -path "pattern" -name "*.ext"
  const findPathMatch = preCleaned.match(/^find\s+(\S+)\s+-path\s+"([^"]+)"(?:\s+-print)?(?:\s*2>&1\s*(?:\||$)|\s*2>\/dev\/null\s*(?:\||$)|\s*\|\s*head\s+(\d+))?/);
  if (findPathMatch) {
    const dir = findPathMatch[1].replace(/\//g, '\\');
    const pattern = findPathMatch[2];
    // -path uses shell glob syntax like "*/main/*", convert to PowerShell -Include
    let ps = `Get-ChildItem -Path "${dir}" -Recurse`;
    if (pattern.includes('*') || pattern.includes('?')) {
      ps += ` -Include "${pattern}"`;
    } else {
      ps += ` -Include "*${pattern}*" `;
    }
    ps += ' | Select-Object -ExpandProperty FullName';
    if (findPathMatch[3]) {
      ps += ` | Select-Object -First ${findPathMatch[3]}`;
    }
    return ps;
  }

  // find dir -name "a" -o -name "b" -o -name "c" | head -20 （多文件扩展名搜索）
  const findMultiMatch = preCleaned.match(/^find\s+(\S+)\s+(-name\s+"[^"]+"\s+-o\s+)+(-name\s+"[^"]+")(\s*\|\s*head\s+(-\d+)?\s*(\d+))?/);
  if (findMultiMatch) {
    const dir = findMultiMatch[1].replace(/\//g, '\\');
    const headMatch = findMultiMatch[6];
    const allNameParts = preCleaned.match(/-name\s+"([^"]+)"/g) || [];
    const patterns = allNameParts.map(p => {
      const m = p.match(/-name\s+"([^"]+)"/);
      return m ? m[1] : '';
    }).filter(Boolean);

    if (patterns.length > 0) {
      let ps = `Get-ChildItem -Path "${dir}" -Recurse`;
      if (patterns.some(p => p.includes('*'))) {
        ps += ` -Include "${patterns.join(',')}"`;
      } else {
        ps += ` -Include "${patterns.map(p => '*' + p.replace(/^\*?\.?/, '.').replace(/\*$/, '')).join(',')}"`;
      }
      ps += ' | Select-Object -ExpandProperty FullName';
      if (headMatch) {
        ps += ` | Select-Object -First ${headMatch}`;
      }
      return ps;
    }
  }

  // find dir -maxdepth N -name "a" -o -name "b" ... （带 -maxdepth 的多模式搜索）
  const findComplexMatch = preCleaned.match(/^find\s+(\S+)\s+-maxdepth\s+(\d+)\s+(.+?)(?:\s*2>&1\s*(?:\||$)|\s*2>\/dev\/null\s*(?:\||$)|\s*\||\s*$)/);
  if (findComplexMatch) {
    const dir = findComplexMatch[1]?.replace(/^["']|["']$/g, '') || '.';
    const maxDepth = parseInt(findComplexMatch[2]) || 5;
    const rest = findComplexMatch[3]?.trim() || '';
    // 规范化路径分隔符
    const normalizedDir = dir.replace(/\//g, '\\');
    // 提取所有 -name "pattern" 条件（支持 -o 连接）
    const allNames = rest.match(/-name\s+"([^"]+)"/g) || [];
    const patterns = allNames.map(p => {
      const m = p.match(/-name\s+"([^"]+)"/);
      return m ? m[1] : '';
    }).filter(Boolean);

    let ps = `Get-ChildItem -Path "${normalizedDir}" -Recurse`;
    if (maxDepth > 0) ps += ` -Depth ${maxDepth}`;
    if (patterns.length > 0) {
      ps += ` -Include "${patterns.join(',')}"`;
    }
    ps += ' | Where-Object { $_.PSIsContainer -eq $false }';
    ps += ' | Select-Object -ExpandProperty FullName';
    return ps;
  }

  // find + head 组合（处理 find ... | head N）
  const findWithHead = preCleaned.match(/^(find\s+[^\|]+)\s*\|\s*head\s+(-\d+)?\s*(\d+)/);
  if (findWithHead) {
    const findCmd = findWithHead[1];
    const count = findWithHead[3];
    const converted = convertCmdToPowerShell(findCmd);
    if (converted !== findCmd) {
      return `${converted} | Select-Object -First ${count}`;
    }
  }

  // pwd
  if (/^pwd\s*$/.test(trimmed)) {
    return 'Get-Location | Select-Object -ExpandProperty Path';
  }

  // findstr /R "pattern" file — Windows CMD 搜索命令，转换为 PowerShell Select-String
  const findstrMatch = preCleaned.match(/^findstr\s+\/R\s+"([^"]+)"\s+(.+)$/i);
  if (findstrMatch) {
    const pattern = findstrMatch[1];
    const file = findstrMatch[2].trim().replace(/\//g, '\\');
    return `Select-String -Path "${file}" -Pattern "${pattern}"`;
  }
  // findstr /R "pattern" — 搜索当前目录所有文件
  const findstrCurrentMatch = preCleaned.match(/^findstr\s+\/R\s+"([^"]+)"\s*$/i);
  if (findstrCurrentMatch) {
    const pattern = findstrCurrentMatch[1];
    return `Get-ChildItem -File | Select-String -Pattern "${pattern}"`;
  }
  // findstr "pattern" file — 不带 /R 标志的基本搜索
  const findstrBasicMatch = preCleaned.match(/^findstr\s+"([^"]+)"\s+(.+)$/i);
  if (findstrBasicMatch) {
    const pattern = findstrBasicMatch[1];
    const file = findstrBasicMatch[2].trim().replace(/\//g, '\\');
    return `Select-String -Path "${file}" -Pattern "${pattern}"`;
  }
  // findstr "pattern" — 搜索当前目录所有文件
  const findstrBasicCurrentMatch = preCleaned.match(/^findstr\s+"([^"]+)"\s*$/i);
  if (findstrBasicCurrentMatch) {
    const pattern = findstrBasicCurrentMatch[1];
    return `Get-ChildItem -File | Select-String -Pattern "${pattern}"`;
  }
  // findstr /S /C:"pattern" dir — 递归搜索（LLM 常用）
  const findstrRecursiveMatch = preCleaned.match(/^findstr\s+\/S\s+\/C:"([^"]+)"\s+(.+)$/i);
  if (findstrRecursiveMatch) {
    const pattern = findstrRecursiveMatch[1];
    const dir = findstrRecursiveMatch[2].trim().replace(/\//g, '\\');
    return `Get-ChildItem -Path "${dir}" -Recurse -File | Select-String -Pattern "${pattern}"`;
  }
  // findstr /S "pattern" dir — 递归搜索（无 /C）
  const findstrRecursiveSimpleMatch = preCleaned.match(/^findstr\s+\/S\s+"([^"]+)"\s+(.+)$/i);
  if (findstrRecursiveSimpleMatch) {
    const pattern = findstrRecursiveSimpleMatch[1];
    const dir = findstrRecursiveSimpleMatch[2].trim().replace(/\//g, '\\');
    return `Get-ChildItem -Path "${dir}" -Recurse -File | Select-String -Pattern "${pattern}"`;
  }

  // which cmd / where cmd
  const whichMatch = preCleaned.match(/^(which|where)\s+(.+)$/);
  if (whichMatch) {
    const cmdName = whichMatch[2].trim();
    return `Get-Command ${cmdName} | Select-Object -ExpandProperty Source`;
  }

  // echo text
  const echoMatch = preCleaned.match(/^echo\s+(.+)$/);
  if (echoMatch) {
    const text = echoMatch[1].trim();
    return `Write-Output ${text}`;
  }

  // mkdir -p dir
  const mkdirPMatch = trimmed.match(/^mkdir\s+-p\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (mkdirPMatch) {
    const dirs = mkdirPMatch[1]?.trim() || '.';
    return `New-Item -ItemType Directory -Path "${dirs.replace(/\//g, '\\')}" -Force`;
  }

  // rm -rf dir / rm -r dir / rm file
  const rmMatch = trimmed.match(/^rm\s+(-[a-zA-Z]+)?\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (rmMatch) {
    const flags = rmMatch[1] || '';
    const target = rmMatch[2]?.trim() || '.';
    const isRecursive = /r/.test(flags) || /f/.test(flags);
    return `Remove-Item "${target.replace(/\//g, '\\')}" -Recurse:${isRecursive} -Force`;
  }

  // cp src dest / cp -r src dest
  const cpMatch = trimmed.match(/^cp\s+(-[a-zA-Z]+)?\s+(.+?)\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (cpMatch) {
    const flags = cpMatch[1] || '';
    const src = cpMatch[2]?.trim() || '';
    const dest = cpMatch[3]?.trim() || '';
    const isRecursive = /r/.test(flags);
    return `Copy-Item "${src.replace(/\//g, '\\')}" "${dest.replace(/\//g, '\\')}" -Recurse:${isRecursive}`;
  }

  // mv src dest
  const mvMatch = trimmed.match(/^mv\s+(.+?)\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (mvMatch) {
    const src = mvMatch[1]?.trim() || '';
    const dest = mvMatch[2]?.trim() || '';
    return `Move-Item "${src.replace(/\//g, '\\')}" "${dest.replace(/\//g, '\\')}"`;
  }

  // touch file
  const touchMatch = trimmed.match(/^touch\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (touchMatch) {
    const file = touchMatch[1]?.trim() || '.';
    return `New-Item -ItemType File -Path "${file.replace(/\//g, '\\')}" -Force`;
  }

  // head -n N file
  const headMatch = preCleaned.match(/^head\s+(-n\s+)?(\d+)\s+(.+)$/);
  if (headMatch) {
    const count = headMatch[2];
    const file = headMatch[3].trim();
    return `Get-Content "${file.replace(/\//g, '\\')}" -TotalCount ${count}`;
  }

  // tail -n N file
  const tailMatch = preCleaned.match(/^tail\s+(-n\s+)?(\d+)\s+(.+)$/);
  if (tailMatch) {
    const count = tailMatch[2];
    const file = tailMatch[3].trim();
    return `Get-Content "${file.replace(/\//g, '\\')}" -Tail ${count}`;
  }

  // wc -l file
  const wcMatch = preCleaned.match(/^wc\s+-l\s+(.+)$/);
  if (wcMatch) {
    const file = wcMatch[1]?.trim().replace(/^["']|["']$/g, '') || '';
    return `(Get-Content "${file.replace(/\//g, '\\')}").Count`;
  }

  // uname -a
  if (/^uname\s+-a\s*$/.test(trimmed)) {
    return '$PSVersionTable.PSVersion.ToString()';
  }

  // curl 命令 → curl.exe（PowerShell 的 curl 是 Invoke-WebRequest 别名，不兼容）
  // 注意：不要在此处 return，因为 LLM 可能在 curl 后追加 | head / | tail
  const curlMatch = preCleaned.match(/^curl(\.exe)?\s+(.+)$/i);
  if (curlMatch) {
    let ps = `curl.exe ${curlMatch[2]}`;
    // 如果后面跟了 | head 或 | tail，转换为 PowerShell 等效命令
    const pipeHead = ps.match(/^(.*?)\s*\|\s*head\s+(-n\s+)?(\d+)\s*$/);
    if (pipeHead) {
      ps = `${pipeHead[1]} | Select-Object -First ${pipeHead[3]}`;
    } else {
      const pipeTail = ps.match(/^(.*?)\s*\|\s*tail\s+(-n\s+)?(\d+)\s*$/);
      if (pipeTail) {
        ps = `${pipeTail[1]} | Select-Object -Last ${pipeTail[3]}`;
      }
    }
    return ps;
  }

  // Get-CimInstance Win32_Process -Filter "Name='java.exe'" 需要转换
  const cimMatch = trimmed.match(/^Get-CimInstance\s+Win32_Process\s+-Filter\s+"(.+?)"(\s*\|.*)?$/);
  if (cimMatch) {
    const filter = cimMatch[1];
    const rest = cimMatch[2] || '';
    // 提取 Name= 值
    const nameMatch = filter.match(/Name\s*=\s*['"](.+?)['"]/);
    if (nameMatch) {
      const processName = nameMatch[1];
      let ps = `Get-Process -Name "${processName}"`;
      if (rest) {
        // 如果原命令有 CommandLine 过滤，添加 Where-Object
        if (filter.includes('CommandLine')) {
          const cmdMatch = filter.match(/CommandLine\s+like\s+['"](.+?)['"]/);
          if (cmdMatch) {
            const pattern = cmdMatch[1].replace(/\*/g, '*');
            ps = `Get-Process -Name "${processName}" | Where-Object { $_.CommandLine -like '${pattern}' }`;
          }
        } else {
          ps = `Get-Process -Name "${processName}"${rest}`;
        }
      }
      return ps;
    }
  }

  // Get-Process 替代 ps aux / tasklist
  const psMatch = preCleaned.match(/^ps\s+(aux|ax)?\s*(.*)$/);
  if (psMatch) {
    const args = psMatch[2]?.trim() || '';
    if (args.includes('java')) {
      return 'Get-Process -Name "java" | Select-Object Id,ProcessName,CPU,WorkingSet,StartTime';
    }
    return 'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet,StartTime';
  }

  // tasklist 转为 Get-Process
  if (/^tasklist\b/.test(trimmed)) {
    return 'Get-Process | Select-Object Id,ProcessName,WorkingSet';
  }

  // ── CMD 命令转换 ─────────────────────────────────────────────
  const dirRecurseMatch = trimmed.match(/^cmd\s+\/c\s+"dir\s+\/S\s+\/B\s+(.+?)"(.*)$/i);
  if (dirRecurseMatch) {
    const pattern = dirRecurseMatch[1].trim();
    const extra = dirRecurseMatch[2] || '';
    // 排除 node_modules 和 target
    const exclude = extra.includes('findstr')
      ? ' | Where-Object { $_ -notmatch "\\\\node_modules\\\\" -and $_ -notmatch "\\\\target\\\\" }'
      : '';
    // 提取文件模式（如 *.java, *.xml）
    const extMatch = pattern.match(/\*\.(\w+)/);
    if (extMatch) {
      const ext = extMatch[1];
      return `Get-ChildItem -Recurse -Include "*.${ext}" | Select-Object -ExpandProperty FullName${exclude}`;
    }
    return `Get-ChildItem -Recurse -Filter "${pattern}" | Select-Object -ExpandProperty FullName${exclude}`;
  }

  // cmd /c "dir pattern" → Get-ChildItem
  // 注意：先剥离 trailing 的 2>nul / 2>&1 / | findstr 等 bash 后缀，再匹配
  const dirPreClean = trimmed.replace(/\s*2>nul\s*(&.*)?$/i, '').replace(/\s*2>\s*&1\s*(&.*)?$/i, '');
  const dirMatch = dirPreClean.match(/^cmd\s+\/c\s+"dir\s+(.+?)"(.*)$/i);
  if (dirMatch) {
    const pattern = dirMatch[1].trim();
    // 剥离 /b /s /o 等 dir 开关参数（只保留真正的 pattern）
    const cleanPattern = pattern.replace(/\s+\/[bBsSoOaAdDpP]+\b/g, '').trim();
    const extMatch = cleanPattern.match(/\*\.(\w+)/);
    if (extMatch) {
      const ext = extMatch[1];
      return `Get-ChildItem -Include "*.${ext}"`;
    }
    return `Get-ChildItem -Filter "${cleanPattern}"`;
  }

  // cmd /c "type file" → Get-Content
  const cmdTypeMatch = trimmed.match(/^cmd\s+\/c\s+"type\s+(.+?)"$/i);
  if (cmdTypeMatch) {
    // 剥离 trailing -Raw / -Encoding utf8 等 PowerShell 参数
    const file = cmdTypeMatch[1].trim().replace(/\s+(?:-Raw|-Encoding|-Width)\s*\S*\s*$/, '').trim();
    return `Get-Content "${file}"`;
  }

  // del file1 file2 file3 — Windows CMD 删除多文件，转换为 Remove-Item 数组
  // PowerShell 的 Remove-Item 不接受多个位置参数，需要用逗号分隔的数组
  const delMultiMatch = trimmed.match(/^del\s+(.+)$/i);
  if (delMultiMatch) {
    const files = delMultiMatch[1]?.trim().split(/\s+/).map(f => f.replace(/\//g, '\\')).filter(Boolean);
    if (files.length === 0) {
      return 'Write-Output "del: 缺少文件参数"';
    }
    // Remove-Item 接受数组: Remove-Item "file1","file2","file3"
    return `Remove-Item -Path ${files.map(f => `"${f}"`).join(',')} -Force`;
  }
  // cmd /c "del file" → Remove-Item
  const delSingleMatch = trimmed.match(/^cmd\s+\/c\s+"del\s+(.+?)"$/i);
  if (delSingleMatch) {
    const file = delSingleMatch[1].trim();
    return `Remove-Item "${file}" -Force`;
  }

  // cmd /c "copy src dest" → Copy-Item
  const copyMatch = trimmed.match(/^cmd\s+\/c\s+"copy\s+(.+?)\s+(.+?)"$/i);
  if (copyMatch) {
    const src = copyMatch[1].trim();
    const dest = copyMatch[2].trim();
    return `Copy-Item "${src}" "${dest}"`;
  }

  // cmd /c "move src dest" → Move-Item
  const moveMatch = trimmed.match(/^cmd\s+\/c\s+"move\s+(.+?)\s+(.+?)"$/i);
  if (moveMatch) {
    const src = moveMatch[1].trim();
    const dest = moveMatch[2].trim();
    return `Move-Item "${src}" "${dest}"`;
  }

  // cmd /c "mkdir dir" → New-Item -ItemType Directory
  const mkdirMatch = trimmed.match(/^cmd\s+\/c\s+"mkdir\s+(.+?)"$/i);
  if (mkdirMatch) {
    const dir = mkdirMatch[1].trim();
    return `New-Item -ItemType Directory -Path "${dir}" -Force`;
  }

  // bash -c "..." — 在 Windows 上不支持 bash，返回友好错误提示
  // WSL 用户应直接使用 Linux 命令而非 bash -c 包装
  const bashCMatch = trimmed.match(/^bash\s+-c\s+"([^"]+)"$/i);
  if (bashCMatch) {
    const innerCmd = bashCMatch[1];
    return `[WSL] 当前环境不支持 bash。请将 bash -c "${innerCmd}" 改为直接的 PowerShell 命令。`;
  }
  // cmd /c "cd dir && ..." → Set-Location; ...
  if (trimmed.startsWith('cmd /c "cd ')) {
    const cdMatch = trimmed.match(/^cmd\s+\/c\s+"cd\s+([^"]+?)"\s*&&\s*(.+)$/i);
    if (cdMatch) {
      const dir = cdMatch[1].trim();
      const rest = cdMatch[2].trim();
      return `Set-Location "${dir}"; ${rest}`;
    }
  }

  // 其他 cmd.exe 命令：去掉 cmd /c 前缀，保留引号内的内容（PowerShell 也能处理基本语法）
  const genericMatch = trimmed.match(/^cmd\s+\/c\s+"(.+)"$/i);
  if (genericMatch) {
    const inner = genericMatch[1].trim();
    // 如果是 cmd 复合命令（含 & 或 &&），拆分为 PowerShell 语句链
    if (/\s*&\s*/.test(inner)) {
      const parts = inner.split(/\s*&\s*/).map(s => s.trim());
      const converted: string[] = [];
      for (const part of parts) {
        // 递归转换每个部分
        const sub = convertCmdToPowerShell(part);
        // 剥离再次包裹的 cmd /c
        const unwrapped = sub.replace(/^cmd\s+\/c\s+"(.+)"$/i, '$1').trim();
        converted.push(unwrapped);
      }
      return converted.join('; ');
    }
    // 单层 cmd 命令：递归转换
    const converted = convertCmdToPowerShell(inner);
    // 剥离可能再次出现的 cmd /c 包裹
    return converted.replace(/^cmd\s+\/c\s+"(.+)"$/i, '$1').trim();
  }

  // 复合命令：按 ; 拆分后逐段转换，再拼接
  // 处理 "pwd ; ls -la"、"cat file ; find ..." 等多命令场景
  if (preCleaned.includes(';')) {
    const segments = preCleaned.split(';').map(s => s.trim()).filter(Boolean);
    const converted = segments.map(s => convertSingleSegment(s)).join('; ');
    return converted;
  }

  // ── 通用管道：| head / | tail 转换 ──────────────────────────────
  // 处理任意命令后的 | head N / | tail N（LLM 常用此限制输出行数）
  // 支持 "cmd | head 50"、"cmd | head -n 50"、"cmd | head -50" 三种格式
  const pipeHead = preCleaned.match(/^(.+?)\s*\|\s*head\s+-?n?\s*(\d+)\s*$/);
  if (pipeHead && pipeHead[1]?.trim()) {
    const leftSide = pipeHead[1].trim();
    const count = pipeHead[2];
    return `${leftSide} | Select-Object -First ${count}`;
  }
  const pipeTail = preCleaned.match(/^(.+?)\s*\|\s*tail\s+-?n?\s*(\d+)\s*$/);
  if (pipeTail && pipeTail[1]?.trim()) {
    const leftSide = pipeTail[1].trim();
    const count = pipeTail[2];
    return `${leftSide} | Select-Object -Last ${count}`;
  }

  return preCleaned;
}

/**
 * 转换单个命令段（不含 ; 分隔符）
 * 供复合命令拆分后逐段转换使用
 */
function convertSingleSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return trimmed;

  // pwd
  if (/^pwd\s*$/.test(trimmed)) {
    return 'Get-Location | Select-Object -ExpandProperty Path';
  }

  // findstr /R "pattern" file — Windows CMD 搜索命令，转换为 PowerShell Select-String
  const findstrMatch = trimmed.match(/^findstr\s+\/R\s+"([^"]+)"\s+(.+)$/i);
  if (findstrMatch) {
    const pattern = findstrMatch[1];
    const file = findstrMatch[2].trim();
    return `Select-String -Path "${file.replace(/\//g, '\\')}" -Pattern "${pattern}"`;
  }
  // findstr "pattern" file — 不带 /R 标志的基本搜索
  const findstrBasicMatch = trimmed.match(/^findstr\s+"([^"]+)"\s+(.+)$/i);
  if (findstrBasicMatch) {
    const pattern = findstrBasicMatch[1];
    const file = findstrBasicMatch[2].trim();
    return `Select-String -Path "${file.replace(/\//g, '\\')}" -Pattern "${pattern}"`;
  }

  // ls -la / ls -l / ls -a / ls -la path / ls -l path 等
  // 先剥离 2>&1、2>/dev/null 等 bash 后缀
  const lsClean = trimmed.replace(/\s*2>\/dev\/null\s*;?\s*$/g, '')
                         .replace(/\s*2>\s*&1\s*;?\s*$/g, '');
  const lsMatch = lsClean.match(/^ls\s*(-[a-zA-Z]+)?\s*(.+?)\s*$/);
  if (lsMatch) {
    const flags = lsMatch[1] || '';
    let rawPath = lsMatch[2]?.trim() || '';
    // 修复路径中的引号不匹配
    rawPath = rawPath.replace(/["']/g, '"').replace(/^"|"$/g, '');
    const hasLongFormat = /l/.test(flags);
    const hasAll = /a/.test(flags);

    let ps = 'Get-ChildItem';
    if (hasAll) ps += ' -Force';
    if (rawPath && rawPath !== '.') ps += ` -Path "${rawPath.replace(/\//g, '\\')}"`;

    if (hasLongFormat) {
      ps += ' | Format-Table Name,Length,LastWriteTime,Mode -AutoSize';
    }
    return ps;
  }

  // cat file / cat file1 file2
  const catMatch = trimmed.match(/^cat\s+(.+?)(?:\s*2>&1|\s*\||\s*$)/);
  if (catMatch) {
    let files = catMatch[1]?.trim() || '.';
    // 修复路径中的引号不匹配
    files = files.replace(/["']/g, '"').replace(/^"|"$/g, '');
    return `Get-Content "${files.replace(/\//g, '\\')}"`;
  }

  // type file — Windows CMD 内置命令，等价于 cat
  // 剥离 trailing -Raw / -Encoding 等 PowerShell 参数
  const typeClean = trimmed
    .replace(/\s*2>\/dev\/null\s*(\||$)/g, '$1')
    .replace(/\s*\|\s*findstr\s+(?:\/R\s+)?(?:"[^"]*"|\S+)\s*$/gi, '')
    .replace(/\s*2>\s*&1\s*(\||$)/g, '$1');
  const typeMatch = typeClean.match(/^type\s+(.+?)(?:\s+(?:-Raw|-Encoding|-Width)(?:\s+\S+)?)?(?:\s*2>&1|\s*\||\s*$)/);
  if (typeMatch) {
    const file = typeMatch[1]?.trim() || '.';
    return `Get-Content "${file.replace(/\//g, '\\')}"`;
  }

  // head -n N file / head N file — 取文件前 N 行
  const headMatch = trimmed.match(/^head\s+(-n\s+)?(\d+)\s+(.+)$/);
  if (headMatch) {
    const count = headMatch[2];
    const file = headMatch[3].trim().replace(/\//g, '\\');
    return `Get-Content "${file}" -TotalCount ${count}`;
  }

  // tail -n N file / tail N file — 取文件后 N 行
  const tailMatch = trimmed.match(/^tail\s+(-n\s+)?(\d+)\s+(.+)$/);
  if (tailMatch) {
    const count = tailMatch[2];
    const file = tailMatch[3].trim().replace(/\//g, '\\');
    return `Get-Content "${file}" -Tail ${count}`;
  }

  // 未知命令：原样返回
  return trimmed;
}

/**
 * 执行 Linux 命令
 */
async function executeLinuxCommand(command: string, cwd: string, timeoutMs: number = 60000): Promise<ToolResult> {
  return new Promise((resolve) => {
    const MAX_OUTPUT = 500 * 1024;
    exec(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT
    }, (err, stdout, stderr) => {
      if (err) {
        resolve(normalizeExecError(err, stdout, stderr, command));
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

/**
 * 执行 Python 命令
 */
export async function executePythonCommand(project: any, args: any): Promise<ToolResult> {
  const command = args.command || args.cmd || args.code || args.script;
  if (!command) {
    return {
      error: '缺少参数: command/cmd/code/script',
      suggestion: '请提供 Python 代码，如: {"command": "print(1+1)"} 或 {"code": "content = open(\"file.py\").read()"}'
    };
  }

  const sys = getSystemInfo();

  // 根据系统类型选择 cwd
  let cwd: string;
  if (sys.isWindows) {
    cwd = project.workspace;
  } else if (sys.isWSL) {
    cwd = toWSLPath(project.workspace);
  } else {
    cwd = getProjectWorkspacePath(project.workspace);
  }

  return new Promise((resolve) => {
    exec(`python -c "${command.replace(/"/g, '\\"')}"`, {
      cwd,
      timeout: 30000
    }, (err, stdout, stderr) => {
      if (err) {
        resolve(normalizeExecError(err, stdout, stderr, command));
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

/**
 * 执行 File-IO 操作
 */
export async function executeFileIO(
  project: any,
  args: any,
  allProjectAgents: any[],
  allEnabledSkills: any[],
  reply?: any
): Promise<ToolResult> {
  let command = args.command || args.cmd || '';
  const filePath = args.path;
  let fileContent = args.content || args.text || args.data || args.body || args.fileContent;
  const oldText = args.oldText || args.old_text;
  const newText = args.newText || args.new_text;

  // 命令别名转换
  const commandAliases: Record<string, string> = {
    'write-file': 'write_file',
    'read-file': 'read_file',
    'list-files': 'list_files',
    'edit-file': 'edit_file',
    'search-files': 'search_files',
    'create': 'write_file',
    'write': 'write_file',
    'read': 'read_file',
    'list': 'list_files',
    'delete': 'rm',
    'find': 'find',
    'search': 'find',
  };

  const normalizedCommand = command.trim().toLowerCase();
  if (commandAliases[normalizedCommand]) {
    command = commandAliases[normalizedCommand];
  }

  switch (command) {
    case 'list_files':
    case 'list':
      const listResult = await FileToolService.listFiles(project.workspace, filePath || '.', Number(args.depth) || 3);
      return { success: true, ...listResult };

    case 'read_file':
    case 'read':
      const readResult = await FileToolService.readFile(project.workspace, filePath, Number(args.offset) || 1, Number(args.limit) || 200);
      return { success: true, ...readResult };

    case 'write_file':
    case 'write':
    case 'create':
      if (!filePath) return { error: '缺少参数: path' };
      if (!fileContent) return { error: '缺少参数: content' };
      const writeResult = await FileToolService.writeFile(project.workspace, filePath, fileContent);
      return { success: true, ...writeResult };

    case 'edit_file':
    case 'edit':
      if (!filePath) return { error: '缺少参数: path' };
      if (!oldText) return { error: '缺少参数: oldText' };
      if (!newText) return { error: '缺少参数: newText' };
      const editResult = await FileToolService.editFile(project.workspace, filePath, oldText, newText);
      return { success: true, ...editResult };

    case 'search_files':
    case 'search-files': {
      const searchPath = filePath || '.';
      const pattern = args.pattern || '*';
      const maxDepth = Math.min(Number(args.max_depth) || 5, 10);
      try {
        const { absolutePath } = FileToolService.resolveWorkspacePath(project.workspace, searchPath);
        const results: any[] = [];

        function walk(dir: string, depth: number) {
          return new Promise<void>((resolve) => {
            if (depth > maxDepth) { resolve(); return; }
            fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
              if (err) { resolve(); return; }
              (entries || []).forEach((entry) => {
                if (entry.isFile() && globMatch(entry.name, pattern)) {
                  fs.stat(path.join(dir, entry.name), (err, stat) => {
                    if (!err) {
                      results.push({
                        path: path.relative(absolutePath, path.join(dir, entry.name)).replace(/\\/g, '/'),
                        name: entry.name,
                        size: stat.size,
                        updatedAt: stat.mtime.toISOString()
                      });
                    }
                  });
                }
                if (entry.isDirectory()) walk(path.join(dir, entry.name), depth + 1);
              });
              resolve();
            });
          });
        }

        await walk(absolutePath, 0);
        return { success: true, count: results.length, results, searchPath, pattern };
      } catch (err: any) {
        return { success: false, error: `文件搜索失败: ${err.message}` };
      }
    }

    case 'find':
    case 'search': {
      // 解析 "find . -name '*.java'" 或 "find src -name 'Foo.java'" 格式的搜索命令
      const findArg = args.command || args.cmd || '';
      const findMatch = findArg.match(/^find\s+(\S+)\s+-name\s+["']?([^"']+)["']?\s*$/);
      if (findMatch) {
        const searchDir = findMatch[1] || '.';
        const pattern = findMatch[2];
        try {
          const { absolutePath } = FileToolService.resolveWorkspacePath(project.workspace, searchDir);
          const results: any[] = [];
          function walk(dir: string, depth: number, maxDepth: number) {
            return new Promise<void>((resolve) => {
              if (depth > maxDepth) { resolve(); return; }
              fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
                if (err) { resolve(); return; }
                (entries || []).forEach((entry) => {
                  const fullPath = path.join(dir, entry.name);
                  const rel = path.relative(absolutePath, fullPath).replace(/\\/g, '/');
                  // 通配符匹配：支持 * 和 ?
                  const regexPattern = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
                  if (entry.isFile() && new RegExp(regexPattern).test(entry.name)) {
                    fs.stat(fullPath, (err, stat) => {
                      if (!err) {
                        results.push({ path: rel, name: entry.name, size: stat.size, updatedAt: stat.mtime.toISOString() });
                      }
                    });
                  }
                  if (entry.isDirectory()) walk(fullPath, depth + 1, maxDepth);
                });
                resolve();
              });
            });
          }
          await walk(absolutePath, 0, 5);
          return { success: true, count: results.length, results, _searchDir: searchDir, _pattern: pattern };
        } catch (err: any) {
          return { success: false, error: `文件搜索失败: ${err.message}` };
        }
      }
      // 没有 -name 参数，退回 list_files
      return await FileToolService.listFiles(project.workspace, filePath || '.', Number(args.depth) || 3);
    }

    default:
      // 空命令或未知命令
      const trimmedCommand = (command || '').trim();
      if (!trimmedCommand) {
        return {
          error: 'file-io 命令为空',
          _availableCommands: Object.keys(commandAliases).join(', '),
          suggestion: '请提供有效的命令，如: list_files, read_file, write_file, edit_file, search_files, find'
        };
      }
      return { error: `未知 file-io 命令: ${command}` };
  }
}

/**
 * 评估成员 agent 的结果质量
 * 低质量结果会自动触发重试
 */
function evaluateResultQuality(finalContent: string, task: string): { ok: boolean; reason?: string } {
  // 空内容
  if (!finalContent || finalContent.trim().length === 0) {
    return { ok: false, reason: 'empty result' };
  }
  // 太短（< 30 chars 可能只是 "已完成" 之类的敷衍）
  // 中文内容较短也正常，放宽阈值
  if (finalContent.trim().length < 30) {
    return { ok: false, reason: `too short (${finalContent.trim().length} chars)` };
  }
  // 检查是否包含文件路径（如果任务涉及文件操作）
  const hasFileOp = /write|create|edit|build|implement|开发|创建|编辑|写入|修改/.test(task);
  if (hasFileOp) {
    const hasFilePath = /[\w\-\.]+\/[\w\-\.]+\.(ts|java|json|css|html|md|txt|yaml|yml|xml|kt|py|sh|ps1|bat)/.test(finalContent);
    if (!hasFilePath) {
      return { ok: false, reason: 'no file path found in file operation task' };
    }
  }
  return { ok: true };
}

/**
 * 成员 Agent 完整循环（同步等待成员真正完成工作）。
 *
 * 关键改进 vs 旧 executeAgentDelegation（单次 LLM fetch + 立刻返回）：
 * 旧实现：成员 agent 只是个 LLM 一次性回答，不调工具不迭代思考，
 *       协调员拿到的 result 是 LLM 仓促回复的文本，不是成员真正完成任务的成果。
 * 新实现：成员 agent 跑完整循环：
 *   1. 调 LLM（cascade 8 个模型 + PREFERRED list）
 *   2. 如果返回 tool_calls → 执行工具 → push tool result → 重新调 LLM（最多 8 轮）
 *   3. 如果没 tool_calls → finalContent = 完整 content → 持久化 → break
 * 协调员在 executeAgentDelegation 中 await 这个函数，**真正等成员完成所有工作**才返回。
 *
 * 工具集 = buildToolList（用成员自己当 coordinatorAgentId）后 **filter 掉 delegate_to_agent**。
 * 原因：防止成员委派给别的成员形成递归，或更糟的循环（成员A → 成员B → 成员A ...）。
 * 成员只该用 read/write/edit/shell/list_files 这些"动手做"的工具。
 *
 * 持久化：v1 暂不持久化成员 agent 的中间过程（避免侵入 project chat 结构）。
 *         跑完 finalContent 直接作为 result 返回给协调员。日志输出详细。
 *         v2 后续：给成员 agent 自己的 chat 文件（如 .agent-chats/agent-{name}-{ts}.json）。
 */
async function runMemberAgentLoop(
  project: any,
  targetAgent: any,
  task: string,
  context: string | undefined,
  allProjectAgents: any[],
  allEnabledSkills: any[],
  reply: any
): Promise<{ success: boolean; finalContent: string; iterations: number; toolCallCount: number; error?: string; model?: string; forcedSummary?: boolean }> {
  // 构造成员 agent 工具集：按角色过滤 + 排除 delegate_to_agent（防递归）
  const allTools = buildToolListForAgent(project, allProjectAgents, targetAgent.id, allEnabledSkills, targetAgent.name);
  const memberTools = allTools.filter((t: any) => {
    const name = t.function?.name || t.name;
    return name !== 'delegate_to_agent';
  });
  console.log(`[MemberLoop] ${targetAgent.name} toolset: ${memberTools.length} tools (role-filtered + excluded delegate_to_agent) → ${memberTools.map((t: any) => t.function?.name || t.name).join(', ')}`);

  // 构造 system + initial user
  const agentSystemMessage = {
    role: 'system',
    content: targetAgent.systemPrompt || `你是 ${targetAgent.name}，一个专业的 AI Agent。${targetAgent.description || ''}`
  };
  const delegationMessage = {
    role: 'user',
    content: `请完成以下任务：\n\n${task}\n\n${context ? `上下文信息：\n${context}` : ''}\n\n请用中文汇报你的工作成果，包括关键发现、改动、文件路径等。`
  };

  let messages: any[] = [agentSystemMessage, delegationMessage];

  // 选模型 + cascade
  const allModels = await DbService.getModels();
  const agentModelId = targetAgent.defaultModelId || targetAgent.modelId;
  const agentModel = allModels.find((m: any) => m.id === agentModelId);
  const finalModel = agentModel || allModels[0];
  if (!finalModel) {
    return { success: false, finalContent: '', iterations: 0, toolCallCount: 0, error: `Agent "${targetAgent.name}" 没有配置可用模型` };
  }

  const PREFERRED_MODEL_IDS = [
    'gemini-2.5-pro', 'MiniMax-M3',
    'mx27', 'mx27-h', 'z-ai/glm5',
    'claude-sonnet-4-6', 'claude-opus-4-6-thinking',
    'gpt-4o', 'o3', 'o3-mini', 'o4-mini',
  ];
  const MEMBER_FALLBACK_LIMIT = 7;
  const triedModelIds = new Set<string>();
  const preferredQueue = PREFERRED_MODEL_IDS
    .map((id) => allModels.find((m: any) => m.id === id))
    .filter((m: any) => m && m.id !== finalModel.id && !triedModelIds.has(m.id))
    .slice(0, MEMBER_FALLBACK_LIMIT);
  preferredQueue.forEach((m: any) => triedModelIds.add(m.id));
  const fallbackQueue = allModels
    .filter((m: any) => m.id !== finalModel.id && !triedModelIds.has(m.id))
    .slice(0, MEMBER_FALLBACK_LIMIT - preferredQueue.length);
  const modelsToTry = [finalModel, ...preferredQueue, ...fallbackQueue];
  triedModelIds.add(finalModel.id);
  console.log(`[MemberLoop] ${targetAgent.name} cascade (${modelsToTry.length} models): ${modelsToTry.map((m: any) => m.id).join(' → ')}`);

  // Agent loop
  const MAX_ITERATIONS = 8;
  let lastToolCallSignature = '';
  let repeatCallCount = 0;
  let toolCallCount = 0;
  let finalContent = '';
  let lastIteration = 0;  // 实际跑了几轮（用于 return 时报告准确 iterations）
  let pickedModel: any = null;
  let retryCount = 0;  // 质量检查重试次数（最多 2 次）

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.log('');
    console.log('─'.repeat(60));
    console.log(`【${targetAgent.name}】 ITERATION ${iteration + 1}/${MAX_ITERATIONS}`);
    console.log('─'.repeat(60));

    // 跑 model cascade，单次成功即用，失败则换下一个
    let llmSuccess = false;
    let choice: any = null;
    let lastError = '';
    for (let mi = 0; mi < modelsToTry.length; mi++) {
      const tryModel = modelsToTry[mi];
      const apiUrl = `${tryModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const reqBody: any = {
        model: tryModel.modelId,
        messages: sanitizeMessages(messages),
        stream: false,
        max_tokens: tryModel.maxTokens || 16384,
        temperature: tryModel.temperature || 0.7
      };
      if (memberTools.length > 0) {
        reqBody.tools = memberTools;
        reqBody.tool_choice = 'auto';
      }
      console.log(`[MemberLoop] [${iteration + 1}.${mi + 1}] Trying model: ${tryModel.name} (${tryModel.modelId}), msgs=${messages.length}, tools=${memberTools.length}`);

      try {
        const { response: res } = await fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tryModel.apiKey}`,
            'Connection': 'close'
          },
          body: JSON.stringify(reqBody)
        }, {
          maxAttempts: 1,
          timeoutMs: 60000,
          contextLabel: `member-${targetAgent.name}→${tryModel.name}`
        });

        if (res.ok) {
          const data: any = await res.json();
          choice = data.choices?.[0];
          pickedModel = tryModel;
          llmSuccess = true;
          console.log(`[MemberLoop] ✅ Model ${tryModel.name} responded (choice finish_reason=${choice?.finish_reason})`);
          break;
        }

        // 失败
        const errText = await res.text();
        const isPermanent = /auth_unavailable|invalid_api_key|unauthorized|not_found|forbidden|quota|cooling down/i.test(errText);
        lastError = `HTTP ${res.status} - ${errText.slice(0, 200)}`;
        console.warn(`[MemberLoop] ❌ Model ${tryModel.name} failed: ${lastError}`);
        if (isPermanent) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        if (mi < modelsToTry.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      } catch (err: any) {
        lastError = err.message;
        console.warn(`[MemberLoop] ❌ Model ${tryModel.name} threw: ${err.message}`);
        if (mi < modelsToTry.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }
    }

    if (!llmSuccess || !choice) {
      return { success: false, finalContent: '', iterations: iteration + 1, toolCallCount, error: `成员 Agent ${targetAgent.name} LLM cascade 全部失败: ${lastError}`, model: pickedModel?.name };
    }

    const assistantMessage = choice?.message || {};
    const rawToolCalls = extractToolCalls(choice);
    const assistantContent = assistantMessage.content || '';

    if (rawToolCalls.length > 0) {
      // 重复检测
      const sig = rawToolCalls.map((tc: any) =>
        (tc.function?.name || '') + ':' + JSON.stringify(tc.function?.arguments || '').slice(0, 100)
      ).join('|');
      if (sig === lastToolCallSignature) {
        repeatCallCount++;
        console.log(`[MemberLoop] ⚠️  Repeated tool signature (${repeatCallCount}/3)`);
        if (repeatCallCount >= 3) {
          console.log(`[MemberLoop] 🛑 Breaking loop after 3 repeated tool calls`);
          // 把最后一次 assistant message 推入 messages，强制 LLM 下次给文本
          messages.push({ role: 'assistant', content: '', tool_calls: rawToolCalls });
          // 给个引导性 user message 让它总结
          messages.push({ role: 'user', content: '请停止重复调用，直接用文字汇报当前成果即可。' });
          continue;
        }
      } else {
        repeatCallCount = 0;
      }
      lastToolCallSignature = sig;

      // 规范化 tool_call id
      const normalizedToolCalls = rawToolCalls.map((tc: any) => {
        let id = tc.id || '';
        if (!id.startsWith('call_')) {
          id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        return { ...tc, id };
      });

      console.log(`[MemberLoop] 🔧 ${normalizedToolCalls.length} tool call(s) from ${pickedModel.name}:`);
      for (const tc of normalizedToolCalls) {
        console.log(`[MemberLoop]    - ${tc.function?.name} (${(tc.function?.arguments || '').slice(0, 80)}...)`);
      }

      // 推送 assistant message（带 tool_calls）
      messages.push({
        role: 'assistant',
        content: normalizedToolCalls.length > 0 ? '' : assistantContent,
        tool_calls: normalizedToolCalls
      });

      // 通知前端：成员 agent 在调工具
      if (reply?.raw?.write) {
        try {
          reply.raw.write(`data: ${JSON.stringify({
            type: 'agent_tool_call',
            agentName: targetAgent.name,
            toolCalls: normalizedToolCalls.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }))
          })}\n\n`);
        } catch {}
      }

      // 执行每个 tool call（用 project context 而非成员 agent 自己的）
      for (const tc of normalizedToolCalls) {
        let toolResult: any;
        try {
          // 注意：执行工具时**不**把 reply 传过去，避免工具的内部 SSE 写到协调员的 chat 流
          // 工具结果通过 messages.push(role:tool) 在下一轮 LLM 看到即可
          toolResult = await executeToolCall(project, tc, allProjectAgents, allEnabledSkills, undefined);
          console.log(`[MemberLoop] ✅ Tool ${tc.function?.name} executed (result ${JSON.stringify(toolResult).length} chars)`);
        } catch (err: any) {
          toolResult = { error: err.message };
          console.error(`[MemberLoop] ❌ Tool ${tc.function?.name} threw: ${err.message}`);
        }
        // 计数放在 try 外 — 不管成功失败都算一次成员 agent 工具调用尝试
        toolCallCount++;

        // 通知前端：成员 agent 工具结果
        if (reply?.raw?.write) {
          try {
            reply.raw.write(`data: ${JSON.stringify({
              type: 'agent_tool_result',
              agentName: targetAgent.name,
              toolCallId: tc.id,
              toolName: tc.function?.name,
              result: toolResult
            })}\n\n`);
          } catch {}
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: safeToolContent(toolResult)
        });
      }
      continue;
    }

    // 没有 tool_calls → 视为最终响应
    finalContent = assistantContent;
    lastIteration = iteration;  // 记录本轮为最后成功轮次

    // 质量检查：低质量结果自动重试
    const quality = evaluateResultQuality(finalContent, task);
    if (!quality.ok && retryCount < 2) {
      retryCount++;
      console.log(`[MemberLoop] ⚠️  ${targetAgent.name} 结果质量不佳 (${quality.reason})，自动重试 #${retryCount}`);
      // 注入重试指令
      messages.push({
        role: 'user',
        content: `[系统提示] 你的上次回复质量不足：${quality.reason}。请重新执行任务，提供更详细、更有价值的结果。`
      });
      continue;
    }

    console.log(`[MemberLoop] ✅ ${targetAgent.name} 完成，finalContent=${finalContent.length} chars`);
    console.log(`[MemberLoop] 📊 Stats: iterations=${iteration + 1}, toolCalls=${toolCallCount}, model=${pickedModel.name}`);

    // 通知前端：成员 agent 完成
    if (reply?.raw?.write) {
      try {
        reply.raw.write(`data: ${JSON.stringify({
          type: 'agent_result',
          agentName: targetAgent.name,
          result: finalContent,
          iterations: iteration + 1,
          toolCallCount,
          model: pickedModel.name
        })}\n\n`);
      } catch {}
    }
    break;
  }

  if (!finalContent) {
    // 走到这里意味着：LLM 跑满了 MAX_ITERATIONS 轮，每轮都只生成 tool_calls 从不收敛到文本。
    // 常见原因：read-after-edit 验证漂移（成功改完文件后还要再 read 确认、再 edit 修饰、再 read …）。
    // 已有 3 次完全相同 tool_call 签名检测不会触发（每次签名都不同）。
    // 修复：再做一轮 LLM 调用，强制要求给文字总结，并禁止继续调工具。
    console.log(`[MemberLoop] ⚠️  No final text after ${MAX_ITERATIONS} iterations — requesting forced summary (completed toolCalls=${toolCallCount})`);
    const summaryResult = await requestForcedSummary(
      messages, modelsToTry, pickedModel, targetAgent, reply, sanitizeMessages
    );
    if (summaryResult.success) {
      return {
        success: true,
        finalContent: summaryResult.finalContent,
        iterations: MAX_ITERATIONS + 1,
        toolCallCount,
        model: summaryResult.model || pickedModel?.name,
        forcedSummary: true  // 标记：这是兜底摘要，告知调用方可能不完整
      };
    }
    console.log(`[MemberLoop] ❌ Forced summary also failed: ${summaryResult.error}`);
    return {
      success: false,
      finalContent: '',
      iterations: MAX_ITERATIONS + 1,
      toolCallCount,
      error: `成员 Agent ${targetAgent.name} 跑完 ${MAX_ITERATIONS} 轮迭代未产出最终响应（兜底总结也失败：${summaryResult.error}）`,
      model: pickedModel?.name
    };
  }

  // 剥掉 DeepSeek 风格的 <think>...</think> 思考块（避免给协调员一堆内部推理）
  const cleanedFinalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  return {
    success: true,
    finalContent: cleanedFinalContent,
    iterations: lastIteration + 1,
    toolCallCount,
    model: pickedModel?.name
  };
}

/**
 * 强制总结兜底：当 MemberLoop 跑满 MAX_ITERATIONS 轮仍未收敛到文本时，最后做一次 LLM 调用。
 * 关键设计：
 *   1) 注入明确的 user message "停止调工具，直接给文字汇报" —— 解决 read-after-edit 漂移
 *   2) 不传 tools（tool_choice: 'none' 等价：让 LLM 无法调工具）—— 物理上保证不会再有 tool_calls
 *   3) 沿用原 cascade 模型列表（pickedModel → preferredQueue），保证至少有一个能跑
 *   4) 返回值带 forcedSummary 标记，调用方可识别这是兜底
 */
async function requestForcedSummary(
  messages: any[],
  modelsToTry: any[],
  pickedModel: any | null,
  targetAgent: any,
  reply: any,
  sanitizeMessages: (msgs: any[]) => any[]
): Promise<{ success: boolean; finalContent: string; error?: string; model?: string }> {
  // 构造一个独立的"总结"消息序列：原 messages + 一条明确的 user 指令
  // 不传 tools，让 LLM 物理上无法继续调工具
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
      max_tokens: tryModel.maxTokens || 4096,  // 总结不需要太多 token
      temperature: 0.3  // 略低温度，让模型更"听话"地给总结而非继续编工具调用
      // 不传 tools / tool_choice —— LLM 物理上无法调工具
    };

    console.log(`[MemberLoop] [forced-summary] Trying model: ${tryModel.name} (${tryModel.modelId}), msgs=${summaryMessages.length}, tools=0`);
    try {
      const { response: res } = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tryModel.apiKey}`
        },
        body: JSON.stringify(reqBody)
      }, { maxAttempts: 2, timeoutMs: 60000, contextLabel: `forced-summary→${tryModel.name}` });

      if (res.ok) {
        const data: any = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (cleaned) {
          console.log(`[MemberLoop] ✅ Forced summary succeeded via ${tryModel.name} (${cleaned.length} chars)`);
          // 通知前端：成员 agent 兜底完成
          if (reply?.raw?.write) {
            try {
              reply.raw.write(`data: ${JSON.stringify({
                type: 'agent_forced_summary',
                agentName: targetAgent.name,
                result: cleaned,
                model: tryModel.name
              })}\n\n`);
            } catch {}
          }
          return { success: true, finalContent: cleaned, model: tryModel.name };
        }
        // content 为空：模型又走了 tool_calls（不应该，因为我们没传 tools）
        lastError = `Empty content from ${tryModel.name}`;
        console.warn(`[MemberLoop] ⚠️  ${lastError}`);
        continue;
      }
      const errText = await res.text();
      lastError = `HTTP ${res.status} from ${tryModel.name}: ${errText.slice(0, 200)}`;
      console.warn(`[MemberLoop] ❌ ${lastError}`);
    } catch (err: any) {
      lastError = `Exception on ${tryModel.name}: ${err.message}`;
      console.warn(`[MemberLoop] ❌ ${lastError}`);
    }
  }
  return { success: false, finalContent: '', error: lastError || 'No models available for forced summary' };
}

/**
 * 执行 Agent 委托
 *
 * 旧实现：单次 LLM fetch + 立即返回（成员 agent 不会真正执行工具/思考）。
 * 新实现：调 runMemberAgentLoop，**真正同步等待成员跑完完整 agent 循环**（think → tool → 反思 → 总结），
 *        把成员最终汇报作为 result 返回。协调员拿到这个 result 时，成员已经完成了所有实际工作。
 */
export async function executeAgentDelegation(
  project: any,
  args: any,
  allProjectAgents: any[],
  allEnabledSkills: any[],
  reply?: any
): Promise<ToolResult> {
  const { agent_name, task, context } = args;

  // 查找目标 Agent
  const targetAgent = allProjectAgents.find((a: any) =>
    a.name?.toLowerCase().includes(agent_name?.toLowerCase()) ||
    agent_name?.toLowerCase().includes(a.name?.toLowerCase())
  );

  if (!targetAgent) {
    return {
      error: `Agent "${agent_name}" not found. Available agents: ${allProjectAgents.map(a => a.name).join(', ')}`
    };
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log(`【${targetAgent.name}】 DELEGATION START (synchronous — wait for member to finish)`);
  console.log('═'.repeat(60));

  // 发送委托开始消息到前端
  if (reply?.raw?.write) {
    try {
      reply.raw.write(`data: ${JSON.stringify({
        type: 'agent_start',
        agentName: targetAgent.name,
        task
      })}\n\n`);
    } catch {}
  }

  // 🔧 关键：同步等待成员 agent 跑完整循环
  // runMemberAgentLoop 内部：调 LLM → 解析 tool_calls → 执行工具 → 重新调 LLM → 直到没 tool_calls → 返回 finalContent
  // 这就是用户要的"主协调员等待成员反馈成果后返回"
  const result = await runMemberAgentLoop(
    project,
    targetAgent,
    task,
    context,
    allProjectAgents,
    allEnabledSkills,
    reply
  );

  console.log('');
  console.log('═'.repeat(60));
  if (result.success) {
    console.log(`【${targetAgent.name}】 DELEGATION END (via ${result.model}, ${result.iterations} iter, ${result.toolCallCount} tool calls, ${result.finalContent.length} chars)`);
  } else {
    console.error(`【${targetAgent.name}】 DELEGATION FAILED: ${result.error}`);
  }
  console.log('═'.repeat(60));
  console.log('');

  if (result.success) {
    return {
      success: true,
      agent: targetAgent.name,
      model: result.model,
      task,
      iterations: result.iterations,
      toolCallCount: result.toolCallCount,
      result: result.finalContent,
      // 告知协调员：这是兜底总结，可能不完整（不是正常 LLM 自发的最终汇报）
      // 协调员可以据此决定是否重试或要求用户确认
      forcedSummary: result.forcedSummary || false
    };
  }

  return {
    error: `Agent ${targetAgent.name} 调用失败: ${result.error}`,
    attempts: result.iterations
  };
}

export default {
  executeToolCall,
  executeShellCommand,
  executePythonCommand,
  executeFileIO,
  executeAgentDelegation
};
