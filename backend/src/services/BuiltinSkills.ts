// 检测系统平台
function isWSL(): boolean {
  // 优先检查 WSL 环境变量（WSL2 特有）
  if (process.env.WSL_DISTRO_NAME !== undefined) return true;
  
  // 检查是否在 WSL 下（通过 /proc/version）
  try {
    const fs = require('fs');
    const content = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (content.includes('wsl') || content.includes('microsoft')) return true;
  } catch {
    // 文件不存在，说明不是 WSL
  }
  
  return false;
}

function isWindows(): boolean {
  return process.platform === 'win32' || process.env.WINDIR !== undefined || process.env.OS !== undefined;
}

// 获取当前平台
function getPlatformInfo() {
  // 通过项目路径判断目标平台
  // D:\... (Windows 原生路径) => Windows 风格 (dir, cmd)
  // /mnt/d/... 或 /home/... (WSL 路径) => Linux 风格 (ls, bash)
  const workspacePath = process.cwd();
  const isWindowsPath = /^[A-Z]:\\/i.test(workspacePath); // D:\...
  
  return {
    isWSL: !isWindowsPath,
    isWindows: isWindowsPath,
    isLinux: !isWindowsPath,
    pathExample: isWindowsPath ? 'D:\\workspace\\...' : '/mnt/d/workspace/...'
  };
}

// 生成 Shell 命令技能内容（根据平台）
function generateShellSkillContent(platform: { isWSL: boolean; isWindows: boolean; pathExample: string }): string {
  if (platform.isWindows) {
    return `---\nname: shell-cmd\ndescription: Execute Windows shell commands and batch operations.\n---\n\n# Shell Command Execution (Windows)\n\nUse the exec tool to run shell commands.\n\n## Common Patterns\n\n### File inspection\n\`\`\`cmd\ndir C:\\path\\to\\dir\ntype file.txt\nfindstr /n "pattern" file.py\ndir /s /b *.ts\n\`\`\`\n\n### Git workflows\n\`\`\`cmd\ngit status\ngit add .\ngit commit -m "message"\ngit push\ngit pull\n\`\`\`\n\n### Build\n\`\`\`cmd\nnpm install\nnpm run build\n\`\`\`\n\n## Rules\n- Destructive commands (del, rd /s) — ask user first\n- Use timeout for long-running commands\n- Windows paths: D:\\path\\to\\dir or C:\\path\\to\\dir\n- Example project path: ${platform.pathExample}`;
  } else {
    return `---\nname: shell-cmd\ndescription: Execute shell commands and git operations.\n---\n\n# Shell Command Execution (WSL/Linux)\n\nUse the exec tool to run shell commands.\n\n## Common Patterns\n\n### File inspection\n\`\`\`bash\nls /path/to/dir\ncat file.txt\ngrep -n "pattern" file.py\nfind . -name "*.ts"\n\`\`\`\n\n### Git workflows\n\`\`\`bash\ngit status\ngit add .\ngit commit -m "message"\ngit push\ngit pull\ngit checkout branch\ngit log --oneline -10\n\`\`\`\n\n### Build\n\`\`\`bash\nnpm install\nnpm run build\n\`\`\`\n\n## Rules\n- Destructive commands (rm, git push --force) — ask user first\n- Use timeout for long-running commands\n- WSL paths: /mnt/d/...\n- Example project path: ${platform.pathExample}`;
  }
}

// 生成文件 IO 技能内容（根据平台）
function generateFileIOSkillContent(platform: { isWSL: boolean; isWindows: boolean; pathExample: string }): string {
  const pathHint = platform.isWSL
    ? '- WSL paths: /mnt/d/workspace/..., /home/user/...'
    : '- Windows paths: D:\\workspace\\..., C:\\Users\\...';

  return `---\nname: file-io\ndescription: Read, write, and edit files inside the current project workspace.\n---\n\n# File IO\n\nUse the provided file tools instead of guessing file contents.\n\n## ⚠️ CRITICAL - Every file-io call MUST include a command parameter\n\n**You MUST specify which operation to perform using the \`command\` field.**\n\n- ✅ \`{"path": "src/main.ts", "command": "read"}\` — read a file\n- ✅ \`{"path": "src/main.ts", "command": "edit", "oldText": "...", "newText": "..."}\` — edit a file\n- ✅ \`{"path": "src/main.ts", "command": "write", "content": "..."}\` — write a file\n- ✅ \`{"path": "src", "command": "list"}\` — list directory\n- ✅ \`{"path": ".", "command": "search_files", "pattern": "*.ts"}\` — search files\n- ❌ \`{"path": "file.txt"}\` — FAILS! Missing command\n- ❌ \`{"command": "write"}\` — FAILS! Missing content parameter\n\n## Available Commands\n\n| Command | Aliases | Required Params | Description |\n|---------|---------|-----------------|-------------|\n| \`read\` | read_file, cat, type | \`path\` | Read file content |\n| \`write\` | write_file, create, save | \`path\`, \`content\` | Create or overwrite file |\n| \`edit\` | edit_file, replace, patch | \`path\`, \`oldText\`, \`newText\` | Exact text replacement |\n| \`list\` | list_files, ls, dir | \`path\` (optional) | List directory contents |\n| \`search_files\` | search | \`path\`, \`pattern\` | Search files by name |\n\n## Path Rules\n${pathHint}\n- Always use relative paths from the project workspace root.\n\n## Rules\n- Only operate inside the current project workspace.\n- Read before editing unless the user clearly asked to create/overwrite a file.\n- Prefer edit for surgical changes.\n- Preserve existing formatting unless the user requested a refactor.\n- Explain what changed after file operations complete.`;
}

// 缓存平台信息
let cachedPlatform: { isWSL: boolean; isWindows: boolean; pathExample: string } | null = null;

function getCachedPlatformInfo() {
  if (!cachedPlatform) {
    cachedPlatform = getPlatformInfo();
    console.log(`[BuiltinSkills] Platform detected: ${cachedPlatform.isWSL ? 'WSL/Linux' : 'Windows'}`);
  }
  return cachedPlatform;
}

export const BUILTIN_SHELL_CMD_SKILL = {
  id: 'builtin-shell-cmd',
  name: 'shell-cmd',
  description: 'Execute shell commands and git operations. Use ONLY for build tools (npm, mvn, gradle), git workflows, process management, or version checks. For file operations, use read_file/list_files/search_files instead.',
  url: 'builtin://shell-cmd',
  builtIn: true,
  rawContent: `---
name: shell-cmd
description: Execute shell commands. Use ONLY for build tools (npm, mvn, gradle), git workflows, process management, or version checks. For file operations, use read_file/list_files/search_files instead.
---

# Shell Command Execution

Use the \`shell_exec\` tool to run system commands.

## When to use shell_exec
- Build commands: \`npm run build\`, \`mvn compile\`, \`gradle build\`
- Git operations: \`git status\`, \`git add .\`, \`git commit\`
- Process management: \`ps\`, \`top\`, \`kill\`
- Version checks: \`java -version\`, \`mvn -v\`, \`node -v\`

## When NOT to use shell_exec
- Reading files → use \`read_file { path: "..." }\`
- Listing directories → use \`list_files { path: "..." }\`
- Searching files → use \`search_files { path: ".", pattern: "*.java" }\`
- Editing files → use \`edit_file { path: "...", oldText: "...", newText: "..." }\`

## Rules
- Destructive commands (rm, git push --force) — ask user first
- Use \`timeout\` for long-running commands
- WSL paths: /mnt/d/...
`
};

export const BUILTIN_INLINE_PYTHON_SKILL = {
  id: 'builtin-inline-python-edit',
  name: 'inline-python-edit',
  description: 'Execute inline Python scripts for file editing. Use when you need to quickly run Python code snippets (read file content, find/replace text, modify files).',
  url: 'builtin://inline-python-edit',
  builtIn: true,
  rawContent: `---
name: inline-python-edit
description: Execute inline Python code. You MUST pass the Python code as the "command" or "code" parameter.
---

# Inline Python Edit

**CRITICAL: Every call MUST include a "command" or "code" parameter with the full Python script.**

## Usage

\`\`\`json
{"command": "content = open('file.py').read(); print(len(content))"}
{"code": "print('hello world')"}
{"script": "x = 1 + 2; print(x)"}
\`\`\`

## Common Patterns

**Read file:**
\`\`\`json
{"command": "content = open('src/main.py').read(); print(content[:500])"}
\`\`\`

**Replace string:**
\`\`\`json
{"command": "content = open('f.py').read(); open('f.py', 'w').write(content.replace('old', 'new'))"}
\`\`\`

**Find position:**
\`\`\`json
{"command": "content = open('f.py').read(); print(content.find('target'))"}
\`\`\`

**Stats:**
\`\`\`json
{"command": "content = open('f.py').read(); print(f'chars={len(content)}, lines={content.count(chr(10))}')"}
\`\`\`

## Rules
- Always use the full file path relative to project workspace
- Preview with print/repr before writing
- Single quotes inside Python code are fine; avoid unescaped double quotes
`
};

export const BUILTIN_FILE_IO_SKILL = {
  id: 'builtin-file-io',
  name: 'file-io',
  description: 'Project-scoped file reading, writing, editing, listing, and searching. Use these tools instead of shell commands for file operations.',
  url: 'builtin://file-io',
  builtIn: true,
  rawContent: [
    '---',
    'name: file-io',
    'description: Read, write, edit, list, and search files inside the current project workspace. Use these structured tools instead of shell commands.',
    '---',
    '',
    '# File IO',
    '',
    '## ⚠️ CRITICAL — Every call MUST include a "command" parameter',
    '**The "command" field specifies which file operation to perform.**',
    '',
    '## Available Commands',
    '| Command | Aliases | Required Params | Description |',
    '|---------|---------|-----------------|-------------|',
    '| \`read\` | read_file, cat, type | \`path\` | Read file content |',
    '| \`write\` | write_file, create, save | \`path\`, \`content\` | Create or overwrite file |',
    '| \`edit\` | edit_file, replace, patch | \`path\`, \`oldText\`, \`newText\` | Exact text replacement |',
    '| \`list\` | list_files, ls, dir | \`path\` (optional) | List directory contents |',
    '| \`search_files\` | search | \`path\`, \`pattern\` | Search files by name |',
    '',
    '## Correct Usage',
    '- Read a file → \`{"path": "src/app.ts", "command": "read"}\`',
    '- List directory → \`{"path": "src", "command": "list", "depth": 3}\`',
    '- Find files → \`{"path": ".", "command": "search_files", "pattern": "*.java"}\`',
    '- Create/overwrite → \`{"path": "file.txt", "command": "write", "content": "..."}\`',
    '- Edit text → \`{"path": "file.txt", "command": "edit", "oldText": "...", "newText": "..."}\`',
    '',
    '## ❌ Common Mistakes',
    '- \`{"path": "file.txt"}\` — FAILS! Missing command',
    '- \`{"command": "write"}\` — FAILS! Missing content parameter',
    '- \`{"command": "edit"}\` — FAILS! Missing oldText and newText',
    '',
    '## Path Rules',
    '- Always use relative paths from the project workspace root.',
    '',
    '## Rules',
    '- Only operate inside the current project workspace.',
    '- Read before editing unless the user clearly asked to create/overwrite a file.',
    '- Prefer edit for surgical changes.',
    '- Preserve existing formatting unless the user requested a refactor.',
    '- Explain what changed after file operations complete.'
  ].join('\n')
};


// 获取 Shell 技能（根据平台动态生成）
export function getBuiltinShellSkill() {
  const platform = getCachedPlatformInfo();
  return {
    id: 'builtin-shell-cmd',
    name: 'shell-cmd',
    description: 'Execute shell commands and git operations. Use when you need to run system commands, git workflows, file navigation, process management, or any command-line operations.',
    url: 'builtin://shell-cmd',
    builtIn: true,
    rawContent: generateShellSkillContent(platform)
  };
}

// 获取文件 IO 技能（根据平台动态生成）
export function getBuiltinFileIOSkill() {
  const platform = getCachedPlatformInfo();
  return {
    id: 'builtin-file-io',
    name: 'file-io',
    description: 'Read, write, and edit files inside the current project workspace.',
    url: 'builtin://file-io',
    builtIn: true,
    rawContent: generateFileIOSkillContent(platform)
  };
}
