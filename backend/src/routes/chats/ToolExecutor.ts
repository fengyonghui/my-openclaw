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
import { exec } from 'child_process';
import { FileToolService } from '../../services/FileToolService.js';
import { getBuiltinShellSkill, getBuiltinFileIOSkill } from '../../services/BuiltinSkills.js';
import { DbService } from '../../services/DbService.js';
import { getSystemInfo } from '../../services/SystemCommands.js';
import { toWSLPath, getProjectWorkspacePath } from '../../services/PathService.js';

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

  // 工具调用日志
  console.log('');
  console.log('═'.repeat(60));
  console.log('🔧 TOOL CALL: ' + fn);
  console.log('═'.repeat(60));
  console.log(' Args: ' + rawArgs.slice(0, 300));
  console.log(' Workspace: ' + project.workspace);
  console.log('═'.repeat(60));
  console.log('');

  switch (fn) {
    case 'list_files':
      return await FileToolService.listFiles(project.workspace, args.path || '.', Number(args.depth) || 3);
    case 'read_file':
      return await FileToolService.readFile(project.workspace, args.path, Number(args.offset) || 1, Number(args.limit) || 200);
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
      throw new Error(`未知工具: ${fn}`);
  }
}

/**
 * 处理 JSON 解析错误
 */
function handleJsonParseError(rawArgs: string, parseError: Error): ToolResult {
  console.error(`[JSON Parse Error] Raw args length: ${rawArgs.length}, first 200 chars: ${rawArgs.slice(0, 200)}`);

  // 尝试修复常见的 JSON 问题
  let fixedArgs = rawArgs;
  if (parseError.message.includes('Unterminated string')) {
    const openBraces = (fixedArgs.match(/{/g) || []).length;
    const closeBraces = (fixedArgs.match(/}/g) || []).length;
    const contentMatch = fixedArgs.match(/"content"\s*:\s*"/);
    if (contentMatch) {
      fixedArgs = fixedArgs + '"}}';
    } else {
      const missingBraces = openBraces - closeBraces;
      for (let i = 0; i < missingBraces; i++) {
        fixedArgs += '}';
      }
    }
    try {
      const args = JSON.parse(fixedArgs);
      return { success: true, args, _fixed: true };
    } catch (retryError: any) {
      return {
        error: `JSON 解析失败: ${parseError.message}`,
        _rawError: parseError.message,
        _rawLength: rawArgs.length
      };
    }
  }
  return { error: `JSON 解析失败: ${parseError.message}`, _rawError: parseError.message };
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
  return {
    success: true,
    message: `✅ 文件已成功写入: ${result.path} (${result.bytes} bytes)`,
    ...result
  };
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
  if (!command) {
    return { error: '缺少参数: command/cmd/exec' };
  }

  const sys = getSystemInfo();
  // 调试：输出平台检测结果
  console.log(`[Shell] Detected: platform=${sys.platform}, isWSL=${sys.isWSL}, isWindows=${sys.isWindows}, isLinux=${sys.isLinux}, wslDistro=${sys.wslDistro}`);
  console.log(`[Shell] Workspace (raw): ${project.workspace}`);

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
    // 路径保持 Windows 格式（project.workspace 本身即 Windows 路径）
    const cwd = project.workspace;
    const isPowerShellCmd = /^(Test-|Remove-|Write-|Get-|New-|Set-)/i.test(trimmedCmd) ||
                             trimmedCmd.startsWith('if ');
    if (isPowerShellCmd) {
      return executePowerShellCommand(effectiveCommand, cwd);
    }
    return executeWindowsCommand(effectiveCommand, cwd);
  }

  if (sys.isWSL) {
    // ── WSL 环境执行 ──
    // 所有路径统一转为 /mnt/d/... 格式，通过 wsl.exe 执行
    const wslWorkspace = toWSLPath(project.workspace);
    return executeLinuxCommand(`wsl.exe ${effectiveCommand}`, wslWorkspace);
  }

  // ── 原生 Linux/macOS 执行 ──
  const localWorkspace = getProjectWorkspacePath(project.workspace);
  return executeLinuxCommand(effectiveCommand, localWorkspace);
}

/**
 * 执行 PowerShell 命令
 *
 * 问题修复：
 * 1. 末尾反斜杠（如 C:\）：PowerShell -Command "..." 中 \ 在闭合 " 前被当作转义符 → 替换为 /
 * 2. shell 重定向（2>&1）：PowerShell 不识别 → 直接剥离
 * 3. 引号嵌套：改用 -Command {block} 语法，避免引号解析问题
 */
async function executePowerShellCommand(command: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const MAX_OUTPUT = 500 * 1024;

    // 清理命令中的 shell/bash 特有语法（PowerShell 不识别）
    let cleanCmd = command
      .replace(/\s*2>\s*&1\s*$/g, '')        // 剥离 2>&1
      .replace(/\s*>\s*&\d\s*$/g, '')         // 剥离 >&2 等
      .replace(/\s*\|\s*tee\s+[^\s]*/gi, '') // 剥离 | tee
      .replace(/\s*;\s*exit\s*\$?\w+/gi, ''); // 剥离 ; exit $?

    // 修复 Windows 路径末尾的反斜杠（PowerShell -Command 中会转义闭合引号）
    // 将 D:\ 末尾反斜杠改为正斜杠，PowerShell 兼容
    cleanCmd = cleanCmd.replace(/([A-Za-z]):\\(?=\s*(['"]|\s*[-&|]|$))/g, '$1:/');

    // 使用 {block} 语法避免引号嵌套问题
    // 注意：双大括号 {{ }} 在模板字符串中是单大括号 {}
    const psCmd = `powershell -NoProfile -Command {${cleanCmd}}`;

    exec(psCmd, {
      cwd,
      timeout: 60000,
      maxBuffer: MAX_OUTPUT
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

/**
 * 执行 Windows CMD 命令
 */
async function executeWindowsCommand(command: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const MAX_OUTPUT = 500 * 1024;
    exec(command, {
      cwd,
      shell: 'cmd.exe',
      timeout: 60000,
      maxBuffer: MAX_OUTPUT
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

/**
 * 执行 Linux 命令
 */
async function executeLinuxCommand(command: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const MAX_OUTPUT = 500 * 1024;
    exec(command, {
      cwd,
      timeout: 60000,
      maxBuffer: MAX_OUTPUT
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ error: err.message, stdout, stderr });
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
  const command = args.command || args.cmd || args.code;
  if (!command) {
    return { error: '缺少参数: command/cmd/code' };
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
        resolve({ error: err.message, stdout, stderr });
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
    'create': 'write_file',
    'write': 'write_file',
    'read': 'read_file',
    'list': 'list_files',
    'delete': 'rm'
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

    default:
      return { error: `未知 file-io 命令: ${command}` };
  }
}

/**
 * 执行 Agent 委托
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
  console.log(`【${targetAgent.name}】 DELEGATION START`);
  console.log('═'.repeat(60));

  // 发送委托开始消息到前端
  if (reply?.raw?.write) {
    try {
      reply.raw.write(`data: ${JSON.stringify({ type: 'agent_start', agentName: targetAgent.name, task })}\n\n`);
    } catch {}
  }

  // 获取 Agent 配置的模型
  const agentModelId = targetAgent.defaultModelId || targetAgent.modelId;
  console.log(`[Delegation] DEBUG: targetAgent.defaultModelId = "${targetAgent.defaultModelId}"`);
  console.log(`[Delegation] DEBUG: targetAgent.modelId = "${targetAgent.modelId}"`);
  console.log(`[Delegation] DEBUG: targetAgent keys: ${Object.keys(targetAgent).join(', ')}`);
  
  const allModels = await DbService.getModels();
  console.log(`[Delegation] DEBUG: allModels count = ${allModels.length}`);
  console.log(`[Delegation] DEBUG: allModels names: ${allModels.map((m: any) => `${m.name} (id=${m.id})`).join(', ')}`);
  
  const agentModel = allModels.find((m: any) => m.id === agentModelId);
  console.log(`[Delegation] DEBUG: model found by ID: ${agentModel?.name || 'NOT FOUND'}`);
  
  const finalModel = agentModel || allModels[0];
  console.log(`[Delegation] DEBUG: using model: ${finalModel.name} (id=${finalModel.id})`);

  if (!finalModel) {
    return { error: `Agent "${targetAgent.name}" 没有配置模型` };
  }

  console.log(`[Delegation] Agent: ${targetAgent.name}, Model: ${finalModel.name}`);

  // 构建 Agent 系统消息
  const agentSystemMessage = {
    role: 'system',
    content: targetAgent.systemPrompt || `你是 ${targetAgent.name}，一个专业的 AI Agent。${targetAgent.description || ''}`
  };

  // 构建委托消息
  const delegationMessage = {
    role: 'user',
    content: `请完成以下任务：\n\n${task}\n\n${context ? `上下文信息：\n${context}` : ''}`
  };

  // 调用模型 API
  const apiUrl = `${finalModel.baseUrl.replace(/\/\/+$/, '')}/chat/completions`;
  const reqBody = {
    model: finalModel.modelId,
    messages: [agentSystemMessage, delegationMessage],
    stream: false,
    max_tokens: finalModel.maxTokens || 16384,
    temperature: finalModel.temperature || 0.7
  };

  console.log(`[Delegation] Calling model API: ${apiUrl}`);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${finalModel.apiKey}`
      },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Delegation] API Error: ${res.status} - ${errText.slice(0, 200)}`);
      return { error: `Agent ${targetAgent.name} 调用失败: HTTP ${res.status}` };
    }

    const data: any = await res.json();
    const agentResponse = data.choices?.[0]?.message?.content || '';

    console.log(`[Delegation] Response length: ${agentResponse.length} chars`);
    console.log(`[Delegation] Response preview: ${agentResponse.slice(0, 200)}...`);

    // 发送委托完成消息到前端
    if (reply?.raw?.write) {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'agent_result', agentName: targetAgent.name, result: agentResponse })}\n\n`);
      } catch {}
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log(`【${targetAgent.name}】 DELEGATION END`);
    console.log('═'.repeat(60));
    console.log('');

    return { success: true, agent: targetAgent.name, task: task, result: agentResponse };
  } catch (err: any) {
    console.error(`[Delegation] Error: ${err.message}`);
    return { error: `Agent ${targetAgent.name} 执行失败: ${err.message}` };
  }
}

export default {
  executeToolCall,
  executeShellCommand,
  executePythonCommand,
  executeFileIO,
  executeAgentDelegation
};
