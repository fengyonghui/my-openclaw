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
  
  return `---\nname: file-io\ndescription: Read, write, and edit files inside the current project workspace.\n---\n\n# File IO\n\nUse the provided file tools instead of guessing file contents.\n\n## ⚠️ IMPORTANT - Write Command Requires content Parameter\n**When using write/create command, you MUST include the content parameter with the FULL file content.**\n- ❌ WRONG: \`{"path": "file.txt", "command": "write"}\` — will fail!\n- ✅ CORRECT: \`{"path": "file.txt", "command": "write", "content": "Hello World"}\`\n\n## Tools\n- **list** (alias: list_files): inspect project directories\n- **read** (alias: read_file): read file content\n- **write** (alias: **create**, write_file): create or fully overwrite files (⚠️ requires content!)\n- **edit** (alias: edit_file): make exact-text replacements\n\n## Required Parameters\n- write/create requires: \`{"path": "filename.ext", "command": "write", "content": "文件内容"}\`\n- edit requires: \`{"path": "file", "command": "edit", "oldText": "原内容", "newText": "新内容"}\`\n- read requires: \`{"path": "file", "command": "read"}\`\n- list requires: \`{"path": "directory", "command": "list"}\`\n\n## Path Rules\n${pathHint}\n- Example project path: ${platform.pathExample}\n- Always use the project workspace path for file operations.\n\n## Rules\n- Only operate inside the current project workspace.\n- Read before editing unless the user clearly asked to create/overwrite a file.\n- Prefer edit for surgical changes.\n- Preserve existing formatting unless the user requested a refactor.\n- Explain what changed after file operations complete.`;
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
  description: 'Execute shell commands and git operations. Use when you need to run system commands, git workflows, file navigation, process management, or any command-line operations.',
  url: 'builtin://shell-cmd',
  builtIn: true,
  rawContent: `---
name: shell-cmd
description: Execute shell commands and git operations. Use when you need to run system commands, git workflows, file navigation, process management, or any command-line operations.
---

# Shell Command Execution

Use the \`exec\` tool to run shell commands.

## Common Patterns

### File inspection
\`\`\`bash
ls /path/to/dir
cat file.txt
grep -n "pattern" file.py
find . -name "*.ts"
\`\`\`

### Git workflows
\`\`\`bash
git status
git add .
git commit -m "message"
git push
git pull
git checkout branch
git log --oneline -10
\`\`\`

### Build
\`\`\`bash
npm install
npm run build
\`\`\`

## Rules
- Destructive commands (rm, git push --force) — ask user first
- Use \`timeout\` for long-running commands
- WSL paths: /mnt/d/...
`
};

export const BUILTIN_INLINE_PYTHON_SKILL = {
  id: 'builtin-inline-python-edit',
  name: 'inline-python-edit',
  description: 'Execute inline Python scripts for file editing. Use when you need to quickly run Python code snippets (read file content, find/replace text, modify files). Triggered by requests like "run python3 -c", "edit file with python", "execute python snippet".',
  url: 'builtin://inline-python-edit',
  builtIn: true,
  rawContent: `---
name: inline-python-edit
description: 快速执行 Python 单行脚本或编辑文件内容。当需要执行简单的 Python 代码片段（如读取文件、字符串替换、内容修改）时使用此技能。
---

# Inline Python Edit

## Execute Python snippet

For simple one-liner operations, use \`python3 -c\` directly:

\`\`\`bash
python3 -c "content = open('/path/file.py').read(); print(len(content))"
python3 -c "content = open('/path/file.py').read(); print(content.find('target'))"
\`\`\`

## Edit file with multi-line Python

Use \`scripts/edit_file.py\` for multi-line file edits:

\`\`\`bash
python3 /home/yonghui/workspace/openclaw/skills/inline-python-edit/scripts/edit_file.py \
  "/path/to/file.py" \
  'content = open("/path/to/file.py").read()
content = content.replace("old", "new")
open("/path/to/file.py", "w").write(content)'
\`\`\`

## Common patterns

**Replace string:**
\`\`\`bash
python3 -c "content = open('f.py').read(); print(content.replace('old', 'new')[:200])"
\`\`\`

**Find position:**
\`\`\`bash
python3 -c "content = open('f.py').read(); print(content.find('target'))"
\`\`\`

**Print excerpt:**
\`\`\`bash
python3 -c "content = open('f.py').read(); print(repr(content[1000:1200]))"
\`\`\`

**Stats:**
\`\`\`bash
python3 -c "content = open('f.py').read(); print(f'chars={len(content)}, lines={content.count(chr(10))}')"
\`\`\`

## Tips

- Always preview with print/repr before writing
- Use \`scripts/edit_file.py\` for multi-line Python code
- WSL paths: /mnt/d/workspace/...
- Use content.find() + repr() to locate exact strings before replacing
`
};

export const BUILTIN_FILE_IO_SKILL = {
  id: 'builtin-file-io',
  name: 'file-io',
  description: 'Project-scoped file reading and writing with safe workspace boundaries.',
  url: 'builtin://file-io',
  builtIn: true,
  rawContent: [
    '---',
    'name: file-io',
    'description: Read, write, and edit files inside the current project workspace. Use when the task requires inspecting code, generating files, patching existing files, or listing directories.',
    '---',
    '',
    '# File IO',
    '',
    'Use the provided file tools instead of guessing file contents.',
    '',
    '## ⚠️ IMPORTANT - Write Command Requires content Parameter',
    '**When using write command, you MUST include the content parameter with the FULL file content.**',
    '- ❌ WRONG: {"path": "file.txt", "command": "write"} — will fail!',
    '- ✅ CORRECT: {"path": "file.txt", "command": "write", "content": "Hello World"}',
    '',
    '## Tools',
    '- `list` (alias: list_files): inspect project directories',
    '- `read` (alias: read_file): read file content',
    '- `write` (alias: **create**, write_file): create or fully overwrite files (⚠️ requires content!)',
    '- `edit` (alias: edit_file): make exact-text replacements',
    '',
    '## Required Parameters',
    '- write/create requires: {"path": "filename.ext", "command": "write", "content": "文件内容"}',
    '- edit requires: {"path": "file", "command": "edit", "oldText": "原内容", "newText": "新内容"}',
    '- read requires: {"path": "file", "command": "read"}',
    '- list requires: {"path": "directory", "command": "list"}',
    '',
    '## Rules',
    '- Only operate inside the current project workspace.',
    '- Read before editing unless the user clearly asked to create/overwrite a file.',
    '- Prefer `edit` for surgical changes.',
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
