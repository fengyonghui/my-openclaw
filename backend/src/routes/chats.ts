import { FastifyInstance } from 'fastify';
import * as path from 'path';
import * as fs from 'fs';
import { DbService } from '../services/DbService.js';
import { FileToolService } from '../services/FileToolService.js';
import { getBuiltinShellSkill, getBuiltinFileIOSkill } from '../services/BuiltinSkills.js';
import { pruneContext, compactContext, getContextStats, Message } from '../services/ContextManager.js';
import { buildToolList, resolveToolName, validateToolCall, BUILTIN_TOOL_DEFINITIONS } from '../services/ToolDefinitions.js';

type ToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

// ============================================
// SSE 停止控制
// ============================================

// 存储每个对话的 abort 控制器
const chatAbortControllers = new Map<string, AbortController>();

function setAbortController(chatId: string, controller: AbortController) {
  // 先取消之前的（如果存在）
  const existing = chatAbortControllers.get(chatId);
  if (existing) {
    try { existing.abort(); } catch {}
  }
  chatAbortControllers.set(chatId, controller);
}

function clearAbortController(chatId: string) {
  const existing = chatAbortControllers.get(chatId);
  if (existing) {
    try { existing.abort(); } catch {}
    chatAbortControllers.delete(chatId);
  }
}

function stopChat(chatId: string): boolean {
  const controller = chatAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

// ============================================
// MEMORY.md 功能辅助函数
// ============================================

/**
 * 将用户消息中以"请注意"开头的内容写入 MEMORY.md
 * 触发条件：用户消息以"请注意"开头
 * @param userMessage 用户消息内容
 * @param projectWorkspace 项目工作目录路径
 * @returns 是否成功写入
 */
// 保存结果类型
type SaveResult = 'success' | 'duplicate' | 'not_trigger' | 'error';

async function saveToMemoryFile(userMessage: string, projectWorkspace: string): Promise<SaveResult> {
  const fs = await import('fs');
  
  // 支持的触发词列表
  const triggerKeywords = ['请注意', '请记住', '记住', '记住：', '请牢记'];
  
  // 检查是否包含触发词
  const matchedTrigger = triggerKeywords.find(keyword => userMessage.startsWith(keyword));
  if (!matchedTrigger) {
    return 'not_trigger';
  }
  
  // 提取需要记录的内容（去掉触发词前缀）
  let noteContent = userMessage.replace(new RegExp(`^${matchedTrigger}[：:]\s*`), '').trim();
  if (!noteContent) {
    noteContent = userMessage.replace(new RegExp(`^${matchedTrigger}\s*`), '').trim();
  }
  
  if (!noteContent) {
    console.log('[Memory] 没有需要记录的内容');
    return 'error';
  }
  
  // 转换路径格式（根据运行平台）
  const os = await import('os');
  const isWindows = os.platform() === 'win32';
  
  let memoryPath = projectWorkspace;
  
  if (isWindows) {
    // 后端运行在 Windows 上
    if (/^\/mnt\/[a-z]\//i.test(memoryPath)) {
      // WSL 路径: /mnt/d/workspace/... -> 转换回 Windows 路径 D:\workspace\...
      const match = memoryPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
      if (match) {
        const drive = match[1].toUpperCase();
        const restPath = match[2].replace(/\//g, '\\');
        memoryPath = `${drive}:\\${restPath}`;
      }
    }
    // 如果已经是 Windows 路径，保持不变
  } else {
    // 后端运行在 Linux/WSL 上
    if (/^[A-Z]:/i.test(memoryPath)) {
      // Windows 路径: D:\workspace\... -> /mnt/d/workspace/...
      const driveLetter = memoryPath.charAt(0).toLowerCase();
      const remainingPath = memoryPath.slice(2).replace(/\\/g, '/');
      memoryPath = `/mnt/${driveLetter}${remainingPath}`;
    } else if (!memoryPath.startsWith('/mnt/')) {
      memoryPath = memoryPath.replace(/\\/g, '/');
    }
  }
  
  memoryPath = memoryPath + '/MEMORY.md';
  
  try {
    // 读取现有内容或创建新文件
    let existingContent = '';
    if (fs.existsSync(memoryPath)) {
      existingContent = fs.readFileSync(memoryPath, 'utf-8').trim();
    }
    
    // --- 去重检查：如果内容已存在，则不重复写入 ---
    // 移除所有换行和多余空格后进行比较
    const normalizedContent = noteContent.replace(/\s+/g, ' ').trim();
    if (existingContent) {
      const normalizedExisting = existingContent.replace(/\s+/g, ' ').trim();
      if (normalizedExisting.includes(normalizedContent)) {
        console.log(`[Memory] 内容已存在，跳过重复写入`);
        return 'duplicate';
      }
    }
    
    // 添加时间戳和新内容
    const timestamp = new Date().toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const newEntry = `\n## 📝 ${timestamp}\n- ${noteContent}\n`;
    
    // 如果文件为空或没有内容，直接写入
    if (!existingContent) {
      fs.writeFileSync(memoryPath, `# MEMORY.md - 项目记忆\n${newEntry}`, 'utf-8');
    } else {
      fs.writeFileSync(memoryPath, existingContent + newEntry, 'utf-8');
    }
    
    console.log(`[Memory] 已写入 MEMORY.md: ${noteContent.slice(0, 30)}...`);
    return 'success';
  } catch (e: any) {
    console.log(`[Memory] 写入失败: ${e.message}`);
    return 'error';
  }
}

function getFileToolsForProject(project: any, teamAgents: any[] = [], coordinatorAgentId?: string) {
  if (!project?.enabledSkillIds?.includes('builtin-file-io')) return [] as any[];
  
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List directory contents. Takes: path (directory) + depth (optional, default 3).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path. Use "." for current directory.' },
            depth: { type: 'number', description: 'Depth level (1-10, default 3).' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read file content. Takes: path + optional offset (start line) + limit (max lines).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read.' },
            offset: { type: 'number', description: 'Start from line N (default 1).' },
            limit: { type: 'number', description: 'Max lines to read (default 200).' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file. Takes: path (file path) + content (file content). Multi-line content uses \\n for newlines.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write (e.g., src/app.ts)' },
            content: { type: 'string', description: 'File content. Use \\n for newlines.' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace exact text in a file. Takes: path + oldText + newText.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path (e.g., src/app.ts)' },
            oldText: { type: 'string', description: 'Exact text to find and replace.' },
            newText: { type: 'string', description: 'Replacement text.' }
          },
          required: ['path', 'oldText', 'newText']
        }
      }
    }
  ];

  // 如果有团队成员（排除自己），添加委托工具
  const delegateOptions = teamAgents
    .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
    .map(a => a.name);
  
  if (delegateOptions.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'delegate_to_agent',
        description: 'As the team coordinator, delegate a task to a team member with specific expertise.',
        parameters: {
          type: 'object',
          properties: {
            agent_name: { 
              type: 'string', 
              description: `Name of the team member to delegate to. Available: ${delegateOptions.join(', ')}` 
            },
            task: { type: 'string', description: 'Clear and specific task description for the delegate.' },
            context: { type: 'string', description: 'Relevant context, requirements, or information the delegate needs.' }
          },
          required: ['agent_name', 'task']
        }
      }
    });
  }

  return tools;
}

async function executeToolCall(project: any, toolCall: ToolCall, allProjectAgents: any[], allEnabledSkills: any[], reply?: any) {
  const fn = toolCall.function?.name;
  const rawArgs = toolCall.function?.arguments || '{}';
  
  // 尝试解析 JSON，如果失败则尝试修复
  let args: any = {};
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch (parseError: any) {
    console.error(`[JSON Parse Error] Failed to parse tool arguments: ${parseError.message}`);
    console.error(`[JSON Parse Error] Raw args length: ${rawArgs.length}, first 200 chars: ${rawArgs.slice(0, 200)}`);
    console.error(`[JSON Parse Error] Last 200 chars: ${rawArgs.slice(-200)}`);
    
    // 尝试修复常见的 JSON 问题
    let fixedArgs = rawArgs;
    
    // 问题1: 字符串未终止 - 尝试添加结束引号和括号
    if (parseError.message.includes('Unterminated string')) {
      // 计算需要添加多少个引号和括号
      const openBraces = (fixedArgs.match(/{/g) || []).length;
      const closeBraces = (fixedArgs.match(/}/g) || []).length;
      const openBrackets = (fixedArgs.match(/\[/g) || []).length;
      const closeBrackets = (fixedArgs.match(/]/g) || []).length;
      
      // 如果内容参数被截断，尝试添加结束引号
      // 格式通常是 {"path": "...", "content": "..."}
      const contentMatch = fixedArgs.match(/"content"\s*:\s*"/);
      if (contentMatch) {
        // 找到 content 开始的位置
        const contentStart = contentMatch.index! + contentMatch[0].length;
        // 检查 content 是否有结束引号
        const afterContent = fixedArgs.slice(contentStart);
        // 简单修复：添加结束引号和括号
        fixedArgs = fixedArgs + '"}}';
      } else {
        // 其他情况，尝试添加缺少的括号
        const missingBraces = openBraces - closeBraces;
        const missingBrackets = openBrackets - closeBrackets;
        for (let i = 0; i < missingBrackets; i++) fixedArgs += ']';
        for (let i = 0; i < missingBraces; i++) fixedArgs += '}';
      }
      
      console.log(`[JSON Parse Error] Attempted fix, new length: ${fixedArgs.length}`);
      
      try {
        args = JSON.parse(fixedArgs);
        console.log(`[JSON Parse Error] Fix successful!`);
        // 标记内容可能被截断
        if (args.content && typeof args.content === 'string') {
          args._contentTruncated = true;
          args._originalLength = rawArgs.length;
        }
      } catch (retryError: any) {
        console.error(`[JSON Parse Error] Fix failed: ${retryError.message}`);
        return { 
          error: `JSON 解析失败，模型返回的参数格式不正确。请尝试将文件内容分块写入，或使用更短的文件内容。错误: ${parseError.message}`,
          _rawError: parseError.message,
          _rawLength: rawArgs.length
        };
      }
    } else {
      return { 
        error: `JSON 解析失败: ${parseError.message}`,
        _rawError: parseError.message
      };
    }
  }

  
  // 工具调用日志
  console.log('');
  console.log('═'.repeat(60));
  console.log('🔧 TOOL CALL: ' + fn);
  console.log('═'.repeat(60));
  console.log('  Args: ' + rawArgs.slice(0, 300));
  console.log('  Workspace: ' + project.workspace);
  console.log('═'.repeat(60));
  console.log('');
  switch (fn) {
    case 'list_files':
      return await FileToolService.listFiles(project.workspace, args.path || '.', Number(args.depth) || 3);
    case 'read_file':
      return await FileToolService.readFile(project.workspace, args.path, Number(args.offset) || 1, Number(args.limit) || 200);
    case 'write_file': {
      // 检测内容是否被截断
      if (args._contentTruncated) {
        return { 
          error: `⚠️ 文件内容被截断，无法完整写入。`,
          suggestion: '请尝试以下方法：\n1. 将文件分成多个小块，分多次写入\n2. 先创建文件骨架，再用 edit_file 分批添加内容\n3. 减少文件内容长度',
          originalLength: args._originalLength
        };
      }
      // 检查文件大小限制（警告）
      const contentLength = (args.content || '').length;
      if (contentLength > 50000) {
        console.log(`[WARN] Large file write: ${args.path}, ${contentLength} chars. Consider splitting.`);
      }
      return await FileToolService.writeFile(project.workspace, args.path, args.content || '');
    }
    case 'edit_file':
      return await FileToolService.editFile(project.workspace, args.path, args.oldText || '', args.newText || '');
    case 'delegate_to_agent':
      return await executeAgentDelegation(project, args, allProjectAgents, allEnabledSkills, reply || null);
    // shell-cmd
    case 'shell_exec':
    case 'shell-cmd': {
      const { exec } = await import('child_process');
      const os = await import('os');
      let command = args.command || args.cmd || args.exec;
      if (!command) return { error: '缺少参数: command/cmd/exec' };
      
      // 判断是否需要用 wsl 执行（项目路径为 WSL 路径）
      const isWSLPath = /^\/mnt\//.test(project.workspace);
      const isWindows = os.platform() === 'win32';
      
      let finalCommand = command;
      let cwd = project.workspace;
      let shellType = '';
      
      // 检查是否是 PowerShell 命令
      const isPowerShellCmd = command.trim().startsWith('if ') || 
        /^(Test-|Remove-|Write-|Get-|New-|Set-|Add-|Clear-|Compare-|Convert-|Copy-|Enter-|Exit-|Find-|Format-|Group-|Import-|Invoke-|Join-|Measure-|Move-|Out-|Pop-|Push-|Receive-|Register-|Rename-|Reset-|Resolve-|Restart-|Restore-|Resume-|Save-|Search-|Select-|Send-|Set-|Show-|Skip-|Sort-|Split-|Start-|Stop-|Submit-|Suspend-|Switch-| Tee-|Test-|Trace-|Unblock-|Undo-|Unregister-|Update-|Use-|Wait-|Watch-|Where-|While-)/i.test(command.trim());
      
      if (isWindows && !isWSLPath) {
        cwd = project.workspace;
        
        if (isPowerShellCmd) {
          // PowerShell 命令
          shellType = 'PowerShell';
          console.log(`[shell-cmd -> PowerShell] ${command}`);
          return new Promise((resolve) => {
            const MAX_OUTPUT = 500 * 1024;
            exec(`powershell -Command "${command.replace(/"/g, '\\"')}"`, { cwd, timeout: 60000, maxBuffer: MAX_OUTPUT }, (err: any, stdout: string, stderr: string) => {
              if (err) {
                if (err.message?.includes('maxBuffer') || err.killed) {
                  resolve({ 
                    error: `⚠️ Command output too large — exceeded 500KB limit.`,
                    stdout: stdout?.slice(0, 2000),
                    stderr,
                    truncated: true
                  });
                } else {
                  resolve({ error: err.message, stdout, stderr });
                }
              } else {
                if (stdout?.length > MAX_OUTPUT) {
                  resolve({ stdout: stdout?.slice(0, 2000) + `\n\n⚠️ [Output truncated — original was ${(stdout.length/1024).toFixed(1)}KB]`, stderr, truncated: true });
                } else {
                  resolve({ stdout, stderr });
                }
              }
            });
          });
        } else {
          // Windows CMD 命令转换
          shellType = 'Windows CMD';
          
          // 检测 heredoc 语法 (cat > file << 'EOF' ... EOF 或 cat >> file << 'EOF' ... EOF)
          const heredocMatch = command.match(/^(cat\s*>>?\s*)(\S+)\s*<<\s*'?(\w+)'?\s*\n([\s\S]*?)\n\3\s*$/);
          if (heredocMatch) {
            const append = heredocMatch[1].includes('>>');
            let filePath = heredocMatch[2].trim();
            const content = heredocMatch[4];
            
            // 路径转换：/ -> \
            filePath = filePath.replace(/\//g, '\\');
            
            // 使用 Node.js 直接写入，避免 shell 字符串转义问题
            console.log(`[shell-cmd -> Node.js heredoc] ${append ? 'append' : 'write'} ${filePath}`);
            return new Promise((resolve) => {
              try {
                const fs = require('fs');
                const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                if (append) {
                  fs.appendFileSync(fullPath, content + '\n', 'utf8');
                } else {
                  fs.writeFileSync(fullPath, content + '\n', 'utf8');
                }
                resolve({ stdout: `✅ 文件已${append ? '追加' : '写入'}: ${filePath}`, stderr: '' });
              } catch (e: any) {
                resolve({ error: e.message, stdout: '', stderr: '' });
              }
            });
          }
          
          const commandMap: Record<string, string> = {
            'ls': 'dir',
            'ls -la': 'dir',
            'ls -l': 'dir',
            'll': 'dir',
            'la': 'dir',
            'cat': 'type',
            'rm': 'del',
            'rm -rf': 'rmdir /s /q',
            'mkdir': 'mkdir',
            'mv': 'move',
            'cp': 'copy',
            'touch': 'type nul >',
            'pwd': 'cd',
            'clear': 'cls',
            'which': 'where',
            'find': 'findstr',
    'head': 'more', // Windows 下使用 more，不支持行数参数
    'tail': 'more', // 简化处理
            'grep': 'findstr',
            'wc': 'find /c /v ""',  // 简化处理
          };
          
          // 替换命令
          finalCommand = command;
          for (const [linuxCmd, winCmd] of Object.entries(commandMap)) {
            const regex = new RegExp(`\\b${linuxCmd.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'g');
            finalCommand = finalCommand.replace(regex, winCmd);
          }
          
          // 将正斜杠路径转换为反斜杠（Windows CMD 认识反斜杠）
          // 例如: type backend/src/entities/file.ts -> type backend\src\entities\file.ts
          finalCommand = finalCommand.replace(/([a-zA-Z0-9_-])(\/)([a-zA-Z0-9_.\-])/g, '$1\\$3');
// 处理 sed -n 'N,Mp' 命令（Linux 行范围提取）
// Linux: sed -n '150,229p' file → 显示第 150-229 行
// Windows: powershell -Command "Get-Content file | Select-Object -Skip 149 -First 80"
const sedMatch = finalCommand.match(/sed\s+-n\s+'(\d+),(\d+)p'\s+(.+)/i);
if (sedMatch) {
  const startLine = parseInt(sedMatch[1]);
  const endLine = parseInt(sedMatch[2]);
  const filePath = sedMatch[3].replace(/\\\\/g, '/');
  const skip = startLine - 1;
  const first = endLine - startLine + 1;
  finalCommand = `powershell -Command "Get-Content '${filePath}' | Select-Object -Skip ${skip} -First ${first}"`;
}

          console.log(`[shell-cmd -> Windows CMD] ${finalCommand}`);
          return new Promise((resolve) => {
            const MAX_OUTPUT = 500 * 1024;
            exec(finalCommand, { cwd, shell: 'cmd.exe', timeout: 60000, maxBuffer: MAX_OUTPUT }, (err: any, stdout: string, stderr: string) => {
              if (err) {
                if (err.message?.includes('maxBuffer') || err.killed) {
                  resolve({ 
                    error: `⚠️ Command output too large — exceeded 500KB limit.`,
                    stdout: stdout?.slice(0, 2000),
                    stderr,
                    truncated: true
                  });
                } else {
                  resolve({ error: err.message, stdout, stderr });
                }
              } else {
                if (stdout?.length > MAX_OUTPUT) {
                  resolve({ stdout: stdout?.slice(0, 2000) + `\n\n⚠️ [Output truncated — original was ${(stdout.length/1024).toFixed(1)}KB]`, stderr, truncated: true });
                } else {
                  resolve({ stdout, stderr });
                }
              }
            });
          });
        }
      } else {
        // WSL 或 Linux 环境
        const execCmd = isWSLPath ? `wsl.exe ${command}` : command;
        cwd = isWSLPath ? '/' + project.workspace.replace(/^\/(mnt\/.)/, '$1').replace(/\\/g, '/') : project.workspace;
        shellType = isWSLPath ? 'WSL' : 'Linux';
        
        console.log(`[shell-cmd -> ${shellType}] ${command}`);
        return new Promise((resolve) => {
          const MAX_OUTPUT = 500 * 1024;
          exec(execCmd, { cwd, timeout: 60000, maxBuffer: MAX_OUTPUT }, (err: any, stdout: string, stderr: string) => {
            if (err) {
              if (err.message?.includes('maxBuffer') || err.killed) {
                resolve({ 
                  error: `⚠️ Command output too large — exceeded 500KB limit.`,
                  stdout: stdout?.slice(0, 2000),
                  stderr,
                  truncated: true
                });
              } else {
                resolve({ error: err.message, stdout, stderr });
              }
            } else {
              if (stdout?.length > MAX_OUTPUT) {
                resolve({ stdout: stdout?.slice(0, 2000) + `\n\n⚠️ [Output truncated — original was ${(stdout.length/1024).toFixed(1)}KB]`, stderr, truncated: true });
              } else {
                resolve({ stdout, stderr });
              }
            }
          });
        });
      }
    }
    
    // inline-python-edit
    case 'inline-python-edit': {
      const command = args.command || args.cmd || args.code;
      if (!command) return { error: '缺少参数: command/cmd/code' };
      const { exec: execPy } = await import('child_process');
      return new Promise((resolve) => {
        execPy(`python -c "${command.replace(/"/g, '\"')}"`, { cwd: project.workspace, timeout: 30000 }, (err: any, stdout: string, stderr: string) => {
          if (err) resolve({ error: err.message });
          else resolve({ stdout, stderr });
        });
      });
    }
    
    // write_file 工具（schema 直接调用，不需要 command 字段）
    case 'write_file': {
      const filePath = args.path;
      const fileContent = args.content;
      if (!filePath) return { error: '缺少参数: path' };
      if (!fileContent) return { 
        error: '❌ 缺少 content 参数！正确格式: {"path": "文件路径", "command": "write_file", "content": "这里是文件的完整内容"} 或 {"path": "文件路径", "command": "write", "content": "这里是文件的完整内容"}'
      };
      const writeResult = await FileToolService.writeFile(project.workspace, filePath, fileContent);
      return { 
        success: true, 
        message: `✅ 文件已成功写入: ${writeResult.path} (${writeResult.bytes} bytes)`,
        path: writeResult.path,
        bytes: writeResult.bytes
      };
    }
    
    // read_file 工具（schema 直接调用）
    case 'read_file': {
      const filePath = args.path;
      if (!filePath) return { error: '缺少参数: path' };
      const readResult = await FileToolService.readFile(project.workspace, filePath, Number(args.offset) || 1, Number(args.limit) || 200);
      return { 
        success: true, 
        message: `✅ 已读取文件: ${readResult.path}`,
        ...readResult
      };
    }
    
    // edit_file 工具（schema 直接调用）
    case 'edit_file': {
      const filePath = args.path;
      const oldText = args.oldText;
      const newText = args.newText;
      if (!filePath) return { error: '缺少参数: path' };
      if (!oldText) return { error: '缺少参数: oldText' };
      if (!newText) return { error: '缺少参数: newText' };
      const editResult = await FileToolService.editFile(project.workspace, filePath, oldText, newText);
      return { 
        success: true, 
        message: `✅ 文件已修改: ${editResult.path}`,
        ...editResult
      };
    }
    
    // list_files 工具（schema 直接调用）
    case 'list_files': {
      const filePath = args.path || '.';
      const listResult = await FileToolService.listFiles(project.workspace, filePath, Number(args.depth) || 3);
      return { 
        success: true, 
        message: `✅ 列出 ${listResult.path}，共 ${listResult.entries?.length || 0} 个项目`,
        ...listResult
      };
    }
    
    // file-io 技能：读写文件（也支持转发 shell 命令）
    case 'file-io': {
      let command = args.command || args.cmd || '';
      const filePath = args.path;
      let fileContent = args.content || args.text || args.data || args.body || args.fileContent;
      const oldText = args.oldText || args.old_text;
      const newText = args.newText || args.new_text;
      
      // 命令别名转换
      const commandAliases: Record<string, string> = {
        'write-file': 'write_file',
        'write-file ': 'write_file',
        'read-file': 'read_file',
        'list-files': 'list_files',
        'edit-file': 'edit_file',
        'create': 'write_file',
        'write': 'write_file',
        'read': 'read_file',
        'list': 'list_files',
        'delete': 'rm',
        'remove': 'rm'
      };
      
      // 标准化命令
      const normalizedCommand = command.trim().toLowerCase();
      
      // 先去掉重复的后缀，如 write_file_file -> write_file
      const dedupedCommand = normalizedCommand.replace(/^(.+)_\1$/, '$1');
      
      if (commandAliases[dedupedCommand]) {
        command = commandAliases[dedupedCommand];
      } else if (commandAliases[normalizedCommand]) {
        command = commandAliases[normalizedCommand];
      } else {
        // 检查是否以别名开头
        for (const [alias, standard] of Object.entries(commandAliases)) {
          if (normalizedCommand.startsWith(alias)) {
            command = standard;  // 直接使用标准命令，不替换
            break;
          }
        }
      }
      
      // 处理模型把内容放在 command 中的情况，如 "write_file:文件内容"
      if (command.includes(':') && !fileContent) {
        const colonIndex = command.indexOf(':');
        const potentialCommand = command.substring(0, colonIndex);
        const potentialContent = command.substring(colonIndex + 1);
        if (['write_file', 'read_file', 'list_files', 'edit_file'].includes(potentialCommand)) {
          command = potentialCommand;
          fileContent = potentialContent;
        }
      }
      
      // 如果是 shell 命令，自动转发并转换命令
      const shellCommands = ['mkdir', 'mv', 'cp', 'rm', 'rmdir', 'touch', 'chmod', 'chown', 'ls', 'pwd', 'cd', 'cat', 'echo'];
      const firstWord = command.trim().split(/\s+/)[0]?.toLowerCase();
      const isShellCommand = shellCommands.includes(firstWord) || 
        command.startsWith('if ') || command.startsWith('Test-') || command.startsWith('Remove-');
      
      if (isShellCommand) {
        // 根据运行平台和项目路径类型确定执行环境
        const os = await import('os');
        const isBackendWindows = os.platform() === 'win32';
        const isWSLPath = /^\/mnt\//.test(project.workspace);
        
        let finalCommand = command;
        
        // 转换项目路径中的命令参数路径（如果有）
        let workspaceForCmd = project.workspace;
        
        if (isBackendWindows && isWSLPath) {
          // 后端在 Windows，项目路径是 WSL 格式，需要转换
          const match = project.workspace.match(/^\/mnt\/([a-z])\/(.+)$/i);
          if (match) {
            const drive = match[1].toUpperCase();
            const restPath = match[2].replace(/\//g, '\\');
            workspaceForCmd = `${drive}:\\${restPath}`;
            console.log(`[file-io] WSL path converted for Windows: ${workspaceForCmd}`);
          }
        }
        
        if (isBackendWindows) {
          // 后端运行在 Windows 上
          
          // 检查是否是 PowerShell 命令
          if (command.startsWith('if ') || command.startsWith('Test-') || command.startsWith('Remove-') || command.startsWith('Write-') || command.startsWith('Get-')) {
            // PowerShell 命令，直接执行
            const cwd = workspaceForCmd;
            console.log(`[file-io -> PowerShell] ${command}`);
            const { exec } = await import('child_process');
            return new Promise((resolve) => {
              exec(`powershell -Command "${command.replace(/"/g, '\\"')}"`, { cwd, timeout: 60000 }, (err: any, stdout: string, stderr: string) => {
                if (err) resolve({ error: err.message, stdout, stderr });
                else resolve({ success: true, stdout, stderr });
              });
            });
          }
          
          // Linux 命令转换为 Windows cmd 命令
          const commandMap: Record<string, string> = {
            'mkdir': 'mkdir',
            'mv': 'move',
            'cp': 'copy',
            'rm': 'del',
            'rmdir': 'rmdir',
            'touch': 'type nul >',
            'chmod': 'attrib',
            'chown': 'takeown',
            'ls': 'dir',
            'cat': 'type',
            'pwd': 'cd',
            'echo': 'echo'
          };
          
          // 替换命令
          for (const [linuxCmd, winCmd] of Object.entries(commandMap)) {
            finalCommand = finalCommand.replace(new RegExp(`^${linuxCmd}\\b`, 'i'), winCmd);
            finalCommand = finalCommand.replace(new RegExp(`\\b${linuxCmd}\\b`, 'g'), winCmd);
          }
          
          // Windows 下使用 cmd.exe
          const cwd = workspaceForCmd;
          console.log(`[file-io -> Windows CMD] ${finalCommand}, cwd=${cwd}`);
          const { exec } = await import('child_process');
          return new Promise((resolve) => {
            exec(finalCommand, { cwd, shell: 'cmd.exe', timeout: 60000 }, (err: any, stdout: string, stderr: string) => {
              if (err) resolve({ error: err.message, stdout, stderr });
              else resolve({ success: true, stdout, stderr });
            });
          });
        } else {
          // WSL 或 Linux 环境
          const execCmd = isWSLPath ? `wsl.exe ${command}` : command;
          const cwd = isWSLPath ? '/' + workspaceForCmd.replace(/^\/(mnt\/.)/, '$1').replace(/\\/g, '/') : workspaceForCmd;
          
          console.log(`[file-io -> shell] ${command}`);
          const { exec } = await import('child_process');
          return new Promise((resolve) => {
            exec(execCmd, { cwd, timeout: 60000 }, (err: any, stdout: string, stderr: string) => {
              if (err) resolve({ error: err.message, stdout, stderr });
              else resolve({ success: true, stdout, stderr });
            });
          });
        }
      }
      
      if (!command) return { error: '缺少参数: command' };
      
      switch (command) {
        case 'list_files':
        case 'list':
          const listResult = await FileToolService.listFiles(project.workspace, filePath || '.', Number(args.depth) || 3);
          return { 
            success: true, 
            message: `✅ 列出 ${listResult.path}，共 ${listResult.entries?.length || 0} 个项目`,
            ...listResult
          };
        case 'read_file':
        case 'read':
          const readResult = await FileToolService.readFile(project.workspace, filePath, Number(args.offset) || 1, Number(args.limit) || 200);
          return { 
            success: true, 
            message: `✅ 已读取文件: ${readResult.path}`,
            ...readResult
          };
        case 'write_file':
        case 'write':
        case 'create':
          if (!filePath) return { error: '缺少参数: path，例如: {"path": "app.py", "command": "write", "content": "文件内容"}' };
          if (!fileContent) return { error: '缺少参数: content。请使用格式: {"path": "文件路径", "command": "write", "content": "要写入的内容，多行内容可以用\\n表示换行"}' };
          const writeResult = await FileToolService.writeFile(project.workspace, filePath, fileContent);
          return { 
            success: true, 
            message: `✅ 文件已成功写入: ${writeResult.path} (${writeResult.bytes} bytes)`,
            path: writeResult.path,
            bytes: writeResult.bytes
          };
        case 'edit_file':
        case 'edit':
          if (!filePath) return { error: '缺少参数: path' };
          if (!oldText) return { error: '缺少参数: oldText' };
          if (!newText) return { error: '缺少参数: newText' };
          const editResult = await FileToolService.editFile(project.workspace, filePath, oldText, newText);
          return { 
            success: true, 
            message: `✅ 文件已修改: ${editResult.path}`,
            ...editResult
          };
        default:
          return { error: `未知 file-io 命令: ${command}，支持的命令: list/list_files, read/read_file, write/write_file/create, edit/edit_file, mkdir, mv, cp, rm` };
      }
    }
    
    default:
      // 尝试从项目技能中查找
      const skill = allEnabledSkills.find((s: any) => s.name === fn);
      if (skill) {
        return { info: `技能 "${fn}" 已收到参数`, skillContent: skill.rawContent || skill.description };
      }
      throw new Error(`未知工具: ${fn}`);
  }
}

// Agent 委托执行
async function executeAgentDelegation(project: any, args: any, allProjectAgents: any[], allEnabledSkills: any[], reply?: any) {
  const { agent_name, task, context } = args;
  
  // 查找目标 Agent
  const targetAgent = allProjectAgents.find((a: any) => 
    a.name?.toLowerCase().includes(agent_name?.toLowerCase()) ||
    agent_name?.toLowerCase().includes(a.name?.toLowerCase())
  );
  
  if (!targetAgent) {
    return { error: `Agent "${agent_name}" not found. Available agents: ${allProjectAgents.map(a => a.name).join(', ')}` };
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log(`【${targetAgent.name}】 DELEGATION START`);
  console.log('═'.repeat(60));
  console.log(`【${targetAgent.name}】 Task: ${task.slice(0, 100)}${task.length > 100 ? '...' : ''}`);
  console.log(`【${targetAgent.name}】 Context: ${context ? context.slice(0, 50) + '...' : 'none'}`);
  console.log('═'.repeat(60));
  console.log('');

  // 发送委托开始消息到前端
  if (reply?.raw?.write) {
    try {
      reply.raw.write(`data: ${JSON.stringify({ 
        type: 'agent_start',
        agentName: targetAgent.name,
        task: task
      })}\n\n`);
    } catch (e) {
      // SSE 写入失败，忽略
    }
  }

  // 构建委托 Agent 的系统提示词
  const skillsPrompt = allEnabledSkills.length > 0 
    ? '\n\n## AVAILABLE SKILLS\n' + allEnabledSkills.map(s => `### ${s.name}\n${s.description || ''}\n\`\`\`\n${s.rawContent || s.content || ''}\n\`\`\``).join('\n\n')
    : '';

  const delegationSystemPrompt = `You are **${targetAgent.name}**${targetAgent.role ? ` (${targetAgent.role})` : ''}. ${targetAgent.description || ''}
${targetAgent.instructions ? `\n## YOUR INSTRUCTIONS\n${targetAgent.instructions}` : ''}
${skillsPrompt}

## IMPORTANT
- You are being delegated a task by another team member
- Focus ONLY on the delegated task
- Provide clear, actionable results
- If you need to read files, use the available tools`;

  // 构建委托对话的消息
  const delegationMessages = [
    { role: 'system', content: delegationSystemPrompt },
    { role: 'user', content: `## DELEGATED TASK\n${task}\n\n${context ? `## CONTEXT\n${context}` : ''}` }
  ];

  // 获取模型配置 - 优先使用项目的默认模型
  const allModels = await DbService.getModels();
  const projectDefaultModelId = project?.defaultModel;
  let defaultModel = projectDefaultModelId
    ? allModels.find((m: any) => m.id === projectDefaultModelId || m.modelId === projectDefaultModelId)
    : null;
  
  // 如果没有找到项目的默认模型，使用第一个可用模型
  if (!defaultModel) {
    defaultModel = allModels[0];
  }
  
  if (!defaultModel) {
    return { error: 'No model available for delegation' };
  }

  const apiUrl = `${defaultModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  
  // 构建可用工具列表
  const delegationTools = [
    { type: 'function', function: { name: 'list_files', description: 'List directory contents', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
    { type: 'function', function: { name: 'read_file', description: 'Read file content', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'shell-cmd', description: 'Execute shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }
  ];
  
  let currentMessages = [...delegationMessages];
  let delegationResult = '';
  const MAX_ITERATIONS = 10;
  
  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      console.log(`【${targetAgent.name}】 Iteration ${iteration + 1}: Calling model ${defaultModel.modelId}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(defaultModel.apiKey ? { 'Authorization': `Bearer ${defaultModel.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: defaultModel.modelId,
          messages: currentMessages,
          tools: delegationTools,
          temperature: 0.7
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`【${targetAgent.name}】 API error: ${response.status} - ${errorText}`);
        throw new Error(`API error: ${response.status}`);
      }
      
      const result: any = await response.json();
      const choice = result.choices?.[0];
      const message = choice?.message || {};
      const toolCalls = message.tool_calls || [];
      
      if (toolCalls.length > 0) {
        console.log(`【${targetAgent.name}】 Model returned ${toolCalls.length} tool call(s)`);
        currentMessages.push({ role: 'assistant', content: message.content || '', tool_calls: toolCalls } as any);
        
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function?.name;
          let toolArgs: any = {};
          try { toolArgs = JSON.parse(toolCall.function?.arguments || '{}'); } catch (e) {}
          
          console.log(`【${targetAgent.name}】 Executing tool: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`);
          
          let toolResult: any;
          try {
            toolResult = await executeToolCall(project, { function: { name: toolName, arguments: toolCall.function?.arguments } }, allProjectAgents, allEnabledSkills, reply);
          } catch (e: any) {
            toolResult = { error: e.message };
          }
          
          console.log(`【${targetAgent.name}】 Tool result: ${JSON.stringify(toolResult).slice(0, 200)}`);
          currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolResult) } as any);
        }
        continue;
      }
      
      // 没有工具调用，获取最终结果
      delegationResult = message.content || 'Task completed with no result';
      console.log(`【${targetAgent.name}】 Final result received (iteration ${iteration + 1})`);
      break;
    }
    
    if (!delegationResult) {
      delegationResult = 'Task completed but no result was generated';
    }
    
    console.log('');
    console.log('═'.repeat(60));
    console.log(`【${targetAgent.name}】 DELEGATION COMPLETE`);
    console.log('═'.repeat(60));
    console.log(`【${targetAgent.name}】 Model: ${defaultModel.modelId}`);
    console.log(`【${targetAgent.name}】 Result length: ${delegationResult.length} chars`);
    console.log(`【${targetAgent.name}】 Result preview: ${delegationResult.slice(0, 200)}${delegationResult.length > 200 ? '...' : ''}`);
    console.log('═'.repeat(60));
    console.log('');
    
    // 发送委托完成消息到前端
    if (reply?.raw?.write) {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'agent_end', agentName: targetAgent.name, result: delegationResult })}\n\n`);
      } catch (e) {}
    }
    
    return { success: true, agent: targetAgent.name, task: task, result: delegationResult };
  } catch (error: any) {
    console.error(`【${targetAgent.name}】 Delegation error: ${error.message}`);
    if (reply?.raw?.write) {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'agent_error', agentName: targetAgent.name, error: error.message })}\n\n`);
      } catch (e) {}
    }
    return { error: `Delegation failed: ${error.message}` };
  }
}

function extractToolCalls(choice: any): ToolCall[] {
  // 标准方式
  if (Array.isArray(choice?.message?.tool_calls)) return choice.message.tool_calls;
  if (Array.isArray(choice?.delta?.tool_calls)) return choice.delta.tool_calls;
  
  // MiniMax 推理模型：工具调用可能在 content 的 <think> 标签中
  const content = choice?.message?.content || '';
  return extractToolCallsFromContent(content);
}

function extractToolCallsFromContent(content: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  
  // 匹配 <invoke name="tool_name">...</invoke> 结构（支持 MiniMax XML 格式）
  const invokePattern = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
  let match;
  
  while ((match = invokePattern.exec(content)) !== null) {
    const toolName = match[1].trim();
    const invokeContent = match[2].trim();
    
    // 尝试解析为 JSON（标准格式）
    let args: any = {};
    try { args = JSON.parse(invokeContent); }
    catch {
      // MiniMax 格式：<parameter name="command">ls /tmp</parameter>
      const paramMatch = invokeContent.match(/<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/i);
      if (paramMatch) {
        const paramName = paramMatch[1].trim();
        const paramValue = paramMatch[2].trim();
        args = { [paramName]: paramValue };
      } else {
        // 纯文本参数
        args = { command: invokeContent };
      }
    }
    
    toolCalls.push({
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: { name: toolName, arguments: JSON.stringify(args) }
    });
    console.log(`[DEBUG] Extracted tool call: ${toolName}, args: ${JSON.stringify(args)?.slice(0, 100)}`);
  }
  
  if (toolCalls.length > 0) {
    console.log(`[DEBUG] Total tool calls extracted from content: ${toolCalls.length}`);
  }
  return toolCalls;
}

export async function ChatRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return await DbService.getChats(projectId);
  });

  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getChat(id);
  });

  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const db = await DbService.load();
    const chat = db.chats.find((c: any) => String(c.id) === String(id));
    if (chat) {
      Object.assign(chat, updates);
      await DbService.save();
    }
    return chat;
  });

  fastify.post('/', async (request) => {
    const { projectId, title, agentId } = request.body as any;
    return await DbService.createChat(projectId, title, agentId);
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteChat(id);
  });

  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}..., Attachments: ${attachments?.length || 0}`);
    
    // 解析被提及的 Agent 名称
    const mentionedAgentNames = content?.match(/@([^\s@]+)/g)?.map((m: string) => m.substring(1)) || [];
    
    // 清理消息中的 @AgentName
    const cleanContent = content?.replace(/@([^\s@]+)/g, '$1').trim() || '';

    await DbService.addMessageToChat(chatId, { 
      role: 'user', 
      content: cleanContent,
      mentions: mentionedAgentNames,
      attachments: attachments || []
    } as any);

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ chunk: '' })}\n\n`);

    // 创建 AbortController 用于停止生成
    const abortController = new AbortController();
    setAbortController(chatId, abortController);
    
    // 监听 abort 信号
    const onAbort = () => {
      console.log(`[SSE Stop] Chat ${chatId} aborted by user`);
      try {
        reply.raw.write(`data: ${JSON.stringify({ chunk: '\n\n⏹️ 已停止生成' })}\n\n`);
        reply.raw.write(`data: [DONE]\n\n`);
        reply.raw.end();
      } catch {}
    };
    abortController.signal.addEventListener('abort', onAbort);

    let fullAssistantContent = '';

    try {
      const projects = await DbService.getProjects();
      const chats = await DbService.getChats();
      const chat = chats.find(c => String(c.id) === String(chatId));
      const project = projects.find(p => p.id === chat?.projectId);
      const allModels = await DbService.getModels();
      
      if (!project) throw new Error('未找到所属项目');
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // --- 0. 检查并保存用户消息到 MEMORY.md ---
      // 如果用户消息以触发词开头，自动保存到 MEMORY.md
      const triggerKeywords = ['请注意', '请记住', '记住', '记住：', '请牢记'];
      const matchedTrigger = triggerKeywords.find(keyword => content.startsWith(keyword));
      let userMessageContent = content;
      
      if (matchedTrigger) {
        const saved = await saveToMemoryFile(content, project.workspace);
        
        // 根据不同结果通知用户
        if (saved === 'success') {
          reply.raw.write(`data: ${JSON.stringify({ chunk: '✅ 已自动记录到 MEMORY.md\n\n' })}\n\n`);
        } else if (saved === 'duplicate') {
          reply.raw.write(`data: ${JSON.stringify({ chunk: 'ℹ️ 该信息已存在，无需重复记录\n\n' })}\n\n`);
        }
        
        // 提取实际内容，过滤掉触发词前缀，让模型处理（无论是否写入成功都提取）
        if (saved === 'success' || saved === 'duplicate') {
          userMessageContent = content.replace(new RegExp(`^${matchedTrigger}[：:]\s*`), '').trim();
          if (!userMessageContent) {
            userMessageContent = content.replace(new RegExp(`^${matchedTrigger}\s*`), '').trim();
          }
        }
      }

      // 清理消息中的 @AgentName（保留用于通知）
      const mentionedAgentNames = content.match(/@([^\s@]+)/g)?.map((m: string) => m.substring(1)) || [];
      let cleanContent = userMessageContent.replace(/@([^\s@]+)/g, '$1').trim();

      // 获取项目的 Agent 列表
      const enabledAgentIds = project?.enabledAgentIds || [];
      const allGlobalAgents = await DbService.getAgents();
      const projectPrivateAgents = project?.projectAgents || [];
      const allProjectAgents = [
        ...allGlobalAgents.filter(a => enabledAgentIds.includes(a.id)),
        ...projectPrivateAgents
      ];

      // --- 1. 获取主协调 Agent ---
      // 优先使用项目指定的主协调 Agent，否则使用默认 Agent
      const coordinatorAgentId = project?.coordinatorAgentId || chat?.agentId || project?.defaultAgentId || '1';
      const coordinatorAgent = allProjectAgents.find((a: any) => String(a.id) === String(coordinatorAgentId));
      
      let agentRolePrompt = '';
      if (coordinatorAgent) {
        agentRolePrompt = `\n## YOUR IDENTITY\nYou are **${coordinatorAgent.name}**${coordinatorAgent.role ? ` (${coordinatorAgent.role})` : ''}. ` +
          `${coordinatorAgent.description || 'A professional AI assistant.'}\n`;
        if (coordinatorAgent.instructions) {
          agentRolePrompt += `\n## YOUR INSTRUCTIONS\n${coordinatorAgent.instructions}\n`;
        }
      }

      // --- 2. 可委托的团队成员列表（排除自己） ---
      const availableDelegates = allProjectAgents
        .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
        .map(a => a.name);
    console.log(`[DEBUG] coordinatorAgentId=${coordinatorAgentId}, allProjectAgents=${allProjectAgents.length}, availableDelegates=${availableDelegates.length}: ${availableDelegates.join(', ')}`);
      
      let teamPrompt = '';
      if (availableDelegates.length > 0) {
        const delegateDetails = allProjectAgents
          .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
          .map((a: any) => `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${a.description || ''}`)
          .join('\n');
        teamPrompt = `\n\n## YOUR TEAM\nYou can delegate tasks to these team members:\n${delegateDetails}`;
      }

      // --- 3. 技能（自动可用） ---
      const enabledSkillIds = project?.enabledSkillIds || [];
      const allGlobalSkills = await DbService.getGlobalSkills();
      const globalProjectSkills = allGlobalSkills.filter(s => enabledSkillIds.includes(s.id));
      const projectPrivateSkills = project?.projectSkills || [];
      const allEnabledSkills = [...globalProjectSkills, ...projectPrivateSkills];

      // --- 4. 构建系统消息 ---
      // 加载项目 MEMORY.md
      let memoryPrompt = '';
      try {
        const fs = await import('fs');
        const os = await import('os');
        
        // 检测后端运行平台
        const isWindows = os.platform() === 'win32';
        
        let memoryPath = project.workspace || '';
        
        if (isWindows) {
          // 后端运行在 Windows 上
          if (/^\/mnt\/[a-z]\//i.test(memoryPath)) {
            // WSL 路径: /mnt/d/workspace/... -> 转换回 Windows 路径 D:\workspace\...
            const match = memoryPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
            if (match) {
              const drive = match[1].toUpperCase();
              const restPath = match[2].replace(/\//g, '\\');
              memoryPath = `${drive}:\\${restPath}`;
              console.log(`[Memory] WSL path converted to Windows: ${memoryPath}`);
            }
          }
          // 如果已经是 Windows 路径 (D:\...)，保持不变
        } else {
          // 后端运行在 Linux/WSL 上
          if (/^[A-Z]:/i.test(memoryPath)) {
            // Windows 路径: D:\workspace\... -> /mnt/d/workspace/...
            const driveLetter = memoryPath.charAt(0).toLowerCase();
            const remainingPath = memoryPath.slice(2).replace(/\\/g, '/');
            memoryPath = `/mnt/${driveLetter}${remainingPath}`;
          } else if (!memoryPath.startsWith('/mnt/')) {
            memoryPath = memoryPath.replace(/\\/g, '/');
          }
        }
        
        memoryPath = memoryPath + '/MEMORY.md';
        if (fs.existsSync(memoryPath)) {
          memoryPrompt = '\n\n## PROJECT MEMORY\n' + fs.readFileSync(memoryPath, 'utf-8');
        } else {
          // 文件不存在，自动创建
          const initialContent = `# MEMORY.md - 项目记忆

> 此文件用于记录项目重要信息，由 AI 自动管理
> 用户可通过输入 "请注意xxx" 或 "请记住xxx" 来添加记录

`;
          fs.writeFileSync(memoryPath, initialContent, 'utf-8');
          console.log(`[Memory] Created new MEMORY.md: ${memoryPath}`);
          memoryPrompt = '\n\n## PROJECT MEMORY\n' + initialContent;
        }
      } catch (e: any) {
        console.log(`[Memory] Could not load MEMORY.md: ${e.message}`);
      }

      const systemMessage = {
        role: 'system',
        content: `You are an AI assistant working inside project workspace: **${project.workspace}**\n` +
          `Project: ${project.name}\n` +
          `${agentRolePrompt}` +
          `${teamPrompt}` +
          `${memoryPrompt}` +
          `\n\n## TOOL CALLING RULES\n` +
          `- If a tool call fails, READ the error message carefully and FIX the arguments\n` +
          `- For write_file: ALWAYS include BOTH path AND content parameters. Example: {"path": "file.ts", "content": "full file content here"}\n` +
          `- If you get "missing content parameter" error, retry with content included\n` +
          `- For edit_file: include path, oldText (exact text to find), and newText\n` +
          `\n\n## IMPORTANT RULES\n` +
          `- When a task requires specific expertise, delegate it to the appropriate team member\n` +
          `- Always use read_file before editing files\n` +
          `- You can understand and analyze images when provided\n` +
          `- Provide clear, concise, and helpful responses\n` +
    `\n\n## DELEGATION RULES (CRITICAL)\n` +
    `- When user asks about backend, API, database, or Java code: CALL delegate_to_agent with agent_name="Backend Agent"\n` +
    `- When user asks about UI, UX, or frontend design: CALL delegate_to_agent with agent_name="UX"\n` +
    `- When user asks about testing: CALL delegate_to_agent with agent_name="QA"\n` +
    `- When user asks about product requirements: CALL delegate_to_agent with agent_name="PM Agent"\n` +
    `- DO NOT answer technical questions yourself - DELEGATE to the appropriate agent\n` +
    `- To delegate: Use the delegate_to_agent tool with agent_name and task parameters\n` +
    `\n\n## DELEGATION RESULT HANDLING\n` +
    `- When you receive a tool result with "success": true, it means the agent COMPLETED the task\n` +
    `- The "result" field contains the agent's FULL RESPONSE - READ IT and present it to the user\n` +
    `- DO NOT say "waiting for agent" or "agent is working" if success=true - the work is DONE\n` +
    `- Summarize or present the agent's result directly to the user as the final answer`
      };

      // --- 构造候选模型队列 (故障转移) ---
      const activeModelId = chat?.modelId || project?.defaultModel;
      const primaryModel = allModels.find(m => m.id === activeModelId) || allModels[0];
      const fallbackModels = allModels.filter(m => m.id !== primaryModel.id);
      const modelsToTry = [primaryModel, ...fallbackModels].slice(0, 3); // 最多尝试前3个模型

      // 使用新的工具定义系统构建工具列表
  const tools = buildToolList(project, allProjectAgents, coordinatorAgentId, allEnabledSkills);
  
  // 为了兼容性，保留旧的工具构建逻辑（如果有遗漏）
  const legacyTools = getFileToolsForProject(project, allProjectAgents, coordinatorAgentId);
  const legacyToolNames = new Set(tools.map((t: any) => t.function.name));
  for (const t of legacyTools) {
    if (!legacyToolNames.has(t.function.name)) {
      tools.push(t);
    }
  }
      console.log(`[Tools] total=${tools.length}`);
      if (tools.length > 0) {
        console.log(`[Tools] Tool names: ${tools.map((t: any) => t.function.name).join(', ')}`);
      }

      const chatWithHistory = await DbService.getChat(chatId);
      const historyMessages = chatWithHistory?.messages || [];
      const CONTEXT_WINDOW = 100;
      const INITIAL_INTENT_COUNT = 2;

      // 转换消息格式，支持附件（图片等）
      const transformMessage = (m: any): any => {
        const base = { role: m.role };
        
        // 如果有附件（图片等），使用多模态格式
        if (m.attachments && m.attachments.length > 0) {
          const content: any[] = [];
          
          // 添加文本内容
          if (m.content && m.content.trim()) {
            content.push({ type: 'text', text: m.content });
          }
          
          // 添加图片附件
          m.attachments.forEach((att: any) => {
            if (att.type?.startsWith('image/') || att.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
              // 支持 base64 dataUrl 或 URL
              if (att.dataUrl) {
                content.push({
                  type: 'image_url',
                  image_url: { url: att.dataUrl }
                });
              }
            } else {
              // 非图片附件，在文本中提及
              if (m.content) {
                content.push({ type: 'text', text: `${m.content}\n\n[附件: ${att.name}]` });
              } else {
                content.push({ type: 'text', text: `[附件: ${att.name}]` });
              }
            }
          });
          
          return { ...base, content: content.length > 0 ? content : m.content || '' };
        }
        
        // 无附件，使用普通格式
        return { ...base, content: m.content || '' };
      };

      let apiMessages: any[] = [];
      if (historyMessages.length > CONTEXT_WINDOW + INITIAL_INTENT_COUNT) {
        apiMessages = [
          ...historyMessages.slice(0, INITIAL_INTENT_COUNT).map(transformMessage),
          ...historyMessages.slice(-CONTEXT_WINDOW).map(transformMessage)
        ];
      } else {
        apiMessages = historyMessages.map(transformMessage);
      }

      // === 上下文管理：Session Pruning ===
      // 在发送请求前，修剪旧的工具结果，避免上下文溢出
      const prunedMessages = pruneContext(apiMessages as Message[], {
        contextWindow: 128000,
        keepLastAssistants: 3,
        softTrimMaxChars: 4000,
        softTrimHeadChars: 1500,
        softTrimTailChars: 1500
      });
      
      // 检查上下文使用情况
      const contextStats = getContextStats(prunedMessages as Message[]);
      console.log(`[Context] Messages: ${contextStats.messageCount}, Tokens: ~${contextStats.estimatedTokens}, Usage: ${contextStats.usagePercent}%`);
      
      if (contextStats.needsCompaction) {
        console.log(`[Context] ⚠️ Context usage at ${contextStats.usagePercent}%, triggering compaction...`);
        const { compacted } = await compactContext(prunedMessages as Message[]);
        apiMessages = compacted as any[];
        console.log(`[Context] ✅ Compaction complete. New message count: ${apiMessages.length}`);
      }

      
      // --- 模型重试外层循环 ---
      let success = false;
      let lastError = '';
      let pickedModelCfg: any = null;

      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 2000;

      for (const modelCfg of modelsToTry) {
        if (success) break;

        console.log(`[Model Try] Using Model: ${modelCfg.name} (${modelCfg.modelId})`);
        const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        
        const finalMessages: any[] = [
          systemMessage,
          ...apiMessages.map((m: any) => ({ role: m.role, content: m.content }))
        ];

        let modelRetryCount = 0;
        let currentModelSuccess = false;

        while (modelRetryCount < MAX_RETRIES && !currentModelSuccess) {
          try {
            let guard = 0;
            while (guard++ < 8) {
              const reqBody: any = {
          model: modelCfg.modelId,
          messages: finalMessages,
          stream: false,
          max_tokens: modelCfg.maxTokens || 8192,
          temperature: modelCfg.temperature || 0.7
        };
              if (tools.length > 0) {
                reqBody.tools = tools;
 reqBody.tool_choice = 'auto';  // 告诉模型可以选择使用工具
                console.log(`[DEBUG] Sending ${tools.length} tools: ${tools.map(t => t.function.name).join(', ')}`);
              }

              console.log('');
  console.log('═'.repeat(60));
  console.log('🤖 MODEL REQUEST');
  console.log('═'.repeat(60));
  console.log('  Model: ' + modelCfg.name + ' (' + modelCfg.modelId + ')');
  console.log('  API URL: ' + apiUrl);
  console.log('  Messages: ' + finalMessages.length);
  console.log('  Tools: ' + (tools.length > 0 ? tools.map(t => t.function.name).join(', ') : 'none'));
  console.log('  Max Tokens: ' + (modelCfg.maxTokens || 8192));
  console.log('═'.repeat(60));
  console.log('');
  console.log('[DEBUG] About to send request with ' + finalMessages.length + ' messages');
              console.log(`[DEBUG] Request body keys: ${Object.keys(reqBody)}`);
console.log(`[DEBUG] Request body.tools: ${reqBody.tools ? reqBody.tools.length + ' tools: ' + reqBody.tools.map((t: any) => t.function?.name).join(', ') : 'undefined'}`);
console.log(`[DEBUG] Request body.tool_choice: ${reqBody.tool_choice || 'undefined'}`);
const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json', 
                  'Authorization': `Bearer ${modelCfg.apiKey}` 
                },
                body: JSON.stringify(reqBody),
                signal: abortController.signal
              });

              if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
              }

              const data: any = await res.json();
              console.log(`[DEBUG] API response keys: ${Object.keys(data||{})}`);
              console.log(`[DEBUG] data.choices length: ${data.choices?.length}`);
              console.log(`[DEBUG] message content: ${data.choices?.[0]?.message?.content?.slice(0, 300)}`);
              const choice = data.choices?.[0];
              const message = choice?.message || {};
              console.log(`[DEBUG] Full API response: ${JSON.stringify(data)?.slice(0, 500)}`);
              const toolCalls = extractToolCalls(choice);
              console.log(`[DEBUG] Extracted ${toolCalls.length} tool calls, choice keys: ${Object.keys(choice||{})}`);
              console.log(`[DEBUG] toolCalls from model: ${JSON.stringify(toolCalls)?.slice(0, 300)}`);

              if (toolCalls.length > 0) {
                console.log(`[DEBUG] Processing ${toolCalls.length} tool call(s), guard=${guard}`);
                for (const tc of toolCalls) {
                  console.log(`[DEBUG]   tool: ${tc.function?.name}, args: ${tc.function?.arguments?.slice(0, 100)}`);
                }
                console.log(`[DEBUG] Processing ${toolCalls.length} tool call(s)`);
                
                // 发送助手消息（包含工具调用）到前端
                if (message.content) {
                  reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
                }
                reply.raw.write(`data: ${JSON.stringify({ 
                  type: 'tool_call',
                  toolCalls: toolCalls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments
                  }))
                })}\n\n`);
                
                finalMessages.push({
                  role: 'assistant',
                  content: message.content || '',
                  tool_calls: toolCalls
                });

                for (const toolCall of toolCalls) {
                  let toolResult: any;
                  try {
                    toolResult = await executeToolCall(project, toolCall, allProjectAgents, allEnabledSkills, reply);
                  } catch (err: any) {
                    toolResult = { error: err.message };
                  }

                  console.log(`[DEBUG] Tool result: ${JSON.stringify(toolResult)?.slice(0, 200)}`);
                  
                  // 对读取类工具结果进行处理，不保留内容到历史会话
                  const toolName = toolCall.function?.name;
                  let toolArgs: any = {};
                  try {
                    toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
                  } catch (e) {
                    // 如果解析失败，使用 executeToolCall 中已经处理过的 args
                    toolArgs = {};
                  }
                  const cmd = (toolArgs.command || '').toLowerCase();
                  const isReadCmd = toolName === 'read_file' || toolName === 'list_files' || 
                                    toolName === 'file-io' && (cmd === 'read_file' || cmd === 'read' || cmd === 'list_files' || cmd === 'list');
                  
                  let resultContent: string;
                  let displayResult: any;
                  if (isReadCmd) {
                    // 读取文件/列表类操作：只返回摘要，不返回内容
                    displayResult = {
                      success: true,
                      message: toolResult.message || '✅ 操作完成',
                      path: toolResult.path,
                      totalLines: toolResult.totalLines,
                      entriesCount: toolResult.entries?.length,
                      preview: toolResult.content 
                        ? toolResult.content.split('\n').slice(0, 3).join('\n') + '\n...'
                        : undefined
                    };
                  } else {
                    // 其他工具：正常返回结果
                    displayResult = toolResult;
                  }
                  resultContent = JSON.stringify(displayResult, null, 2);
                  
                  // 发送工具结果到前端
                  reply.raw.write(`data: ${JSON.stringify({ 
                    type: 'tool_result',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function?.name,
                    result: displayResult
                  })}\n\n`);
                  
                  finalMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: resultContent
                  });
                }
                continue;
              }

              fullAssistantContent = message.content || '';
              success = true;
              currentModelSuccess = true;
              pickedModelCfg = modelCfg;
              console.log(`[DEBUG] Response content: ${fullAssistantContent?.slice(0, 200)}`);
              break;
            }
          } catch (err: any) {
            modelRetryCount++;
            console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
            lastError = err.message;
            
            if (modelRetryCount < MAX_RETRIES) {
              console.log(`[Model] Retrying ${modelCfg.name} in ${RETRY_DELAY_MS}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
          }
        }
      }

      if (!success || !pickedModelCfg) {
        throw new Error(`所有模型均不可用。最后错误: ${lastError}`);
      }

      // --- 关键：如果发生了模型切换，通知前端并更新数据库 ---
      if (pickedModelCfg.id !== activeModelId) {
        console.log(`[Model Switch] Notifying UI & Updating DB: ${pickedModelCfg.name}`);
        
        // 1. 发送 SSE 通知块
        reply.raw.write(`data: ${JSON.stringify({ 
          info: `已自动切换至备用模型: ${pickedModelCfg.name}`,
          switchedModelId: pickedModelCfg.id 
        })}\n\n`);

        // 2. 持久化到数据库，让页面下拉框同步更新
        const db = await DbService.load();
        const chatToUpdate = db.chats.find((c: any) => String(c.id) === String(chatId));
        if (chatToUpdate) {
            chatToUpdate.modelId = pickedModelCfg.id;
            await DbService.save();
        }
      }

      if (fullAssistantContent) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
        await DbService.addMessageToChat(chatId, { role: 'assistant', content: fullAssistantContent });
      }

      reply.raw.write(`data: [DONE]\n\n`);
    } catch (err: any) {
      console.error('[SSE Error Final]', err.message);
      // 检查是否是用户停止
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        console.log(`[SSE] Chat ${chatId} was stopped by user`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\n❌ 彻底失败: ${err.message}` })}\n\n`);
        reply.raw.write(`data: [DONE]\n\n`);
      }
    } finally {
      // 清理 abort 监听器和控制器
      abortController.signal.removeEventListener('abort', onAbort);
      clearAbortController(chatId);
      try { reply.raw.end(); } catch {}
    }
  });

  // ============================================
  // POST /:id/stop - 停止对话生成
  // ============================================
  fastify.post('/:id/stop', async (request, reply) => {
    const { id: chatId } = request.params as any;
    console.log(`[Stop] Request to stop chat ${chatId}`);
    
    const stopped = stopChat(chatId);
    if (stopped) {
      console.log(`[Stop] Successfully stopped chat ${chatId}`);
      return { success: true, message: '已停止生成' };
    } else {
      console.log(`[Stop] No active chat found for ${chatId}`);
      return { success: false, message: '没有正在进行的生成' };
    }
  });

  // ============================================
  // POST /:id/resend - 重发用户消息（不保存新记录）
  // ============================================
  fastify.post('/:id/resend', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { messageId } = request.body as any;
    console.log(`[Resend] ChatID: ${chatId}, MessageID: ${messageId}`);
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ chunk: '' })}\n\n`);
    const abortController = new AbortController();
    setAbortController(chatId, abortController);
    abortController.signal.addEventListener('abort', () => {
      try { reply.raw.write(`data: [DONE]\n\n`); reply.raw.end(); } catch {}
    });
    let fullAssistantContent = '';
    try {
      const projects = await DbService.getProjects();
      const chats = await DbService.getChats();
      const chat = chats.find(c => String(c.id) === String(chatId));
      const project = projects.find(p => p.id === chat?.projectId);
      const allModels = await DbService.getModels();
      if (!project) throw new Error('未找到所属项目');
      const allGlobalAgents = await DbService.getAgents();
      const projectAgents = (project.enabledAgentIds || []).map((aid: string) => allGlobalAgents.find((a: any) => String(a.id) === String(aid))).filter(Boolean);
      const coordinatorAgent = projectAgents.find((a: any) => String(a.id) === String(project.coordinatorAgentId)) || projectAgents[0];
      const chatMessages = chat?.messages || [];
      const messagesForAPI: any[] = [];
      const model = allModels.find((m: any) => m.id === chat?.modelId) || allModels[0];
      messagesForAPI.push({ role: 'system', content: coordinatorAgent?.description || '' });
      for (let i = 0; i < chatMessages.length - 1; i++) {
        const msg = chatMessages[i];
        if (msg.role === 'user' || msg.role === 'assistant') messagesForAPI.push({ role: msg.role, content: msg.content });
      }
      const response = await fetch(`${model?.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model?.apiKey}` },
        body: JSON.stringify({ model: model?.modelId, messages: messagesForAPI, stream: true, temperature: model?.temperature || 0.7, max_tokens: model?.maxTokens || 4096 }),
        signal: abortController.signal
      });
      if (!response.ok) throw new Error(`模型 API 错误: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');
      const decoder = new TextDecoder();
      let partialLine = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split('\n');
        partialLine = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) { fullAssistantContent += delta; reply.raw.write(`data: ${JSON.stringify({ chunk: delta })}\n\n`); }
          } catch {}
        }
      }
      const db = await DbService.load();
      const chatIndex = db.chats.findIndex((c: any) => String(c.id) === String(chatId));
      if (chatIndex >= 0) {
        const chatMsgs = db.chats[chatIndex].messages || [];
        const userMsgIndex = chatMsgs.findIndex((m: any) => m.id === messageId);
        if (userMsgIndex >= 0 && userMsgIndex + 1 < chatMsgs.length) {
          db.chats[chatIndex].messages[userMsgIndex + 1] = { ...db.chats[chatIndex].messages[userMsgIndex + 1], content: fullAssistantContent, status: undefined };
        }
        await DbService.save();
      }
      reply.raw.write(`data: [DONE]\n\n`); reply.raw.end();
    } catch (err: any) {
      console.error(`[Resend Error] ${err.message}`);
      reply.raw.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      reply.raw.write(`data: [DONE]\n\n`); reply.raw.end();
    } finally { clearAbortController(chatId); }
  });
}
