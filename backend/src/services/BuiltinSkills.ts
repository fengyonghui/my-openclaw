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
    '## Tools',
    '- `list_files`: inspect project directories before changing things',
    '- `read_file`: read file content before editing',
    '- `write_file`: create or fully overwrite files',
    '- `edit_file`: make exact-text replacements in an existing file',
    '',
    '## Rules',
    '- Only operate inside the current project workspace.',
    '- Read before editing unless the user clearly asked to create/overwrite a file.',
    '- Prefer `edit_file` for surgical changes.',
    '- Preserve existing formatting unless the user requested a refactor.',
    '- Explain what changed after file operations complete.'
  ].join('\n')
};
